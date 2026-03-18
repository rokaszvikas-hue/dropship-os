import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

const ANGLE_STATUSES = ["planned", "filming_ready", "filmed", "edited", "published", "killed"];
const PLATFORM_OPTIONS = ["TikTok", "Instagram", "YouTube", "Facebook"];
const ANGLE_STATUS_FLOW = {
  planned: "filming_ready",
  filming_ready: "filmed",
  filmed: "edited",
  edited: "published",
};

const angleStatusColor = {
  planned: "#64748b",
  filming_ready: "#8b5cf6",
  filmed: "#3b82f6",
  edited: "#f59e0b",
  published: "#10b981",
  killed: "#ef4444",
};

const batchStatusColor = {
  planned: "#64748b",
  filming: "#8b5cf6",
  done: "#10b981",
};

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

function emptyAngleForm() {
  return {
    name: "",
    commercial_frame: "",
    visual_hook: "",
    text_hook: "",
    emotional_target: "",
    set_location: "",
    platform: "TikTok",
    notes: "",
    script: "",
    status: "planned",
    outlier_trigger: false,
    store_trigger: false,
  };
}

function emptyBatchForm() {
  return {
    name: "",
    scheduled_date: "",
    set_location: "",
    props_needed: "",
    status: "planned",
  };
}

export default function ContentFactory() {
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [angles, setAngles] = useState([]);
  const [batches, setBatches] = useState([]);
  const [batchAngles, setBatchAngles] = useState([]);
  const [assignSelection, setAssignSelection] = useState({});

  const [isSyncing, setIsSyncing] = useState(true);
  const [isWriting, setIsWriting] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [showAngleModal, setShowAngleModal] = useState(false);
  const [editingAngle, setEditingAngle] = useState(null);
  const [angleForm, setAngleForm] = useState(emptyAngleForm());

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchForm, setBatchForm] = useState(emptyBatchForm());

  const pushToast = useCallback((message, type = "error") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const fetchProducts = useCallback(async () => {
    setIsSyncing(true);
    const { data, error } = await supabase
      .from("products")
      .select("id, name, stage")
      .in("stage", ["execution_ready", "live"])
      .order("updated_at", { ascending: false });

    if (error) {
      pushToast(`Could not load products: ${error.message}`, "error");
      setProducts([]);
      setSelectedProductId("");
      setIsSyncing(false);
      return false;
    }

    const fetched = data || [];
    setProducts(fetched);
    setSelectedProductId((prev) => {
      if (prev && fetched.some((p) => p.id === prev)) return prev;
      return fetched[0]?.id || "";
    });
    setIsSyncing(false);
    return true;
  }, [pushToast]);

  const fetchProductContent = useCallback(async (productId) => {
    if (!productId) {
      setAngles([]);
      setBatches([]);
      setBatchAngles([]);
      return true;
    }

    setIsSyncing(true);

    const { data: angleData, error: angleError } = await supabase
      .from("angles")
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });

    if (angleError) {
      pushToast(`Could not load angles: ${angleError.message}`, "error");
      setIsSyncing(false);
      return false;
    }

    const { data: batchData, error: batchError } = await supabase
      .from("filming_batches")
      .select("*")
      .eq("product_id", productId)
      .order("scheduled_date", { ascending: true });

    if (batchError) {
      pushToast(`Could not load batches: ${batchError.message}`, "error");
      setIsSyncing(false);
      return false;
    }

    const batchIds = (batchData || []).map((b) => b.id);
    if (batchIds.length === 0) {
      setAngles(angleData || []);
      setBatches(batchData || []);
      setBatchAngles([]);
      setIsSyncing(false);
      return true;
    }

    const { data: junctionData, error: junctionError } = await supabase
      .from("batch_angles")
      .select("*")
      .in("batch_id", batchIds);

    if (junctionError) {
      pushToast(`Could not load batch assignments: ${junctionError.message}`, "error");
      setIsSyncing(false);
      return false;
    }

    setAngles(angleData || []);
    setBatches(batchData || []);
    setBatchAngles(junctionData || []);
    setIsSyncing(false);
    return true;
  }, [pushToast]);

  useEffect(() => {
    const timerId = setTimeout(() => {
      void fetchProducts();
    }, 0);
    return () => clearTimeout(timerId);
  }, [fetchProducts]);

  useEffect(() => {
    const timerId = setTimeout(() => {
      void fetchProductContent(selectedProductId);
    }, 0);
    return () => clearTimeout(timerId);
  }, [selectedProductId, fetchProductContent]);

  const withWrite = useCallback(async (operation, successMessage) => {
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
  }, [pushToast]);

  const angleCounts = useMemo(() => {
    const counts = { total: angles.length };
    ANGLE_STATUSES.forEach((status) => {
      counts[status] = angles.filter((angle) => angle.status === status).length;
    });
    return counts;
  }, [angles]);

  const anglesById = useMemo(() => {
    const map = {};
    angles.forEach((angle) => {
      map[angle.id] = angle;
    });
    return map;
  }, [angles]);

  const filmingReadyAngles = useMemo(
    () => angles.filter((angle) => angle.status === "filming_ready"),
    [angles]
  );

  const selectedProduct = products.find((p) => p.id === selectedProductId) || null;

  const openAddAngle = () => {
    setEditingAngle(null);
    setAngleForm(emptyAngleForm());
    setShowAngleModal(true);
  };

  const openEditAngle = (angle) => {
    setEditingAngle(angle);
    setAngleForm({
      name: angle.name || "",
      commercial_frame: angle.commercial_frame || "",
      visual_hook: angle.visual_hook || "",
      text_hook: angle.text_hook || "",
      emotional_target: angle.emotional_target || "",
      set_location: angle.set_location || "",
      platform: angle.platform || "TikTok",
      notes: angle.notes || "",
      script: angle.script || "",
      status: angle.status || "planned",
      outlier_trigger: !!(angle.outlier_trigger ?? angle.is_outlier ?? angle.outlier ?? false),
      store_trigger: !!(angle.store_trigger ?? angle.is_store_trigger ?? angle.store_candidate ?? false),
    });
    setShowAngleModal(true);
  };

  const saveAngle = async () => {
    if (!selectedProductId) {
      pushToast("Pick a product first", "error");
      return;
    }

    const payload = {
      ...angleForm,
      product_id: selectedProductId,
      updated_at: new Date().toISOString(),
    };

    await withWrite(async () => {
      if (editingAngle?.id) {
        const { error } = await supabase.from("angles").update(payload).eq("id", editingAngle.id);
        if (error) {
          pushToast(`Could not update angle: ${error.message}`, "error");
          return false;
        }
      } else {
        const { error } = await supabase.from("angles").insert({
          ...payload,
          created_at: new Date().toISOString(),
        });
        if (error) {
          pushToast(`Could not create angle: ${error.message}`, "error");
          return false;
        }
      }

      const refreshed = await fetchProductContent(selectedProductId);
      if (refreshed) {
        setShowAngleModal(false);
      }
      return refreshed;
    }, editingAngle?.id ? "Angle updated" : "Angle created");
  };

  const advanceAngleStatus = async (angle) => {
    const next = ANGLE_STATUS_FLOW[angle.status];
    if (!next) return;

    await withWrite(async () => {
      const { error } = await supabase
        .from("angles")
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq("id", angle.id);

      if (error) {
        pushToast(`Could not advance angle: ${error.message}`, "error");
        return false;
      }
      return fetchProductContent(selectedProductId);
    }, `Angle moved to ${next.replace("_", " ")}`);
  };

  const killAngle = async (angle) => {
    await withWrite(async () => {
      const { error } = await supabase
        .from("angles")
        .update({ status: "killed", updated_at: new Date().toISOString() })
        .eq("id", angle.id);

      if (error) {
        pushToast(`Could not kill angle: ${error.message}`, "error");
        return false;
      }
      return fetchProductContent(selectedProductId);
    }, "Angle killed");
  };

  const openCreateBatch = () => {
    setBatchForm(emptyBatchForm());
    setShowBatchModal(true);
  };

  const createBatch = async () => {
    if (!selectedProductId) {
      pushToast("Pick a product first", "error");
      return;
    }

    await withWrite(async () => {
      const { error } = await supabase.from("filming_batches").insert({
        ...batchForm,
        product_id: selectedProductId,
        status: batchForm.status || "planned",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (error) {
        pushToast(`Could not create batch: ${error.message}`, "error");
        return false;
      }
      const refreshed = await fetchProductContent(selectedProductId);
      if (refreshed) {
        setShowBatchModal(false);
      }
      return refreshed;
    }, "Batch created");
  };

  const assignAngleToBatch = async (batchId) => {
    const angleId = assignSelection[batchId];
    if (!angleId) return;

    await withWrite(async () => {
      const { error } = await supabase
        .from("batch_angles")
        .insert({ batch_id: batchId, angle_id: angleId, filmed: false });

      if (error) {
        pushToast(`Could not assign angle: ${error.message}`, "error");
        return false;
      }
      const refreshed = await fetchProductContent(selectedProductId);
      if (refreshed) {
        setAssignSelection((prev) => ({ ...prev, [batchId]: "" }));
      }
      return refreshed;
    }, "Angle assigned to batch");
  };

  const updateBatchCompletionStatus = useCallback(async (batchId, nextBatchAngles) => {
    const inBatch = nextBatchAngles.filter((entry) => entry.batch_id === batchId);
    if (inBatch.length === 0) return true;

    const allFilmed = inBatch.every((entry) => !!entry.filmed);
    const anyFilmed = inBatch.some((entry) => !!entry.filmed);
    const nextStatus = allFilmed ? "done" : anyFilmed ? "filming" : "planned";

    const { error } = await supabase
      .from("filming_batches")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", batchId);

    if (error) {
      pushToast(`Could not update batch status: ${error.message}`, "error");
      return false;
    }
    return true;
  }, [pushToast]);

  const toggleBatchAngleFilmed = async (assignment) => {
    const nextValue = !assignment.filmed;

    await withWrite(async () => {
      const { error } = await supabase
        .from("batch_angles")
        .update({ filmed: nextValue })
        .eq("id", assignment.id);

      if (error) {
        pushToast(`Could not update filmed checkbox: ${error.message}`, "error");
        return false;
      }

      const nextBatchAngles = batchAngles.map((entry) =>
        entry.id === assignment.id ? { ...entry, filmed: nextValue } : entry
      );

      const updatedStatus = await updateBatchCompletionStatus(assignment.batch_id, nextBatchAngles);
      if (!updatedStatus) return false;

      return fetchProductContent(selectedProductId);
    }, nextValue ? "Angle marked filmed" : "Angle marked unfilmed");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#e2e8f0",
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
        padding: 20,
        boxSizing: "border-box",
      }}
    >
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
            background:
              "linear-gradient(90deg, rgba(233, 69, 96, 0), rgba(233, 69, 96, 0.95), rgba(56, 189, 248, 0.95), rgba(233, 69, 96, 0))",
            backgroundSize: "220% 100%",
            animation: "writeProgressSlide 1.1s linear infinite",
            boxShadow: "0 0 10px rgba(233, 69, 96, 0.4)",
          }}
        />
      )}

      <div
        style={{
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "0.04em", color: "#e94560" }}>
          CONTENT FACTORY
        </h2>
        <div style={{ minWidth: 280, width: 360, maxWidth: "100%" }}>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            style={inputStyle}
          >
            {products.length === 0 && <option value="">No execution-ready/live products</option>}
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.stage})
              </option>
            ))}
          </select>
        </div>
      </div>

      {isSyncing ? (
        <div
          style={{
            minHeight: "calc(100vh - 140px)",
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
              borderRadius: "50%",
              border: "2px solid rgba(148, 163, 184, 0.2)",
              borderTopColor: "#38bdf8",
              animation: "syncSpinner 0.8s linear infinite",
            }}
          />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Loading...</div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "3fr 2fr",
            gap: 14,
          }}
        >
          <section
            style={{
              background: "#0f0f1a",
              border: "1px solid #1e293b",
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, letterSpacing: "0.04em" }}>Angle Bank</h3>
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <CountBadge label="total" value={angleCounts.total} color="#334155" />
                  {ANGLE_STATUSES.map((status) => (
                    <CountBadge key={status} label={status} value={angleCounts[status]} color={angleStatusColor[status]} />
                  ))}
                </div>
              </div>
              <button style={primaryButtonStyle} onClick={openAddAngle} disabled={!selectedProductId}>
                + New Angle
              </button>
            </div>

            {!selectedProduct && (
              <div style={{ color: "#94a3b8", fontSize: 13, padding: "14px 6px" }}>
                Select an execution-ready/live product to load angles.
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
              {angles.map((angle) => {
                const nextStatus = ANGLE_STATUS_FLOW[angle.status];
                const outlier = !!(angle.outlier_trigger ?? angle.is_outlier ?? angle.outlier ?? false);
                const storeTrigger = !!(angle.store_trigger ?? angle.is_store_trigger ?? angle.store_candidate ?? false);
                return (
                  <div
                    key={angle.id}
                    style={{
                      background: "#0b1220",
                      border: "1px solid #1e293b",
                      borderRadius: 10,
                      padding: 12,
                      cursor: "pointer",
                    }}
                    onClick={() => openEditAngle(angle)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{angle.name || "Untitled angle"}</div>
                      <StatusBadge label={angle.status || "planned"} color={angleStatusColor[angle.status] || "#64748b"} />
                    </div>
                    <AngleLine label="Frame" value={angle.commercial_frame} />
                    <AngleLine label="Visual hook" value={angle.visual_hook} />
                    <AngleLine label="Text hook" value={angle.text_hook} />
                    <AngleLine label="Emotion" value={angle.emotional_target} />
                    <AngleLine label="Set" value={angle.set_location} />
                    <AngleLine label="Platform" value={angle.platform} />

                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {outlier && <StatusBadge label="Outlier" color="#f43f5e" />}
                      {storeTrigger && <StatusBadge label="Store Trigger" color="#22c55e" />}
                    </div>

                    <div
                      style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => openEditAngle(angle)}
                        style={ghostButtonStyle}
                      >
                        Edit
                      </button>
                      {nextStatus && (
                        <button
                          onClick={() => void advanceAngleStatus(angle)}
                          style={ghostButtonStyle}
                        >
                          Advance
                        </button>
                      )}
                      {angle.status !== "killed" && (
                        <button
                          onClick={() => void killAngle(angle)}
                          style={{ ...ghostButtonStyle, borderColor: "rgba(239, 68, 68, 0.4)", color: "#fca5a5" }}
                        >
                          Kill
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {selectedProduct && angles.length === 0 && (
                <div style={{ color: "#94a3b8", fontSize: 13, padding: 8 }}>No angles yet.</div>
              )}
            </div>
          </section>

          <section
            style={{
              background: "#0f0f1a",
              border: "1px solid #1e293b",
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 14, letterSpacing: "0.04em" }}>Filming Batches</h3>
              <button style={primaryButtonStyle} onClick={openCreateBatch} disabled={!selectedProductId}>
                + New Batch
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {batches.map((batch) => {
                const inBatch = batchAngles.filter((entry) => entry.batch_id === batch.id);
                const assignedIds = new Set(inBatch.map((entry) => entry.angle_id));
                const assignable = filmingReadyAngles.filter((angle) => !assignedIds.has(angle.id));

                return (
                  <div
                    key={batch.id}
                    style={{
                      background: "#0b1220",
                      border: "1px solid #1e293b",
                      borderRadius: 10,
                      padding: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{batch.name || "Unnamed batch"}</div>
                      <StatusBadge label={batch.status || "planned"} color={batchStatusColor[batch.status] || "#64748b"} />
                    </div>
                    <AngleLine label="Scheduled" value={batch.scheduled_date} />
                    <AngleLine label="Set" value={batch.set_location} />
                    <AngleLine label="Props" value={batch.props_needed} />

                    <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                      <select
                        value={assignSelection[batch.id] || ""}
                        onChange={(e) => setAssignSelection((prev) => ({ ...prev, [batch.id]: e.target.value }))}
                        style={{ ...inputStyle, padding: "8px 10px", fontSize: 12 }}
                      >
                        <option value="">Assign filming-ready angle...</option>
                        {assignable.map((angle) => (
                          <option key={angle.id} value={angle.id}>
                            {angle.name}
                          </option>
                        ))}
                      </select>
                      <button
                        style={ghostButtonStyle}
                        onClick={() => void assignAngleToBatch(batch.id)}
                        disabled={!assignSelection[batch.id]}
                      >
                        Add
                      </button>
                    </div>

                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                      {inBatch.map((entry) => {
                        const angle = anglesById[entry.angle_id];
                        return (
                          <label
                            key={entry.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                              fontSize: 12,
                              color: "#cbd5e1",
                              padding: "6px 8px",
                              border: "1px solid #1e293b",
                              borderRadius: 8,
                            }}
                          >
                            <span>{angle?.name || `Angle ${entry.angle_id}`}</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              filmed
                              <input
                                type="checkbox"
                                checked={!!entry.filmed}
                                onChange={() => void toggleBatchAngleFilmed(entry)}
                              />
                            </span>
                          </label>
                        );
                      })}
                      {inBatch.length === 0 && (
                        <div style={{ fontSize: 12, color: "#64748b" }}>No angles assigned.</div>
                      )}
                    </div>
                  </div>
                );
              })}
              {selectedProduct && batches.length === 0 && (
                <div style={{ color: "#94a3b8", fontSize: 13, padding: 8 }}>No filming batches yet.</div>
              )}
            </div>
          </section>
        </div>
      )}

      {showAngleModal && (
        <ModalShell
          title={editingAngle ? "Edit Angle" : "New Angle"}
          onClose={() => setShowAngleModal(false)}
          onConfirm={() => void saveAngle()}
          confirmLabel={editingAngle ? "Save changes" : "Create angle"}
        >
          <FieldGroup label="Name">
            <input
              value={angleForm.name}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, name: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Commercial frame">
            <input
              value={angleForm.commercial_frame}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, commercial_frame: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Visual hook">
            <input
              value={angleForm.visual_hook}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, visual_hook: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Text hook">
            <input
              value={angleForm.text_hook}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, text_hook: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Emotional target">
            <input
              value={angleForm.emotional_target}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, emotional_target: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Set location">
            <input
              value={angleForm.set_location}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, set_location: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Platform">
            <select
              value={angleForm.platform}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, platform: e.target.value }))}
              style={inputStyle}
            >
              {PLATFORM_OPTIONS.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </FieldGroup>
          <FieldGroup label="Status">
            <select
              value={angleForm.status}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, status: e.target.value }))}
              style={inputStyle}
            >
              {ANGLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </FieldGroup>
          <FieldGroup label="Notes">
            <textarea
              value={angleForm.notes}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, notes: e.target.value }))}
              style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
            />
          </FieldGroup>
          <FieldGroup label="Script">
            <textarea
              value={angleForm.script}
              onChange={(e) => setAngleForm((prev) => ({ ...prev, script: e.target.value }))}
              style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
            />
          </FieldGroup>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <ToggleButton
              active={angleForm.outlier_trigger}
              onClick={() => setAngleForm((prev) => ({ ...prev, outlier_trigger: !prev.outlier_trigger }))}
              label={angleForm.outlier_trigger ? "Outlier ON" : "Outlier OFF"}
              color="#f43f5e"
            />
            <ToggleButton
              active={angleForm.store_trigger}
              onClick={() => setAngleForm((prev) => ({ ...prev, store_trigger: !prev.store_trigger }))}
              label={angleForm.store_trigger ? "Store Trigger ON" : "Store Trigger OFF"}
              color="#22c55e"
            />
          </div>
        </ModalShell>
      )}

      {showBatchModal && (
        <ModalShell
          title="Create Batch"
          onClose={() => setShowBatchModal(false)}
          onConfirm={() => void createBatch()}
          confirmLabel="Create batch"
        >
          <FieldGroup label="Name">
            <input
              value={batchForm.name}
              onChange={(e) => setBatchForm((prev) => ({ ...prev, name: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Scheduled date">
            <input
              type="date"
              value={batchForm.scheduled_date}
              onChange={(e) => setBatchForm((prev) => ({ ...prev, scheduled_date: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Set location">
            <input
              value={batchForm.set_location}
              onChange={(e) => setBatchForm((prev) => ({ ...prev, set_location: e.target.value }))}
              style={inputStyle}
            />
          </FieldGroup>
          <FieldGroup label="Props needed">
            <textarea
              value={batchForm.props_needed}
              onChange={(e) => setBatchForm((prev) => ({ ...prev, props_needed: e.target.value }))}
              style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
            />
          </FieldGroup>
        </ModalShell>
      )}

      <div
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 3000,
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

function ModalShell({ title, onClose, onConfirm, confirmLabel, children }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.75)",
        zIndex: 2200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "min(640px, 100%)",
          maxHeight: "90vh",
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

function StatusBadge({ label, color }) {
  return (
    <span
      style={{
        background: `${color}22`,
        border: `1px solid ${color}55`,
        color,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {label}
    </span>
  );
}

function CountBadge({ label, value, color }) {
  return (
    <span
      style={{
        background: `${color}22`,
        border: `1px solid ${color}55`,
        color: "#e2e8f0",
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 10,
      }}
    >
      {label}: {value}
    </span>
  );
}

function AngleLine({ label, value }) {
  return (
    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
      <strong style={{ color: "#cbd5e1", fontWeight: 600 }}>{label}:</strong> {value || "-"}
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
