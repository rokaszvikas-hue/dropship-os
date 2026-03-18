import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const SIGNALS = ["green", "yellow", "red", "unknown"];
const SYSTEM_STATES = ["clean", "minor_issue", "missing_logs", "identity_broken", "unknown"];
const DIAG_CODES = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"];
const ROUTED_DEPTS = ["PR", "CS", "CP", "OD", "SC", "SF", "AN"];
const DECISIONS = ["keep", "revise", "widen", "hold", "pause", "kill"];
const ACTION_STATUS = ["open", "in_progress", "done", "blocked", "dropped"];
const BOTTLENECK_SEVERITY = ["low", "medium", "high", "critical"];
const BOTTLENECK_STATUS = ["open", "in_progress", "blocked", "resolved", "closed"];

const executionPrepStages = ["sample_ordered", "sample_review", "execution_ready"];
const researchStages = ["sourced", "quick_screen", "scored"];

const inputStyle = {
  width: "100%",
  background: "#0b1220",
  border: "1px solid #1e293b",
  color: "#e2e8f0",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function getCurrentMonthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getISOWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

function getCurrentWeekKey(date = new Date()) {
  const { year, week } = getISOWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function ymd(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(v) {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
}

function fmtDateTime(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function daysSince(dateLike) {
  if (!dateLike) return 0;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function getProductLabel(p) {
  return p?.product_name || p?.name || p?.title || "Untitled Product";
}

function getProductCode(p) {
  return p?.product_code || p?.sku || p?.code || "NO-CODE";
}

function getProductStage(p) {
  return p?.stage || p?.status || p?.pipeline_stage || "unknown";
}

function getProductUpdatedAt(p) {
  return p?.updated_at || p?.created_at || null;
}

function isResolvedBottleneck(b) {
  return ["resolved", "closed"].includes(String(b?.status || "").toLowerCase());
}

function isOverdue(item) {
  if (!item?.due_date) return false;
  const due = new Date(item.due_date);
  if (Number.isNaN(due.getTime())) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return due < now;
}

function deriveLaneFromStage(stage) {
  if (researchStages.includes(stage)) return "Research";
  if (executionPrepStages.includes(stage)) return "Execution Prep";
  if (stage === "live") return "Live";
  if (stage === "dead") return "Kill";
  return "Research";
}

function severityColor(level) {
  if (level === "critical") return "#ef4444";
  if (level === "high") return "#f97316";
  if (level === "medium" || level === "warning") return "#f59e0b";
  return "#64748b";
}

function signalColor(sig) {
  if (sig === "green") return "#10b981";
  if (sig === "yellow") return "#f59e0b";
  if (sig === "red") return "#ef4444";
  return "#64748b";
}

function defaultObjectiveForm(monthKey) {
  return {
    month_key: monthKey,
    title: "",
    description: "",
    owner: "",
    start_date: ymd(new Date()),
    due_date: ymd(addDays(new Date(), 30)),
    status: "active",
    weekly_commitments: "",
    notes: "",
  };
}

function defaultKrForm(objectiveId = "", monthKey = "") {
  return {
    objective_id: objectiveId || null,
    month_key: monthKey || null,
    label: "",
    owner: "",
    target_value: "",
    current_value: "",
    unit: "",
    due_date: ymd(addDays(new Date(), 30)),
    status: "open",
    sort_order: 100,
    notes: "",
  };
}

function defaultBottleneckForm() {
  return {
    title: "",
    description: "",
    bottleneck_type: "",
    severity: "medium",
    product_id: "",
    owner: "",
    due_date: ymd(addDays(new Date(), 7)),
    status: "open",
    resolution_note: "",
  };
}

function defaultReviewDraft(product, currentWeekReview) {
  const stage = getProductStage(product);
  const lane = currentWeekReview?.current_lane || deriveLaneFromStage(stage);
  return {
    id: currentWeekReview?.id || null,
    week_key: currentWeekReview?.week_key || getCurrentWeekKey(),
    product_id: product.id,
    product_code: currentWeekReview?.product_code || getProductCode(product),
    product_name: currentWeekReview?.product_name || getProductLabel(product),
    current_lane: lane,
    best_concept: currentWeekReview?.best_concept || "",
    front_end_signal: currentWeekReview?.front_end_signal || "unknown",
    store_signal: currentWeekReview?.store_signal || "unknown",
    backend_signal: currentWeekReview?.backend_signal || "unknown",
    system_state: currentWeekReview?.system_state || "unknown",
    diagnosis_code: currentWeekReview?.diagnosis_code || "D7",
    routed_department: currentWeekReview?.routed_department || "PR",
    decision: currentWeekReview?.decision || "hold",
    owner: currentWeekReview?.owner || "",
    due_date: currentWeekReview?.due_date ? ymd(currentWeekReview.due_date) : "",
    action_status: currentWeekReview?.action_status || "open",
    revisit_date: currentWeekReview?.revisit_date ? ymd(currentWeekReview.revisit_date) : "",
    notes: currentWeekReview?.notes || "",
    review_date: currentWeekReview?.review_date ? ymd(currentWeekReview.review_date) : ymd(new Date()),
  };
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

export default function Management() {
  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const weekKey = useMemo(() => getCurrentWeekKey(), []);

  const [isLoading, setIsLoading] = useState(true);
  const [isWriting, setIsWriting] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState([]);

  const [products, setProducts] = useState([]);
  const [dailyRevenue, setDailyRevenue] = useState([]);
  const [monthlyObjectives, setMonthlyObjectives] = useState([]);
  const [monthlyKrs, setMonthlyKrs] = useState([]);
  const [weeklyReviews, setWeeklyReviews] = useState([]);
  const [bottlenecks, setBottlenecks] = useState([]);
  const [decisionLog, setDecisionLog] = useState([]);
  const [productActivity, setProductActivity] = useState([]);

  const [reviewDrafts, setReviewDrafts] = useState({});
  const [bottleneckFilter, setBottleneckFilter] = useState("open");
  const [showResolvedBottlenecks, setShowResolvedBottlenecks] = useState(false);

  const [showObjectiveModal, setShowObjectiveModal] = useState(false);
  const [editingObjective, setEditingObjective] = useState(null);
  const [objectiveForm, setObjectiveForm] = useState(defaultObjectiveForm(monthKey));

  const [showKrModal, setShowKrModal] = useState(false);
  const [editingKr, setEditingKr] = useState(null);
  const [krForm, setKrForm] = useState(defaultKrForm("", monthKey));

  const [showBottleneckModal, setShowBottleneckModal] = useState(false);
  const [editingBottleneck, setEditingBottleneck] = useState(null);
  const [bottleneckForm, setBottleneckForm] = useState(defaultBottleneckForm());

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

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setError("");

    const [
      productsRes,
      dailyRevenueRes,
      objectivesRes,
      krsRes,
      weeklyReviewsRes,
      bottlenecksRes,
      decisionLogRes,
      activityRes,
    ] = await Promise.all([
      supabase.from("products").select("*"),
      supabase.from("daily_revenue").select("*"),
      supabase.from("monthly_objectives").select("*"),
      supabase.from("monthly_key_results").select("*"),
      supabase.from("weekly_business_reviews").select("*"),
      supabase.from("bottlenecks").select("*"),
      supabase.from("decision_log").select("*"),
      supabase.from("product_activity").select("*"),
    ]);

    const firstError = [
      productsRes.error,
      dailyRevenueRes.error,
      objectivesRes.error,
      krsRes.error,
      weeklyReviewsRes.error,
      bottlenecksRes.error,
      decisionLogRes.error,
      activityRes.error,
    ].find(Boolean);

    if (firstError) {
      setError(firstError.message || "Failed to load management data.");
    }

    setProducts(safeArray(productsRes.data));
    setDailyRevenue(safeArray(dailyRevenueRes.data));
    setMonthlyObjectives(safeArray(objectivesRes.data));
    setMonthlyKrs(safeArray(krsRes.data));
    setWeeklyReviews(safeArray(weeklyReviewsRes.data));
    setBottlenecks(safeArray(bottlenecksRes.data));
    setDecisionLog(safeArray(decisionLogRes.data));
    setProductActivity(safeArray(activityRes.data));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void refreshAll();
    }, 0);
    return () => clearTimeout(t);
  }, [refreshAll]);

  const productById = useMemo(() => {
    const map = {};
    products.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [products]);

  const latestReviewByProduct = useMemo(() => {
    const map = {};
    weeklyReviews.forEach((r) => {
      const prev = map[r.product_id];
      const rTime = new Date(r.review_date || r.updated_at || r.created_at || 0).getTime();
      const pTime = prev
        ? new Date(prev.review_date || prev.updated_at || prev.created_at || 0).getTime()
        : -1;
      if (!prev || rTime > pTime) map[r.product_id] = r;
    });
    return map;
  }, [weeklyReviews]);

  const currentWeekReviewsByProduct = useMemo(() => {
    const map = {};
    weeklyReviews
      .filter((r) => r.week_key === weekKey)
      .forEach((r) => {
        map[r.product_id] = r;
      });
    return map;
  }, [weeklyReviews, weekKey]);

  const activeProducts = useMemo(() => {
    return products.filter((p) => {
      const stage = getProductStage(p);
      const latest = latestReviewByProduct[p.id];
      const latestDecision = String(latest?.decision || "").toLowerCase();
      return (
        executionPrepStages.includes(stage) ||
        stage === "live" ||
        ["hold", "pause", "widen"].includes(latestDecision)
      );
    });
  }, [products, latestReviewByProduct]);

  useEffect(() => {
    setReviewDrafts((prev) => {
      const next = { ...prev };
      activeProducts.forEach((p) => {
        if (!next[p.id]) {
          next[p.id] = defaultReviewDraft(p, currentWeekReviewsByProduct[p.id]);
        }
      });
      Object.keys(next).forEach((id) => {
        if (!activeProducts.find((p) => String(p.id) === String(id))) delete next[id];
      });
      return next;
    });
  }, [activeProducts, currentWeekReviewsByProduct]);

  const currentObjective = useMemo(() => {
    const inMonth = monthlyObjectives.find((o) => o.month_key === monthKey);
    if (inMonth) return inMonth;
    return monthlyObjectives.find((o) => {
      if (!o.start_date) return false;
      const d = new Date(o.start_date);
      return !Number.isNaN(d.getTime()) && getCurrentMonthKey(d) === monthKey;
    }) || null;
  }, [monthlyObjectives, monthKey]);

  const objectiveKrs = useMemo(() => {
    if (!currentObjective) return [];
    return monthlyKrs
      .filter((kr) => kr.objective_id === currentObjective.id || kr.month_key === monthKey)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }, [currentObjective, monthlyKrs, monthKey]);

  const deriveStateStartDate = useCallback(
    (product) => {
      const stage = getProductStage(product);
      const items = productActivity
        .filter((a) => String(a.product_id) === String(product.id))
        .sort(
          (a, b) =>
            new Date(b.created_at || b.updated_at || 0).getTime() -
            new Date(a.created_at || a.updated_at || 0).getTime()
        );
      for (const entry of items) {
        const candidates = [
          entry.stage,
          entry.to_stage,
          entry.new_stage,
          entry?.metadata?.stage,
          entry?.metadata?.to_stage,
          entry?.data?.stage,
          entry?.data?.to_stage,
        ].filter(Boolean);
        if (candidates.includes(stage)) {
          return entry.created_at || entry.updated_at || getProductUpdatedAt(product);
        }
      }
      return getProductUpdatedAt(product);
    },
    [productActivity]
  );

  const portfolioColumns = useMemo(() => {
    const base = {
      Research: [],
      "Execution Prep": [],
      Live: [],
      "Hold / Pause": [],
      Widen: [],
      Kill: [],
    };

    activeProducts.forEach((product) => {
      const latest = latestReviewByProduct[product.id];
      const decision = String(latest?.decision || "").toLowerCase();
      let lane = null;
      if (decision === "kill") lane = "Kill";
      else if (decision === "widen") lane = "Widen";
      else if (decision === "hold" || decision === "pause") lane = "Hold / Pause";
      else {
        const stage = getProductStage(product);
        if (researchStages.includes(stage)) lane = "Research";
        else if (executionPrepStages.includes(stage)) lane = "Execution Prep";
        else if (stage === "live") lane = "Live";
        else lane = "Research";
      }

      base[lane].push({
        product,
        latestReview: latest || null,
        stateStartedAt: deriveStateStartDate(product),
      });
    });

    const deadRecent = products
      .filter((p) => getProductStage(p) === "dead")
      .sort(
        (a, b) =>
          new Date(b.killed_at || getProductUpdatedAt(b) || 0).getTime() -
          new Date(a.killed_at || getProductUpdatedAt(a) || 0).getTime()
      )
      .slice(0, 12)
      .map((product) => ({
        product,
        latestReview: latestReviewByProduct[product.id] || null,
        stateStartedAt: product.killed_at || getProductUpdatedAt(product),
      }));
    base.Kill = deadRecent;
    return base;
  }, [activeProducts, latestReviewByProduct, products, deriveStateStartDate]);

  const laneCounts = useMemo(() => {
    return {
      research: portfolioColumns["Research"].length,
      executionPrep: portfolioColumns["Execution Prep"].length,
      live: portfolioColumns.Live.length,
      holdPause: portfolioColumns["Hold / Pause"].length,
      widen: portfolioColumns.Widen.length,
      kill: portfolioColumns.Kill.length,
    };
  }, [portfolioColumns]);

  const revenueThisMonth = useMemo(() => {
    return dailyRevenue.reduce((sum, row) => {
      const d = new Date(row.date || 0);
      if (Number.isNaN(d.getTime()) || getCurrentMonthKey(d) !== monthKey) return sum;
      return sum + Number(row.net_revenue ?? (Number(row.gross_revenue || 0) - Number(row.refunds || 0)));
    }, 0);
  }, [dailyRevenue, monthKey]);

  const qualifiedSignal = useMemo(() => {
    return activeProducts.filter((p) => {
      const r = latestReviewByProduct[p.id];
      if (!r) return false;
      const decision = String(r.decision || "").toLowerCase();
      if (["hold", "pause", "kill"].includes(decision)) return false;
      if (String(r.diagnosis_code || "").toUpperCase() === "D7") return false;
      const fe = String(r.front_end_signal || "unknown");
      const store = String(r.store_signal || "unknown");
      return fe === "green" || (fe === "yellow" && store !== "red");
    }).length;
  }, [activeProducts, latestReviewByProduct]);

  const stableWinners = useMemo(() => {
    return activeProducts.filter((p) => {
      const r = latestReviewByProduct[p.id];
      if (!r) return false;
      const lane = String(r.current_lane || "").toLowerCase();
      const decision = String(r.decision || "").toLowerCase();
      const fe = String(r.front_end_signal || "unknown");
      const store = String(r.store_signal || "unknown");
      const be = String(r.backend_signal || "unknown");
      return (
        ["live", "widen"].includes(lane) &&
        ["keep", "widen"].includes(decision) &&
        fe === "green" &&
        ["green", "yellow"].includes(store) &&
        ["green", "yellow"].includes(be)
      );
    }).length;
  }, [activeProducts, latestReviewByProduct]);

  const wipComplianceOK = laneCounts.research <= 5 && laneCounts.executionPrep <= 2 && laneCounts.live <= 2;
  const weeklyReviewCompletion = {
    completed: activeProducts.filter((p) => !!currentWeekReviewsByProduct[p.id]).length,
    total: activeProducts.length,
  };

  const openCriticalBottlenecks = useMemo(() => {
    return bottlenecks.filter((b) => {
      const sev = String(b.severity || "").toLowerCase();
      const unresolved = !isResolvedBottleneck(b);
      return (["high", "critical"].includes(sev) && unresolved) || (isOverdue(b) && unresolved);
    }).length;
  }, [bottlenecks]);

  const guardrailAlerts = useMemo(() => {
    const alerts = [];
    if (laneCounts.research > 5) alerts.push({ severity: "critical", text: "Research WIP exceeds 5" });
    if (laneCounts.executionPrep > 2) alerts.push({ severity: "critical", text: "Execution Prep WIP exceeds 2" });
    if (laneCounts.live > 2) alerts.push({ severity: "warning", text: "Live WIP exceeds 2" });

    Object.values(latestReviewByProduct).forEach((r) => {
      if (String(r.decision || "").toLowerCase() === "widen" && String(r.backend_signal || "").toLowerCase() === "red") {
        alerts.push({ severity: "critical", text: `${r.product_code || "NO-CODE"} widened with red backend signal` });
      }
      const dec = String(r.decision || "").toLowerCase();
      if (["hold", "pause"].includes(dec) && !r.revisit_date) {
        alerts.push({ severity: "warning", text: `${r.product_code || "NO-CODE"} is ${dec} without revisit date` });
      }
    });

    activeProducts.forEach((p) => {
      const r = currentWeekReviewsByProduct[p.id];
      if (!r) alerts.push({ severity: "warning", text: `${getProductCode(p)} missing current-week review` });
      if (r && !r.owner) alerts.push({ severity: "warning", text: `${getProductCode(p)} current-week review missing owner` });
      if (r && !r.due_date) alerts.push({ severity: "warning", text: `${getProductCode(p)} current-week review missing due date` });
    });

    bottlenecks.forEach((b) => {
      const unresolved = !isResolvedBottleneck(b);
      if (unresolved && ["high", "critical"].includes(String(b.severity || "").toLowerCase()) && !b.owner) {
        alerts.push({ severity: "critical", text: `Bottleneck "${b.title || "Untitled"}" missing owner` });
      }
      if (unresolved && isOverdue(b)) {
        alerts.push({ severity: "critical", text: `Overdue bottleneck: ${b.title || "Untitled"}` });
      }
    });

    if (!currentObjective) alerts.push({ severity: "info", text: "No current monthly objective" });
    return alerts.slice(0, 30);
  }, [laneCounts, latestReviewByProduct, activeProducts, currentWeekReviewsByProduct, bottlenecks, currentObjective]);

  const openBottlenecks = useMemo(
    () =>
      bottlenecks
        .filter((b) => !isResolvedBottleneck(b))
        .sort((a, b) => {
          const rank = { critical: 0, high: 1, medium: 2, low: 3 };
          const ra = rank[String(a.severity || "").toLowerCase()] ?? 9;
          const rb = rank[String(b.severity || "").toLowerCase()] ?? 9;
          if (ra !== rb) return ra - rb;
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        }),
    [bottlenecks]
  );

  const resolvedBottlenecks = useMemo(
    () =>
      bottlenecks
        .filter((b) => isResolvedBottleneck(b))
        .sort((a, b) => new Date(b.updated_at || b.resolved_at || 0).getTime() - new Date(a.updated_at || a.resolved_at || 0).getTime()),
    [bottlenecks]
  );

  const shownBottlenecks = bottleneckFilter === "open" ? openBottlenecks : bottlenecks;

  const recentDecisionLog = useMemo(
    () =>
      [...decisionLog]
        .sort((a, b) => new Date(b.decision_date || b.created_at || 0).getTime() - new Date(a.decision_date || a.created_at || 0).getTime())
        .slice(0, 20),
    [decisionLog]
  );

  const saveWeeklyReview = async (productId) => {
    const product = products.find((p) => String(p.id) === String(productId));
    const draft = reviewDrafts[productId];
    if (!product || !draft) return;
    await withWrite(async () => {
      const payload = {
        week_key: weekKey,
        product_id: productId,
        product_code: draft.product_code || getProductCode(product),
        product_name: draft.product_name || getProductLabel(product),
        current_lane: draft.current_lane,
        best_concept: draft.best_concept,
        front_end_signal: draft.front_end_signal,
        store_signal: draft.store_signal,
        backend_signal: draft.backend_signal,
        system_state: draft.system_state,
        diagnosis_code: draft.diagnosis_code,
        routed_department: draft.routed_department,
        decision: draft.decision,
        owner: draft.owner,
        due_date: draft.due_date || null,
        action_status: draft.action_status,
        revisit_date: draft.revisit_date || null,
        notes: draft.notes,
        review_date: draft.review_date || ymd(new Date()),
      };

      const up = await supabase
        .from("weekly_business_reviews")
        .upsert(payload, { onConflict: "week_key,product_id" })
        .select()
        .maybeSingle();
      if (up.error) {
        pushToast(`Failed to save weekly review: ${up.error.message}`, "error");
        return false;
      }

      const previous = currentWeekReviewsByProduct[productId] || null;
      const firstDecision = !previous;
      const decisionChanged = previous && String(previous.decision || "") !== String(payload.decision || "");
      const laneChanged = previous && String(previous.current_lane || "") !== String(payload.current_lane || "");
      if (firstDecision || decisionChanged || laneChanged) {
        const reviewId = up.data?.id || previous?.id || null;
        const evidence = `FE:${payload.front_end_signal} ST:${payload.store_signal} BE:${payload.backend_signal} SYS:${payload.system_state} DX:${payload.diagnosis_code}`;
        const previousState = `${previous?.current_lane || deriveLaneFromStage(getProductStage(product))} / ${previous?.decision || "none"}`;
        const newState = `${payload.current_lane || "-"} / ${payload.decision || "-"}`;
        const logPayload = {
          source_review_id: reviewId,
          decision_date: ymd(new Date()),
          product_id: productId,
          title: `${payload.product_code || "NO-CODE"} — ${payload.decision || "decision"}`,
          previous_state: previousState,
          new_state: newState,
          decision_type: payload.decision || null,
          evidence_summary: evidence,
          why_text: payload.notes || "",
          decided_by: payload.owner || null,
          review_date: payload.review_date || null,
        };
        const ins = await supabase.from("decision_log").insert(logPayload);
        if (ins.error) {
          pushToast(`Review saved but decision log insert failed: ${ins.error.message}`, "error");
        }
      }

      await refreshAll();
      return true;
    }, "Weekly review saved");
  };

  const openObjectiveModal = (objective = null) => {
    setEditingObjective(objective);
    setObjectiveForm(
      objective
        ? {
            ...defaultObjectiveForm(monthKey),
            ...objective,
            start_date: objective.start_date ? ymd(objective.start_date) : ymd(new Date()),
            due_date: objective.due_date ? ymd(objective.due_date) : ymd(addDays(new Date(), 30)),
          }
        : defaultObjectiveForm(monthKey)
    );
    setShowObjectiveModal(true);
  };

  const saveObjective = async () => {
    await withWrite(async () => {
      const payload = { ...objectiveForm, month_key: objectiveForm.month_key || monthKey };
      if (editingObjective?.id) {
        const up = await supabase.from("monthly_objectives").update(payload).eq("id", editingObjective.id);
        if (up.error) {
          pushToast(`Failed to update objective: ${up.error.message}`, "error");
          return false;
        }
      } else {
        const ins = await supabase.from("monthly_objectives").insert(payload);
        if (ins.error) {
          pushToast(`Failed to create objective: ${ins.error.message}`, "error");
          return false;
        }
      }
      await refreshAll();
      setShowObjectiveModal(false);
      return true;
    }, editingObjective ? "Objective updated" : "Objective created");
  };

  const openKrModal = (kr = null) => {
    setEditingKr(kr);
    setKrForm(
      kr
        ? {
            ...defaultKrForm(currentObjective?.id || null, monthKey),
            ...kr,
            due_date: kr.due_date ? ymd(kr.due_date) : ymd(addDays(new Date(), 30)),
          }
        : defaultKrForm(currentObjective?.id || null, monthKey)
    );
    setShowKrModal(true);
  };

  const saveKr = async () => {
    await withWrite(async () => {
      const payload = {
        ...krForm,
        objective_id: krForm.objective_id || currentObjective?.id || null,
        month_key: krForm.month_key || monthKey,
        target_value: toNumber(krForm.target_value),
        current_value: toNumber(krForm.current_value),
        sort_order: toNumber(krForm.sort_order),
      };
      if (editingKr?.id) {
        const up = await supabase.from("monthly_key_results").update(payload).eq("id", editingKr.id);
        if (up.error) {
          pushToast(`Failed to update key result: ${up.error.message}`, "error");
          return false;
        }
      } else {
        const ins = await supabase.from("monthly_key_results").insert(payload);
        if (ins.error) {
          pushToast(`Failed to create key result: ${ins.error.message}`, "error");
          return false;
        }
      }
      await refreshAll();
      setShowKrModal(false);
      return true;
    }, editingKr ? "Key result updated" : "Key result created");
  };

  const deleteKr = async (krId) => {
    await withWrite(async () => {
      const del = await supabase.from("monthly_key_results").delete().eq("id", krId);
      if (del.error) {
        pushToast(`Failed to delete key result: ${del.error.message}`, "error");
        return false;
      }
      await refreshAll();
      return true;
    }, "Key result deleted");
  };

  const openBottleneckModal = (b = null) => {
    setEditingBottleneck(b);
    setBottleneckForm(
      b
        ? {
            ...defaultBottleneckForm(),
            ...b,
            product_id: b.product_id || "",
            due_date: b.due_date ? ymd(b.due_date) : ymd(addDays(new Date(), 7)),
          }
        : defaultBottleneckForm()
    );
    setShowBottleneckModal(true);
  };

  const saveBottleneck = async () => {
    await withWrite(async () => {
      const payload = {
        ...bottleneckForm,
        product_id: bottleneckForm.product_id || null,
        due_date: bottleneckForm.due_date || null,
      };
      if (editingBottleneck?.id) {
        const up = await supabase.from("bottlenecks").update(payload).eq("id", editingBottleneck.id);
        if (up.error) {
          pushToast(`Failed to update bottleneck: ${up.error.message}`, "error");
          return false;
        }
      } else {
        const ins = await supabase.from("bottlenecks").insert(payload);
        if (ins.error) {
          pushToast(`Failed to create bottleneck: ${ins.error.message}`, "error");
          return false;
        }
      }
      await refreshAll();
      setShowBottleneckModal(false);
      return true;
    }, editingBottleneck ? "Bottleneck updated" : "Bottleneck created");
  };

  const markBottleneckResolved = async (b) => {
    await withWrite(async () => {
      const up = await supabase
        .from("bottlenecks")
        .update({ status: "resolved", resolution_note: b.resolution_note || "Marked resolved", resolved_at: new Date().toISOString() })
        .eq("id", b.id);
      if (up.error) {
        pushToast(`Failed to resolve bottleneck: ${up.error.message}`, "error");
        return false;
      }
      await refreshAll();
      return true;
    }, "Bottleneck marked resolved");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e2e8f0", fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace", padding: "16px 18px", boxSizing: "border-box" }}>
      <style>{`@keyframes writeProgressSlide{0%{background-position:200% 0;}100%{background-position:-200% 0;}} @keyframes spinner{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}`}</style>
      {isWriting && <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: 3, zIndex: 5000, background: "linear-gradient(90deg, rgba(233,69,96,0), rgba(233,69,96,0.95), rgba(56,189,248,0.95), rgba(233,69,96,0))", backgroundSize: "220% 100%", animation: "writeProgressSlide 1.1s linear infinite" }} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ color: "#e94560", fontWeight: 800, letterSpacing: "0.06em", fontSize: 14 }}>MANAGEMENT COCKPIT</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            Decisions • Owners • Blocks • Guardrails • {monthKey} • {weekKey}
          </div>
        </div>
        <button style={ghostButtonStyle} onClick={() => void refreshAll()}>↻ Refresh</button>
      </div>

      {error && <div style={{ marginBottom: 10, padding: "10px 12px", border: "1px solid rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.14)", borderRadius: 8, color: "#fca5a5", fontSize: 12 }}>{error}</div>}

      {isLoading ? (
        <ManagementSkeleton />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
            <MetricCard label="Revenue This Month" value={money(revenueThisMonth)} subtitle="Net from daily_revenue" color="#10b981" />
            <MetricCard label="Qualified Signal" value={qualifiedSignal} subtitle="Commercially valid latest reviews" color="#3b82f6" />
            <MetricCard label="Stable Winners" value={stableWinners} subtitle="Keep/Widen with stable ops signals" color="#10b981" />
            <MetricCard
              label="WIP Compliance"
              value={wipComplianceOK ? "GREEN" : "BREACH"}
              subtitle={`R:${laneCounts.research} • EP:${laneCounts.executionPrep} • L:${laneCounts.live}`}
              color={wipComplianceOK ? "#10b981" : "#ef4444"}
            />
            <MetricCard
              label="Weekly Review Completion"
              value={`${weeklyReviewCompletion.completed}/${weeklyReviewCompletion.total}`}
              subtitle={weeklyReviewCompletion.total ? `${Math.round((weeklyReviewCompletion.completed / weeklyReviewCompletion.total) * 100)}% complete` : "No active products"}
              color={weeklyReviewCompletion.total > 0 && weeklyReviewCompletion.completed === weeklyReviewCompletion.total ? "#10b981" : "#f59e0b"}
              progress={weeklyReviewCompletion.total ? (weeklyReviewCompletion.completed / weeklyReviewCompletion.total) * 100 : 0}
            />
            <MetricCard label="Open Critical Bottlenecks" value={openCriticalBottlenecks} subtitle="High/critical unresolved or overdue" color="#ef4444" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr", gap: 10, marginBottom: 10 }}>
            <Panel title="Monthly Objective">
              {!currentObjective ? (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  No objective for {monthKey}. <button style={linkButtonStyle} onClick={() => openObjectiveModal(null)}>Create Objective</button>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{currentObjective.title || "Untitled Objective"}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{currentObjective.description || "-"}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                    Owner: {currentObjective.owner || "-"} • {fmtDate(currentObjective.start_date)} → {fmtDate(currentObjective.due_date)} • {currentObjective.status || "active"}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: "#cbd5e1" }}>
                    <strong>Weekly commitments:</strong>
                    <ul style={{ margin: "6px 0 0 18px" }}>
                      {String(currentObjective.weekly_commitments || "")
                        .split(/\n|,/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .slice(0, 3)
                        .map((s, idx) => <li key={idx}>{s}</li>)}
                    </ul>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button style={ghostButtonStyle} onClick={() => openObjectiveModal(currentObjective)}>Edit Objective</button>
                    <button style={ghostButtonStyle} onClick={() => openKrModal(null)}>Add KR</button>
                  </div>
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    {objectiveKrs.map((kr) => (
                      <div key={kr.id} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: "6px 8px", background: "#111322" }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{kr.label || "Untitled KR"}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>
                          {kr.current_value ?? 0}/{kr.target_value ?? 0} {kr.unit || ""} • Owner: {kr.owner || "-"} • Due: {fmtDate(kr.due_date)}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button style={ghostMiniButtonStyle} onClick={() => openKrModal(kr)}>Edit</button>
                          <button style={{ ...ghostMiniButtonStyle, borderColor: "#ef444466", color: "#fca5a5" }} onClick={() => void deleteKr(kr.id)}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Panel>

            <Panel title="Portfolio Board">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8 }}>
                {["Research", "Execution Prep", "Live", "Hold / Pause", "Widen", "Kill"].map((lane) => (
                  <div key={lane} style={{ border: "1px solid #1e293b", borderRadius: 8, background: "#111322", padding: 6, minHeight: 180 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>{lane} ({portfolioColumns[lane].length})</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {portfolioColumns[lane].slice(0, lane === "Kill" ? 8 : 99).map((entry) => {
                        const p = entry.product;
                        const r = entry.latestReview;
                        return (
                          <div key={p.id} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 6, background: "#0b1220" }}>
                            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>{getProductCode(p)}</div>
                            <div style={{ fontSize: 11, fontWeight: 700 }}>{getProductLabel(p)}</div>
                            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                              Lane: {r?.current_lane || lane} • DX: {r?.diagnosis_code || "-"} • Decision: {r?.decision || "-"}
                            </div>
                            <div style={{ fontSize: 10, color: "#94a3b8" }}>
                              Owner: {r?.owner || "-"} • Due: {fmtDate(r?.due_date)} • Days: {daysSince(entry.stateStartedAt)}
                            </div>
                            <div style={{ marginTop: 4 }}><SignalDot value={r?.backend_signal || "unknown"} /></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Guardrail Alerts">
              {guardrailAlerts.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>No current guardrail violations.</div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {guardrailAlerts.map((a, idx) => (
                    <div key={`${a.text}-${idx}`} style={{ border: `1px solid ${severityColor(a.severity)}66`, background: `${severityColor(a.severity)}20`, borderRadius: 8, padding: "7px 8px", fontSize: 11, color: "#e2e8f0" }}>
                      <strong style={{ color: severityColor(a.severity), marginRight: 6 }}>{String(a.severity).toUpperCase()}</strong>{a.text}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Weekly Business Review">
            <div style={{ marginBottom: 8, fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
              D1 weak reach/weak execution • D2 reach-only/wrong audience • D3 useful traffic/weak store response • D4 strong front-end/backend leakage • D5 weak thesis/lane truth • D6 account/platform issue • D7 unknown/insufficient data
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1650 }}>
                <thead>
                  <tr style={{ background: "#111827" }}>
                    {["Product", "Lane", "Best Concept", "Front-End", "Store", "Backend", "System", "Diagnosis", "Route", "Decision", "Owner", "Due Date", "Action Status", "Revisit Date", "Notes", "Save"].map((h) => (
                      <Th key={h}>{h}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeProducts.map((p) => {
                    const d = reviewDrafts[p.id] || defaultReviewDraft(p, currentWeekReviewsByProduct[p.id]);
                    const missingReview = !currentWeekReviewsByProduct[p.id];
                    return (
                      <tr key={p.id} style={{ borderTop: "1px solid #1e293b", background: missingReview ? "rgba(245,158,11,0.08)" : "transparent" }}>
                        <Td>
                          <div style={{ fontWeight: 700 }}>{getProductCode(p)}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>{getProductLabel(p)}</div>
                          {missingReview ? (
                            <div style={{ fontSize: 9, color: "#f59e0b", marginTop: 2, fontWeight: 700, letterSpacing: "0.04em" }}>
                              MISSING REVIEW
                            </div>
                          ) : null}
                        </Td>
                        <Td><select value={d.current_lane || ""} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, current_lane: e.target.value } }))} style={compactInputStyle}><option>Research</option><option>Execution Prep</option><option>Live</option><option>Hold / Pause</option><option>Widen</option><option>Kill</option></select></Td>
                        <Td><input value={d.best_concept || ""} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, best_concept: e.target.value } }))} style={compactInputStyle} /></Td>
                        <Td><select value={d.front_end_signal} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, front_end_signal: e.target.value } }))} style={compactInputStyle}>{SIGNALS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Td>
                        <Td><select value={d.store_signal} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, store_signal: e.target.value } }))} style={compactInputStyle}>{SIGNALS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Td>
                        <Td><select value={d.backend_signal} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, backend_signal: e.target.value } }))} style={compactInputStyle}>{SIGNALS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Td>
                        <Td><select value={d.system_state} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, system_state: e.target.value } }))} style={compactInputStyle}>{SYSTEM_STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Td>
                        <Td><select value={d.diagnosis_code} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, diagnosis_code: e.target.value } }))} style={compactInputStyle}>{DIAG_CODES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Td>
                        <Td><select value={d.routed_department} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, routed_department: e.target.value } }))} style={compactInputStyle}>{ROUTED_DEPTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Td>
                        <Td><select value={d.decision} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, decision: e.target.value } }))} style={compactInputStyle}>{DECISIONS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Td>
                        <Td><input value={d.owner || ""} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, owner: e.target.value } }))} style={compactInputStyle} /></Td>
                        <Td><input type="date" value={d.due_date || ""} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, due_date: e.target.value } }))} style={compactInputStyle} /></Td>
                        <Td><select value={d.action_status} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, action_status: e.target.value } }))} style={compactInputStyle}>{ACTION_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Td>
                        <Td><input type="date" value={d.revisit_date || ""} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, revisit_date: e.target.value } }))} style={compactInputStyle} /></Td>
                        <Td><input value={d.notes || ""} onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [p.id]: { ...d, notes: e.target.value } }))} style={compactInputStyle} /></Td>
                        <Td>
                          <button
                            style={missingReview ? { ...primaryMiniButtonStyle, width: "100%" } : ghostMiniButtonStyle}
                            onClick={() => void saveWeeklyReview(p.id)}
                          >
                            {missingReview ? "Create" : "Save"}
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            <Panel title="Bottleneck Log">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={tabMiniButtonStyle(bottleneckFilter === "open")} onClick={() => setBottleneckFilter("open")}>Open</button>
                  <button style={tabMiniButtonStyle(bottleneckFilter === "all")} onClick={() => setBottleneckFilter("all")}>All</button>
                </div>
                <button style={primaryMiniButtonStyle} onClick={() => openBottleneckModal(null)}>+ Add</button>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <Pill color="#f59e0b">Open {openBottlenecks.length}</Pill>
                <Pill color="#ef4444">Overdue {bottlenecks.filter((b) => !isResolvedBottleneck(b) && isOverdue(b)).length}</Pill>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {shownBottlenecks.map((b) => (
                  <div key={b.id} style={{ border: `1px solid ${severityColor(b.severity)}66`, background: "#111322", borderRadius: 8, padding: "7px 8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{b.title || "Untitled bottleneck"}</div>
                      <Pill color={severityColor(b.severity)}>{String(b.severity || "medium").toUpperCase()}</Pill>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{b.description || "-"}</div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>
                      {b.bottleneck_type || "general"} • Product: {productById[b.product_id] ? getProductCode(productById[b.product_id]) : "-"} • Owner: {b.owner || "-"} • Due: {fmtDate(b.due_date)} • Status: {b.status || "open"}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                      <button style={ghostMiniButtonStyle} onClick={() => openBottleneckModal(b)}>Edit</button>
                      {!isResolvedBottleneck(b) && <button style={ghostMiniButtonStyle} onClick={() => void markBottleneckResolved(b)}>Resolve</button>}
                    </div>
                  </div>
                ))}
                {shownBottlenecks.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>No bottlenecks found.</div>}
              </div>
              <button style={{ ...ghostMiniButtonStyle, marginTop: 8 }} onClick={() => setShowResolvedBottlenecks((v) => !v)}>
                {showResolvedBottlenecks ? "Hide resolved section" : `Show resolved (${resolvedBottlenecks.length})`}
              </button>
              {showResolvedBottlenecks && (
                <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                  {resolvedBottlenecks.slice(0, 12).map((b) => (
                    <div key={b.id} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: "6px 8px", background: "#0b1220", fontSize: 11, color: "#94a3b8" }}>
                      {b.title || "Untitled"} • {b.status} • {fmtDateTime(b.updated_at || b.resolved_at)}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={`Decision Log (${recentDecisionLog.length})`}>
              <div style={{ display: "grid", gap: 6 }}>
                {recentDecisionLog.map((row) => (
                  <div key={row.id} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: "7px 8px", background: "#111322" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{fmtDate(row.decision_date || row.created_at)}</div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{row.title || "Decision"}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      {row.previous_state || "-"} → {row.new_state || "-"} • {row.decision_type || "-"}
                    </div>
                    <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>{row.evidence_summary || "-"}</div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                      By: {row.decided_by || "-"} • Review: {fmtDate(row.review_date)}
                    </div>
                  </div>
                ))}
                {recentDecisionLog.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>No decisions logged yet.</div>}
              </div>
            </Panel>
          </div>
        </>
      )}

      {showObjectiveModal && (
        <ModalShell title={editingObjective ? "Edit Monthly Objective" : "Create Monthly Objective"} onClose={() => setShowObjectiveModal(false)} onConfirm={() => void saveObjective()} confirmLabel={editingObjective ? "Save objective" : "Create objective"}>
          <Field label="Month Key"><input value={objectiveForm.month_key || monthKey} onChange={(e) => setObjectiveForm((p) => ({ ...p, month_key: e.target.value }))} style={inputStyle} /></Field>
          <Field label="Title"><input value={objectiveForm.title} onChange={(e) => setObjectiveForm((p) => ({ ...p, title: e.target.value }))} style={inputStyle} /></Field>
          <Field label="Description"><textarea value={objectiveForm.description} onChange={(e) => setObjectiveForm((p) => ({ ...p, description: e.target.value }))} style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            <Field label="Owner"><input value={objectiveForm.owner} onChange={(e) => setObjectiveForm((p) => ({ ...p, owner: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Start"><input type="date" value={objectiveForm.start_date || ""} onChange={(e) => setObjectiveForm((p) => ({ ...p, start_date: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Due"><input type="date" value={objectiveForm.due_date || ""} onChange={(e) => setObjectiveForm((p) => ({ ...p, due_date: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Status"><input value={objectiveForm.status || ""} onChange={(e) => setObjectiveForm((p) => ({ ...p, status: e.target.value }))} style={inputStyle} /></Field>
          </div>
          <Field label="Weekly Commitments (comma or newline separated)"><textarea value={objectiveForm.weekly_commitments} onChange={(e) => setObjectiveForm((p) => ({ ...p, weekly_commitments: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} /></Field>
          <Field label="Notes"><textarea value={objectiveForm.notes} onChange={(e) => setObjectiveForm((p) => ({ ...p, notes: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} /></Field>
        </ModalShell>
      )}

      {showKrModal && (
        <ModalShell title={editingKr ? "Edit Key Result" : "Add Key Result"} onClose={() => setShowKrModal(false)} onConfirm={() => void saveKr()} confirmLabel={editingKr ? "Save KR" : "Create KR"}>
          <Field label="Label"><input value={krForm.label} onChange={(e) => setKrForm((p) => ({ ...p, label: e.target.value }))} style={inputStyle} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            <Field label="Owner"><input value={krForm.owner} onChange={(e) => setKrForm((p) => ({ ...p, owner: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Target"><input value={krForm.target_value} onChange={(e) => setKrForm((p) => ({ ...p, target_value: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Current"><input value={krForm.current_value} onChange={(e) => setKrForm((p) => ({ ...p, current_value: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Unit"><input value={krForm.unit} onChange={(e) => setKrForm((p) => ({ ...p, unit: e.target.value }))} style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <Field label="Due"><input type="date" value={krForm.due_date || ""} onChange={(e) => setKrForm((p) => ({ ...p, due_date: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Status"><input value={krForm.status || ""} onChange={(e) => setKrForm((p) => ({ ...p, status: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Sort"><input type="number" value={krForm.sort_order || ""} onChange={(e) => setKrForm((p) => ({ ...p, sort_order: e.target.value }))} style={inputStyle} /></Field>
          </div>
          <Field label="Notes"><textarea value={krForm.notes} onChange={(e) => setKrForm((p) => ({ ...p, notes: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} /></Field>
        </ModalShell>
      )}

      {showBottleneckModal && (
        <ModalShell title={editingBottleneck ? "Edit Bottleneck" : "Add Bottleneck"} onClose={() => setShowBottleneckModal(false)} onConfirm={() => void saveBottleneck()} confirmLabel={editingBottleneck ? "Save bottleneck" : "Create bottleneck"}>
          <Field label="Title"><input value={bottleneckForm.title} onChange={(e) => setBottleneckForm((p) => ({ ...p, title: e.target.value }))} style={inputStyle} /></Field>
          <Field label="Description"><textarea value={bottleneckForm.description} onChange={(e) => setBottleneckForm((p) => ({ ...p, description: e.target.value }))} style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            <Field label="Type"><input value={bottleneckForm.bottleneck_type} onChange={(e) => setBottleneckForm((p) => ({ ...p, bottleneck_type: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Severity"><select value={bottleneckForm.severity} onChange={(e) => setBottleneckForm((p) => ({ ...p, severity: e.target.value }))} style={inputStyle}>{BOTTLENECK_SEVERITY.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="Product"><select value={bottleneckForm.product_id} onChange={(e) => setBottleneckForm((p) => ({ ...p, product_id: e.target.value }))} style={inputStyle}><option value="">No product link</option>{products.map((p) => <option key={p.id} value={p.id}>{getProductCode(p)} — {getProductLabel(p)}</option>)}</select></Field>
            <Field label="Owner"><input value={bottleneckForm.owner} onChange={(e) => setBottleneckForm((p) => ({ ...p, owner: e.target.value }))} style={inputStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Due Date"><input type="date" value={bottleneckForm.due_date || ""} onChange={(e) => setBottleneckForm((p) => ({ ...p, due_date: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Status"><select value={bottleneckForm.status} onChange={(e) => setBottleneckForm((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>{BOTTLENECK_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          </div>
          <Field label="Resolution Note"><textarea value={bottleneckForm.resolution_note} onChange={(e) => setBottleneckForm((p) => ({ ...p, resolution_note: e.target.value }))} style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} /></Field>
        </ModalShell>
      )}

      <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 5200, display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} />
        ))}
      </div>
    </div>
  );
}

function ManagementSkeleton() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ ...panelStyle, height: 90 }} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr", gap: 10, marginBottom: 10 }}>
        <div style={{ ...panelStyle, height: 260 }} />
        <div style={{ ...panelStyle, height: 260 }} />
        <div style={{ ...panelStyle, height: 260 }} />
      </div>
      <div style={{ ...panelStyle, height: 260, marginBottom: 10 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ ...panelStyle, height: 220 }} />
        <div style={{ ...panelStyle, height: 220 }} />
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function MetricCard({ label, value, subtitle, color, progress }) {
  return (
    <div style={{ ...panelStyle, borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 9, color: "#475569", fontWeight: 700, letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{subtitle}</div>
      {typeof progress === "number" && (
        <div style={{ marginTop: 6, height: 6, background: "#1e293b", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, progress))}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

function SignalDot({ value }) {
  return <span style={{ width: 10, height: 10, display: "inline-block", borderRadius: "50%", background: signalColor(value) }} />;
}

function Pill({ color, children }) {
  return <span style={{ borderRadius: 999, border: `1px solid ${color}66`, background: `${color}22`, color, fontSize: 10, fontWeight: 700, padding: "2px 8px", textTransform: "uppercase" }}>{children}</span>;
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function ModalShell({ title, onClose, onConfirm, confirmLabel, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(2, 6, 23, 0.78)", zIndex: 5100, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div style={{ width: "min(980px, 100%)", maxHeight: "92vh", overflowY: "auto", background: "#0f0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: 14 }}>
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

function Th({ children }) {
  return <th style={{ textAlign: "left", padding: "8px 8px", fontSize: 11, color: "#94a3b8", fontWeight: 700, position: "sticky", top: 0, zIndex: 3, background: "#111827" }}>{children}</th>;
}

function Td({ children }) {
  return <td style={{ padding: "8px 8px", fontSize: 11, color: "#e2e8f0", verticalAlign: "top" }}>{children}</td>;
}

function Toast({ message, type }) {
  const isSuccess = type === "success";
  return <div style={{ background: isSuccess ? "rgba(22,163,74,0.92)" : "rgba(185,28,28,0.92)", border: `1px solid ${isSuccess ? "rgba(74,222,128,0.45)" : "rgba(252,165,165,0.45)"}`, color: "#f8fafc", borderRadius: 10, padding: "10px 12px", fontSize: 12, fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>{message}</div>;
}

const panelStyle = { background: "#0f0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: 10 };
const compactInputStyle = { ...inputStyle, padding: "5px 6px", fontSize: 11 };
const primaryButtonStyle = { background: "#e94560", color: "#fff", border: "1px solid #f87187", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const ghostButtonStyle = { background: "transparent", color: "#cbd5e1", border: "1px solid #334155", borderRadius: 8, padding: "7px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const primaryMiniButtonStyle = { ...primaryButtonStyle, padding: "5px 8px", fontSize: 11 };
const ghostMiniButtonStyle = { ...ghostButtonStyle, padding: "5px 8px", fontSize: 11 };
const linkButtonStyle = { background: "none", border: "none", color: "#e94560", cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: 0 };
function tabMiniButtonStyle(active) {
  return { ...ghostMiniButtonStyle, borderColor: active ? "#e94560" : "#334155", color: active ? "#e94560" : "#cbd5e1" };
}



