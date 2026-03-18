import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

const TABS = [
  { id: "active_products", label: "Active Products" },
  { id: "suppliers", label: "Supplier Directory" },
  { id: "support", label: "Support Queue" },
  { id: "revenue", label: "Revenue" },
];

const SUPPLIER_STATUSES = ["active", "backup", "blacklisted", "inactive"];
const SUPPLIER_STATUS_COLOR = {
  active: "#10b981",
  backup: "#f59e0b",
  blacklisted: "#ef4444",
  inactive: "#64748b",
};

const ISSUE_TYPES = [
  "shipping",
  "quality",
  "refund",
  "exchange",
  "question",
  "missing_item",
  "wrong_item",
  "other",
];

const PRIORITIES = ["low", "normal", "urgent"];
const PRIORITY_COLOR = {
  low: "#64748b",
  normal: "#3b82f6",
  urgent: "#ef4444",
};

const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_customer",
  "waiting_supplier",
  "resolved",
  "closed",
];

const TICKET_STATUS_COLOR = {
  open: "#ef4444",
  in_progress: "#8b5cf6",
  waiting_customer: "#f59e0b",
  waiting_supplier: "#3b82f6",
  resolved: "#10b981",
  closed: "#64748b",
};

const NEXT_TICKET_STATUS = {
  open: "in_progress",
  in_progress: "waiting_customer",
  waiting_customer: "waiting_supplier",
  waiting_supplier: "resolved",
  resolved: "closed",
};

const PRODUCT_SUPPLIER_ROLES = ["primary", "backup", "sample_only"];

const inputStyle = {
  width: "100%",
  background: "#0b1220",
  border: "1px solid #1e293b",
  color: "#e2e8f0",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function defaultSupplierForm() {
  return {
    name: "",
    contact_method: "",
    contact_info: "",
    website: "",
    products_supplied: "",
    communication_rating: 3,
    quality_rating: 3,
    reliability_rating: 3,
    price_rating: 3,
    status: "active",
    notes: "",
    red_flags: "",
    avg_shipping_days: "",
    shipping_method: "",
    ships_from: "",
  };
}

function defaultLinkForm() {
  return {
    product_id: "",
    role: "primary",
    unit_cost: "",
    shipping_cost: "",
    moq: "",
    notes: "",
  };
}

function defaultTicketForm() {
  return {
    customer_name: "",
    customer_email: "",
    order_number: "",
    product_id: "",
    issue_type: "shipping",
    priority: "normal",
    status: "open",
    description: "",
    resolution: "",
    resolved_at: "",
    refund_amount: "",
    replacement_sent: false,
  };
}

function defaultRevenueForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    product_id: "",
    orders_count: "",
    gross_revenue: "",
    refunds: "",
  };
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatCurrency(value) {
  const n = Number(value || 0);
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function monthStartDate() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function weekStartDate() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function ymd(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function StoreOrders() {
  const [activeTab, setActiveTab] = useState("active_products");
  const [isLoading, setIsLoading] = useState(true);
  const [isWriting, setIsWriting] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [productSuppliers, setProductSuppliers] = useState([]);
  const [supportTickets, setSupportTickets] = useState([]);
  const [dailyRevenue, setDailyRevenue] = useState([]);

  const [editingProduct, setEditingProduct] = useState(null);
  const [economicsForm, setEconomicsForm] = useState({ aov: "", cogs: "", shipping_cost: "" });

  const [supplierStatusFilter, setSupplierStatusFilter] = useState("all");
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [supplierForm, setSupplierForm] = useState(defaultSupplierForm());

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkSupplier, setLinkSupplier] = useState(null);
  const [linkForm, setLinkForm] = useState(defaultLinkForm());

  const [ticketFilters, setTicketFilters] = useState({
    status: "all",
    issue_type: "all",
    priority: "all",
    product_id: "all",
  });
  const [showResolvedTickets, setShowResolvedTickets] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [editingTicket, setEditingTicket] = useState(null);
  const [ticketForm, setTicketForm] = useState(defaultTicketForm());

  const [dateFrom, setDateFrom] = useState(ymd(monthStartDate()));
  const [dateTo, setDateTo] = useState(ymd(new Date()));
  const [showRevenueModal, setShowRevenueModal] = useState(false);
  const [editingRevenue, setEditingRevenue] = useState(null);
  const [revenueForm, setRevenueForm] = useState(defaultRevenueForm());

  const pushToast = useCallback((message, type = "error") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const withWrite = useCallback(
    async (operation, successMessage) => {
      setIsWriting(true);
      try {
        const ok = await operation();
        if (ok && successMessage) {
          pushToast(successMessage, "success");
        }
        return ok;
      } finally {
        setIsWriting(false);
      }
    },
    [pushToast]
  );

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    const [productsRes, suppliersRes, psRes, ticketsRes, revenueRes] = await Promise.all([
      supabase.from("products").select("*").order("updated_at", { ascending: false }),
      supabase.from("suppliers").select("*").order("name", { ascending: true }),
      supabase.from("product_suppliers").select("*"),
      supabase.from("support_tickets").select("*"),
      supabase.from("daily_revenue").select("*").order("date", { ascending: false }),
    ]);

    if (productsRes.error) pushToast(`Could not load products: ${productsRes.error.message}`, "error");
    if (suppliersRes.error) pushToast(`Could not load suppliers: ${suppliersRes.error.message}`, "error");
    if (psRes.error) pushToast(`Could not load product-supplier links: ${psRes.error.message}`, "error");
    if (ticketsRes.error) pushToast(`Could not load support tickets: ${ticketsRes.error.message}`, "error");
    if (revenueRes.error) pushToast(`Could not load daily revenue: ${revenueRes.error.message}`, "error");

    setProducts(productsRes.data || []);
    setSuppliers(suppliersRes.data || []);
    setProductSuppliers(psRes.data || []);
    setSupportTickets(ticketsRes.data || []);
    setDailyRevenue(revenueRes.data || []);
    setIsLoading(false);
  }, [pushToast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchAll();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAll]);

  const productById = useMemo(() => {
    const map = {};
    products.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [products]);

  const supplierById = useMemo(() => {
    const map = {};
    suppliers.forEach((s) => {
      map[s.id] = s;
    });
    return map;
  }, [suppliers]);

  const activeProducts = useMemo(
    () => products.filter((p) => ["live", "execution_ready"].includes(p.stage)),
    [products]
  );

  const weekStart = useMemo(() => weekStartDate(), []);
  const monthStart = useMemo(() => monthStartDate(), []);

  const revenueByProduct = useMemo(() => {
    const week = {};
    const month = {};
    dailyRevenue.forEach((entry) => {
      const d = new Date(entry.date || 0);
      if (Number.isNaN(d.getTime())) return;
      const id = entry.product_id;
      if (!id) return;
      const net = Number(entry.net_revenue ?? (Number(entry.gross_revenue || 0) - Number(entry.refunds || 0)));
      if (d >= weekStart) {
        week[id] = (week[id] || 0) + net;
      }
      if (d >= monthStart) {
        month[id] = (month[id] || 0) + net;
      }
    });
    return { week, month };
  }, [dailyRevenue, weekStart, monthStart]);

  const supplierLinksByProduct = useMemo(() => {
    const map = {};
    productSuppliers.forEach((link) => {
      const pid = link.product_id;
      if (!map[pid]) map[pid] = [];
      map[pid].push(link);
    });
    return map;
  }, [productSuppliers]);

  const filteredSuppliers = useMemo(() => {
    if (supplierStatusFilter === "all") return suppliers;
    return suppliers.filter((s) => s.status === supplierStatusFilter);
  }, [suppliers, supplierStatusFilter]);

  const ticketStats = useMemo(() => {
    const weekAgo = weekStartDate();
    const base = {
      open: 0,
      in_progress: 0,
      waiting_customer: 0,
      waiting_supplier: 0,
      resolved_week: 0,
      refunds_week: 0,
    };
    supportTickets.forEach((t) => {
      if (t.status === "open") base.open += 1;
      if (t.status === "in_progress") base.in_progress += 1;
      if (t.status === "waiting_customer") base.waiting_customer += 1;
      if (t.status === "waiting_supplier") base.waiting_supplier += 1;

      const resolvedAt = new Date(t.resolved_at || 0);
      if (!Number.isNaN(resolvedAt.getTime()) && resolvedAt >= weekAgo) {
        if (["resolved", "closed"].includes(t.status)) base.resolved_week += 1;
        base.refunds_week += Number(t.refund_amount || 0);
      }
    });
    return base;
  }, [supportTickets]);

  const filteredTickets = useMemo(() => {
    let list = [...supportTickets];
    if (ticketFilters.status !== "all") list = list.filter((t) => t.status === ticketFilters.status);
    if (ticketFilters.issue_type !== "all") list = list.filter((t) => t.issue_type === ticketFilters.issue_type);
    if (ticketFilters.priority !== "all") list = list.filter((t) => t.priority === ticketFilters.priority);
    if (ticketFilters.product_id !== "all") list = list.filter((t) => String(t.product_id || "") === ticketFilters.product_id);
    return list;
  }, [supportTickets, ticketFilters]);

  const unresolvedTickets = useMemo(() => {
    return filteredTickets
      .filter((t) => !["resolved", "closed"].includes(t.status))
      .sort((a, b) => {
        const pA = a.priority === "urgent" ? 0 : a.priority === "normal" ? 1 : 2;
        const pB = b.priority === "urgent" ? 0 : b.priority === "normal" ? 1 : 2;
        if (pA !== pB) return pA - pB;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
  }, [filteredTickets]);

  const resolvedTickets = useMemo(() => {
    return filteredTickets
      .filter((t) => ["resolved", "closed"].includes(t.status))
      .sort((a, b) => new Date(b.resolved_at || 0).getTime() - new Date(a.resolved_at || 0).getTime());
  }, [filteredTickets]);

  const filteredRevenue = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo) : null;
    if (to) to.setHours(23, 59, 59, 999);
    return dailyRevenue.filter((r) => {
      const d = new Date(r.date || 0);
      if (Number.isNaN(d.getTime())) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [dailyRevenue, dateFrom, dateTo]);

  const revenueSummary = useMemo(() => {
    return filteredRevenue.reduce(
      (acc, row) => {
        acc.orders += Number(row.orders_count || 0);
        acc.gross += Number(row.gross_revenue || 0);
        acc.refunds += Number(row.refunds || 0);
        acc.net += Number(row.net_revenue ?? (Number(row.gross_revenue || 0) - Number(row.refunds || 0)));
        return acc;
      },
      { orders: 0, gross: 0, refunds: 0, net: 0 }
    );
  }, [filteredRevenue]);

  const revenueByDay = useMemo(() => {
    const map = {};
    filteredRevenue.forEach((row) => {
      const key = row.date;
      if (!map[key]) map[key] = 0;
      map[key] += Number(row.net_revenue ?? (Number(row.gross_revenue || 0) - Number(row.refunds || 0)));
    });
    const points = Object.entries(map)
      .map(([date, net]) => ({ date, net }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const max = points.reduce((m, p) => Math.max(m, p.net), 0);
    return { points, max };
  }, [filteredRevenue]);

  const revenueByProductBreakdown = useMemo(() => {
    const map = {};
    filteredRevenue.forEach((row) => {
      const key = row.product_id || "unknown";
      if (!map[key]) {
        map[key] = { orders: 0, gross: 0, refunds: 0, net: 0 };
      }
      map[key].orders += Number(row.orders_count || 0);
      map[key].gross += Number(row.gross_revenue || 0);
      map[key].refunds += Number(row.refunds || 0);
      map[key].net += Number(row.net_revenue ?? (Number(row.gross_revenue || 0) - Number(row.refunds || 0)));
    });
    return Object.entries(map)
      .map(([productId, data]) => ({ productId, ...data }))
      .sort((a, b) => b.net - a.net);
  }, [filteredRevenue]);

  const openEconomicsModal = (product) => {
    setEditingProduct(product);
    setEconomicsForm({
      aov: product.aov ?? "",
      cogs: product.cogs ?? "",
      shipping_cost: product.shipping_cost ?? "",
    });
  };

  const saveEconomics = async () => {
    if (!editingProduct?.id) return;
    await withWrite(async () => {
      const payload = {
        aov: toNumber(economicsForm.aov),
        cogs: toNumber(economicsForm.cogs),
        shipping_cost: toNumber(economicsForm.shipping_cost),
      };
      const { error } = await supabase.from("products").update(payload).eq("id", editingProduct.id);
      if (error) {
        pushToast(`Could not update product economics: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      setEditingProduct(null);
      return true;
    }, "Product economics updated");
  };

  const openSupplierModal = (supplier = null) => {
    setEditingSupplier(supplier);
    setSupplierForm(
      supplier
        ? {
            ...defaultSupplierForm(),
            ...supplier,
            communication_rating: supplier.communication_rating ?? 3,
            quality_rating: supplier.quality_rating ?? 3,
            reliability_rating: supplier.reliability_rating ?? 3,
            price_rating: supplier.price_rating ?? 3,
            avg_shipping_days: supplier.avg_shipping_days ?? "",
          }
        : defaultSupplierForm()
    );
    setShowSupplierModal(true);
  };

  const saveSupplier = async () => {
    await withWrite(async () => {
      const payload = {
        ...supplierForm,
        communication_rating: toNumber(supplierForm.communication_rating),
        quality_rating: toNumber(supplierForm.quality_rating),
        reliability_rating: toNumber(supplierForm.reliability_rating),
        price_rating: toNumber(supplierForm.price_rating),
        avg_shipping_days: toNumber(supplierForm.avg_shipping_days),
      };

      if (editingSupplier?.id) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", editingSupplier.id);
        if (error) {
          pushToast(`Could not update supplier: ${error.message}`, "error");
          return false;
        }
      } else {
        const { error } = await supabase.from("suppliers").insert(payload);
        if (error) {
          pushToast(`Could not create supplier: ${error.message}`, "error");
          return false;
        }
      }

      await fetchAll();
      setShowSupplierModal(false);
      return true;
    }, editingSupplier ? "Supplier updated" : "Supplier created");
  };

  const openLinkModal = (supplier) => {
    setLinkSupplier(supplier);
    setLinkForm(defaultLinkForm());
    setShowLinkModal(true);
  };

  const linkSupplierToProduct = async () => {
    if (!linkSupplier?.id) return;
    await withWrite(async () => {
      const payload = {
        supplier_id: linkSupplier.id,
        product_id: linkForm.product_id || null,
        role: linkForm.role,
        unit_cost: toNumber(linkForm.unit_cost),
        shipping_cost: toNumber(linkForm.shipping_cost),
        moq: toNumber(linkForm.moq),
        notes: linkForm.notes,
      };
      const { error } = await supabase.from("product_suppliers").insert(payload);
      if (error) {
        pushToast(`Could not link supplier to product: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      setLinkForm(defaultLinkForm());
      return true;
    }, "Supplier linked");
  };

  const unlinkProductSupplier = async (linkId) => {
    await withWrite(async () => {
      const { error } = await supabase.from("product_suppliers").delete().eq("id", linkId);
      if (error) {
        pushToast(`Could not unlink supplier: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      return true;
    }, "Supplier unlinked");
  };

  const openTicketModal = (ticket = null) => {
    setEditingTicket(ticket);
    setTicketForm(
      ticket
        ? {
            ...defaultTicketForm(),
            ...ticket,
            product_id: ticket.product_id || "",
            resolved_at: ticket.resolved_at ? new Date(ticket.resolved_at).toISOString().slice(0, 16) : "",
            refund_amount: ticket.refund_amount ?? "",
          }
        : defaultTicketForm()
    );
    setShowTicketModal(true);
  };

  const saveTicket = async () => {
    await withWrite(async () => {
      const payload = {
        ...ticketForm,
        product_id: ticketForm.product_id || null,
        refund_amount: toNumber(ticketForm.refund_amount),
        resolved_at: ticketForm.resolved_at ? new Date(ticketForm.resolved_at).toISOString() : null,
      };

      if (editingTicket?.id) {
        const { error } = await supabase.from("support_tickets").update(payload).eq("id", editingTicket.id);
        if (error) {
          pushToast(`Could not update ticket: ${error.message}`, "error");
          return false;
        }
      } else {
        const { error } = await supabase.from("support_tickets").insert(payload);
        if (error) {
          pushToast(`Could not create ticket: ${error.message}`, "error");
          return false;
        }
      }

      await fetchAll();
      setShowTicketModal(false);
      return true;
    }, editingTicket ? "Ticket updated" : "Ticket created");
  };

  const advanceTicketStatus = async (ticket) => {
    const next = NEXT_TICKET_STATUS[ticket.status];
    if (!next) return;
    await withWrite(async () => {
      const payload = {
        status: next,
        resolved_at: next === "resolved" ? new Date().toISOString() : ticket.resolved_at,
      };
      const { error } = await supabase.from("support_tickets").update(payload).eq("id", ticket.id);
      if (error) {
        pushToast(`Could not update ticket status: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      return true;
    }, `Ticket moved to ${next}`);
  };

  const openRevenueModal = (row = null) => {
    setEditingRevenue(row);
    setRevenueForm(
      row
        ? {
            date: row.date || ymd(new Date()),
            product_id: row.product_id || "",
            orders_count: row.orders_count ?? "",
            gross_revenue: row.gross_revenue ?? "",
            refunds: row.refunds ?? "",
          }
        : defaultRevenueForm()
    );
    setShowRevenueModal(true);
  };

  const saveRevenue = async () => {
    await withWrite(async () => {
      const payload = {
        date: revenueForm.date,
        product_id: revenueForm.product_id || null,
        orders_count: toNumber(revenueForm.orders_count),
        gross_revenue: toNumber(revenueForm.gross_revenue),
        refunds: toNumber(revenueForm.refunds),
      };

      if (editingRevenue?.id) {
        const { error } = await supabase.from("daily_revenue").update(payload).eq("id", editingRevenue.id);
        if (error) {
          pushToast(`Could not update daily revenue: ${error.message}`, "error");
          return false;
        }
      } else {
        const { error } = await supabase.from("daily_revenue").insert(payload);
        if (error) {
          pushToast(`Could not create daily revenue entry: ${error.message}`, "error");
          return false;
        }
      }

      await fetchAll();
      setShowRevenueModal(false);
      return true;
    }, editingRevenue ? "Revenue entry updated" : "Revenue entry created");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#e2e8f0",
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
        padding: "16px 18px",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes writeProgressSlide {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes spinner {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {isWriting && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: 3,
            zIndex: 3100,
            background:
              "linear-gradient(90deg, rgba(233,69,96,0), rgba(233,69,96,0.95), rgba(56,189,248,0.95), rgba(233,69,96,0))",
            backgroundSize: "220% 100%",
            animation: "writeProgressSlide 1.1s linear infinite",
            boxShadow: "0 0 10px rgba(233,69,96,0.45)",
          }}
        />
      )}

      <div style={{ marginBottom: 10, color: "#e94560", fontWeight: 800, letterSpacing: "0.05em", fontSize: 14 }}>
        STORE & ORDERS
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={tabButtonStyle(activeTab === tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              width: 24,
              height: 24,
              border: "2px solid rgba(148,163,184,0.25)",
              borderTopColor: "#38bdf8",
              borderRadius: "50%",
              animation: "spinner 0.8s linear infinite",
            }}
          />
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Loading...</div>
        </div>
      ) : (
        <>
          {activeTab === "active_products" && (
            <section style={panelStyle}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
                {activeProducts.map((product) => {
                  const aov = Number(product.aov || 0);
                  const cogs = Number(product.cogs || 0);
                  const shipping = Number(product.shipping_cost || 0);
                  const processingFee = aov * 0.0425;
                  const marginPerUnit = aov - cogs - shipping - processingFee;
                  const marginPct = aov > 0 ? (marginPerUnit / aov) * 100 : 0;
                  const marginColor = marginPct > 40 ? "#10b981" : marginPct >= 25 ? "#f59e0b" : "#ef4444";

                  const links = supplierLinksByProduct[product.id] || [];
                  const primary = links.find((l) => l.role === "primary");
                  const backup = links.find((l) => l.role === "backup");
                  const primarySupplier = primary ? supplierById[primary.supplier_id]?.name : null;
                  const backupSupplier = backup ? supplierById[backup.supplier_id]?.name : null;

                  const weekRevenue = revenueByProduct.week[product.id] || 0;
                  const monthRevenue = revenueByProduct.month[product.id] || 0;

                  return (
                    <div key={product.id} style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 10, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{product.name || "Unnamed product"}</div>
                        <MarginBadge color={marginColor} label={`${marginPct.toFixed(1)}%`} />
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                        Store URL: {product.source_url || "-"}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                        <MetricRow label="AOV" value={formatCurrency(aov)} />
                        <MetricRow label="COGS" value={formatCurrency(cogs)} />
                        <MetricRow label="Shipping" value={formatCurrency(shipping)} />
                        <MetricRow label="Processing 4.25%" value={formatCurrency(processingFee)} />
                        <MetricRow label="Margin / unit" value={formatCurrency(marginPerUnit)} />
                        <MetricRow label="Margin %" value={`${marginPct.toFixed(1)}%`} />
                      </div>

                      <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 4 }}>
                        Primary supplier: <strong>{primarySupplier || "-"}</strong>
                      </div>
                      <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 8 }}>
                        Backup supplier: <strong>{backupSupplier || "-"}</strong>
                      </div>

                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <StatChip label="Week Revenue" value={formatCurrency(weekRevenue)} color="#3b82f6" />
                        <StatChip label="Month Revenue" value={formatCurrency(monthRevenue)} color="#8b5cf6" />
                      </div>

                      <button style={ghostButtonStyle} onClick={() => openEconomicsModal(product)}>
                        Quick edit economics
                      </button>
                    </div>
                  );
                })}
                {activeProducts.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>No active/execution-ready products found.</div>}
              </div>
            </section>
          )}

          {activeTab === "suppliers" && (
            <section style={panelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
                <select value={supplierStatusFilter} onChange={(e) => setSupplierStatusFilter(e.target.value)} style={{ ...inputStyle, width: 200 }}>
                  <option value="all">All statuses</option>
                  {SUPPLIER_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button style={primaryButtonStyle} onClick={() => openSupplierModal()}>
                  + Add supplier
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
                {filteredSuppliers.map((supplier) => (
                  <div key={supplier.id} style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 10, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{supplier.name || "Unnamed supplier"}</div>
                      <Pill label={supplier.status || "inactive"} color={SUPPLIER_STATUS_COLOR[supplier.status] || "#64748b"} />
                    </div>
                    <div style={{ fontSize: 11, color: "#cbd5e1" }}>
                      {supplier.contact_method || "-"}: {supplier.contact_info || "-"}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                      Products: {supplier.products_supplied || "-"}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <RatingBar label="Communication" value={supplier.communication_rating} />
                      <RatingBar label="Quality" value={supplier.quality_rating} />
                      <RatingBar label="Reliability" value={supplier.reliability_rating} />
                      <RatingBar label="Price" value={supplier.price_rating} />
                    </div>
                    <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 6 }}>
                      Shipping: {supplier.avg_shipping_days ?? "-"} days • {supplier.shipping_method || "-"} • {supplier.ships_from || "-"}
                    </div>
                    {!!supplier.red_flags && (
                      <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 6, border: "1px solid rgba(239,68,68,0.4)", padding: "6px 8px", borderRadius: 8, background: "rgba(239,68,68,0.12)" }}>
                        Red flags: {supplier.red_flags}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button style={ghostButtonStyle} onClick={() => openSupplierModal(supplier)}>Edit</button>
                      <button style={ghostButtonStyle} onClick={() => openLinkModal(supplier)}>Link products</button>
                    </div>
                  </div>
                ))}
                {filteredSuppliers.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>No suppliers found for this filter.</div>}
              </div>
            </section>
          )}

          {activeTab === "support" && (
            <section style={panelStyle}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 10 }}>
                <StatChip label="Open" value={ticketStats.open} color={TICKET_STATUS_COLOR.open} />
                <StatChip label="In Progress" value={ticketStats.in_progress} color={TICKET_STATUS_COLOR.in_progress} />
                <StatChip label="Waiting Customer" value={ticketStats.waiting_customer} color={TICKET_STATUS_COLOR.waiting_customer} />
                <StatChip label="Waiting Supplier" value={ticketStats.waiting_supplier} color={TICKET_STATUS_COLOR.waiting_supplier} />
                <StatChip label="Resolved This Week" value={ticketStats.resolved_week} color="#10b981" />
                <StatChip label="Refunds This Week" value={formatCurrency(ticketStats.refunds_week)} color="#ef4444" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr)) auto", gap: 8, marginBottom: 10 }}>
                <select value={ticketFilters.status} onChange={(e) => setTicketFilters((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>
                  <option value="all">All statuses</option>
                  {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={ticketFilters.issue_type} onChange={(e) => setTicketFilters((p) => ({ ...p, issue_type: e.target.value }))} style={inputStyle}>
                  <option value="all">All issue types</option>
                  {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
                <select value={ticketFilters.priority} onChange={(e) => setTicketFilters((p) => ({ ...p, priority: e.target.value }))} style={inputStyle}>
                  <option value="all">All priorities</option>
                  {PRIORITIES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
                </select>
                <select value={ticketFilters.product_id} onChange={(e) => setTicketFilters((p) => ({ ...p, product_id: e.target.value }))} style={inputStyle}>
                  <option value="all">All products</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div />
                <button style={primaryButtonStyle} onClick={() => openTicketModal()}>+ Add ticket</button>
              </div>

              <div style={{ border: "1px solid #1e293b", borderRadius: 10, overflow: "auto", marginBottom: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead>
                    <tr style={{ background: "#111827" }}>
                      <Th>Date</Th>
                      <Th>Customer / Order</Th>
                      <Th>Product</Th>
                      <Th>Issue</Th>
                      <Th>Priority</Th>
                      <Th>Status</Th>
                      <Th>Description</Th>
                      <Th>Quick Action</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {unresolvedTickets.map((ticket) => (
                      <tr key={ticket.id} style={{ borderTop: "1px solid #1e293b" }}>
                        <Td>{new Date(ticket.created_at || ticket.updated_at || Date.now()).toLocaleDateString()}</Td>
                        <Td>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{ticket.customer_name || "-"}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>#{ticket.order_number || "-"}</div>
                        </Td>
                        <Td>{productById[ticket.product_id]?.name || "-"}</Td>
                        <Td><Pill label={ticket.issue_type || "other"} color="#3b82f6" /></Td>
                        <Td><Pill label={ticket.priority || "normal"} color={PRIORITY_COLOR[ticket.priority] || "#64748b"} /></Td>
                        <Td><Pill label={ticket.status || "open"} color={TICKET_STATUS_COLOR[ticket.status] || "#64748b"} /></Td>
                        <Td>
                          <button style={{ ...linkButtonStyle, textAlign: "left" }} onClick={() => openTicketModal(ticket)}>
                            {(ticket.description || "").slice(0, 80) || "-"}
                          </button>
                        </Td>
                        <Td>
                          {NEXT_TICKET_STATUS[ticket.status] ? (
                            <button style={ghostButtonStyle} onClick={() => void advanceTicketStatus(ticket)}>
                              → {NEXT_TICKET_STATUS[ticket.status]}
                            </button>
                          ) : (
                            "-"
                          )}
                        </Td>
                      </tr>
                    ))}
                    {unresolvedTickets.length === 0 && (
                      <tr><Td colSpan={8}><div style={{ fontSize: 12, color: "#94a3b8" }}>No unresolved tickets.</div></Td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <button style={ghostButtonStyle} onClick={() => setShowResolvedTickets((v) => !v)}>
                {showResolvedTickets ? "Hide resolved tickets" : `Show resolved tickets (${resolvedTickets.length})`}
              </button>

              {showResolvedTickets && (
                <div style={{ border: "1px solid #1e293b", borderRadius: 10, overflow: "auto", marginTop: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead>
                      <tr style={{ background: "#111827" }}>
                        <Th>Date</Th>
                        <Th>Customer</Th>
                        <Th>Product</Th>
                        <Th>Status</Th>
                        <Th>Resolution</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {resolvedTickets.map((ticket) => (
                        <tr key={ticket.id} style={{ borderTop: "1px solid #1e293b" }}>
                          <Td>{new Date(ticket.resolved_at || ticket.updated_at || Date.now()).toLocaleDateString()}</Td>
                          <Td>
                            <button style={{ ...linkButtonStyle, textAlign: "left" }} onClick={() => openTicketModal(ticket)}>
                              {ticket.customer_name || "-"}
                            </button>
                          </Td>
                          <Td>{productById[ticket.product_id]?.name || "-"}</Td>
                          <Td><Pill label={ticket.status} color={TICKET_STATUS_COLOR[ticket.status] || "#64748b"} /></Td>
                          <Td>{(ticket.resolution || "-").slice(0, 80)}</Td>
                        </tr>
                      ))}
                      {resolvedTickets.length === 0 && (
                        <tr><Td colSpan={5}><div style={{ fontSize: 12, color: "#94a3b8" }}>No resolved tickets found.</div></Td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === "revenue" && (
            <section style={panelStyle}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 220px) auto", gap: 8, marginBottom: 10, alignItems: "center" }}>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
                <button style={{ ...primaryButtonStyle, justifySelf: "end" }} onClick={() => openRevenueModal()}>
                  + Add daily entry
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
                <StatChip label="Total Orders" value={revenueSummary.orders} color="#3b82f6" />
                <StatChip label="Total Gross" value={formatCurrency(revenueSummary.gross)} color="#8b5cf6" />
                <StatChip label="Total Refunds" value={formatCurrency(revenueSummary.refunds)} color="#ef4444" />
                <StatChip label="Total Net" value={formatCurrency(revenueSummary.net)} color="#10b981" />
              </div>

              <div style={{ border: "1px solid #1e293b", borderRadius: 10, padding: 10, background: "#0b1220", marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Daily net revenue trend</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140 }}>
                  {revenueByDay.points.map((point) => (
                    <div key={point.date} style={{ flex: 1, minWidth: 16 }}>
                      <div
                        title={`${point.date}: ${formatCurrency(point.net)}`}
                        style={{
                          width: "100%",
                          height: `${revenueByDay.max > 0 ? Math.max(6, (point.net / revenueByDay.max) * 120) : 6}px`,
                          background: "#10b981",
                          borderRadius: "4px 4px 0 0",
                        }}
                      />
                      <div style={{ fontSize: 9, color: "#64748b", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {point.date}
                      </div>
                    </div>
                  ))}
                  {revenueByDay.points.length === 0 && (
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>No data for selected range.</div>
                  )}
                </div>
              </div>

              <div style={{ border: "1px solid #1e293b", borderRadius: 10, overflow: "auto", marginBottom: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
                  <thead>
                    <tr style={{ background: "#111827" }}>
                      <Th>Date</Th>
                      <Th>Product</Th>
                      <Th>Orders</Th>
                      <Th>Gross</Th>
                      <Th>Refunds</Th>
                      <Th>Net</Th>
                      <Th>Edit</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRevenue.map((row) => {
                      const net = Number(row.net_revenue ?? (Number(row.gross_revenue || 0) - Number(row.refunds || 0)));
                      return (
                        <tr key={row.id} style={{ borderTop: "1px solid #1e293b" }}>
                          <Td>{row.date}</Td>
                          <Td>{productById[row.product_id]?.name || "-"}</Td>
                          <Td>{Number(row.orders_count || 0)}</Td>
                          <Td>{formatCurrency(row.gross_revenue || 0)}</Td>
                          <Td>{formatCurrency(row.refunds || 0)}</Td>
                          <Td>{formatCurrency(net)}</Td>
                          <Td>
                            <button style={ghostButtonStyle} onClick={() => openRevenueModal(row)}>Edit</button>
                          </Td>
                        </tr>
                      );
                    })}
                    {filteredRevenue.length === 0 && (
                      <tr><Td colSpan={7}><div style={{ fontSize: 12, color: "#94a3b8" }}>No daily revenue entries in this range.</div></Td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ border: "1px solid #1e293b", borderRadius: 10, padding: 10, background: "#0b1220" }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Revenue by product</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
                  {revenueByProductBreakdown.map((row) => (
                    <div key={row.productId} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{productById[row.productId]?.name || "Unknown product"}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                        Orders: {row.orders} • Gross: {formatCurrency(row.gross)} • Refunds: {formatCurrency(row.refunds)} • Net: {formatCurrency(row.net)}
                      </div>
                    </div>
                  ))}
                  {revenueByProductBreakdown.length === 0 && (
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>No product breakdown data.</div>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {editingProduct && (
        <ModalShell title={`Edit Economics — ${editingProduct.name}`} onClose={() => setEditingProduct(null)} onConfirm={() => void saveEconomics()} confirmLabel="Save economics">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            <FieldGroup label="AOV"><input value={economicsForm.aov} onChange={(e) => setEconomicsForm((p) => ({ ...p, aov: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="COGS"><input value={economicsForm.cogs} onChange={(e) => setEconomicsForm((p) => ({ ...p, cogs: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Shipping Cost"><input value={economicsForm.shipping_cost} onChange={(e) => setEconomicsForm((p) => ({ ...p, shipping_cost: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
        </ModalShell>
      )}

      {showSupplierModal && (
        <ModalShell title={editingSupplier ? "Edit Supplier" : "Add Supplier"} onClose={() => setShowSupplierModal(false)} onConfirm={() => void saveSupplier()} confirmLabel={editingSupplier ? "Save supplier" : "Create supplier"}>
          <FieldGroup label="Name"><input value={supplierForm.name} onChange={(e) => setSupplierForm((p) => ({ ...p, name: e.target.value }))} style={inputStyle} /></FieldGroup>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Contact Method"><input value={supplierForm.contact_method} onChange={(e) => setSupplierForm((p) => ({ ...p, contact_method: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Contact Info"><input value={supplierForm.contact_info} onChange={(e) => setSupplierForm((p) => ({ ...p, contact_info: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Website"><input value={supplierForm.website} onChange={(e) => setSupplierForm((p) => ({ ...p, website: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Products Supplied"><input value={supplierForm.products_supplied} onChange={(e) => setSupplierForm((p) => ({ ...p, products_supplied: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <FieldGroup label="Communication"><input type="number" min="1" max="5" value={supplierForm.communication_rating} onChange={(e) => setSupplierForm((p) => ({ ...p, communication_rating: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Quality"><input type="number" min="1" max="5" value={supplierForm.quality_rating} onChange={(e) => setSupplierForm((p) => ({ ...p, quality_rating: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Reliability"><input type="number" min="1" max="5" value={supplierForm.reliability_rating} onChange={(e) => setSupplierForm((p) => ({ ...p, reliability_rating: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Price"><input type="number" min="1" max="5" value={supplierForm.price_rating} onChange={(e) => setSupplierForm((p) => ({ ...p, price_rating: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <FieldGroup label="Status">
              <select value={supplierForm.status} onChange={(e) => setSupplierForm((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>
                {SUPPLIER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </FieldGroup>
            <FieldGroup label="Avg Shipping Days"><input value={supplierForm.avg_shipping_days} onChange={(e) => setSupplierForm((p) => ({ ...p, avg_shipping_days: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Shipping Method"><input value={supplierForm.shipping_method} onChange={(e) => setSupplierForm((p) => ({ ...p, shipping_method: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Ships From"><input value={supplierForm.ships_from} onChange={(e) => setSupplierForm((p) => ({ ...p, ships_from: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
          <FieldGroup label="Notes"><textarea value={supplierForm.notes} onChange={(e) => setSupplierForm((p) => ({ ...p, notes: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} /></FieldGroup>
          <FieldGroup label="Red Flags"><textarea value={supplierForm.red_flags} onChange={(e) => setSupplierForm((p) => ({ ...p, red_flags: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} /></FieldGroup>
        </ModalShell>
      )}

      {showLinkModal && linkSupplier && (
        <ModalShell title={`Link Products — ${linkSupplier.name}`} onClose={() => setShowLinkModal(false)} onConfirm={() => void linkSupplierToProduct()} confirmLabel="Link supplier">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <FieldGroup label="Product">
              <select value={linkForm.product_id} onChange={(e) => setLinkForm((p) => ({ ...p, product_id: e.target.value }))} style={inputStyle}>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FieldGroup>
            <FieldGroup label="Role">
              <select value={linkForm.role} onChange={(e) => setLinkForm((p) => ({ ...p, role: e.target.value }))} style={inputStyle}>
                {PRODUCT_SUPPLIER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </FieldGroup>
            <FieldGroup label="MOQ"><input value={linkForm.moq} onChange={(e) => setLinkForm((p) => ({ ...p, moq: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Unit Cost"><input value={linkForm.unit_cost} onChange={(e) => setLinkForm((p) => ({ ...p, unit_cost: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Shipping Cost"><input value={linkForm.shipping_cost} onChange={(e) => setLinkForm((p) => ({ ...p, shipping_cost: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
          <FieldGroup label="Notes"><textarea value={linkForm.notes} onChange={(e) => setLinkForm((p) => ({ ...p, notes: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} /></FieldGroup>

          <div style={{ marginTop: 10, border: "1px solid #1e293b", borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Current links</div>
            {(productSuppliers.filter((l) => l.supplier_id === linkSupplier.id)).map((l) => (
              <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1e293b", padding: "6px 0" }}>
                <div style={{ fontSize: 12 }}>
                  {productById[l.product_id]?.name || "-"} • {l.role}
                </div>
                <button style={{ ...ghostButtonStyle, borderColor: "rgba(239,68,68,0.5)", color: "#fca5a5" }} onClick={() => void unlinkProductSupplier(l.id)}>
                  Unlink
                </button>
              </div>
            ))}
            {(productSuppliers.filter((l) => l.supplier_id === linkSupplier.id)).length === 0 && (
              <div style={{ fontSize: 12, color: "#64748b" }}>No links yet.</div>
            )}
          </div>
        </ModalShell>
      )}

      {showTicketModal && (
        <ModalShell title={editingTicket ? "Edit Support Ticket" : "Add Support Ticket"} onClose={() => setShowTicketModal(false)} onConfirm={() => void saveTicket()} confirmLabel={editingTicket ? "Save ticket" : "Create ticket"}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Customer Name"><input value={ticketForm.customer_name} onChange={(e) => setTicketForm((p) => ({ ...p, customer_name: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Customer Email"><input value={ticketForm.customer_email} onChange={(e) => setTicketForm((p) => ({ ...p, customer_email: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <FieldGroup label="Order #"><input value={ticketForm.order_number} onChange={(e) => setTicketForm((p) => ({ ...p, order_number: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Product">
              <select value={ticketForm.product_id} onChange={(e) => setTicketForm((p) => ({ ...p, product_id: e.target.value }))} style={inputStyle}>
                <option value="">No linked product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FieldGroup>
            <FieldGroup label="Issue Type">
              <select value={ticketForm.issue_type} onChange={(e) => setTicketForm((p) => ({ ...p, issue_type: e.target.value }))} style={inputStyle}>
                {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </FieldGroup>
            <FieldGroup label="Priority">
              <select value={ticketForm.priority} onChange={(e) => setTicketForm((p) => ({ ...p, priority: e.target.value }))} style={inputStyle}>
                {PRIORITIES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
              </select>
            </FieldGroup>
          </div>
          <FieldGroup label="Status">
            <select value={ticketForm.status} onChange={(e) => setTicketForm((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="Description"><textarea value={ticketForm.description} onChange={(e) => setTicketForm((p) => ({ ...p, description: e.target.value }))} style={{ ...inputStyle, minHeight: 86, resize: "vertical" }} /></FieldGroup>
          <FieldGroup label="Resolution"><textarea value={ticketForm.resolution} onChange={(e) => setTicketForm((p) => ({ ...p, resolution: e.target.value }))} style={{ ...inputStyle, minHeight: 86, resize: "vertical" }} /></FieldGroup>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Resolved At"><input type="datetime-local" value={ticketForm.resolved_at} onChange={(e) => setTicketForm((p) => ({ ...p, resolved_at: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Refund Amount"><input value={ticketForm.refund_amount} onChange={(e) => setTicketForm((p) => ({ ...p, refund_amount: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
          <label style={checkLabelStyle}>
            <input type="checkbox" checked={!!ticketForm.replacement_sent} onChange={(e) => setTicketForm((p) => ({ ...p, replacement_sent: e.target.checked }))} />
            Replacement Sent
          </label>
        </ModalShell>
      )}

      {showRevenueModal && (
        <ModalShell title={editingRevenue ? "Edit Daily Revenue" : "Add Daily Revenue"} onClose={() => setShowRevenueModal(false)} onConfirm={() => void saveRevenue()} confirmLabel={editingRevenue ? "Save entry" : "Create entry"}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Date"><input type="date" value={revenueForm.date} onChange={(e) => setRevenueForm((p) => ({ ...p, date: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Product">
              <select value={revenueForm.product_id} onChange={(e) => setRevenueForm((p) => ({ ...p, product_id: e.target.value }))} style={inputStyle}>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FieldGroup>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            <FieldGroup label="Orders Count"><input value={revenueForm.orders_count} onChange={(e) => setRevenueForm((p) => ({ ...p, orders_count: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Gross Revenue"><input value={revenueForm.gross_revenue} onChange={(e) => setRevenueForm((p) => ({ ...p, gross_revenue: e.target.value }))} style={inputStyle} /></FieldGroup>
            <FieldGroup label="Refunds"><input value={revenueForm.refunds} onChange={(e) => setRevenueForm((p) => ({ ...p, refunds: e.target.value }))} style={inputStyle} /></FieldGroup>
          </div>
        </ModalShell>
      )}

      <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 4000, display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
        {toasts.map((t) => <Toast key={t.id} message={t.message} type={t.type} />)}
      </div>
    </div>
  );
}

function MetricRow({ label, value }) {
  return (
    <div style={{ fontSize: 11, color: "#94a3b8", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 8px", background: "#0f172a" }}>
      <div style={{ color: "#64748b", marginBottom: 2 }}>{label}</div>
      <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function MarginBadge({ color, label }) {
  return (
    <span style={{ border: `1px solid ${color}66`, background: `${color}22`, color, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
      {label}
    </span>
  );
}

function RatingBar({ label, value }) {
  const v = Number(value || 0);
  return (
    <div>
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2 }}>
        {Array.from({ length: 5 }).map((_, i) => {
          const idx = i + 1;
          let color = "#1f2937";
          if (idx <= v) {
            if (idx <= 2) color = "#ef4444";
            else if (idx === 3) color = "#f59e0b";
            else color = "#10b981";
          }
          return <div key={idx} style={{ height: 6, borderRadius: 3, background: color }} />;
        })}
      </div>
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div style={{ border: `1px solid ${color}66`, background: `${color}20`, borderRadius: 8, padding: "7px 8px", fontSize: 11 }}>
      <div style={{ color: "#94a3b8", marginBottom: 2 }}>{label}</div>
      <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Pill({ label, color }) {
  return (
    <span style={{ borderRadius: 999, border: `1px solid ${color}66`, background: `${color}20`, color, fontSize: 10, fontWeight: 700, padding: "2px 8px", textTransform: "uppercase" }}>
      {label}
    </span>
  );
}

function ModalShell({ title, onClose, onConfirm, confirmLabel, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(2, 6, 23, 0.78)", zIndex: 3300, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div style={{ width: "min(900px, 100%)", maxHeight: "92vh", overflowY: "auto", background: "#0f0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h4 style={{ margin: 0, fontSize: 14 }}>{title}</h4>
          <button style={ghostButtonStyle} onClick={onClose}>Close</button>
        </div>
        {children}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button style={ghostButtonStyle} onClick={onClose}>Cancel</button>
          <button style={primaryButtonStyle} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.03em" }}>{label}</div>
      {children}
    </div>
  );
}

function Th({ children }) {
  return <th style={{ textAlign: "left", padding: "10px 9px", fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>{children}</th>;
}

function Td({ children, colSpan }) {
  return <td colSpan={colSpan} style={{ padding: "10px 9px", fontSize: 12, color: "#e2e8f0", verticalAlign: "top" }}>{children}</td>;
}

function Toast({ message, type }) {
  const isSuccess = type === "success";
  return (
    <div style={{ background: isSuccess ? "rgba(22, 163, 74, 0.92)" : "rgba(185, 28, 28, 0.92)", border: `1px solid ${isSuccess ? "rgba(74, 222, 128, 0.45)" : "rgba(252, 165, 165, 0.45)"}`, color: "#f8fafc", borderRadius: 10, padding: "10px 12px", fontSize: 12, fontWeight: 600, boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)" }}>
      {message}
    </div>
  );
}

const panelStyle = {
  background: "#0f0f1a",
  border: "1px solid #1e293b",
  borderRadius: 12,
  padding: 12,
};

const primaryButtonStyle = {
  background: "linear-gradient(135deg, #e94560, #c62a40)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const ghostButtonStyle = {
  background: "transparent",
  color: "#cbd5e1",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
};

const linkButtonStyle = {
  background: "transparent",
  color: "#e2e8f0",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontFamily: "inherit",
  width: "100%",
};

const checkLabelStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #1e293b",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  color: "#cbd5e1",
  background: "#0b1220",
};

function tabButtonStyle(active) {
  return {
    background: active ? "rgba(233, 69, 96, 0.15)" : "transparent",
    color: active ? "#e94560" : "#64748b",
    border: active ? "1px solid rgba(233, 69, 96, 0.3)" : "1px solid #334155",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
