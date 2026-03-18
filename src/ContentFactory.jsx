import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

const VIDEO_STATUS_FLOW = [
  "concept",
  "scripted",
  "filming_ready",
  "filmed",
  "editing",
  "edited",
  "published",
];

const STATUS_COLOR = {
  concept: "#64748b",
  scripted: "#8b5cf6",
  filming_ready: "#a855f7",
  filmed: "#3b82f6",
  editing: "#f59e0b",
  edited: "#eab308",
  published: "#10b981",
  killed: "#ef4444",
};

const FRAME_TYPE_COLOR = {
  standard: "#64748b",
  dominant_demo: "#e94560",
};

const PLATFORM_OPTIONS = ["tiktok", "instagram", "youtube", "facebook"];
const VALIDATION_PHASE_OPTIONS = ["finding_outlier", "ab_testing"];

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

function defaultFrameForm() {
  return {
    name: "",
    description: "",
    frame_type: "standard",
    is_active: true,
    sort_order: 0,
  };
}

function defaultVideoForm(productId, frameId) {
  return {
    product_id: productId || "",
    frame_id: frameId && frameId !== "all" ? frameId : null,
    name: "",
    visual_hook: "",
    text_hook: "",
    background: "",
    sound: "",
    hand_movements: "",
    emotional_target: "",
    script: "",
    notes: "",
    platform: "tiktok",
    status: "concept",
    validation_week: 1,
    validation_phase: "finding_outlier",
    is_outlier: false,
    is_store_trigger: false,
    published_url: "",
    views_24h: 0,
    views_48h: 0,
    views_7d: 0,
    comments: 0,
    shares: 0,
    saves: 0,
  };
}

function defaultBatchForm() {
  return {
    name: "",
    scheduled_date: "",
    set_location: "",
    props_needed: "",
    notes: "",
    status: "planned",
  };
}

function statusRank(status) {
  const idx = VIDEO_STATUS_FLOW.indexOf(status);
  return idx === -1 ? 999 : idx;
}

function formatDate(dateLike) {
  if (!dateLike) return "-";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return String(dateLike);
  return d.toLocaleDateString();
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function ContentFactory() {
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");

  const [frames, setFrames] = useState([]);
  const [videos, setVideos] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selectedFrameId, setSelectedFrameId] = useState("all");

  const [sortBy, setSortBy] = useState("newest");
  const [statusFilter, setStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [weekFilter, setWeekFilter] = useState("all");

  const [isLoading, setIsLoading] = useState(true);
  const [isWriting, setIsWriting] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [showFrameModal, setShowFrameModal] = useState(false);
  const [editingFrame, setEditingFrame] = useState(null);
  const [frameForm, setFrameForm] = useState(defaultFrameForm());

  const [showVideoModal, setShowVideoModal] = useState(false);
  const [editingVideo, setEditingVideo] = useState(null);
  const [videoForm, setVideoForm] = useState(defaultVideoForm("", "all"));

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchForm, setBatchForm] = useState(defaultBatchForm());
  const [batchAssignSelection, setBatchAssignSelection] = useState({});

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

  const fetchProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, stage")
      .in("stage", ["execution_ready", "live"])
      .order("updated_at", { ascending: false });

    if (error) {
      pushToast(`Could not load products: ${error.message}`, "error");
      return false;
    }

    const rows = data || [];
    setProducts(rows);
    setSelectedProductId((prev) => {
      if (prev && rows.some((p) => p.id === prev)) return prev;
      return rows[0]?.id || "";
    });
    return true;
  }, [pushToast]);

  const fetchLibrary = useCallback(
    async (productId) => {
      if (!productId) {
        setFrames([]);
        setVideos([]);
        setBatches([]);
        return true;
      }

      const [framesRes, videosRes, batchesRes] = await Promise.all([
        supabase
          .from("commercial_frames")
          .select("*")
          .eq("product_id", productId)
          .order("sort_order", { ascending: true }),
        supabase
          .from("videos")
          .select("*")
          .eq("product_id", productId)
          .order("created_at", { ascending: false }),
        supabase
          .from("filming_batches")
          .select("*")
          .order("scheduled_date", { ascending: true }),
      ]);

      if (framesRes.error) {
        pushToast(`Could not load frames: ${framesRes.error.message}`, "error");
        return false;
      }
      if (videosRes.error) {
        pushToast(`Could not load videos: ${videosRes.error.message}`, "error");
        return false;
      }
      if (batchesRes.error) {
        pushToast(`Could not load batches: ${batchesRes.error.message}`, "error");
        return false;
      }

      setFrames(framesRes.data || []);
      setVideos(videosRes.data || []);
      setBatches(batchesRes.data || []);
      return true;
    },
    [pushToast]
  );

  useEffect(() => {
    const timer = setTimeout(async () => {
      setIsLoading(true);
      await fetchProducts();
      setIsLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchProducts]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setIsLoading(true);
      await fetchLibrary(selectedProductId);
      setIsLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedProductId, fetchLibrary]);

  const frameCountById = useMemo(() => {
    const counts = {};
    videos.forEach((v) => {
      const k = v.frame_id || "none";
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }, [videos]);

  const stats = useMemo(() => {
    const counts = { total: videos.length, outlier: 0, storeTrigger: 0 };
    VIDEO_STATUS_FLOW.forEach((s) => {
      counts[s] = 0;
    });
    counts.killed = 0;
    videos.forEach((v) => {
      const s = v.status || "concept";
      counts[s] = (counts[s] || 0) + 1;
      if (v.is_outlier) counts.outlier += 1;
      if (v.is_store_trigger) counts.storeTrigger += 1;
    });
    return counts;
  }, [videos]);

  const filteredVideos = useMemo(() => {
    let list = [...videos];
    if (selectedFrameId !== "all") list = list.filter((v) => v.frame_id === selectedFrameId);
    if (statusFilter !== "all") list = list.filter((v) => v.status === statusFilter);
    if (platformFilter !== "all") list = list.filter((v) => v.platform === platformFilter);
    if (weekFilter !== "all") list = list.filter((v) => String(v.validation_week || "") === weekFilter);

    if (sortBy === "status") {
      list.sort((a, b) => statusRank(a.status) - statusRank(b.status));
    } else if (sortBy === "platform") {
      list.sort((a, b) => (a.platform || "").localeCompare(b.platform || ""));
    } else {
      list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    }
    return list;
  }, [videos, selectedFrameId, statusFilter, platformFilter, weekFilter, sortBy]);

  const framesById = useMemo(() => {
    const map = {};
    frames.forEach((f) => {
      map[f.id] = f;
    });
    return map;
  }, [frames]);

  const filmingReadyUnassigned = useMemo(
    () => videos.filter((v) => v.status === "filming_ready" && !v.batch_id),
    [videos]
  );

  const openAddFrame = () => {
    setEditingFrame(null);
    setFrameForm(defaultFrameForm());
    setShowFrameModal(true);
  };

  const openEditFrame = (frame) => {
    setEditingFrame(frame);
    setFrameForm({
      name: frame.name || "",
      description: frame.description || "",
      frame_type: frame.frame_type || "standard",
      is_active: frame.is_active !== false,
      sort_order: frame.sort_order || 0,
    });
    setShowFrameModal(true);
  };

  const saveFrame = async () => {
    if (!selectedProductId) {
      pushToast("Select a product first", "error");
      return;
    }

    await withWrite(async () => {
      const payload = {
        ...frameForm,
        product_id: selectedProductId,
        sort_order: Number(frameForm.sort_order || 0),
      };

      if (editingFrame?.id) {
        const { error } = await supabase.from("commercial_frames").update(payload).eq("id", editingFrame.id);
        if (error) {
          pushToast(`Could not update frame: ${error.message}`, "error");
          return false;
        }
      } else {
        const { error } = await supabase.from("commercial_frames").insert(payload);
        if (error) {
          pushToast(`Could not create frame: ${error.message}`, "error");
          return false;
        }
      }

      const ok = await fetchLibrary(selectedProductId);
      if (ok) setShowFrameModal(false);
      return ok;
    }, editingFrame?.id ? "Frame updated" : "Frame created");
  };

  const deleteFrame = async (frame) => {
    const count = frameCountById[frame.id] || 0;
    if (count > 0) {
      pushToast("Frame has videos. Reassign or delete videos first.", "error");
      return;
    }
    await withWrite(async () => {
      const { error } = await supabase.from("commercial_frames").delete().eq("id", frame.id);
      if (error) {
        pushToast(`Could not delete frame: ${error.message}`, "error");
        return false;
      }
      if (selectedFrameId === frame.id) setSelectedFrameId("all");
      return fetchLibrary(selectedProductId);
    }, "Frame deleted");
  };

  const openAddVideo = () => {
    setEditingVideo(null);
    setVideoForm(defaultVideoForm(selectedProductId, selectedFrameId));
    setShowVideoModal(true);
  };

  const openEditVideo = (video) => {
    setEditingVideo(video);
    setVideoForm({
      ...defaultVideoForm(selectedProductId, selectedFrameId),
      ...video,
      validation_week: video.validation_week || 1,
      validation_phase: video.validation_phase || "finding_outlier",
    });
    setShowVideoModal(true);
  };

  const saveVideo = async () => {
    if (!selectedProductId) {
      pushToast("Select a product first", "error");
      return;
    }

    await withWrite(async () => {
      const payload = {
        ...videoForm,
        product_id: selectedProductId,
        frame_id: videoForm.frame_id || null,
        views_24h: toNumber(videoForm.views_24h),
        views_48h: toNumber(videoForm.views_48h),
        views_7d: toNumber(videoForm.views_7d),
        comments: toNumber(videoForm.comments),
        shares: toNumber(videoForm.shares),
        saves: toNumber(videoForm.saves),
        validation_week: toNumber(videoForm.validation_week),
      };

      if (editingVideo?.id) {
        const { error } = await supabase
          .from("videos")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editingVideo.id);
        if (error) {
          pushToast(`Could not update video: ${error.message}`, "error");
          return false;
        }
      } else {
        const { error } = await supabase.from("videos").insert({
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (error) {
          pushToast(`Could not create video: ${error.message}`, "error");
          return false;
        }
      }

      const ok = await fetchLibrary(selectedProductId);
      if (ok) setShowVideoModal(false);
      return ok;
    }, editingVideo?.id ? "Video updated" : "Video created");
  };

  const advanceVideoStatus = async (video) => {
    const idx = VIDEO_STATUS_FLOW.indexOf(video.status || "concept");
    if (idx < 0 || idx >= VIDEO_STATUS_FLOW.length - 1) return;
    const nextStatus = VIDEO_STATUS_FLOW[idx + 1];
    await withWrite(async () => {
      const patch = { status: nextStatus, updated_at: new Date().toISOString() };
      if (nextStatus === "filmed") patch.filmed_at = new Date().toISOString();
      if (nextStatus === "published") patch.published_at = new Date().toISOString();

      const { error } = await supabase.from("videos").update(patch).eq("id", video.id);
      if (error) {
        pushToast(`Could not advance video: ${error.message}`, "error");
        return false;
      }

      if (video.batch_id) {
        await updateBatchStatus(video.batch_id);
      }
      return fetchLibrary(selectedProductId);
    }, `Video moved to ${nextStatus}`);
  };

  const killVideo = async (video) => {
    await withWrite(async () => {
      const { error } = await supabase
        .from("videos")
        .update({ status: "killed", updated_at: new Date().toISOString() })
        .eq("id", video.id);
      if (error) {
        pushToast(`Could not kill video: ${error.message}`, "error");
        return false;
      }
      if (video.batch_id) {
        await updateBatchStatus(video.batch_id);
      }
      return fetchLibrary(selectedProductId);
    }, "Video killed");
  };

  const createBatch = async () => {
    await withWrite(async () => {
      const { error } = await supabase.from("filming_batches").insert({
        ...batchForm,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) {
        pushToast(`Could not create batch: ${error.message}`, "error");
        return false;
      }
      const ok = await fetchLibrary(selectedProductId);
      if (ok) setShowBatchModal(false);
      return ok;
    }, "Batch created");
  };

  const updateBatchStatus = useCallback(
    async (batchId) => {
      const { data, error } = await supabase
        .from("videos")
        .select("id, status")
        .eq("batch_id", batchId);

      if (error) {
        pushToast(`Could not evaluate batch status: ${error.message}`, "error");
        return false;
      }

      const assigned = data || [];
      let next = "planned";
      if (assigned.length > 0) {
        const filmedLike = assigned.every((v) =>
          ["filmed", "editing", "edited", "published"].includes(v.status)
        );
        const anyFilmedLike = assigned.some((v) =>
          ["filmed", "editing", "edited", "published"].includes(v.status)
        );
        next = filmedLike ? "done" : anyFilmedLike ? "filming" : "planned";
      }

      const { error: upErr } = await supabase
        .from("filming_batches")
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq("id", batchId);

      if (upErr) {
        pushToast(`Could not update batch status: ${upErr.message}`, "error");
        return false;
      }
      return true;
    },
    [pushToast]
  );

  const assignVideoToBatch = async (batchId) => {
    const videoId = batchAssignSelection[batchId];
    if (!videoId) return;

    await withWrite(async () => {
      const { error } = await supabase
        .from("videos")
        .update({ batch_id: batchId, updated_at: new Date().toISOString() })
        .eq("id", videoId);
      if (error) {
        pushToast(`Could not assign video: ${error.message}`, "error");
        return false;
      }
      const ok = await updateBatchStatus(batchId);
      if (!ok) return false;
      const refreshed = await fetchLibrary(selectedProductId);
      if (refreshed) {
        setBatchAssignSelection((prev) => ({ ...prev, [batchId]: "" }));
      }
      return refreshed;
    }, "Video assigned");
  };

  const toggleFilmedInBatch = async (video) => {
    const checked = ["filmed", "editing", "edited", "published"].includes(video.status);
    const nextStatus = checked ? "filming_ready" : "filmed";

    await withWrite(async () => {
      const { error } = await supabase
        .from("videos")
        .update({
          status: nextStatus,
          filmed_at: nextStatus === "filmed" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", video.id);
      if (error) {
        pushToast(`Could not update filmed checkbox: ${error.message}`, "error");
        return false;
      }
      if (video.batch_id) {
        const ok = await updateBatchStatus(video.batch_id);
        if (!ok) return false;
      }
      return fetchLibrary(selectedProductId);
    }, checked ? "Marked as not filmed" : "Marked as filmed");
  };

  const currentProduct = products.find((p) => p.id === selectedProductId) || null;

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

      <div
        style={{
          background: "#0f0f1a",
          border: "1px solid #1e293b",
          borderRadius: 12,
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "space-between",
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ color: "#e94560", fontWeight: 800, letterSpacing: "0.05em", fontSize: 14 }}>
              CONTENT LIBRARY
            </div>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              style={{ ...inputStyle, minWidth: 320, width: "auto" }}
            >
              {products.length === 0 && <option value="">No execution-ready/live products</option>}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.stage})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button style={primaryButtonStyle} onClick={openAddFrame} disabled={!currentProduct}>
              + Add Frame
            </button>
            <button style={primaryButtonStyle} onClick={openAddVideo} disabled={!currentProduct}>
              + Add Video
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <StatChip label="Total" value={stats.total} color="#334155" />
          {VIDEO_STATUS_FLOW.map((s) => (
            <StatChip key={s} label={s} value={stats[s] || 0} color={STATUS_COLOR[s]} />
          ))}
          <StatChip label="killed" value={stats.killed || 0} color={STATUS_COLOR.killed} />
          <StatChip label="Outliers" value={stats.outlier} color="#f59e0b" />
          <StatChip label="Store Triggers" value={stats.storeTrigger} color="#10b981" />
        </div>
      </div>

      {isLoading ? (
        <div
          style={{
            minHeight: "calc(100vh - 180px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 12,
            color: "#94a3b8",
          }}
        >
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
          <div style={{ fontSize: 13, fontWeight: 600 }}>Loading...</div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr 1fr",
            gap: 12,
          }}
        >
          <section style={panelStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <SectionTitle>Frames & Structure</SectionTitle>
            </div>

            <button
              onClick={() => setSelectedFrameId("all")}
              style={{
                ...listItemButtonStyle,
                borderColor: selectedFrameId === "all" ? "rgba(233,69,96,0.5)" : "#1e293b",
                background: selectedFrameId === "all" ? "rgba(233,69,96,0.12)" : "#0b1220",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>All Videos</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{videos.length} videos</div>
            </button>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {frames.map((frame) => (
                <div
                  key={frame.id}
                  style={{
                    ...listItemButtonStyle,
                    borderColor: selectedFrameId === frame.id ? "rgba(233,69,96,0.5)" : "#1e293b",
                    background: selectedFrameId === frame.id ? "rgba(233,69,96,0.12)" : "#0b1220",
                  }}
                >
                  <button
                    onClick={() => setSelectedFrameId(frame.id)}
                    style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{frame.name}</div>
                      <StatusPill
                        label={frame.frame_type || "standard"}
                        color={FRAME_TYPE_COLOR[frame.frame_type] || FRAME_TYPE_COLOR.standard}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                      {frame.description || "No description"}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      {frameCountById[frame.id] || 0} videos
                    </div>
                  </button>

                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button style={ghostButtonStyle} onClick={() => openEditFrame(frame)}>
                      Edit
                    </button>
                    <button
                      style={{ ...ghostButtonStyle, borderColor: "rgba(239,68,68,0.5)", color: "#fca5a5" }}
                      onClick={() => void deleteFrame(frame)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {frames.length === 0 && (
                <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 2px" }}>
                  No frames yet.
                </div>
              )}
            </div>
          </section>

          <section style={panelStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <SectionTitle>Video Library</SectionTitle>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ ...inputStyle, width: 116, padding: "7px 9px", fontSize: 12 }}>
                  <option value="newest">Newest</option>
                  <option value="status">Status</option>
                  <option value="platform">Platform</option>
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 126, padding: "7px 9px", fontSize: 12 }}>
                  <option value="all">All status</option>
                  {VIDEO_STATUS_FLOW.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  <option value="killed">killed</option>
                </select>
                <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} style={{ ...inputStyle, width: 126, padding: "7px 9px", fontSize: 12 }}>
                  <option value="all">All platforms</option>
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)} style={{ ...inputStyle, width: 100, padding: "7px 9px", fontSize: 12 }}>
                  <option value="all">All weeks</option>
                  <option value="1">Week 1</option>
                  <option value="2">Week 2</option>
                  <option value="3">Week 3</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredVideos.map((video) => {
                const frame = framesById[video.frame_id] || null;
                return (
                  <div
                    key={video.id}
                    onClick={() => openEditVideo(video)}
                    style={{
                      background: "#0b1220",
                      border: "1px solid #1e293b",
                      borderRadius: 10,
                      padding: 12,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8, alignItems: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{video.name || "Untitled video"}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <StatusPill label={video.platform || "tiktok"} color="#3b82f6" />
                        <StatusPill label={video.status || "concept"} color={STATUS_COLOR[video.status] || "#64748b"} />
                        {frame && <StatusPill label={frame.name} color="#e94560" />}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <VariableField label="Visual Hook" value={video.visual_hook} />
                      <VariableField label="Text Hook" value={video.text_hook} />
                      <VariableField label="Background" value={video.background} />
                      <VariableField label="Sound" value={video.sound} />
                      <VariableField label="Hand Movements" value={video.hand_movements} />
                      <VariableField label="Emotional Target" value={video.emotional_target} />
                    </div>

                    <StatusProgress status={video.status} />

                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {video.is_outlier && <StatusPill label="Outlier" color="#f59e0b" />}
                      {video.is_store_trigger && <StatusPill label="Store Trigger" color="#22c55e" />}
                      {video.validation_week && <StatusPill label={`Week ${video.validation_week}`} color="#64748b" />}
                      {video.validation_phase && <StatusPill label={video.validation_phase} color="#64748b" />}
                    </div>

                    <div
                      style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button style={ghostButtonStyle} onClick={() => openEditVideo(video)}>
                        Edit
                      </button>
                      {video.status !== "published" && video.status !== "killed" && (
                        <button style={ghostButtonStyle} onClick={() => void advanceVideoStatus(video)}>
                          Advance
                        </button>
                      )}
                      {video.status !== "killed" && (
                        <button
                          style={{ ...ghostButtonStyle, borderColor: "rgba(239,68,68,0.5)", color: "#fca5a5" }}
                          onClick={() => void killVideo(video)}
                        >
                          Kill
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredVideos.length === 0 && (
                <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 2px" }}>
                  No videos match current filters.
                </div>
              )}
            </div>
          </section>

          <section style={panelStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <SectionTitle>Filming Batches</SectionTitle>
              <button style={primaryButtonStyle} onClick={() => setShowBatchModal(true)}>
                + New Batch
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {batches.map((batch) => {
                const assigned = videos.filter((v) => v.batch_id === batch.id);
                const batchStatusColor = batch.status === "done" ? "#10b981" : batch.status === "filming" ? "#8b5cf6" : "#64748b";
                return (
                  <div
                    key={batch.id}
                    style={{
                      background: "#0b1220",
                      border: "1px solid #1e293b",
                      borderRadius: 10,
                      padding: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{batch.name || "Unnamed batch"}</div>
                      <StatusPill label={batch.status || "planned"} color={batchStatusColor} />
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                      {formatDate(batch.scheduled_date)} • {batch.set_location || "No location"}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      {assigned.length} assigned videos
                    </div>

                    <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                      <select
                        value={batchAssignSelection[batch.id] || ""}
                        onChange={(e) =>
                          setBatchAssignSelection((prev) => ({ ...prev, [batch.id]: e.target.value }))
                        }
                        style={{ ...inputStyle, padding: "7px 9px", fontSize: 12 }}
                      >
                        <option value="">Assign filming_ready video...</option>
                        {filmingReadyUnassigned.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name || "Untitled video"}
                          </option>
                        ))}
                      </select>
                      <button
                        style={ghostButtonStyle}
                        disabled={!batchAssignSelection[batch.id]}
                        onClick={() => void assignVideoToBatch(batch.id)}
                      >
                        Add
                      </button>
                    </div>

                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                      {assigned.map((v) => {
                        const checked = ["filmed", "editing", "edited", "published"].includes(v.status);
                        return (
                          <label
                            key={v.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              fontSize: 11,
                              color: "#cbd5e1",
                              border: "1px solid #1e293b",
                              borderRadius: 8,
                              padding: "6px 8px",
                              gap: 8,
                            }}
                          >
                            <span>{v.name || "Untitled video"}</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              filmed
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => void toggleFilmedInBatch(v)}
                              />
                            </span>
                          </label>
                        );
                      })}
                      {assigned.length === 0 && (
                        <div style={{ fontSize: 11, color: "#64748b" }}>No videos assigned.</div>
                      )}
                    </div>
                  </div>
                );
              })}
              {batches.length === 0 && (
                <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 2px" }}>
                  No filming batches yet.
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {showFrameModal && (
        <ModalShell
          title={editingFrame ? "Edit Commercial Frame" : "Add Commercial Frame"}
          onClose={() => setShowFrameModal(false)}
          onConfirm={() => void saveFrame()}
          confirmLabel={editingFrame ? "Save frame" : "Create frame"}
        >
          <FieldGroup label="Name">
            <input value={frameForm.name} onChange={(e) => setFrameForm((p) => ({ ...p, name: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label="Description">
            <textarea value={frameForm.description} onChange={(e) => setFrameForm((p) => ({ ...p, description: e.target.value }))} style={{ ...inputStyle, minHeight: 76, resize: "vertical" }} />
          </FieldGroup>
          <FieldGroup label="Frame Type">
            <select value={frameForm.frame_type} onChange={(e) => setFrameForm((p) => ({ ...p, frame_type: e.target.value }))} style={inputStyle}>
              <option value="standard">standard</option>
              <option value="dominant_demo">dominant_demo</option>
            </select>
          </FieldGroup>
          <FieldGroup label="Sort Order">
            <input type="number" value={frameForm.sort_order} onChange={(e) => setFrameForm((p) => ({ ...p, sort_order: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <div style={{ marginTop: 8 }}>
            <ToggleButton
              active={frameForm.is_active}
              onClick={() => setFrameForm((p) => ({ ...p, is_active: !p.is_active }))}
              label={frameForm.is_active ? "Active" : "Inactive"}
              color="#22c55e"
            />
          </div>
        </ModalShell>
      )}

      {showVideoModal && (
        <ModalShell
          title={editingVideo ? "Video Detail" : "Add Video"}
          onClose={() => setShowVideoModal(false)}
          onConfirm={() => void saveVideo()}
          confirmLabel={editingVideo ? "Save video" : "Create video"}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Product">
              <select
                value={videoForm.product_id || selectedProductId}
                onChange={(e) => setVideoForm((p) => ({ ...p, product_id: e.target.value }))}
                style={inputStyle}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FieldGroup>
            <FieldGroup label="Commercial Frame">
              <select
                value={videoForm.frame_id || ""}
                onChange={(e) => setVideoForm((p) => ({ ...p, frame_id: e.target.value || null }))}
                style={inputStyle}
              >
                <option value="">No frame</option>
                {frames.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </FieldGroup>
          </div>

          <FieldGroup label='Visual Hook (e.g. "POV using product")'>
            <input value={videoForm.visual_hook || ""} onChange={(e) => setVideoForm((p) => ({ ...p, visual_hook: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label='Text Hook (e.g. "Watch what happens")'>
            <input value={videoForm.text_hook || ""} onChange={(e) => setVideoForm((p) => ({ ...p, text_hook: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label='Background (e.g. "Kitchen counter")'>
            <input value={videoForm.background || ""} onChange={(e) => setVideoForm((p) => ({ ...p, background: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label='Sound (e.g. "ASMR product sounds")'>
            <input value={videoForm.sound || ""} onChange={(e) => setVideoForm((p) => ({ ...p, sound: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label='Hand Movements (e.g. "Quick unboxing")'>
            <input value={videoForm.hand_movements || ""} onChange={(e) => setVideoForm((p) => ({ ...p, hand_movements: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label='Emotional Target (e.g. "Curiosity")'>
            <input value={videoForm.emotional_target || ""} onChange={(e) => setVideoForm((p) => ({ ...p, emotional_target: e.target.value }))} style={inputStyle} />
          </FieldGroup>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <FieldGroup label="Name">
              <input value={videoForm.name || ""} onChange={(e) => setVideoForm((p) => ({ ...p, name: e.target.value }))} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="Platform">
              <select value={videoForm.platform || "tiktok"} onChange={(e) => setVideoForm((p) => ({ ...p, platform: e.target.value }))} style={inputStyle}>
                {PLATFORM_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </FieldGroup>
            <FieldGroup label="Status">
              <select value={videoForm.status || "concept"} onChange={(e) => setVideoForm((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>
                {VIDEO_STATUS_FLOW.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="killed">killed</option>
              </select>
            </FieldGroup>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Validation Week (1-3)">
              <select value={String(videoForm.validation_week || 1)} onChange={(e) => setVideoForm((p) => ({ ...p, validation_week: Number(e.target.value) }))} style={inputStyle}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </FieldGroup>
            <FieldGroup label="Validation Phase">
              <select value={videoForm.validation_phase || "finding_outlier"} onChange={(e) => setVideoForm((p) => ({ ...p, validation_phase: e.target.value }))} style={inputStyle}>
                {VALIDATION_PHASE_OPTIONS.map((phase) => (
                  <option key={phase} value={phase}>{phase}</option>
                ))}
              </select>
            </FieldGroup>
          </div>

          <FieldGroup label="Script">
            <textarea value={videoForm.script || ""} onChange={(e) => setVideoForm((p) => ({ ...p, script: e.target.value }))} style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} />
          </FieldGroup>
          <FieldGroup label="Notes">
            <textarea value={videoForm.notes || ""} onChange={(e) => setVideoForm((p) => ({ ...p, notes: e.target.value }))} style={{ ...inputStyle, minHeight: 74, resize: "vertical" }} />
          </FieldGroup>

          <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 8 }}>
            <ToggleButton active={!!videoForm.is_outlier} onClick={() => setVideoForm((p) => ({ ...p, is_outlier: !p.is_outlier }))} label={videoForm.is_outlier ? "Outlier ON" : "Outlier OFF"} color="#f59e0b" />
            <ToggleButton active={!!videoForm.is_store_trigger} onClick={() => setVideoForm((p) => ({ ...p, is_store_trigger: !p.is_store_trigger }))} label={videoForm.is_store_trigger ? "Store Trigger ON" : "Store Trigger OFF"} color="#22c55e" />
          </div>

          <FieldGroup label="Published URL">
            <input value={videoForm.published_url || ""} onChange={(e) => setVideoForm((p) => ({ ...p, published_url: e.target.value }))} style={inputStyle} />
          </FieldGroup>

          <h4 style={{ margin: "12px 0 8px", fontSize: 13, color: "#94a3b8", letterSpacing: "0.04em" }}>Performance</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            <FieldGroup label="views_24h">
              <input type="number" value={videoForm.views_24h ?? 0} onChange={(e) => setVideoForm((p) => ({ ...p, views_24h: e.target.value }))} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="views_48h">
              <input type="number" value={videoForm.views_48h ?? 0} onChange={(e) => setVideoForm((p) => ({ ...p, views_48h: e.target.value }))} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="views_7d">
              <input type="number" value={videoForm.views_7d ?? 0} onChange={(e) => setVideoForm((p) => ({ ...p, views_7d: e.target.value }))} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="comments">
              <input type="number" value={videoForm.comments ?? 0} onChange={(e) => setVideoForm((p) => ({ ...p, comments: e.target.value }))} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="shares">
              <input type="number" value={videoForm.shares ?? 0} onChange={(e) => setVideoForm((p) => ({ ...p, shares: e.target.value }))} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="saves">
              <input type="number" value={videoForm.saves ?? 0} onChange={(e) => setVideoForm((p) => ({ ...p, saves: e.target.value }))} style={inputStyle} />
            </FieldGroup>
          </div>

          <h4 style={{ margin: "12px 0 8px", fontSize: 13, color: "#94a3b8", letterSpacing: "0.04em" }}>Status Timeline</h4>
          <StatusTimeline video={editingVideo || videoForm} />
        </ModalShell>
      )}

      {showBatchModal && (
        <ModalShell
          title="Create Filming Batch"
          onClose={() => setShowBatchModal(false)}
          onConfirm={() => void createBatch()}
          confirmLabel="Create batch"
        >
          <FieldGroup label="Name">
            <input value={batchForm.name} onChange={(e) => setBatchForm((p) => ({ ...p, name: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label="Scheduled Date">
            <input type="date" value={batchForm.scheduled_date} onChange={(e) => setBatchForm((p) => ({ ...p, scheduled_date: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label="Set Location">
            <input value={batchForm.set_location} onChange={(e) => setBatchForm((p) => ({ ...p, set_location: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label="Props Needed">
            <textarea value={batchForm.props_needed} onChange={(e) => setBatchForm((p) => ({ ...p, props_needed: e.target.value }))} style={{ ...inputStyle, minHeight: 74, resize: "vertical" }} />
          </FieldGroup>
          <FieldGroup label="Notes">
            <textarea value={batchForm.notes} onChange={(e) => setBatchForm((p) => ({ ...p, notes: e.target.value }))} style={{ ...inputStyle, minHeight: 74, resize: "vertical" }} />
          </FieldGroup>
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
        {toasts.map((toast) => (
          <Toast key={toast.id} message={toast.message} type={toast.type} />
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 style={{ margin: 0, fontSize: 13, letterSpacing: "0.05em", color: "#cbd5e1" }}>
      {children}
    </h3>
  );
}

function VariableField({ label, value }) {
  return (
    <div
      style={{
        background: "rgba(15, 23, 42, 0.55)",
        border: "1px solid rgba(30, 41, 59, 0.9)",
        borderRadius: 8,
        padding: "7px 8px",
      }}
    >
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600, minHeight: 16 }}>
        {value || "-"}
      </div>
    </div>
  );
}

function StatusProgress({ status }) {
  const idx = VIDEO_STATUS_FLOW.indexOf(status || "concept");
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${VIDEO_STATUS_FLOW.length}, 1fr)`, gap: 4 }}>
      {VIDEO_STATUS_FLOW.map((s, i) => {
        const active = i <= idx;
        return (
          <div key={s} title={s}>
            <div
              style={{
                height: 5,
                borderRadius: 999,
                background: active ? STATUS_COLOR[s] : "#1f2937",
                border: "1px solid #1e293b",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <span
      style={{
        borderRadius: 999,
        border: `1px solid ${color}66`,
        background: `${color}22`,
        padding: "3px 8px",
        fontSize: 11,
        color: "#e2e8f0",
      }}
    >
      {label}: {value}
    </span>
  );
}

function StatusPill({ label, color }) {
  return (
    <span
      style={{
        borderRadius: 999,
        border: `1px solid ${color}66`,
        background: `${color}22`,
        padding: "2px 7px",
        fontSize: 10,
        fontWeight: 700,
        color,
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

function StatusTimeline({ video }) {
  const events = [
    { label: "Created", date: video.created_at },
    { label: "Filmed", date: video.filmed_at },
    { label: "Published", date: video.published_at },
    { label: `Current status: ${video.status || "concept"}`, date: video.updated_at || video.created_at },
  ].filter((e) => !!e.date);

  if (events.length === 0) {
    return <div style={{ fontSize: 12, color: "#64748b" }}>No timeline yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {events.map((event, idx) => (
        <div
          key={`${event.label}-${idx}`}
          style={{
            border: "1px solid #1e293b",
            borderRadius: 8,
            padding: "7px 9px",
            fontSize: 12,
            color: "#cbd5e1",
            background: "#0b1220",
          }}
        >
          <div style={{ fontWeight: 700 }}>{event.label}</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{formatDate(event.date)}</div>
        </div>
      ))}
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
          width: "min(860px, 100%)",
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
  minHeight: "calc(100vh - 190px)",
  overflow: "auto",
};

const listItemButtonStyle = {
  border: "1px solid #1e293b",
  background: "#0b1220",
  borderRadius: 8,
  padding: 10,
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
