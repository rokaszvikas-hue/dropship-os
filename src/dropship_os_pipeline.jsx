import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./lib/supabase";
import ContentFactory from "./ContentFactory";
import Distribution from "./Distribution";
import StoreOrders from "./StoreOrders";

// ============================================================
// CONSTANTS & CONFIG
// ============================================================
const STAGES = [
  { id: "sourced", label: "Sourced", color: "#64748b", icon: "🔍" },
  { id: "quick_screen", label: "Quick Screen", color: "#8b5cf6", icon: "⚡" },
  { id: "scored", label: "Scored", color: "#3b82f6", icon: "📊" },
  { id: "sample_ordered", label: "Sample Ordered", color: "#f59e0b", icon: "📦" },
  { id: "sample_review", label: "Sample Review", color: "#ef4444", icon: "🔬" },
  { id: "execution_ready", label: "Exec Ready", color: "#10b981", icon: "🚀" },
  { id: "live", label: "Live", color: "#059669", icon: "💰" },
];

const DEAD_STAGE = { id: "dead", label: "Dead", color: "#dc2626", icon: "💀" };

const CRITICAL_FAILS = [
  { key: "critical_fail_no_gap", label: "No market gap" },
  { key: "critical_fail_weak_demo", label: "Weak demo" },
  { key: "critical_fail_no_packaging", label: "No packaging potential" },
  { key: "critical_fail_low_margin", label: "Margin below 25%" },
  { key: "critical_fail_no_supplier", label: "No supplier confidence" },
  { key: "critical_fail_saturated", label: "Lane saturated (3+ operators)" },
];

const SCORE_BUCKETS = [
  { key: "entry_opportunity", label: "Entry Opportunity", weight: 30, noteKey: "score_entry_note", question: "Is there a real gap in the lane?" },
  { key: "organic_fit", label: "Organic Fit", weight: 30, noteKey: "score_organic_note", question: "Can it sell itself in short-form video?" },
  { key: "business_quality", label: "Business Quality", weight: 20, noteKey: "score_business_note", question: "Can this make real money and scale?" },
  { key: "lane_strength", label: "Lane Strength", weight: 20, noteKey: "score_lane_note", question: "Is the entry logic strong?" },
];

const SAMPLE_CHECKS = [
  { key: "sample_quality_ok", label: "Quality acceptable in hand?" },
  { key: "sample_demo_ok", label: "Demo produces expected visual payoff?" },
  { key: "sample_filmable", label: "Filmable cleanly and repeatably?" },
  { key: "sample_thesis_holds", label: "Original thesis still holds?" },
  { key: "sample_deserves_slot", label: "Deserves execution slot over queue?" },
];

const PRODUCTS_TABLE = "products";
const PRODUCT_ACTIVITY_TABLE = "product_activity";
const PRODUCT_WRITE_COLUMNS = [
  "id",
  "name",
  "stage",
  "stage_entered_at",
  "created_at",
  "updated_at",
  "source_url",
  "notes",
  "target_platform",
  "target_geography",
  "target_angle",
  "score_entry_opportunity",
  "score_entry_note",
  "score_organic_fit",
  "score_organic_note",
  "score_business_quality",
  "score_business_note",
  "score_lane_strength",
  "score_lane_note",
  "critical_fail_no_gap",
  "critical_fail_weak_demo",
  "critical_fail_no_packaging",
  "critical_fail_low_margin",
  "critical_fail_no_supplier",
  "critical_fail_saturated",
  "quick_screen_passed",
  "quick_screen_reason",
  "sample_quality_ok",
  "sample_demo_ok",
  "sample_filmable",
  "sample_thesis_holds",
  "sample_deserves_slot",
  "sample_verdict",
  "sample_supplier",
  "sample_backup_supplier",
  "sample_notes",
  "sample_ordered_at",
  "sample_arrived_at",
  "aov",
  "cogs",
  "shipping_cost",
  "exception_invoked",
  "exception_type",
  "exception_comparable_product",
  "primary_supplier",
  "backup_supplier",
  "killed_at",
  "killed_at_stage",
  "kill_reason",
];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function calcWeightedScore(p) {
  if (!p.score_entry_opportunity || !p.score_organic_fit || !p.score_business_quality || !p.score_lane_strength) return null;
  return (p.score_entry_opportunity * 6) + (p.score_organic_fit * 6) + (p.score_business_quality * 4) + (p.score_lane_strength * 4);
}

function getScoreColor(score) {
  if (score === null || score === undefined) return "#64748b";
  if (score >= 75) return "#10b981";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

function getBucketScoreColor(s) {
  if (!s) return "#64748b";
  if (s >= 4) return "#10b981";
  if (s === 3) return "#f59e0b";
  return "#ef4444";
}

function hasCriticalFail(p) {
  return CRITICAL_FAILS.some(cf => p[cf.key]);
}

function getCriticalFails(p) {
  return CRITICAL_FAILS.filter(cf => p[cf.key]).map(cf => cf.label);
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function getScoreVerdict(score, p) {
  if (hasCriticalFail(p)) return { label: "KILL", color: "#ef4444", desc: "Critical fail present" };
  if (score === null) return { label: "UNSCORED", color: "#64748b", desc: "Score all 4 buckets" };
  if (score >= 75) return { label: "GO", color: "#10b981", desc: "Move to next stage" };
  if (score >= 60) return { label: "HOLD", color: "#f59e0b", desc: "7-day max, gather proof" };
  return { label: "KILL", color: "#ef4444", desc: "Below threshold" };
}

function rowToProduct(row) {
  const data = (row.data && typeof row.data === "object") ? row.data : {};
  return {
    ...data,
    ...row,
    id: row.id,
    name: row.name ?? data.name ?? "Untitled Product",
    stage: row.stage ?? data.stage ?? "sourced",
    stage_entered_at: row.stage_entered_at ?? data.stage_entered_at ?? row.created_at ?? new Date().toISOString(),
    created_at: row.created_at ?? data.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? data.updated_at ?? new Date().toISOString(),
  };
}

function productToRow(product) {
  const payload = {};
  PRODUCT_WRITE_COLUMNS.forEach((key) => {
    if (product[key] !== undefined) {
      payload[key] = product[key];
    }
  });
  payload.name = payload.name || "Untitled Product";
  payload.stage = payload.stage || "sourced";
  payload.stage_entered_at = payload.stage_entered_at || new Date().toISOString();
  payload.updated_at = new Date().toISOString();
  payload.created_at = payload.created_at || new Date().toISOString();
  return payload;
}

function createProductId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [products, setProducts] = useState([]);
  const [isSyncing, setIsSyncing] = useState(true);
  const [isWriting, setIsWriting] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [syncError, setSyncError] = useState("");
  const [view, setView] = useState("pipeline"); // pipeline | command | content_factory | distribution | store_orders
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showKillModal, setShowKillModal] = useState(null);
  const [showDeadProducts, setShowDeadProducts] = useState(false);

  const deadProducts = products.filter(p => p.stage === "dead");
  const liveProducts = products.filter(p => p.stage !== "dead");

  const pushToast = useCallback((message, type = "error") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  // Command center stats
  const stats = useMemo(() => {
    const byStage = {};
    STAGES.forEach(s => { byStage[s.id] = products.filter(p => p.stage === s.id).length; });
    byStage.dead = deadProducts.length;
    const totalProducts = products.length;
    const killRate = totalProducts > 0 ? Math.round((deadProducts.length / totalProducts) * 100) : 0;
    const inPipeline = liveProducts.filter(p => !["live", "execution_ready"].includes(p.stage)).length;
    const readyOrLive = liveProducts.filter(p => ["live", "execution_ready"].includes(p.stage)).length;
    return { byStage, totalProducts, killRate, inPipeline, readyOrLive, deadCount: deadProducts.length };
  }, [products, deadProducts, liveProducts]);

  const fetchProducts = useCallback(async () => {
    setIsSyncing(true);
    const { data, error } = await supabase
      .from(PRODUCTS_TABLE)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase fetch error:", error.message);
      setSyncError(`Could not load from Supabase: ${error.message}`);
      pushToast(`Load failed: ${error.message}`, "error");
      setIsSyncing(false);
      return false;
    }

    const mapped = (data || []).map(rowToProduct);
    setProducts(mapped);
    setSyncError("");
    setIsSyncing(false);
    return true;
  }, [pushToast]);

  useEffect(() => {
    const timerId = setTimeout(() => {
      void fetchProducts();
    }, 0);
    return () => clearTimeout(timerId);
  }, [fetchProducts]);

  const selectedProductId = selectedProduct?.id ?? null;
  useEffect(() => {
    if (!selectedProductId) return;
    const timerId = setTimeout(() => {
      const freshSelected = products.find((p) => p.id === selectedProductId) || null;
      setSelectedProduct((prev) => {
        if (!prev) return freshSelected;
        if (!freshSelected) return null;
        return prev === freshSelected ? prev : freshSelected;
      });
    }, 0);
    return () => clearTimeout(timerId);
  }, [products, selectedProductId]);

  const logProductActivity = useCallback(async ({ productId, action, fromStage = null, toStage = null, meta = {} }) => {
    const attempts = [
      { product_id: productId, action, from_stage: fromStage, to_stage: toStage, meta },
      { product_id: productId, activity_type: action, details: { fromStage, toStage, ...meta } },
      { product_id: productId, event: action, payload: { fromStage, toStage, ...meta } },
      { product_id: productId, description: action, details: { fromStage, toStage, ...meta } },
    ];

    let lastError = null;
    for (const payload of attempts) {
      const { error } = await supabase.from(PRODUCT_ACTIVITY_TABLE).insert(payload);
      if (!error) {
        return true;
      }
      lastError = error;
    }

    const activityError = lastError?.message || "unknown error";
    console.warn("Supabase activity log skipped:", activityError);
    pushToast(`Activity log failed: ${activityError}`, "error");
    return false;
  }, [pushToast]);

  const saveProduct = useCallback(async (product, activity = {}) => {
    setIsWriting(true);
    const payload = productToRow({
      ...product,
      updated_at: new Date().toISOString(),
    });

    try {
      const { error } = await supabase
        .from(PRODUCTS_TABLE)
        .upsert(payload, { onConflict: "id" });

      if (error) {
        console.error("Supabase save error:", error.message);
        setSyncError(`Could not save to Supabase: ${error.message}`);
        pushToast(`Save failed: ${error.message}`, "error");
        return false;
      }

      setSyncError("");
      await logProductActivity({
        productId: payload.id,
        action: activity.action || "updated",
        fromStage: activity.fromStage ?? null,
        toStage: activity.toStage ?? payload.stage ?? null,
        meta: activity.meta || {},
      });
      await fetchProducts();
      return true;
    } finally {
      setIsWriting(false);
    }
  }, [fetchProducts, logProductActivity, pushToast]);

  const updateProduct = useCallback(async (id, updates, activityAction = "updated") => {
    const current = products.find((p) => p.id === id);
    if (!current) return false;

    const nextUpdatedAt = new Date().toISOString();
    const nextProduct = { ...current, ...updates, updated_at: nextUpdatedAt };

    setProducts(prev => prev.map((p) => {
      if (p.id !== id) return p;
      return { ...p, ...updates, updated_at: nextUpdatedAt };
    }));

    if (selectedProduct?.id === id) {
      setSelectedProduct(prev => prev ? { ...prev, ...updates, updated_at: nextUpdatedAt } : null);
    }

    return await saveProduct(nextProduct, {
      action: activityAction,
      fromStage: current.stage,
      toStage: updates.stage ?? current.stage,
      meta: { changed_fields: Object.keys(updates) },
    });
  }, [products, selectedProduct, saveProduct]);

  const advanceStage = useCallback(async (product) => {
    const currentIdx = STAGES.findIndex(s => s.id === product.stage);
    if (currentIdx < STAGES.length - 1) {
      const nextStage = STAGES[currentIdx + 1].id;
      const didAdvance = await updateProduct(
        product.id,
        { stage: nextStage, stage_entered_at: new Date().toISOString() },
        "advanced_stage"
      );
      if (didAdvance) {
        pushToast(`Advanced to ${nextStage.replace("_", " ")}`, "success");
      }
    }
  }, [updateProduct, pushToast]);

  const killProduct = useCallback(async (id, reason) => {
    const product = products.find(p => p.id === id);
    if (!product) return;
    const didKill = await updateProduct(id, {
      stage: "dead",
      killed_at: new Date().toISOString(),
      killed_at_stage: product.stage,
      kill_reason: reason,
    }, "killed");
    if (didKill) {
      pushToast("Product moved to dead", "success");
    }
    setShowKillModal(null);
    setSelectedProduct(null);
  }, [products, updateProduct, pushToast]);

  const addProduct = useCallback(async (data) => {
    const newProduct = {
      id: createProductId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stage: "sourced",
      stage_entered_at: new Date().toISOString(),
      ...data,
      score_entry_opportunity: null,
      score_organic_fit: null,
      score_business_quality: null,
      score_lane_strength: null,
      score_total: null,
      critical_fail_no_gap: false,
      critical_fail_weak_demo: false,
      critical_fail_no_packaging: false,
      critical_fail_low_margin: false,
      critical_fail_no_supplier: false,
      critical_fail_saturated: false,
      exception_invoked: false,
      quick_screen_passed: null,
      sample_quality_ok: null,
      sample_demo_ok: null,
      sample_filmable: null,
      sample_thesis_holds: null,
      sample_deserves_slot: null,
    };
    const didSave = await saveProduct(newProduct, {
      action: "created",
      fromStage: null,
      toStage: "sourced",
      meta: { source: "add_modal" },
    });
    if (didSave) {
      setShowAddModal(false);
      pushToast("Product added", "success");
    }
  }, [saveProduct, pushToast]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#e2e8f0",
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    }}>
      <style>{`
        @keyframes writeProgressSlide {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes syncSpinner {
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
            zIndex: 2000,
            background: "linear-gradient(90deg, rgba(233, 69, 96, 0), rgba(233, 69, 96, 0.95), rgba(56, 189, 248, 0.95), rgba(233, 69, 96, 0))",
            backgroundSize: "220% 100%",
            animation: "writeProgressSlide 1.1s linear infinite",
            boxShadow: "0 0 10px rgba(233, 69, 96, 0.4)",
          }}
        />
      )}
      {/* Top Bar */}
      <div style={{
        background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)",
        borderBottom: "1px solid #1e293b",
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            background: "linear-gradient(135deg, #e94560, #ff6b6b)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            DROPSHIP OS
          </div>
          <div style={{ width: 1, height: 24, background: "#1e293b" }} />
          <NavTab active={view === "pipeline"} onClick={() => setView("pipeline")} label="Pipeline" icon="◉" />
          <NavTab active={view === "command"} onClick={() => setView("command")} label="Command Center" icon="◎" />
          <NavTab active={view === "content_factory"} onClick={() => setView("content_factory")} label="Content Factory" icon="🎬" />
          <NavTab active={view === "distribution"} onClick={() => setView("distribution")} label="Distribution" icon="📡" />
          <NavTab active={view === "store_orders"} onClick={() => setView("store_orders")} label="Store & Orders" icon="🏪" />
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            background: "linear-gradient(135deg, #e94560, #c62a40)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "0.02em",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => e.target.style.transform = "translateY(-1px)"}
          onMouseLeave={e => e.target.style.transform = "translateY(0)"}
        >
          + ADD PRODUCT
        </button>
      </div>

      {/* Main Content */}
      <div style={{ padding: "20px 24px" }}>
        {isSyncing ? (
          <div
            style={{
              minHeight: "calc(100vh - 140px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "#94a3b8",
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                border: "2px solid rgba(148, 163, 184, 0.2)",
                borderTopColor: "#38bdf8",
                animation: "syncSpinner 0.8s linear infinite",
              }}
            />
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.02em" }}>
              Loading...
            </div>
          </div>
        ) : (
          <>
            {syncError && (
              <div style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 8,
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                color: "#fca5a5",
                fontSize: 12,
                fontWeight: 600,
              }}>
                {syncError}
              </div>
            )}
            {view === "pipeline" && (
              <PipelineView
                products={liveProducts}
                deadProducts={deadProducts}
                showDead={showDeadProducts}
                setShowDead={setShowDeadProducts}
                onSelect={setSelectedProduct}
                onAdvance={advanceStage}
                onKill={setShowKillModal}
              />
            )}
            {view === "command" && (
              <CommandCenter stats={stats} products={products} deadProducts={deadProducts} onSelect={setSelectedProduct} />
            )}
            {view === "content_factory" && <ContentFactory />}
            {view === "distribution" && <Distribution />}
            {view === "store_orders" && <StoreOrders />}
          </>
        )}
      </div>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetail
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onUpdate={(updates) => updateProduct(selectedProduct.id, updates)}
          onAdvance={() => advanceStage(selectedProduct)}
          onKill={() => setShowKillModal(selectedProduct)}
        />
      )}

      {/* Add Product Modal */}
      {showAddModal && (
        <AddProductModal onClose={() => setShowAddModal(false)} onAdd={addProduct} />
      )}

      {/* Kill Confirmation Modal */}
      {showKillModal && (
        <KillModal product={showKillModal} onClose={() => setShowKillModal(null)} onKill={killProduct} />
      )}

      {/* Toasts */}
      <div
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 2500,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 360,
        }}
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} message={toast.message} type={toast.type} />
        ))}
      </div>
    </div>
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
        letterSpacing: "0.01em",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
        backdropFilter: "blur(3px)",
      }}
    >
      {message}
    </div>
  );
}

// ============================================================
// NAV TAB
// ============================================================
function NavTab({ active, onClick, label, icon }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "rgba(233, 69, 96, 0.15)" : "transparent",
        color: active ? "#e94560" : "#64748b",
        border: active ? "1px solid rgba(233, 69, 96, 0.3)" : "1px solid transparent",
        borderRadius: 6,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        letterSpacing: "0.04em",
        transition: "all 0.15s",
      }}
    >
      {icon} {label}
    </button>
  );
}

// ============================================================
// PIPELINE VIEW (Kanban)
// ============================================================
function PipelineView({ products, deadProducts, showDead, setShowDead, onSelect, onAdvance, onKill }) {
  return (
    <div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${STAGES.length}, minmax(180px, 1fr))`,
        gap: 12,
        overflowX: "auto",
        paddingBottom: 20,
      }}>
        {STAGES.map(stage => {
          const stageProducts = products.filter(p => p.stage === stage.id);
          return (
            <div key={stage.id} style={{
              background: "#0f0f1a",
              borderRadius: 12,
              border: "1px solid #1e293b",
              minHeight: 400,
            }}>
              {/* Column Header */}
              <div style={{
                padding: "14px 16px 10px",
                borderBottom: "1px solid #1e293b",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{stage.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: stage.color, textTransform: "uppercase" }}>
                    {stage.label}
                  </span>
                </div>
                <span style={{
                  background: `${stage.color}22`,
                  color: stage.color,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 10,
                }}>
                  {stageProducts.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {stageProducts.map(p => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onSelect={() => onSelect(p)}
                    onAdvance={() => onAdvance(p)}
                    onKill={() => onKill(p)}
                  />
                ))}
                {stageProducts.length === 0 && (
                  <div style={{ color: "#334155", fontSize: 11, textAlign: "center", padding: "30px 10px", fontStyle: "italic" }}>
                    No products
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Dead Products Toggle */}
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => setShowDead(!showDead)}
          style={{
            background: "transparent",
            color: "#64748b",
            border: "1px solid #1e293b",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 600,
          }}
        >
          {DEAD_STAGE.icon} Dead Products ({deadProducts.length}) {showDead ? "▲" : "▼"}
        </button>
        {showDead && (
          <div style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 10,
          }}>
            {deadProducts.map(p => (
              <div key={p.id} onClick={() => onSelect(p)} style={{
                background: "#0f0f1a",
                border: "1px solid #2d1215",
                borderRadius: 10,
                padding: 14,
                cursor: "pointer",
                opacity: 0.7,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = "1"}
              onMouseLeave={e => e.currentTarget.style.opacity = "0.7"}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#ef4444" }}>{p.name}</span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>Killed at {p.killed_at_stage}</span>
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{p.kill_reason || "No reason logged"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// PRODUCT CARD (Kanban Card)
// ============================================================
function ProductCard({ product: p, onSelect, onAdvance, onKill }) {
  const score = p.score_total ?? calcWeightedScore(p);
  const days = daysSince(p.stage_entered_at);
  const critFails = getCriticalFails(p);

  return (
    <div
      onClick={onSelect}
      style={{
        background: "#141420",
        border: `1px solid ${hasCriticalFail(p) ? "#7f1d1d" : "#1e293b"}`,
        borderRadius: 10,
        padding: 14,
        cursor: "pointer",
        transition: "all 0.15s",
        position: "relative",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#e94560"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = hasCriticalFail(p) ? "#7f1d1d" : "#1e293b"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {/* Critical fail banner */}
      {critFails.length > 0 && (
        <div style={{
          background: "#7f1d1d",
          color: "#fca5a5",
          fontSize: 9,
          fontWeight: 700,
          padding: "3px 8px",
          borderRadius: 4,
          marginBottom: 8,
          letterSpacing: "0.05em",
        }}>
          ⚠ CRITICAL: {critFails[0]}{critFails.length > 1 ? ` +${critFails.length - 1}` : ""}
        </div>
      )}

      {/* Product Name */}
      <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginBottom: 6, lineHeight: 1.3 }}>
        {p.name}
      </div>

      {/* Score bar */}
      {score !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${score}%`, height: "100%", background: getScoreColor(score), borderRadius: 2, transition: "width 0.3s" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: getScoreColor(score) }}>{score}</span>
        </div>
      )}

      {/* Bucket mini scores */}
      {p.score_entry_opportunity && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {SCORE_BUCKETS.map(b => {
            const val = p[`score_${b.key}`];
            return (
              <div key={b.key} style={{
                flex: 1,
                textAlign: "center",
                padding: "3px 0",
                borderRadius: 4,
                background: `${getBucketScoreColor(val)}15`,
                border: `1px solid ${getBucketScoreColor(val)}30`,
              }}>
                <div style={{ fontSize: 8, color: "#64748b", letterSpacing: "0.05em" }}>{b.label.split(" ")[0].substring(0, 3).toUpperCase()}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: getBucketScoreColor(val) }}>{val || "—"}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Meta row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#475569" }}>{days}d in stage</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={e => { e.stopPropagation(); onAdvance(); }} title="Advance"
            style={{ background: "#10b98120", border: "1px solid #10b98140", color: "#10b981", borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
            →
          </button>
          <button onClick={e => { e.stopPropagation(); onKill(); }} title="Kill"
            style={{ background: "#ef444420", border: "1px solid #ef444440", color: "#ef4444", borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// COMMAND CENTER
// ============================================================
function CommandCenter({ onSelect }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({
    products: [],
    videos: [],
    publications: [],
    supportTickets: [],
    dailyRevenue: [],
    publishingTargets: [],
  });

  const defaultTargets = useMemo(
    () => ({
      tiktok: { daily_target: 2, weekly_target: 14 },
      instagram: { daily_target: 1, weekly_target: 7 },
      youtube: { daily_target: 1, weekly_target: 7 },
      facebook: { daily_target: 1, weekly_target: 7 },
    }),
    []
  );

  const getWeekStart = useCallback((dateLike) => {
    const d = new Date(dateLike);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const refreshDashboard = useCallback(async () => {
    setRefreshing(true);
    setError("");
    const [productsRes, videosRes, pubsRes, supportRes, revenueRes, targetsRes] = await Promise.all([
      supabase.from("products").select("*"),
      supabase.from("videos").select("*"),
      supabase.from("publications").select("*"),
      supabase.from("support_tickets").select("*"),
      supabase.from("daily_revenue").select("*"),
      supabase.from("publishing_targets").select("*"),
    ]);

    const errors = [
      productsRes.error?.message,
      videosRes.error?.message,
      pubsRes.error?.message,
      supportRes.error?.message,
      revenueRes.error?.message,
      targetsRes.error?.message,
    ].filter(Boolean);

    if (errors.length > 0) {
      setError(`Failed to load some dashboard data: ${errors[0]}`);
    }

    setData({
      products: productsRes.data || [],
      videos: videosRes.data || [],
      publications: pubsRes.data || [],
      supportTickets: supportRes.data || [],
      dailyRevenue: revenueRes.data || [],
      publishingTargets: targetsRes.data || [],
    });
    setRefreshing(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshDashboard();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshDashboard]);

  const now = useMemo(() => new Date(), []);
  const monthStart = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 1), [now]);
  const thisWeekStart = useMemo(() => getWeekStart(now), [getWeekStart, now]);
  const nextWeekStart = useMemo(() => {
    const d = new Date(thisWeekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [thisWeekStart]);
  const prevWeekStart = useMemo(() => {
    const d = new Date(thisWeekStart);
    d.setDate(d.getDate() - 7);
    return d;
  }, [thisWeekStart]);

  const products = data.products;
  const videos = data.videos;
  const publications = data.publications;
  const supportTickets = data.supportTickets;
  const dailyRevenue = data.dailyRevenue;

  const productById = useMemo(() => {
    const map = {};
    products.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [products]);

  const revenueThisMonth = useMemo(() => {
    return dailyRevenue.reduce((sum, row) => {
      const d = new Date(row.date || 0);
      if (Number.isNaN(d.getTime()) || d < monthStart) return sum;
      return sum + Number(row.net_revenue ?? (Number(row.gross_revenue || 0) - Number(row.refunds || 0)));
    }, 0);
  }, [dailyRevenue, monthStart]);

  const revenueTarget = 100000;
  const revenueProgressPct = Math.min(100, Math.round((revenueThisMonth / revenueTarget) * 100));

  const productsInPipeline = useMemo(
    () => products.filter((p) => !["dead", "live"].includes(p.stage)).length,
    [products]
  );
  const productsLive = useMemo(() => products.filter((p) => p.stage === "live").length, [products]);

  const videosPublishedThisWeek = useMemo(
    () =>
      publications.filter((p) => {
        const d = new Date(p.published_at || 0);
        return !Number.isNaN(d.getTime()) && d >= thisWeekStart && d < nextWeekStart;
      }).length,
    [publications, thisWeekStart, nextWeekStart]
  );

  const openSupportTickets = useMemo(
    () =>
      supportTickets.filter((t) =>
        ["open", "in_progress", "waiting_customer", "waiting_supplier"].includes(t.status)
      ).length,
    [supportTickets]
  );

  const actionItems = useMemo(() => {
    const items = [];

    products.forEach((p) => {
      if (p.stage === "sourced" && daysSince(p.stage_entered_at) > 1) {
        items.push({
          id: `product-sourced-${p.id}`,
          product: p,
          title: p.name,
          msg: "Needs quick screen",
          urgency: "medium",
        });
      }

      if (p.stage === "scored") {
        const score = p.score_total ?? calcWeightedScore(p);
        if (score !== null && score >= 60 && score <= 74 && daysSince(p.stage_entered_at) > 7) {
          items.push({
            id: `product-hold-${p.id}`,
            product: p,
            title: p.name,
            msg: "Hold expired — kill or approve",
            urgency: "critical",
          });
        }
      }

      if (p.stage === "sample_ordered" && daysSince(p.stage_entered_at) > 14) {
        items.push({
          id: `product-sample-ordered-${p.id}`,
          product: p,
          title: p.name,
          msg: "Sample overdue",
          urgency: "high",
        });
      }

      if (p.stage === "sample_review" && daysSince(p.stage_entered_at) > 2) {
        items.push({
          id: `product-sample-review-${p.id}`,
          product: p,
          title: p.name,
          msg: "Sample review overdue",
          urgency: "high",
        });
      }
    });

    videos.forEach((v) => {
      if (v.status === "filmed" && daysSince(v.filmed_at || v.updated_at || v.created_at) > 2) {
        items.push({
          id: `video-filmed-${v.id}`,
          title: v.name || "Untitled video",
          msg: "Needs editing",
          urgency: "high",
        });
      }
      if (v.status === "edited" && daysSince(v.updated_at || v.created_at) > 1) {
        items.push({
          id: `video-edited-${v.id}`,
          title: v.name || "Untitled video",
          msg: "Ready to publish",
          urgency: "medium",
        });
      }
    });

    supportTickets.forEach((t) => {
      if (t.status === "open" && daysSince(t.created_at || t.updated_at) > 2) {
        items.push({
          id: `ticket-open-${t.id}`,
          title: t.order_number ? `Order #${t.order_number}` : t.customer_name || "Support ticket",
          msg: "Support ticket aging",
          urgency: "high",
        });
      }
    });

    const rank = { critical: 0, high: 1, medium: 2 };
    return items.sort((a, b) => rank[a.urgency] - rank[b.urgency]);
  }, [products, videos, supportTickets]);

  const cadenceData = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const mergedTargets = { ...defaultTargets };
    data.publishingTargets.forEach((row) => {
      const k = String(row.platform || "").toLowerCase();
      if (mergedTargets[k]) {
        mergedTargets[k] = {
          daily_target: row.daily_target ?? mergedTargets[k].daily_target,
          weekly_target: row.weekly_target ?? mergedTargets[k].weekly_target,
        };
      }
    });

    const result = {};
    Object.keys(mergedTargets).forEach((k) => {
      result[k] = { today: 0, week: 0, ...mergedTargets[k] };
    });

    publications.forEach((pub) => {
      const k = String(pub.platform || "").toLowerCase();
      if (!result[k]) return;
      const d = new Date(pub.published_at || 0);
      if (Number.isNaN(d.getTime())) return;
      if (d >= todayStart) result[k].today += 1;
      if (d >= thisWeekStart && d < nextWeekStart) result[k].week += 1;
    });

    return result;
  }, [data.publishingTargets, defaultTargets, publications, thisWeekStart, nextWeekStart]);

  const pipelineByStage = useMemo(() => {
    const byStage = {};
    STAGES.forEach((s) => {
      byStage[s.id] = products.filter((p) => p.stage === s.id).length;
    });
    return byStage;
  }, [products]);

  const totalPipelineCount = useMemo(
    () => STAGES.reduce((sum, s) => sum + (pipelineByStage[s.id] || 0), 0),
    [pipelineByStage]
  );

  const contentOutput = useMemo(() => {
    const statuses = ["concept", "scripted", "filming_ready", "filmed", "editing", "edited", "published"];
    const counts = {};
    statuses.forEach((s) => {
      counts[s] = videos.filter((v) => v.status === s).length;
    });

    const publishedThisWeek = videos.filter((v) => {
      if (v.status !== "published") return false;
      const d = new Date(v.published_at || 0);
      return !Number.isNaN(d.getTime()) && d >= thisWeekStart && d < nextWeekStart;
    }).length;

    const publishedLastWeek = videos.filter((v) => {
      if (v.status !== "published") return false;
      const d = new Date(v.published_at || 0);
      return !Number.isNaN(d.getTime()) && d >= prevWeekStart && d < thisWeekStart;
    }).length;

    return { counts, publishedThisWeek, publishedLastWeek };
  }, [videos, thisWeekStart, nextWeekStart, prevWeekStart]);

  const deadProducts = useMemo(
    () =>
      products
        .filter((p) => p.stage === "dead")
        .sort(
          (a, b) =>
            new Date(b.killed_at || b.updated_at || 0).getTime() -
            new Date(a.killed_at || a.updated_at || 0).getTime()
        ),
    [products]
  );

  const killsByStage = useMemo(() => {
    const map = {};
    deadProducts.forEach((p) => {
      const s = p.killed_at_stage || "unknown";
      map[s] = (map[s] || 0) + 1;
    });
    return map;
  }, [deadProducts]);

  const weeklyRevenueTrend = useMemo(() => {
    const points = [];
    for (let i = 7; i >= 0; i -= 1) {
      const start = new Date(thisWeekStart);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const value = dailyRevenue.reduce((sum, row) => {
        const d = new Date(row.date || 0);
        if (Number.isNaN(d.getTime()) || d < start || d >= end) return sum;
        return sum + Number(row.net_revenue ?? (Number(row.gross_revenue || 0) - Number(row.refunds || 0)));
      }, 0);
      points.push({
        label: `${start.getMonth() + 1}/${start.getDate()}`,
        value,
      });
    }
    const max = points.reduce((m, p) => Math.max(m, p.value), 0);
    return { points, max };
  }, [dailyRevenue, thisWeekStart]);

  const topPerformers = useMemo(() => {
    return publications
      .filter((p) => {
        const d = new Date(p.published_at || 0);
        return !Number.isNaN(d.getTime()) && d >= monthStart;
      })
      .sort((a, b) => Number(b.views_current || 0) - Number(a.views_current || 0))
      .slice(0, 5);
  }, [publications, monthStart]);

  if (loading) {
    return <CommandCenterSkeleton />;
  }

  return (
    <div style={{ maxWidth: 1380, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em" }}>
          COMMAND CENTER — LIVE DASHBOARD
        </div>
        <button onClick={() => void refreshDashboard()} style={commandGhostButtonStyle}>
          {refreshing ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.35)",
            color: "#fca5a5",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {/* Top Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
        <CommandMetricCard
          label="REVENUE THIS MONTH"
          value={`$${Math.round(revenueThisMonth).toLocaleString()}`}
          subtitle="From daily_revenue"
          color="#10b981"
        />
        <CommandMetricCard
          label="REVENUE TARGET"
          value={`${revenueProgressPct}%`}
          subtitle={`$100,000 target • ${Math.round(revenueThisMonth).toLocaleString()} achieved`}
          color={revenueProgressPct >= 100 ? "#10b981" : revenueProgressPct >= 70 ? "#f59e0b" : "#ef4444"}
          progress={revenueProgressPct}
        />
        <CommandMetricCard
          label="PRODUCTS IN PIPELINE"
          value={productsInPipeline}
          subtitle="Not dead / not live"
          color="#3b82f6"
        />
        <CommandMetricCard label="PRODUCTS LIVE" value={productsLive} subtitle="Stage = live" color="#10b981" />
        <CommandMetricCard
          label="VIDEOS PUBLISHED THIS WEEK"
          value={videosPublishedThisWeek}
          subtitle="From publications table"
          color="#8b5cf6"
        />
        <CommandMetricCard
          label="OPEN SUPPORT TICKETS"
          value={openSupportTickets}
          subtitle="open / in progress / waiting"
          color="#ef4444"
        />
      </div>

      {/* Row 2 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={commandPanelStyle}>
          <div style={commandHeaderStyle}>⚡ ACTION ITEMS ({actionItems.length})</div>
          {actionItems.length === 0 ? (
            <div style={{ color: "#334155", fontSize: 12, fontStyle: "italic" }}>All clear — nothing overdue</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {actionItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => item.product && onSelect && onSelect(item.product)}
                  style={{
                    background: "#141420",
                    border: `1px solid ${
                      item.urgency === "critical"
                        ? "#7f1d1d"
                        : item.urgency === "high"
                          ? "#78350f"
                          : "#3f3f46"
                    }`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#e94560";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor =
                      item.urgency === "critical"
                        ? "#7f1d1d"
                        : item.urgency === "high"
                          ? "#78350f"
                          : "#3f3f46";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{item.msg}</div>
                  </div>
                  <UrgencyBadge urgency={item.urgency} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={commandPanelStyle}>
          <div style={commandHeaderStyle}>📣 PUBLISHING CADENCE</div>
          <div style={{ display: "grid", gap: 8 }}>
            {Object.entries(cadenceData).map(([platform, row]) => {
              const dayRatio = row.daily_target > 0 ? row.today / row.daily_target : 0;
              const weekRatio = row.weekly_target > 0 ? row.week / row.weekly_target : 0;
              const pretty = platform.charAt(0).toUpperCase() + platform.slice(1);
              return (
                <div key={platform} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 8, background: "#111322" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
                    <span style={{ color: "#cbd5e1", fontWeight: 700 }}>{pretty}</span>
                    <span style={{ color: "#94a3b8" }}>
                      {row.today}/{row.daily_target} today • {row.week}/{row.weekly_target} week
                    </span>
                  </div>
                  <MiniProgress ratio={dayRatio} />
                  <div style={{ height: 4 }} />
                  <MiniProgress ratio={weekRatio} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 3 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={commandPanelStyle}>
          <div style={commandHeaderStyle}>PIPELINE BREAKDOWN</div>
          <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", border: "1px solid #1e293b" }}>
            {STAGES.map((s) => {
              const c = pipelineByStage[s.id] || 0;
              const width = totalPipelineCount > 0 ? (c / totalPipelineCount) * 100 : 0;
              return <div key={s.id} style={{ width: `${width}%`, background: s.color, minWidth: c > 0 ? 10 : 0 }} />;
            })}
          </div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {STAGES.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: s.color, fontWeight: 700 }}>{s.label}</span>
                <span style={{ color: "#cbd5e1" }}>{pipelineByStage[s.id] || 0}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={commandPanelStyle}>
          <div style={commandHeaderStyle}>CONTENT OUTPUT</div>
          <div style={{ display: "grid", gap: 6 }}>
            {["concept", "scripted", "filming_ready", "filmed", "editing", "edited", "published"].map((s) => (
              <div key={s} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#94a3b8" }}>{s}</span>
                <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{contentOutput.counts[s] || 0}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid #1e293b", paddingTop: 10, fontSize: 11 }}>
            <span style={{ color: "#94a3b8" }}>Published this week vs last week: </span>
            <span
              style={{
                color:
                  contentOutput.publishedThisWeek > contentOutput.publishedLastWeek
                    ? "#10b981"
                    : contentOutput.publishedThisWeek < contentOutput.publishedLastWeek
                      ? "#ef4444"
                      : "#94a3b8",
                fontWeight: 700,
              }}
            >
              {contentOutput.publishedThisWeek} vs {contentOutput.publishedLastWeek}{" "}
              {contentOutput.publishedThisWeek > contentOutput.publishedLastWeek
                ? "↑"
                : contentOutput.publishedThisWeek < contentOutput.publishedLastWeek
                  ? "↓"
                  : "→"}
            </span>
          </div>
        </div>

        <div style={commandPanelStyle}>
          <div style={commandHeaderStyle}>💀 DEATH LOG SUMMARY</div>
          {deadProducts.length === 0 ? (
            <div style={{ color: "#334155", fontSize: 12, fontStyle: "italic" }}>No dead products yet</div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                {Object.entries(killsByStage).map(([stage, count]) => {
                  const stageInfo = STAGES.find((s) => s.id === stage) || DEAD_STAGE;
                  return (
                    <div key={stage} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 90, fontSize: 11, color: stageInfo.color, fontWeight: 700 }}>
                        {stageInfo.label || stage}
                      </div>
                      <div style={{ flex: 1, height: 7, background: "#1e293b", borderRadius: 999, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${(count / deadProducts.length) * 100}%`,
                            height: "100%",
                            background: "#ef4444",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 700 }}>{count}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ borderTop: "1px solid #1e293b", paddingTop: 10 }}>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>RECENT 5 KILLS</div>
                {deadProducts.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    onClick={() => onSelect && onSelect(p)}
                    style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#e94560")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                  >
                    <span style={{ color: "#ef4444" }}>✕</span> {p.name || "Unknown"} — {p.kill_reason || "no reason"}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={commandPanelStyle}>
          <div style={commandHeaderStyle}>WEEKLY REVENUE TREND (LAST 8 WEEKS)</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 160 }}>
            {weeklyRevenueTrend.points.map((p) => (
              <div key={p.label} style={{ flex: 1, minWidth: 24 }}>
                <div
                  title={`${p.label}: $${Math.round(p.value).toLocaleString()}`}
                  style={{
                    width: "100%",
                    height: `${weeklyRevenueTrend.max > 0 ? Math.max(8, (p.value / weeklyRevenueTrend.max) * 130) : 8}px`,
                    background: "#10b981",
                    borderRadius: "6px 6px 0 0",
                  }}
                />
                <div style={{ marginTop: 4, fontSize: 9, color: "#64748b", textAlign: "center" }}>{p.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={commandPanelStyle}>
          <div style={commandHeaderStyle}>TOP PERFORMERS (THIS MONTH)</div>
          {topPerformers.length === 0 ? (
            <div style={{ color: "#334155", fontSize: 12, fontStyle: "italic" }}>No publications this month yet</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {topPerformers.map((pub, idx) => (
                <div key={pub.id || idx} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: "8px 10px", background: "#111322" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                      {idx + 1}. {pub.title || pub.hook_used || "Untitled"}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#10b981" }}>
                      {(Number(pub.views_current || 0)).toLocaleString()} views
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                    {(pub.platform || "unknown").toUpperCase()} • {(productById[pub.product_id]?.name || "No linked product")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CommandCenterSkeleton() {
  return (
    <div style={{ maxWidth: 1380, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ ...commandPanelStyle, height: 96, background: "#0f0f1a" }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={{ ...commandPanelStyle, height: 260 }} />
        <div style={{ ...commandPanelStyle, height: 260 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={{ ...commandPanelStyle, height: 240 }} />
        <div style={{ ...commandPanelStyle, height: 240 }} />
        <div style={{ ...commandPanelStyle, height: 240 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ ...commandPanelStyle, height: 220 }} />
        <div style={{ ...commandPanelStyle, height: 220 }} />
      </div>
    </div>
  );
}

function CommandMetricCard({ label, value, subtitle, color, progress }) {
  return (
    <div
      style={{
        background: "#0f0f1a",
        border: "1px solid #1e293b",
        borderRadius: 12,
        padding: "14px 14px",
        borderTop: `3px solid ${color}`,
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 6, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>{subtitle}</div>
      {typeof progress === "number" && (
        <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: "#1e293b", overflow: "hidden" }}>
          <div style={{ width: `${Math.max(0, Math.min(100, progress))}%`, height: "100%", background: color }} />
        </div>
      )}
    </div>
  );
}

function UrgencyBadge({ urgency }) {
  const bg = urgency === "critical" ? "#7f1d1d" : urgency === "high" ? "#78350f" : "#3f3f46";
  const fg = urgency === "critical" ? "#fca5a5" : urgency === "high" ? "#fcd34d" : "#fde68a";
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 4,
        background: bg,
        color: fg,
      }}
    >
      {urgency.toUpperCase()}
    </span>
  );
}

function MiniProgress({ ratio }) {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const color = ratio >= 1 ? "#10b981" : ratio >= 0.7 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ height: 6, borderRadius: 999, background: "#1e293b", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color }} />
    </div>
  );
}

const commandPanelStyle = {
  background: "#0f0f1a",
  border: "1px solid #1e293b",
  borderRadius: 12,
  padding: 14,
};

const commandHeaderStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: "#64748b",
  letterSpacing: "0.08em",
  marginBottom: 12,
};

const commandGhostButtonStyle = {
  background: "transparent",
  color: "#cbd5e1",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
};

// ============================================================
// PRODUCT DETAIL MODAL
// ============================================================
function ProductDetail({ product: p, onClose, onUpdate, onAdvance, onKill }) {
  const [tab, setTab] = useState("overview");
  const score = p.score_total ?? calcWeightedScore(p);
  const verdict = getScoreVerdict(score, p);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200,
      display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 40,
      overflowY: "auto",
    }} onClick={onClose}>
      <div style={{
        background: "#0f0f1a",
        border: "1px solid #1e293b",
        borderRadius: 16,
        width: "90%",
        maxWidth: 800,
        maxHeight: "90vh",
        overflowY: "auto",
        marginBottom: 40,
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: "20px 24px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9" }}>{p.name}</div>
            <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center" }}>
              <StageBadge stage={p.stage} />
              {score !== null && (
                <span style={{ fontSize: 14, fontWeight: 800, color: getScoreColor(score) }}>Score: {score}/100</span>
              )}
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 4,
                background: `${verdict.color}20`,
                color: verdict.color,
                border: `1px solid ${verdict.color}40`,
              }}>
                {verdict.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ padding: "0 24px", borderBottom: "1px solid #1e293b", display: "flex", gap: 0 }}>
          {["overview", "scoring", "sample", "economics", "timeline"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid #e94560" : "2px solid transparent",
              color: tab === t ? "#e94560" : "#64748b",
              padding: "12px 16px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              transition: "all 0.15s",
            }}>
              {t}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{ padding: 24 }}>
          {tab === "overview" && <OverviewTab product={p} onUpdate={onUpdate} />}
          {tab === "scoring" && <ScoringTab product={p} onUpdate={onUpdate} />}
          {tab === "sample" && <SampleTab product={p} onUpdate={onUpdate} />}
          {tab === "economics" && <EconomicsTab product={p} onUpdate={onUpdate} />}
          {tab === "timeline" && <TimelineTab product={p} />}
        </div>

        {/* Footer Actions */}
        {p.stage !== "dead" && (
          <div style={{
            padding: "16px 24px",
            borderTop: "1px solid #1e293b",
            display: "flex",
            justifyContent: "space-between",
          }}>
            <button onClick={onKill} style={{
              background: "#7f1d1d",
              color: "#fca5a5",
              border: "none",
              borderRadius: 8,
              padding: "8px 20px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}>
              💀 KILL PRODUCT
            </button>
            <button onClick={onAdvance} style={{
              background: "linear-gradient(135deg, #10b981, #059669)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 20px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}>
              ADVANCE STAGE →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StageBadge({ stage }) {
  const info = STAGES.find(s => s.id === stage) || DEAD_STAGE;
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 700,
      padding: "3px 10px",
      borderRadius: 4,
      background: `${info.color}20`,
      color: info.color,
      border: `1px solid ${info.color}40`,
    }}>
      {info.icon} {info.label}
    </span>
  );
}

// ============================================================
// TAB: OVERVIEW
// ============================================================
function OverviewTab({ product: p, onUpdate }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FieldGroup label="NOTES">
        <EditableTextArea value={p.notes} onChange={v => onUpdate({ notes: v })} placeholder="Add notes about this product..." />
      </FieldGroup>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <FieldGroup label="SOURCE URL">
          <EditableInput value={p.source_url} onChange={v => onUpdate({ source_url: v })} placeholder="https://..." />
        </FieldGroup>
        <FieldGroup label="TARGET PLATFORM">
          <EditableInput value={p.target_platform} onChange={v => onUpdate({ target_platform: v })} placeholder="TikTok, IG, YT, FB" />
        </FieldGroup>
        <FieldGroup label="TARGET GEOGRAPHY">
          <EditableInput value={p.target_geography} onChange={v => onUpdate({ target_geography: v })} placeholder="US, UK, EU..." />
        </FieldGroup>
        <FieldGroup label="TARGET ANGLE">
          <EditableInput value={p.target_angle} onChange={v => onUpdate({ target_angle: v })} placeholder="Time-saving, frustration removal..." />
        </FieldGroup>
      </div>
      <FieldGroup label="QUICK SCREEN">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <ToggleButton active={p.quick_screen_passed === true} onClick={() => onUpdate({ quick_screen_passed: true })} label="PASS" color="#10b981" />
          <ToggleButton active={p.quick_screen_passed === false} onClick={() => onUpdate({ quick_screen_passed: false })} label="FAIL" color="#ef4444" />
        </div>
        <EditableInput value={p.quick_screen_reason} onChange={v => onUpdate({ quick_screen_reason: v })} placeholder="One-line reason..." style={{ marginTop: 8 }} />
      </FieldGroup>
      <FieldGroup label="CRITICAL FAILS">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CRITICAL_FAILS.map(cf => (
            <button key={cf.key} onClick={() => onUpdate({ [cf.key]: !p[cf.key] })} style={{
              background: p[cf.key] ? "#7f1d1d" : "#141420",
              color: p[cf.key] ? "#fca5a5" : "#64748b",
              border: `1px solid ${p[cf.key] ? "#991b1b" : "#1e293b"}`,
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: p[cf.key] ? 700 : 400,
              transition: "all 0.15s",
            }}>
              {p[cf.key] ? "⚠ " : ""}{cf.label}
            </button>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup label="EXCEPTION">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ToggleButton active={p.exception_invoked} onClick={() => onUpdate({ exception_invoked: !p.exception_invoked })} label={p.exception_invoked ? "EXCEPTION ACTIVE" : "No exception"} color={p.exception_invoked ? "#f59e0b" : "#64748b"} />
        </div>
        {p.exception_invoked && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {["low_ticket", "non_problem_solving", "dominant_demo"].map(t => (
                <button key={t} onClick={() => onUpdate({ exception_type: t })} style={{
                  background: p.exception_type === t ? "#78350f" : "#141420",
                  color: p.exception_type === t ? "#fcd34d" : "#64748b",
                  border: `1px solid ${p.exception_type === t ? "#92400e" : "#1e293b"}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 10,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}>
                  {t.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            <EditableInput value={p.exception_comparable_product} onChange={v => onUpdate({ exception_comparable_product: v })} placeholder="Name ONE comparable product that succeeded similarly..." />
          </div>
        )}
      </FieldGroup>
    </div>
  );
}

// ============================================================
// TAB: SCORING
// ============================================================
function ScoringTab({ product: p, onUpdate }) {
  const score = p.score_total ?? calcWeightedScore(p);
  const verdict = getScoreVerdict(score, p);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Score summary */}
      <div style={{
        background: "#141420",
        border: "1px solid #1e293b",
        borderRadius: 12,
        padding: 20,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 48, fontWeight: 800, color: score !== null ? getScoreColor(score) : "#334155", lineHeight: 1 }}>
          {score !== null ? score : "—"}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>/ 100</div>
        <div style={{
          display: "inline-block",
          marginTop: 12,
          fontSize: 12,
          fontWeight: 700,
          padding: "4px 16px",
          borderRadius: 6,
          background: `${verdict.color}20`,
          color: verdict.color,
          border: `1px solid ${verdict.color}40`,
        }}>
          {verdict.label} — {verdict.desc}
        </div>
      </div>

      {/* Bucket scoring */}
      {SCORE_BUCKETS.map(b => {
        const val = p[`score_${b.key}`];
        return (
          <div key={b.key} style={{
            background: "#141420",
            border: "1px solid #1e293b",
            borderRadius: 12,
            padding: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{b.label}</span>
                <span style={{ fontSize: 10, color: "#475569", marginLeft: 8 }}>Weight: {b.weight}%</span>
              </div>
              <span style={{ fontSize: 11, color: "#64748b", fontStyle: "italic" }}>{b.question}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => onUpdate({ [`score_${b.key}`]: n })} style={{
                  flex: 1,
                  padding: "10px 0",
                  background: val === n ? getBucketScoreColor(n) : "#0f0f1a",
                  color: val === n ? "#fff" : "#64748b",
                  border: `1px solid ${val === n ? getBucketScoreColor(n) : "#1e293b"}`,
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}>
                  {n}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", marginBottom: 8, padding: "0 4px" }}>
              <span>Very weak</span><span>Weak</span><span>Acceptable</span><span>Strong</span><span>Exceptional</span>
            </div>
            <EditableInput
              value={p[b.noteKey]}
              onChange={v => onUpdate({ [b.noteKey]: v })}
              placeholder="One-line justification..."
            />
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// TAB: SAMPLE
// ============================================================
function SampleTab({ product: p, onUpdate }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <FieldGroup label="SAMPLE SUPPLIER">
          <EditableInput value={p.sample_supplier} onChange={v => onUpdate({ sample_supplier: v })} placeholder="Supplier name..." />
        </FieldGroup>
        <FieldGroup label="BACKUP SUPPLIER">
          <EditableInput value={p.sample_backup_supplier} onChange={v => onUpdate({ sample_backup_supplier: v })} placeholder="Backup supplier..." />
        </FieldGroup>
      </div>

      <FieldGroup label="SAMPLE REALITY CHECK — 5 YES/NO QUESTIONS">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SAMPLE_CHECKS.map(sc => (
            <div key={sc.key} style={{
              background: "#141420",
              border: "1px solid #1e293b",
              borderRadius: 8,
              padding: "12px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ fontSize: 12, color: "#e2e8f0" }}>{sc.label}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <ToggleButton active={p[sc.key] === true} onClick={() => onUpdate({ [sc.key]: true })} label="YES" color="#10b981" small />
                <ToggleButton active={p[sc.key] === false} onClick={() => onUpdate({ [sc.key]: false })} label="NO" color="#ef4444" small />
              </div>
            </div>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="SAMPLE VERDICT">
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { value: "go", label: "GO", color: "#10b981", desc: "Move to execution" },
            { value: "adjust", label: "ADJUST & PROCEED", color: "#f59e0b", desc: "Revise plan, then proceed" },
            { value: "kill", label: "KILL", color: "#ef4444", desc: "Stop the product" },
          ].map(v => (
            <button key={v.value} onClick={() => onUpdate({ sample_verdict: v.value })} style={{
              flex: 1,
              background: p.sample_verdict === v.value ? `${v.color}20` : "#141420",
              border: `2px solid ${p.sample_verdict === v.value ? v.color : "#1e293b"}`,
              borderRadius: 10,
              padding: "14px 12px",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "center",
              transition: "all 0.15s",
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: p.sample_verdict === v.value ? v.color : "#64748b" }}>{v.label}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>{v.desc}</div>
            </button>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="SAMPLE NOTES">
        <EditableTextArea value={p.sample_notes} onChange={v => onUpdate({ sample_notes: v })} placeholder="Notes about the physical sample..." />
      </FieldGroup>
    </div>
  );
}

// ============================================================
// TAB: ECONOMICS
// ============================================================
function EconomicsTab({ product: p, onUpdate }) {
  const margin = p.aov && p.cogs != null && p.shipping_cost != null
    ? p.aov - p.cogs - p.shipping_cost - (p.aov * 0.0425)
    : null;
  const marginPct = margin !== null && p.aov > 0 ? (margin / p.aov) * 100 : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <FieldGroup label="AOV (Selling Price)">
          <EditableNumber value={p.aov} onChange={v => onUpdate({ aov: v })} prefix="$" />
        </FieldGroup>
        <FieldGroup label="COGS (Product Cost)">
          <EditableNumber value={p.cogs} onChange={v => onUpdate({ cogs: v })} prefix="$" />
        </FieldGroup>
        <FieldGroup label="SHIPPING COST">
          <EditableNumber value={p.shipping_cost} onChange={v => onUpdate({ shipping_cost: v })} prefix="$" />
        </FieldGroup>
      </div>

      {/* Auto-calculated */}
      <div style={{
        background: "#141420",
        border: "1px solid #1e293b",
        borderRadius: 12,
        padding: 20,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 20,
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#475569", fontWeight: 700, letterSpacing: "0.08em" }}>PROCESSING FEE</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#64748b", marginTop: 4 }}>
            {p.aov ? `$${(p.aov * 0.0425).toFixed(2)}` : "—"}
          </div>
          <div style={{ fontSize: 9, color: "#475569" }}>4.25%</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#475569", fontWeight: 700, letterSpacing: "0.08em" }}>MARGIN / UNIT</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: margin !== null && margin > 0 ? "#10b981" : "#ef4444", marginTop: 4 }}>
            {margin !== null ? `$${margin.toFixed(2)}` : "—"}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#475569", fontWeight: 700, letterSpacing: "0.08em" }}>MARGIN %</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: marginPct !== null && marginPct > 25 ? "#10b981" : "#ef4444", marginTop: 4 }}>
            {marginPct !== null ? `${marginPct.toFixed(1)}%` : "—"}
          </div>
          {marginPct !== null && marginPct <= 25 && (
            <div style={{ fontSize: 9, color: "#ef4444", fontWeight: 700, marginTop: 2 }}>⚠ BELOW 25% FLOOR</div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <FieldGroup label="PRIMARY SUPPLIER">
          <EditableInput value={p.primary_supplier} onChange={v => onUpdate({ primary_supplier: v })} placeholder="Supplier name..." />
        </FieldGroup>
        <FieldGroup label="BACKUP SUPPLIER">
          <EditableInput value={p.backup_supplier} onChange={v => onUpdate({ backup_supplier: v })} placeholder="Backup supplier..." />
        </FieldGroup>
      </div>
    </div>
  );
}

// ============================================================
// TAB: TIMELINE
// ============================================================
function TimelineTab({ product: p }) {
  const events = [
    { date: p.created_at, label: "Product sourced", stage: "sourced" },
    p.quick_screen_passed !== null && { date: p.created_at, label: `Quick screen: ${p.quick_screen_passed ? "PASS" : "FAIL"}`, stage: "quick_screen" },
    p.score_total && { date: p.created_at, label: `Scored: ${p.score_total}/100`, stage: "scored" },
    p.sample_ordered_at && { date: p.sample_ordered_at, label: "Sample ordered", stage: "sample_ordered" },
    p.sample_arrived_at && { date: p.sample_arrived_at, label: "Sample arrived", stage: "sample_review" },
    p.sample_verdict && { date: p.sample_arrived_at, label: `Sample verdict: ${p.sample_verdict.toUpperCase()}`, stage: "sample_review" },
    p.killed_at && { date: p.killed_at, label: `KILLED at ${p.killed_at_stage}: ${p.kill_reason}`, stage: "dead" },
  ].filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {events.map((ev, i) => {
        const stageInfo = STAGES.find(s => s.id === ev.stage) || DEAD_STAGE;
        return (
          <div key={i} style={{ display: "flex", gap: 16, padding: "12px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: stageInfo.color, flexShrink: 0 }} />
              {i < events.length - 1 && <div style={{ width: 2, flex: 1, background: "#1e293b" }} />}
            </div>
            <div style={{ paddingBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{ev.label}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                {ev.date ? new Date(ev.date).toLocaleDateString() : "—"}
              </div>
            </div>
          </div>
        );
      })}
      {events.length === 0 && (
        <div style={{ color: "#334155", fontSize: 12, fontStyle: "italic" }}>No activity yet</div>
      )}
    </div>
  );
}

// ============================================================
// MODALS
// ============================================================
function AddProductModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [platform, setPlatform] = useState("");
  const [geo, setGeo] = useState("");
  const [angle, setAngle] = useState("");

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200,
      display: "flex", justifyContent: "center", alignItems: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#0f0f1a",
        border: "1px solid #1e293b",
        borderRadius: 16,
        width: "90%",
        maxWidth: 500,
        padding: 24,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 20 }}>Add New Product</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <FieldGroup label="PRODUCT NAME *">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Product name..."
              style={{ ...inputStyle, fontSize: 14 }} autoFocus />
          </FieldGroup>
          <FieldGroup label="SOURCE URL">
            <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..."
              style={inputStyle} />
          </FieldGroup>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FieldGroup label="TARGET PLATFORM">
              <input value={platform} onChange={e => setPlatform(e.target.value)} placeholder="TikTok, IG..."
                style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="TARGET GEO">
              <input value={geo} onChange={e => setGeo(e.target.value)} placeholder="US, UK..."
                style={inputStyle} />
            </FieldGroup>
          </div>
          <FieldGroup label="TARGET ANGLE">
            <input value={angle} onChange={e => setAngle(e.target.value)} placeholder="Time-saving, satisfaction..."
              style={inputStyle} />
          </FieldGroup>
          <FieldGroup label="NOTES">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Initial notes..."
              style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} />
          </FieldGroup>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            background: "transparent", color: "#64748b", border: "1px solid #1e293b",
            borderRadius: 8, padding: "8px 20px", fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
          }}>
            Cancel
          </button>
          <button onClick={() => {
            if (!name.trim()) return;
            onAdd({ name, source_url: sourceUrl, notes, target_platform: platform, target_geography: geo, target_angle: angle });
          }} style={{
            background: name.trim() ? "linear-gradient(135deg, #e94560, #c62a40)" : "#1e293b",
            color: name.trim() ? "#fff" : "#475569",
            border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 12,
            cursor: name.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700,
          }}>
            ADD TO PIPELINE
          </button>
        </div>
      </div>
    </div>
  );
}

function KillModal({ product, onClose, onKill }) {
  const [reason, setReason] = useState("");

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
      display: "flex", justifyContent: "center", alignItems: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#0f0f1a",
        border: "1px solid #7f1d1d",
        borderRadius: 16,
        width: "90%",
        maxWidth: 450,
        padding: 24,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#ef4444", marginBottom: 8 }}>💀 Kill Product</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20 }}>
          Killing <strong style={{ color: "#f1f5f9" }}>{product.name}</strong> at stage <strong style={{ color: "#f1f5f9" }}>{product.stage}</strong>
        </div>

        <FieldGroup label="KILL REASON (Required for death log)">
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Why is this product being killed? Be specific — this builds institutional memory."
            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
            autoFocus />
        </FieldGroup>

        <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            background: "transparent", color: "#64748b", border: "1px solid #1e293b",
            borderRadius: 8, padding: "8px 20px", fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
          }}>
            Cancel
          </button>
          <button onClick={() => {
            if (!reason.trim()) return;
            onKill(product.id, reason);
          }} style={{
            background: reason.trim() ? "#991b1b" : "#1e293b",
            color: reason.trim() ? "#fca5a5" : "#475569",
            border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 12,
            cursor: reason.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", fontWeight: 700,
          }}>
            CONFIRM KILL
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// REUSABLE FORM COMPONENTS
// ============================================================
const inputStyle = {
  width: "100%",
  background: "#141420",
  border: "1px solid #1e293b",
  borderRadius: 8,
  padding: "8px 12px",
  color: "#e2e8f0",
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s",
};

function FieldGroup({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function EditableInput({ value, onChange, placeholder, style: extraStyle }) {
  return (
    <input
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...inputStyle, ...extraStyle }}
      onFocus={e => e.target.style.borderColor = "#e94560"}
      onBlur={e => e.target.style.borderColor = "#1e293b"}
    />
  );
}

function EditableTextArea({ value, onChange, placeholder }) {
  return (
    <textarea
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
      onFocus={e => e.target.style.borderColor = "#e94560"}
      onBlur={e => e.target.style.borderColor = "#1e293b"}
    />
  );
}

function EditableNumber({ value, onChange, prefix }) {
  return (
    <div style={{ position: "relative" }}>
      {prefix && <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#475569", fontSize: 12 }}>{prefix}</span>}
      <input
        type="number"
        value={value ?? ""}
        onChange={e => onChange(e.target.value ? parseFloat(e.target.value) : null)}
        style={{ ...inputStyle, paddingLeft: prefix ? 28 : 12 }}
        onFocus={e => e.target.style.borderColor = "#e94560"}
        onBlur={e => e.target.style.borderColor = "#1e293b"}
      />
    </div>
  );
}

function ToggleButton({ active, onClick, label, color, small }) {
  return (
    <button onClick={onClick} style={{
      background: active ? `${color}20` : "#141420",
      color: active ? color : "#475569",
      border: `1px solid ${active ? `${color}60` : "#1e293b"}`,
      borderRadius: 6,
      padding: small ? "4px 10px" : "6px 14px",
      fontSize: small ? 10 : 11,
      fontWeight: active ? 700 : 500,
      cursor: "pointer",
      fontFamily: "inherit",
      transition: "all 0.15s",
    }}>
      {label}
    </button>
  );
}
