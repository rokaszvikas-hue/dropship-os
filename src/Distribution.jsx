import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

const PLATFORM_META = {
  tiktok: { label: "TikTok", color: "#00f2ea", icon: "♪" },
  instagram: { label: "Instagram", color: "#E1306C", icon: "◎" },
  youtube: { label: "YouTube", color: "#FF0000", icon: "▶" },
  facebook: { label: "Facebook", color: "#1877F2", icon: "f" },
};

const DEFAULT_TARGETS = {
  tiktok: { daily_target: 2, weekly_target: 14 },
  instagram: { daily_target: 1, weekly_target: 7 },
  youtube: { daily_target: 1, weekly_target: 7 },
  facebook: { daily_target: 1, weekly_target: 7 },
};

const PLATFORMS = ["tiktok", "instagram", "youtube", "facebook"];

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

function defaultPublicationForm() {
  return {
    platform: "tiktok",
    title: "",
    hook_used: "",
    frame_used: "",
    product_id: "",
    published_url: "",
    published_at: new Date().toISOString().slice(0, 16),
    account_name: "",
    notes: "",
    views_24h: 0,
    views_48h: 0,
    views_7d: 0,
    views_current: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    likes: 0,
    is_outlier: false,
    is_store_trigger: false,
  };
}

function weekStartMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toLocalInputDateTime(dateLike) {
  const d = new Date(dateLike || Date.now());
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hrs = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hrs}:${mins}`;
}

function formatDateTime(dateLike) {
  if (!dateLike) return "-";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function formatDateShort(dateLike) {
  if (!dateLike) return "-";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function progressColor(ratio) {
  if (ratio >= 1) return "#10b981";
  if (ratio >= 0.7) return "#f59e0b";
  return "#ef4444";
}

export default function Distribution() {
  const [publications, setPublications] = useState([]);
  const [targets, setTargets] = useState(DEFAULT_TARGETS);
  const [products, setProducts] = useState([]);

  const [activeTab, setActiveTab] = useState("calendar");
  const [weekAnchor, setWeekAnchor] = useState(weekStartMonday(new Date()));

  const [sortConfig, setSortConfig] = useState({ key: "published_at", direction: "desc" });
  const [platformFilter, setPlatformFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [outlierOnly, setOutlierOnly] = useState(false);
  const [storeTriggerOnly, setStoreTriggerOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isWriting, setIsWriting] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [showModal, setShowModal] = useState(false);
  const [editingPublication, setEditingPublication] = useState(null);
  const [publicationForm, setPublicationForm] = useState(defaultPublicationForm());

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
        if (ok && successMessage) pushToast(successMessage, "success");
        return ok;
      } finally {
        setIsWriting(false);
      }
    },
    [pushToast]
  );

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    const [pubRes, tarRes, prodRes] = await Promise.all([
      supabase.from("publications").select("*").order("published_at", { ascending: false }),
      supabase.from("publishing_targets").select("*"),
      supabase.from("products").select("id, name, stage").order("updated_at", { ascending: false }),
    ]);

    if (pubRes.error) pushToast(`Could not load publications: ${pubRes.error.message}`, "error");
    if (tarRes.error) pushToast(`Could not load targets: ${tarRes.error.message}`, "error");
    if (prodRes.error) pushToast(`Could not load products: ${prodRes.error.message}`, "error");

    setPublications(pubRes.data || []);
    setProducts(prodRes.data || []);

    const mergedTargets = { ...DEFAULT_TARGETS };
    (tarRes.data || []).forEach((row) => {
      const key = String(row.platform || "").toLowerCase();
      if (PLATFORMS.includes(key)) {
        mergedTargets[key] = {
          daily_target: row.daily_target ?? mergedTargets[key].daily_target,
          weekly_target: row.weekly_target ?? mergedTargets[key].weekly_target,
        };
      }
    });
    setTargets(mergedTargets);
    setIsLoading(false);
  }, [pushToast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchAll();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAll]);

  const publicationAverageViews = useMemo(() => {
    if (publications.length === 0) return 0;
    const total = publications.reduce((sum, p) => sum + (Number(p.views_current) || 0), 0);
    return total / publications.length;
  }, [publications]);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weekStart = useMemo(() => weekStartMonday(new Date()), []);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const cadence = useMemo(() => {
    const data = {};
    PLATFORMS.forEach((p) => {
      data[p] = { today: 0, week: 0 };
    });

    publications.forEach((p) => {
      const platform = String(p.platform || "").toLowerCase();
      if (!PLATFORMS.includes(platform)) return;
      const publishedAt = new Date(p.published_at || 0);
      if (Number.isNaN(publishedAt.getTime())) return;
      if (publishedAt >= todayStart) data[platform].today += 1;
      if (publishedAt >= weekStart && publishedAt < weekEnd) data[platform].week += 1;
    });
    return data;
  }, [publications, todayStart, weekStart, weekEnd]);

  const overallWeekly = useMemo(() => {
    const published = PLATFORMS.reduce((sum, p) => sum + (cadence[p]?.week || 0), 0);
    const target = PLATFORMS.reduce((sum, p) => sum + (targets[p]?.weekly_target || 0), 0);
    return { published, target };
  }, [cadence, targets]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => addDays(weekAnchor, i));
  }, [weekAnchor]);

  const publicationsByDay = useMemo(() => {
    const map = {};
    weekDays.forEach((d) => {
      const key = d.toDateString();
      map[key] = [];
    });
    publications.forEach((p) => {
      const d = new Date(p.published_at || 0);
      if (Number.isNaN(d.getTime())) return;
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toDateString();
      if (map[key]) map[key].push(p);
    });
    return map;
  }, [publications, weekDays]);

  const filteredPublications = useMemo(() => {
    let list = [...publications];
    if (platformFilter !== "all") list = list.filter((p) => (p.platform || "").toLowerCase() === platformFilter);
    if (productFilter !== "all") list = list.filter((p) => String(p.product_id || "") === productFilter);
    if (outlierOnly) list = list.filter((p) => !!p.is_outlier);
    if (storeTriggerOnly) list = list.filter((p) => !!p.is_store_trigger);
    if (dateFrom) {
      const from = new Date(dateFrom);
      list = list.filter((p) => new Date(p.published_at || 0) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter((p) => new Date(p.published_at || 0) <= to);
    }

    const dir = sortConfig.direction === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const av = a[sortConfig.key];
      const bv = b[sortConfig.key];
      if (sortConfig.key === "published_at") {
        return (new Date(av || 0).getTime() - new Date(bv || 0).getTime()) * dir;
      }
      if (typeof av === "number" || typeof bv === "number") {
        return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
      }
      return String(av || "").localeCompare(String(bv || "")) * dir;
    });
    return list;
  }, [publications, platformFilter, productFilter, outlierOnly, storeTriggerOnly, dateFrom, dateTo, sortConfig]);

  const alerts = useMemo(() => {
    return publications
      .filter((p) => p.is_outlier || p.is_store_trigger)
      .sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime());
  }, [publications]);

  const openAddModal = (prefillDate = null) => {
    setEditingPublication(null);
    const form = defaultPublicationForm();
    if (prefillDate) {
      const d = new Date(prefillDate);
      d.setHours(new Date().getHours(), new Date().getMinutes(), 0, 0);
      form.published_at = toLocalInputDateTime(d);
    }
    setPublicationForm(form);
    setShowModal(true);
  };

  const openEditModal = (publication) => {
    setEditingPublication(publication);
    setPublicationForm({
      ...defaultPublicationForm(),
      ...publication,
      product_id: publication.product_id || "",
      published_at: toLocalInputDateTime(publication.published_at || new Date()),
      views_24h: publication.views_24h ?? 0,
      views_48h: publication.views_48h ?? 0,
      views_7d: publication.views_7d ?? 0,
      views_current: publication.views_current ?? 0,
      comments: publication.comments ?? 0,
      shares: publication.shares ?? 0,
      saves: publication.saves ?? 0,
      likes: publication.likes ?? 0,
    });
    setShowModal(true);
  };

  const savePublication = async () => {
    await withWrite(async () => {
      const payload = {
        ...publicationForm,
        product_id: publicationForm.product_id || null,
        published_at: publicationForm.published_at ? new Date(publicationForm.published_at).toISOString() : new Date().toISOString(),
        views_24h: toNumber(publicationForm.views_24h),
        views_48h: toNumber(publicationForm.views_48h),
        views_7d: toNumber(publicationForm.views_7d),
        views_current: toNumber(publicationForm.views_current),
        comments: toNumber(publicationForm.comments),
        shares: toNumber(publicationForm.shares),
        saves: toNumber(publicationForm.saves),
        likes: toNumber(publicationForm.likes),
      };

      if (editingPublication?.id) {
        const { error } = await supabase.from("publications").update(payload).eq("id", editingPublication.id);
        if (error) {
          pushToast(`Could not update publication: ${error.message}`, "error");
          return false;
        }
      } else {
        const { error } = await supabase.from("publications").insert(payload);
        if (error) {
          pushToast(`Could not create publication: ${error.message}`, "error");
          return false;
        }
      }

      await fetchAll();
      setShowModal(false);
      return true;
    }, editingPublication ? "Publication updated" : "Publication created");
  };

  const toggleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "desc" };
    });
  };

  const outlierSuggestion =
    Number(publicationForm.views_current || 0) > 30000 &&
    Number(publicationForm.views_current || 0) > publicationAverageViews * 10;
  const storeTriggerSuggestion =
    Number(publicationForm.views_current || 0) > 100000 &&
    Number(publicationForm.comments || 0) > 30;

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
            zIndex: 3000,
            background:
              "linear-gradient(90deg, rgba(233,69,96,0), rgba(233,69,96,0.95), rgba(56,189,248,0.95), rgba(233,69,96,0))",
            backgroundSize: "220% 100%",
            animation: "writeProgressSlide 1.1s linear infinite",
            boxShadow: "0 0 10px rgba(233,69,96,0.45)",
          }}
        />
      )}

      <div style={{ marginBottom: 10, color: "#e94560", fontWeight: 800, letterSpacing: "0.05em", fontSize: 14 }}>
        DISTRIBUTION TRACKER
      </div>

      <section style={panelStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {PLATFORMS.map((platform) => {
            const m = PLATFORM_META[platform];
            const c = cadence[platform] || { today: 0, week: 0 };
            const t = targets[platform] || DEFAULT_TARGETS[platform];
            const dayRatio = t.daily_target > 0 ? c.today / t.daily_target : 0;
            const weekRatio = t.weekly_target > 0 ? c.week / t.weekly_target : 0;
            return (
              <div key={platform} style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 10, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ color: m.color, fontSize: 12, fontWeight: 700 }}>{m.icon} {m.label}</div>
                </div>
                <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 6 }}>
                  Today: <strong>{c.today}</strong> / {t.daily_target}
                </div>
                <ProgressBar ratio={dayRatio} />
                <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 8, marginBottom: 6 }}>
                  Week: <strong>{c.week}</strong> / {t.weekly_target}
                </div>
                <ProgressBar ratio={weekRatio} />
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
          Overall this week: <strong style={{ color: "#e2e8f0" }}>{overallWeekly.published}</strong> / {overallWeekly.target} published
        </div>
      </section>

      <section style={{ ...panelStyle, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={tabButtonStyle(activeTab === "calendar")} onClick={() => setActiveTab("calendar")}>
              Calendar View
            </button>
            <button style={tabButtonStyle(activeTab === "performance")} onClick={() => setActiveTab("performance")}>
              Performance View
            </button>
          </div>
          <button style={primaryButtonStyle} onClick={() => openAddModal()}>
            + Add Publication
          </button>
        </div>

        {isLoading ? (
          <div style={{ minHeight: 280, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10 }}>
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
        ) : activeTab === "calendar" ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                Week of {formatDateShort(weekDays[0])} - {formatDateShort(weekDays[6])}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={ghostButtonStyle} onClick={() => setWeekAnchor((w) => addDays(w, -7))}>← Prev</button>
                <button style={ghostButtonStyle} onClick={() => setWeekAnchor(weekStartMonday(new Date()))}>This Week</button>
                <button style={ghostButtonStyle} onClick={() => setWeekAnchor((w) => addDays(w, 7))}>Next →</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
              {weekDays.map((day) => {
                const key = day.toDateString();
                const items = publicationsByDay[key] || [];
                return (
                  <div key={key} style={{ border: "1px solid #1e293b", borderRadius: 10, padding: 8, minHeight: 190, background: "#0b1220" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        {day.toLocaleDateString(undefined, { weekday: "short" })} {day.getDate()}
                      </div>
                      <button style={{ ...ghostButtonStyle, padding: "4px 6px", fontSize: 10 }} onClick={() => openAddModal(day)}>
                        Quick Publish
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((p) => {
                        const platform = String(p.platform || "").toLowerCase();
                        const meta = PLATFORM_META[platform] || PLATFORM_META.tiktok;
                        return (
                          <button
                            key={p.id}
                            onClick={() => openEditModal(p)}
                            style={{
                              border: `1px solid ${meta.color}66`,
                              background: `${meta.color}1a`,
                              borderRadius: 8,
                              color: "#e2e8f0",
                              textAlign: "left",
                              padding: "6px 7px",
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ fontSize: 10, color: meta.color, marginBottom: 3 }}>{meta.label}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{p.title || "Untitled"}</div>
                            <div style={{ fontSize: 10, color: "#cbd5e1" }}>Views: {Number(p.views_current || 0).toLocaleString()}</div>
                          </button>
                        );
                      })}
                      {items.length === 0 && (
                        <div style={{ border: "1px dashed #334155", borderRadius: 8, padding: "10px 8px", fontSize: 10, color: "#64748b" }}>
                          No publications
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
              <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} style={inputStyle}>
                <option value="all">All platforms</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_META[p].label}</option>
                ))}
              </select>
              <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} style={inputStyle}>
                <option value="all">All products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
              <label style={checkLabelStyle}>
                <input type="checkbox" checked={outlierOnly} onChange={(e) => setOutlierOnly(e.target.checked)} />
                Outlier only
              </label>
              <label style={checkLabelStyle}>
                <input type="checkbox" checked={storeTriggerOnly} onChange={(e) => setStoreTriggerOnly(e.target.checked)} />
                Store trigger only
              </label>
            </div>

            <div style={{ border: "1px solid #1e293b", borderRadius: 10, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1140 }}>
                <thead>
                  <tr style={{ background: "#111827" }}>
                    <Th label="Date" onClick={() => toggleSort("published_at")} />
                    <Th label="Platform" onClick={() => toggleSort("platform")} />
                    <Th label="Title / Hook" onClick={() => toggleSort("title")} />
                    <Th label="Views 24h/48h/7d/current" onClick={() => toggleSort("views_current")} />
                    <Th label="Engagement c/s/sv" onClick={() => toggleSort("comments")} />
                    <Th label="Flags" onClick={() => toggleSort("is_outlier")} />
                  </tr>
                </thead>
                <tbody>
                  {filteredPublications.map((p) => {
                    const platform = String(p.platform || "").toLowerCase();
                    const meta = PLATFORM_META[platform] || PLATFORM_META.tiktok;
                    const glow = p.is_outlier
                      ? "0 0 0 1px rgba(245, 158, 11, 0.8), inset 0 0 20px rgba(245, 158, 11, 0.08)"
                      : p.is_store_trigger
                        ? "0 0 0 1px rgba(16, 185, 129, 0.8), inset 0 0 20px rgba(16, 185, 129, 0.08)"
                        : "none";
                    return (
                      <tr
                        key={p.id}
                        onClick={() => openEditModal(p)}
                        style={{ cursor: "pointer", borderTop: "1px solid #1e293b", boxShadow: glow }}
                      >
                        <Td>{formatDateTime(p.published_at)}</Td>
                        <Td>
                          <span style={{ color: meta.color, fontWeight: 700, fontSize: 12 }}>{meta.label}</span>
                        </Td>
                        <Td>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{p.title || "Untitled"}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.hook_used || "-"}</div>
                        </Td>
                        <Td>
                          <div style={{ fontSize: 11 }}>
                            {Number(p.views_24h || 0).toLocaleString()} / {Number(p.views_48h || 0).toLocaleString()} / {Number(p.views_7d || 0).toLocaleString()} /{" "}
                            <strong>{Number(p.views_current || 0).toLocaleString()}</strong>
                          </div>
                        </Td>
                        <Td>
                          <div style={{ fontSize: 11 }}>
                            {Number(p.comments || 0)} / {Number(p.shares || 0)} / {Number(p.saves || 0)}
                          </div>
                        </Td>
                        <Td>
                          <div style={{ display: "flex", gap: 6 }}>
                            {p.is_outlier && <Pill label="Outlier" color="#f59e0b" />}
                            {p.is_store_trigger && <Pill label="Store Trigger" color="#10b981" />}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                  {filteredPublications.length === 0 && (
                    <tr>
                      <Td colSpan={6}>
                        <div style={{ color: "#94a3b8", fontSize: 12, padding: "6px 0" }}>No publications match current filters.</div>
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section style={{ ...panelStyle, marginTop: 12 }}>
        <div style={{ marginBottom: 10, fontSize: 13, color: "#cbd5e1", letterSpacing: "0.04em" }}>
          Outlier & Store Trigger Alerts
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
          {alerts.map((p) => {
            const platform = String(p.platform || "").toLowerCase();
            const meta = PLATFORM_META[platform] || PLATFORM_META.tiktok;
            return (
              <button
                key={p.id}
                onClick={() => openEditModal(p)}
                style={{
                  textAlign: "left",
                  border: "1px solid #1e293b",
                  background: "#0b1220",
                  color: "#e2e8f0",
                  borderRadius: 10,
                  padding: 12,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{p.title || "Untitled publication"}</div>
                  <Pill label={meta.label} color={meta.color} />
                </div>
                <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 6 }}>
                  Views: {Number(p.views_current || 0).toLocaleString()}
                </div>
                {p.is_outlier && (
                  <div style={{ fontSize: 11, color: "#fbbf24", marginBottom: 4 }}>
                    OUTLIER DETECTED — Create 3-5 variations of this hook within 48 hours
                  </div>
                )}
                {p.is_store_trigger && (
                  <div style={{ fontSize: 11, color: "#4ade80" }}>
                    STORE TRIGGER — 100K+ views with product intent. Launch store if not live.
                  </div>
                )}
              </button>
            );
          })}
          {alerts.length === 0 && (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>No outlier or store-trigger alerts yet.</div>
          )}
        </div>
      </section>

      {showModal && (
        <ModalShell
          title={editingPublication ? "Edit Publication" : "Add Publication"}
          onClose={() => setShowModal(false)}
          onConfirm={() => void savePublication()}
          confirmLabel={editingPublication ? "Save publication" : "Create publication"}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Platform *">
              <select
                value={publicationForm.platform}
                onChange={(e) => setPublicationForm((p) => ({ ...p, platform: e.target.value }))}
                style={inputStyle}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_META[p].label}</option>
                ))}
              </select>
            </FieldGroup>
            <FieldGroup label="Published Date / Time">
              <input
                type="datetime-local"
                value={publicationForm.published_at || ""}
                onChange={(e) => setPublicationForm((p) => ({ ...p, published_at: e.target.value }))}
                style={inputStyle}
              />
            </FieldGroup>
          </div>

          <FieldGroup label="Title / Description">
            <input
              value={publicationForm.title || ""}
              onChange={(e) => setPublicationForm((p) => ({ ...p, title: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Hook Used">
              <input
                value={publicationForm.hook_used || ""}
                onChange={(e) => setPublicationForm((p) => ({ ...p, hook_used: e.target.value }))}
                style={inputStyle}
              />
            </FieldGroup>
            <FieldGroup label="Frame Used">
              <input
                value={publicationForm.frame_used || ""}
                onChange={(e) => setPublicationForm((p) => ({ ...p, frame_used: e.target.value }))}
                style={inputStyle}
              />
            </FieldGroup>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Product (optional)">
              <select
                value={publicationForm.product_id || ""}
                onChange={(e) => setPublicationForm((p) => ({ ...p, product_id: e.target.value }))}
                style={inputStyle}
              >
                <option value="">No linked product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FieldGroup>
            <FieldGroup label="Account Name">
              <input
                value={publicationForm.account_name || ""}
                onChange={(e) => setPublicationForm((p) => ({ ...p, account_name: e.target.value }))}
                style={inputStyle}
              />
            </FieldGroup>
          </div>

          <FieldGroup label="Published URL">
            <input
              value={publicationForm.published_url || ""}
              onChange={(e) => setPublicationForm((p) => ({ ...p, published_url: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>

          <FieldGroup label="Notes">
            <textarea
              value={publicationForm.notes || ""}
              onChange={(e) => setPublicationForm((p) => ({ ...p, notes: e.target.value }))}
              style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
            />
          </FieldGroup>

          {editingPublication && (
            <>
              <h4 style={{ margin: "12px 0 8px", fontSize: 13, color: "#94a3b8", letterSpacing: "0.04em" }}>
                Performance
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                <NumericField label="views_24h" value={publicationForm.views_24h} onChange={(v) => setPublicationForm((p) => ({ ...p, views_24h: v }))} />
                <NumericField label="views_48h" value={publicationForm.views_48h} onChange={(v) => setPublicationForm((p) => ({ ...p, views_48h: v }))} />
                <NumericField label="views_7d" value={publicationForm.views_7d} onChange={(v) => setPublicationForm((p) => ({ ...p, views_7d: v }))} />
                <NumericField label="views_current" value={publicationForm.views_current} onChange={(v) => setPublicationForm((p) => ({ ...p, views_current: v }))} />
                <NumericField label="comments" value={publicationForm.comments} onChange={(v) => setPublicationForm((p) => ({ ...p, comments: v }))} />
                <NumericField label="shares" value={publicationForm.shares} onChange={(v) => setPublicationForm((p) => ({ ...p, shares: v }))} />
                <NumericField label="saves" value={publicationForm.saves} onChange={(v) => setPublicationForm((p) => ({ ...p, saves: v }))} />
                <NumericField label="likes" value={publicationForm.likes} onChange={(v) => setPublicationForm((p) => ({ ...p, likes: v }))} />
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <ToggleButton
                  active={!!publicationForm.is_outlier}
                  onClick={() => setPublicationForm((p) => ({ ...p, is_outlier: !p.is_outlier }))}
                  label={publicationForm.is_outlier ? "Outlier ON" : "Outlier OFF"}
                  color="#f59e0b"
                />
                <ToggleButton
                  active={!!publicationForm.is_store_trigger}
                  onClick={() => setPublicationForm((p) => ({ ...p, is_store_trigger: !p.is_store_trigger }))}
                  label={publicationForm.is_store_trigger ? "Store Trigger ON" : "Store Trigger OFF"}
                  color="#10b981"
                />
              </div>

              {outlierSuggestion && !publicationForm.is_outlier && (
                <div style={hintBox("#f59e0b")}>
                  Suggestion: views_current is above 30K and 10x average. Consider flagging as outlier.
                </div>
              )}
              {storeTriggerSuggestion && !publicationForm.is_store_trigger && (
                <div style={hintBox("#10b981")}>
                  Suggestion: views_current above 100K and comments above 30. Consider flagging as store trigger.
                </div>
              )}
            </>
          )}
        </ModalShell>
      )}

      <div
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 4000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 380,
        }}
      >
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} />
        ))}
      </div>
    </div>
  );
}

function hintBox(color) {
  return {
    marginTop: 8,
    border: `1px solid ${color}66`,
    background: `${color}18`,
    color: "#e2e8f0",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 12,
  };
}

function ProgressBar({ ratio }) {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const color = progressColor(ratio);
  return (
    <div style={{ height: 8, borderRadius: 999, background: "#1f2937", border: "1px solid #334155", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color }} />
    </div>
  );
}

function Th({ label, onClick }) {
  return (
    <th
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "10px 9px",
        fontSize: 11,
        color: "#94a3b8",
        fontWeight: 700,
        cursor: "pointer",
        letterSpacing: "0.03em",
      }}
    >
      {label}
    </th>
  );
}

function Td({ children, colSpan }) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "10px 9px",
        fontSize: 12,
        color: "#e2e8f0",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

function Pill({ label, color }) {
  return (
    <span
      style={{
        borderRadius: 999,
        border: `1px solid ${color}66`,
        background: `${color}20`,
        color,
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

function NumericField({ label, value, onChange }) {
  return (
    <FieldGroup label={label}>
      <input type="number" value={value ?? 0} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </FieldGroup>
  );
}

function ModalShell({ title, onClose, onConfirm, confirmLabel, children }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.78)",
        zIndex: 3200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        style={{
          width: "min(900px, 100%)",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "#0f0f1a",
          border: "1px solid #1e293b",
          borderRadius: 12,
          padding: 14,
        }}
      >
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

function ToggleButton({ active, onClick, label, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? `${color}22` : "transparent",
        border: `1px solid ${active ? `${color}66` : "#334155"}`,
        color: active ? color : "#94a3b8",
        borderRadius: 8,
        padding: "7px 10px",
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

function Toast({ message, type }) {
  const isSuccess = type === "success";
  return (
    <div
      style={{
        background: isSuccess ? "rgba(22, 163, 74, 0.92)" : "rgba(185, 28, 28, 0.92)",
        border: `1px solid ${isSuccess ? "rgba(74, 222, 128, 0.45)" : "rgba(252, 165, 165, 0.45)"}`,
        color: "#f8fafc",
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: 12,
        fontWeight: 600,
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
      }}
    >
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

const checkLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #1e293b",
  borderRadius: 8,
  padding: "0 10px",
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
