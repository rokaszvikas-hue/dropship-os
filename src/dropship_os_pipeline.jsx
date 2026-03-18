import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./lib/supabase";

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
  const [syncError, setSyncError] = useState("");
  const [view, setView] = useState("pipeline"); // pipeline | command
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showKillModal, setShowKillModal] = useState(null);
  const [showDeadProducts, setShowDeadProducts] = useState(false);

  const deadProducts = products.filter(p => p.stage === "dead");
  const liveProducts = products.filter(p => p.stage !== "dead");

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
      setIsSyncing(false);
      return false;
    }

    const mapped = (data || []).map(rowToProduct);
    setProducts(mapped);
    setSelectedProduct((prev) => {
      if (!prev) return null;
      return mapped.find((p) => p.id === prev.id) || null;
    });
    setSyncError("");
    setIsSyncing(false);
    return true;
  }, []);

  useEffect(() => {
    const timerId = setTimeout(() => {
      void fetchProducts();
    }, 0);
    return () => clearTimeout(timerId);
  }, [fetchProducts]);

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

    console.warn("Supabase activity log skipped:", lastError?.message || "unknown error");
    return false;
  }, []);

  const saveProduct = useCallback(async (product, activity = {}) => {
    const payload = productToRow({
      ...product,
      updated_at: new Date().toISOString(),
    });

    const { error } = await supabase
      .from(PRODUCTS_TABLE)
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.error("Supabase save error:", error.message);
      setSyncError(`Could not save to Supabase: ${error.message}`);
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
  }, [fetchProducts, logProductActivity]);

  const updateProduct = useCallback(async (id, updates, activityAction = "updated") => {
    const current = products.find((p) => p.id === id);
    if (!current) return;

    const nextUpdatedAt = new Date().toISOString();
    const nextProduct = { ...current, ...updates, updated_at: nextUpdatedAt };

    setProducts(prev => prev.map((p) => {
      if (p.id !== id) return p;
      return { ...p, ...updates, updated_at: nextUpdatedAt };
    }));

    if (selectedProduct?.id === id) {
      setSelectedProduct(prev => prev ? { ...prev, ...updates, updated_at: nextUpdatedAt } : null);
    }

    await saveProduct(nextProduct, {
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
      await updateProduct(
        product.id,
        { stage: nextStage, stage_entered_at: new Date().toISOString() },
        "advanced_stage"
      );
    }
  }, [updateProduct]);

  const killProduct = useCallback(async (id, reason) => {
    const product = products.find(p => p.id === id);
    if (!product) return;
    await updateProduct(id, {
      stage: "dead",
      killed_at: new Date().toISOString(),
      killed_at_stage: product.stage,
      kill_reason: reason,
    }, "killed");
    setShowKillModal(null);
    setSelectedProduct(null);
  }, [products, updateProduct]);

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
    }
  }, [saveProduct]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#e2e8f0",
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    }}>
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
        {isSyncing && (
          <div style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(59, 130, 246, 0.12)",
            border: "1px solid rgba(59, 130, 246, 0.35)",
            color: "#93c5fd",
            fontSize: 12,
            fontWeight: 600,
          }}>
            Syncing with Supabase...
          </div>
        )}
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
function CommandCenter({ stats, products, deadProducts, onSelect }) {
  const holdProducts = products.filter(p => {
    const score = p.score_total ?? calcWeightedScore(p);
    return score !== null && score >= 60 && score < 75 && !hasCriticalFail(p) && p.stage === "scored";
  });

  const actionItems = [];
  products.forEach(p => {
    if (p.stage === "dead") return;
    const days = daysSince(p.stage_entered_at);
    if (p.stage === "sourced" && days > 1) actionItems.push({ product: p, msg: "Needs quick screen", urgency: "medium" });
    if (p.stage === "quick_screen" && days > 1) actionItems.push({ product: p, msg: "Needs scoring", urgency: "medium" });
    if (p.stage === "scored" && days > 2) actionItems.push({ product: p, msg: "Score pending too long", urgency: "high" });
    if (p.stage === "sample_ordered" && days > 14) actionItems.push({ product: p, msg: "Sample overdue — check supplier", urgency: "high" });
    if (p.stage === "sample_review" && days > 2) actionItems.push({ product: p, msg: "Sample review overdue", urgency: "high" });
    if (holdProducts.find(h => h.id === p.id) && days > 7) actionItems.push({ product: p, msg: "Hold expired — kill or approve", urgency: "critical" });
  });

  // Death log analysis
  const killsByStage = {};
  deadProducts.forEach(p => {
    const s = p.killed_at_stage || "unknown";
    killsByStage[s] = (killsByStage[s] || 0) + 1;
  });

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Top Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="IN PIPELINE" value={stats.inPipeline} subtitle="Being evaluated" color="#3b82f6" />
        <StatCard label="READY / LIVE" value={stats.readyOrLive} subtitle="Generating revenue" color="#10b981" />
        <StatCard label="DEAD" value={stats.deadCount} subtitle={`${stats.killRate}% kill rate`} color="#ef4444" />
        <StatCard label="TOTAL TRACKED" value={stats.totalProducts} subtitle="All time" color="#8b5cf6" />
      </div>

      {/* Pipeline Stage Breakdown */}
      <div style={{ background: "#0f0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em", marginBottom: 16 }}>PIPELINE BREAKDOWN</div>
        <div style={{ display: "flex", gap: 8 }}>
          {STAGES.map(s => (
            <div key={s.id} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{stats.byStage[s.id]}</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em", marginTop: 4 }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Action Items */}
        <div style={{ background: "#0f0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em", marginBottom: 16 }}>
            ⚡ ACTION ITEMS ({actionItems.length})
          </div>
          {actionItems.length === 0 ? (
            <div style={{ color: "#334155", fontSize: 12, fontStyle: "italic" }}>All clear — nothing overdue</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {actionItems.map((item, i) => (
                <div key={i} onClick={() => onSelect(item.product)} style={{
                  background: "#141420",
                  border: `1px solid ${item.urgency === "critical" ? "#7f1d1d" : item.urgency === "high" ? "#78350f" : "#1e293b"}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#e94560"}
                onMouseLeave={e => e.currentTarget.style.borderColor = item.urgency === "critical" ? "#7f1d1d" : item.urgency === "high" ? "#78350f" : "#1e293b"}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{item.product.name}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{item.msg}</div>
                  </div>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: item.urgency === "critical" ? "#7f1d1d" : item.urgency === "high" ? "#78350f" : "#1e293b",
                    color: item.urgency === "critical" ? "#fca5a5" : item.urgency === "high" ? "#fcd34d" : "#94a3b8",
                  }}>
                    {item.urgency.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Death Log Summary */}
        <div style={{ background: "#0f0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em", marginBottom: 16 }}>
            💀 DEATH LOG — KILLS BY STAGE
          </div>
          {deadProducts.length === 0 ? (
            <div style={{ color: "#334155", fontSize: 12, fontStyle: "italic" }}>No dead products yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.entries(killsByStage).map(([stage, count]) => {
                const stageInfo = STAGES.find(s => s.id === stage) || DEAD_STAGE;
                return (
                  <div key={stage} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 100, fontSize: 11, color: stageInfo.color, fontWeight: 600 }}>
                      {stageInfo.label || stage}
                    </div>
                    <div style={{ flex: 1, height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${(count / deadProducts.length) * 100}%`, height: "100%", background: "#ef4444", borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", minWidth: 20 }}>{count}</span>
                  </div>
                );
              })}
              <div style={{ marginTop: 12, borderTop: "1px solid #1e293b", paddingTop: 12 }}>
                <div style={{ fontSize: 10, color: "#475569", fontWeight: 600, marginBottom: 8 }}>RECENT KILLS</div>
                {deadProducts.slice(0, 5).map(p => (
                  <div key={p.id} onClick={() => onSelect(p)} style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.color = "#e94560"}
                    onMouseLeave={e => e.currentTarget.style.color = "#94a3b8"}
                  >
                    <span style={{ color: "#ef4444" }}>✕</span> {p.name} — {p.kill_reason || "no reason"}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, subtitle, color }) {
  return (
    <div style={{
      background: "#0f0f1a",
      border: "1px solid #1e293b",
      borderRadius: 12,
      padding: "18px 20px",
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color, marginTop: 4, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{subtitle}</div>
    </div>
  );
}

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
