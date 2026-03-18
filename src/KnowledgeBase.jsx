import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

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

function defaultCategoryForm() {
  return {
    name: "",
    description: "",
    icon: "📘",
    color: "#3b82f6",
    sort_order: 100,
  };
}

function defaultArticleForm(categoryId = "") {
  return {
    category_id: categoryId || "",
    title: "",
    content: "",
    tags: "",
    is_pinned: false,
    product_id: "",
    author: "Team",
    review_needed: false,
  };
}

function parseTags(tags) {
  return String(tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function firstTwoLines(content) {
  const lines = String(content || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2);
  return lines.join(" ");
}

function formatDate(dateLike) {
  if (!dateLike) return "-";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const withItalic = withBold.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return withItalic;
}

function renderMarkdown(content) {
  const source = String(content || "");
  const blocks = source.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const out = [];

  let keyIdx = 0;
  blocks.forEach((block) => {
    if (block.startsWith("```") && block.endsWith("```")) {
      const code = block.slice(3, -3).trim();
      out.push(
        <pre
          key={`md-${keyIdx++}`}
          style={{
            background: "#0b0f1a",
            border: "1px solid #1e293b",
            borderRadius: 10,
            padding: "10px 12px",
            overflowX: "auto",
            color: "#cbd5e1",
            fontSize: 12,
            lineHeight: 1.5,
            margin: "10px 0",
          }}
        >
          <code>{code}</code>
        </pre>
      );
      return;
    }

    const lines = block.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      if (trimmed === "---") {
        out.push(<hr key={`md-${keyIdx++}`} style={{ border: "none", borderTop: "1px solid #1e293b", margin: "12px 0" }} />);
        i += 1;
        continue;
      }

      if (trimmed.startsWith("## ")) {
        out.push(
          <h2
            key={`md-${keyIdx++}`}
            style={{ margin: "10px 0 6px", fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}
            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(trimmed.slice(3)) }}
          />
        );
        i += 1;
        continue;
      }

      if (trimmed.startsWith("- ")) {
        const items = [];
        while (i < lines.length && lines[i].trim().startsWith("- ")) {
          items.push(lines[i].trim().slice(2));
          i += 1;
        }
        out.push(
          <ul key={`md-${keyIdx++}`} style={{ margin: "6px 0 10px 18px", color: "#cbd5e1", fontSize: 14, lineHeight: 1.6 }}>
            {items.map((item, idx) => (
              <li key={idx} dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(item) }} />
            ))}
          </ul>
        );
        continue;
      }

      const paragraph = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        lines[i].trim() !== "---" &&
        !lines[i].trim().startsWith("## ") &&
        !lines[i].trim().startsWith("- ")
      ) {
        paragraph.push(lines[i].trim());
        i += 1;
      }
      out.push(
        <p
          key={`md-${keyIdx++}`}
          style={{ margin: "6px 0", color: "#cbd5e1", fontSize: 14, lineHeight: 1.7 }}
          dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(paragraph.join(" ")) }}
        />
      );
    }
  });

  return out;
}

export default function KnowledgeBase() {
  const [isLoading, setIsLoading] = useState(true);
  const [isWriting, setIsWriting] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [products, setProducts] = useState([]);

  const [search, setSearch] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState("all");

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState(defaultCategoryForm());

  const [showArticleModal, setShowArticleModal] = useState(false);
  const [articleForm, setArticleForm] = useState(defaultArticleForm());

  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [isEditingArticle, setIsEditingArticle] = useState(false);
  const [articleEditForm, setArticleEditForm] = useState(defaultArticleForm());

  const [showPostMortemModal, setShowPostMortemModal] = useState(false);
  const [postMortemProductId, setPostMortemProductId] = useState("");
  const [postMortemTitle, setPostMortemTitle] = useState("");
  const [postMortemContent, setPostMortemContent] = useState("");
  const [postMortemTags, setPostMortemTags] = useState("post-mortem, dead-product");
  const [postMortemAuthor, setPostMortemAuthor] = useState("Team");
  const [postMortemPinned, setPostMortemPinned] = useState(false);
  const [postMortemReviewNeeded, setPostMortemReviewNeeded] = useState(true);

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
    const [catRes, articleRes, productRes] = await Promise.all([
      supabase.from("kb_categories").select("*").order("sort_order", { ascending: true }),
      supabase.from("kb_articles").select("*").order("updated_at", { ascending: false }),
      supabase.from("products").select("*").order("updated_at", { ascending: false }),
    ]);

    if (catRes.error) pushToast(`Could not load categories: ${catRes.error.message}`, "error");
    if (articleRes.error) pushToast(`Could not load articles: ${articleRes.error.message}`, "error");
    if (productRes.error) pushToast(`Could not load products: ${productRes.error.message}`, "error");

    setCategories(catRes.data || []);
    setArticles(articleRes.data || []);
    setProducts(productRes.data || []);
    setIsLoading(false);
  }, [pushToast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchAll();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAll]);

  const categoryById = useMemo(() => {
    const map = {};
    categories.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const articleCountByCategory = useMemo(() => {
    const map = {};
    categories.forEach((c) => {
      map[c.id] = 0;
    });
    articles.forEach((a) => {
      map[a.category_id] = (map[a.category_id] || 0) + 1;
    });
    return map;
  }, [categories, articles]);

  const selectedCategory = activeCategoryId === "all" ? null : categoryById[activeCategoryId] || null;

  const filteredArticles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...articles]
      .filter((a) => {
        if (activeCategoryId !== "all" && a.category_id !== activeCategoryId) return false;
        if (!q) return true;
        const haystack = `${a.title || ""}\n${a.content || ""}\n${a.tags || ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        if (!!a.is_pinned !== !!b.is_pinned) return a.is_pinned ? -1 : 1;
        return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
      });
  }, [articles, activeCategoryId, search]);

  const selectedArticle = useMemo(
    () => articles.find((a) => a.id === selectedArticleId) || null,
    [articles, selectedArticleId]
  );

  useEffect(() => {
    if (!selectedArticleId) return;
    if (!selectedArticle) {
      setSelectedArticleId(null);
      setIsEditingArticle(false);
    }
  }, [selectedArticleId, selectedArticle]);

  const productById = useMemo(() => {
    const map = {};
    products.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [products]);

  const deadProducts = useMemo(() => {
    return products.filter((p) => p.stage === "dead");
  }, [products]);

  const postMortemCategory = useMemo(() => {
    return categories.find((c) => String(c.name || "").toLowerCase() === "product post-mortems") || null;
  }, [categories]);

  const openAddCategory = () => {
    setCategoryForm(defaultCategoryForm());
    setShowCategoryModal(true);
  };

  const saveCategory = async () => {
    await withWrite(async () => {
      const payload = {
        ...categoryForm,
        sort_order: Number(categoryForm.sort_order || 0),
      };
      const { error } = await supabase.from("kb_categories").insert(payload);
      if (error) {
        pushToast(`Could not create category: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      setShowCategoryModal(false);
      return true;
    }, "Category created");
  };

  const openAddArticle = () => {
    const pre = activeCategoryId !== "all" ? activeCategoryId : categories[0]?.id || "";
    setArticleForm(defaultArticleForm(pre));
    setShowArticleModal(true);
  };

  const saveNewArticle = async () => {
    await withWrite(async () => {
      const payload = {
        ...articleForm,
        product_id: articleForm.product_id || null,
        author: articleForm.author || "Team",
      };
      const { error } = await supabase.from("kb_articles").insert(payload);
      if (error) {
        pushToast(`Could not create article: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      setShowArticleModal(false);
      return true;
    }, "Article created");
  };

  const openArticleView = (article) => {
    setSelectedArticleId(article.id);
    setIsEditingArticle(false);
  };

  const startEditArticle = () => {
    if (!selectedArticle) return;
    setArticleEditForm({
      category_id: selectedArticle.category_id || "",
      title: selectedArticle.title || "",
      content: selectedArticle.content || "",
      tags: selectedArticle.tags || "",
      is_pinned: !!selectedArticle.is_pinned,
      product_id: selectedArticle.product_id || "",
      author: selectedArticle.author || "Team",
      review_needed: !!selectedArticle.review_needed,
    });
    setIsEditingArticle(true);
  };

  const saveArticleEdit = async () => {
    if (!selectedArticle?.id) return;
    await withWrite(async () => {
      const payload = {
        ...articleEditForm,
        product_id: articleEditForm.product_id || null,
        author: articleEditForm.author || "Team",
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("kb_articles").update(payload).eq("id", selectedArticle.id);
      if (error) {
        pushToast(`Could not update article: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      setIsEditingArticle(false);
      return true;
    }, "Article updated");
  };

  const deleteArticle = async () => {
    if (!selectedArticle?.id) return;
    if (!window.confirm("Delete this article? This cannot be undone.")) return;
    await withWrite(async () => {
      const { error } = await supabase.from("kb_articles").delete().eq("id", selectedArticle.id);
      if (error) {
        pushToast(`Could not delete article: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      setSelectedArticleId(null);
      setIsEditingArticle(false);
      return true;
    }, "Article deleted");
  };

  const markArticleReviewed = async () => {
    if (!selectedArticle?.id) return;
    await withWrite(async () => {
      const { error } = await supabase
        .from("kb_articles")
        .update({
          review_needed: false,
          last_reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedArticle.id);
      if (error) {
        pushToast(`Could not mark reviewed: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      return true;
    }, "Article marked as reviewed");
  };

  const openPostMortemModal = () => {
    setPostMortemProductId("");
    setPostMortemTitle("");
    setPostMortemContent("");
    setPostMortemTags("post-mortem, dead-product");
    setPostMortemAuthor("Team");
    setPostMortemPinned(false);
    setPostMortemReviewNeeded(true);
    setShowPostMortemModal(true);
  };

  useEffect(() => {
    if (!postMortemProductId) return;
    const p = deadProducts.find((d) => d.id === postMortemProductId);
    if (!p) return;
    const template = `## Product: ${p.name || "[product name]"}
**Killed at stage:** ${p.killed_at_stage || "-"}
**Kill reason:** ${p.kill_reason || "-"}
**Score:** ${p.score_total ?? "N/A"}/100
**Entry:** ${p.score_entry_opportunity ?? "-"} | **Organic:** ${p.score_organic_fit ?? "-"} | **Business:** ${p.score_business_quality ?? "-"} | **Lane:** ${p.score_lane_strength ?? "-"}

### What happened
[fill in]

### Why it failed
[fill in]

### What we would do differently
[fill in]

### Lessons for future product selection
[fill in]`;
    setPostMortemTitle(`${p.name || "Product"} — Post-Mortem`);
    setPostMortemContent(template);
  }, [postMortemProductId, deadProducts]);

  const savePostMortem = async () => {
    if (!postMortemCategory?.id) {
      pushToast("Post-mortem category not found.", "error");
      return;
    }
    await withWrite(async () => {
      const payload = {
        category_id: postMortemCategory.id,
        title: postMortemTitle || "Untitled Post-Mortem",
        content: postMortemContent,
        tags: postMortemTags,
        is_pinned: postMortemPinned,
        product_id: postMortemProductId || null,
        author: postMortemAuthor || "Team",
        review_needed: postMortemReviewNeeded,
      };
      const { error } = await supabase.from("kb_articles").insert(payload);
      if (error) {
        pushToast(`Could not create post-mortem: ${error.message}`, "error");
        return false;
      }
      await fetchAll();
      setShowPostMortemModal(false);
      if (postMortemCategory?.id) {
        setActiveCategoryId(postMortemCategory.id);
      }
      return true;
    }, "Post-mortem article created");
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
            zIndex: 3200,
            background:
              "linear-gradient(90deg, rgba(233,69,96,0), rgba(233,69,96,0.95), rgba(56,189,248,0.95), rgba(233,69,96,0))",
            backgroundSize: "220% 100%",
            animation: "writeProgressSlide 1.1s linear infinite",
            boxShadow: "0 0 10px rgba(233,69,96,0.45)",
          }}
        />
      )}

      <div style={{ marginBottom: 10, color: "#e94560", fontWeight: 800, letterSpacing: "0.05em", fontSize: 14 }}>
        KNOWLEDGE BASE
      </div>

      {isLoading ? (
        <div style={{ minHeight: "65vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12 }}>
          {/* Sidebar */}
          <aside style={{ background: "#0f0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)" }}>
            <input
              placeholder="Search title, content, tags..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, marginBottom: 10 }}
            />

            <button
              onClick={() => setActiveCategoryId("all")}
              style={{
                ...categoryItemStyle(activeCategoryId === "all", "#64748b"),
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 13 }}>📚</span>
              <span style={{ flex: 1, textAlign: "left", fontSize: 12, fontWeight: 700 }}>All Articles</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{articles.length}</span>
            </button>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", paddingRight: 2 }}>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategoryId(cat.id)}
                  style={categoryItemStyle(activeCategoryId === cat.id, cat.color || "#64748b")}
                >
                  <span style={{ fontSize: 13 }}>{cat.icon || "📘"}</span>
                  <span style={{ flex: 1, textAlign: "left", fontSize: 12, fontWeight: 700 }}>
                    {cat.name}
                  </span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{articleCountByCategory[cat.id] || 0}</span>
                </button>
              ))}
            </div>

            <div style={{ marginTop: "auto", paddingTop: 10 }}>
              <button style={primaryButtonStyle} onClick={openAddCategory}>
                + Add Category
              </button>
            </div>
          </aside>

          {/* Main */}
          <main style={{ background: "#0f0f1a", border: "1px solid #1e293b", borderRadius: 12, padding: 14 }}>
            {!selectedArticle && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>
                      {selectedCategory ? (
                        <>
                          <span style={{ marginRight: 8 }}>{selectedCategory.icon || "📘"}</span>
                          {selectedCategory.name}
                        </>
                      ) : (
                        "All Articles"
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                      {selectedCategory?.description || "Browse doctrine, SOPs, lessons learned, and post-mortems."}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      {filteredArticles.length} article{filteredArticles.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {selectedCategory?.id === postMortemCategory?.id && (
                      <button style={ghostButtonStyle} onClick={openPostMortemModal}>
                        Generate Post-Mortem from Dead Product
                      </button>
                    )}
                    <button style={primaryButtonStyle} onClick={openAddArticle}>
                      + Add Article
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {filteredArticles.map((article) => {
                    const tags = parseTags(article.tags);
                    const linkedProduct = article.product_id ? productById[article.product_id]?.name : null;
                    return (
                      <button
                        key={article.id}
                        onClick={() => openArticleView(article)}
                        style={{
                          textAlign: "left",
                          border: "1px solid #1e293b",
                          background: "#0b1220",
                          color: "#e2e8f0",
                          borderRadius: 10,
                          padding: "10px 12px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>
                            {article.is_pinned && <span style={{ marginRight: 6 }}>📌</span>}
                            {article.title || "Untitled article"}
                          </div>
                          {article.review_needed && (
                            <span style={{ border: "1px solid #f59e0b66", background: "#f59e0b20", color: "#fcd34d", fontSize: 10, borderRadius: 999, padding: "2px 8px" }}>
                              Review needed
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
                          {firstTwoLines(article.content) || "No content yet."}
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {tags.map((tag) => (
                            <span key={tag} style={tagStyle}>{tag}</span>
                          ))}
                          {linkedProduct && <span style={{ ...tagStyle, borderColor: "#22c55e55", background: "#22c55e1a", color: "#86efac" }}>Product: {linkedProduct}</span>}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 10, color: "#64748b" }}>
                          Updated: {formatDate(article.updated_at)}
                        </div>
                      </button>
                    );
                  })}
                  {filteredArticles.length === 0 && (
                    <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 2px" }}>No articles found.</div>
                  )}
                </div>
              </>
            )}

            {selectedArticle && !isEditingArticle && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button style={ghostButtonStyle} onClick={() => setSelectedArticleId(null)}>← Back</button>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>
                      {selectedArticle.is_pinned && <span style={{ marginRight: 6 }}>📌</span>}
                      {selectedArticle.title || "Untitled article"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={ghostButtonStyle} onClick={startEditArticle}>Edit</button>
                    <button style={ghostButtonStyle} onClick={() => void markArticleReviewed()}>
                      Mark as Reviewed
                    </button>
                    <button style={{ ...ghostButtonStyle, borderColor: "#ef444466", color: "#fca5a5" }} onClick={() => void deleteArticle()}>
                      Delete
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
                  Author: {selectedArticle.author || "Team"} • Updated: {formatDate(selectedArticle.updated_at)} • Last reviewed: {formatDate(selectedArticle.last_reviewed_at)}
                </div>

                <div style={{ marginBottom: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {parseTags(selectedArticle.tags).map((tag) => (
                    <span key={tag} style={tagStyle}>{tag}</span>
                  ))}
                  {selectedArticle.product_id && (
                    <span style={{ ...tagStyle, borderColor: "#22c55e55", background: "#22c55e1a", color: "#86efac" }}>
                      Linked product: {productById[selectedArticle.product_id]?.name || selectedArticle.product_id}
                    </span>
                  )}
                </div>

                <article style={{ border: "1px solid #1e293b", borderRadius: 10, padding: 14, background: "#0b1220" }}>
                  {renderMarkdown(selectedArticle.content)}
                </article>
              </div>
            )}

            {selectedArticle && isEditingArticle && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>Edit Article</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={ghostButtonStyle} onClick={() => setIsEditingArticle(false)}>Cancel</button>
                    <button style={primaryButtonStyle} onClick={() => void saveArticleEdit()}>Save</button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <FieldGroup label="Category">
                    <select value={articleEditForm.category_id} onChange={(e) => setArticleEditForm((p) => ({ ...p, category_id: e.target.value }))} style={inputStyle}>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </FieldGroup>
                  <FieldGroup label="Title">
                    <input value={articleEditForm.title} onChange={(e) => setArticleEditForm((p) => ({ ...p, title: e.target.value }))} style={inputStyle} />
                  </FieldGroup>
                </div>
                <FieldGroup label="Content (Markdown)">
                  <textarea value={articleEditForm.content} onChange={(e) => setArticleEditForm((p) => ({ ...p, content: e.target.value }))} style={{ ...inputStyle, minHeight: 300, resize: "vertical" }} />
                </FieldGroup>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <FieldGroup label="Tags (comma-separated)">
                    <input value={articleEditForm.tags} onChange={(e) => setArticleEditForm((p) => ({ ...p, tags: e.target.value }))} style={inputStyle} />
                  </FieldGroup>
                  <FieldGroup label="Product link (optional)">
                    <select value={articleEditForm.product_id} onChange={(e) => setArticleEditForm((p) => ({ ...p, product_id: e.target.value }))} style={inputStyle}>
                      <option value="">No linked product</option>
                      {products.map((prod) => <option key={prod.id} value={prod.id}>{prod.name}</option>)}
                    </select>
                  </FieldGroup>
                  <FieldGroup label="Author">
                    <input value={articleEditForm.author} onChange={(e) => setArticleEditForm((p) => ({ ...p, author: e.target.value }))} style={inputStyle} />
                  </FieldGroup>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <ToggleButton active={articleEditForm.is_pinned} onClick={() => setArticleEditForm((p) => ({ ...p, is_pinned: !p.is_pinned }))} label={articleEditForm.is_pinned ? "Pinned" : "Not pinned"} color="#eab308" />
                  <ToggleButton active={articleEditForm.review_needed} onClick={() => setArticleEditForm((p) => ({ ...p, review_needed: !p.review_needed }))} label={articleEditForm.review_needed ? "Review needed" : "Review not needed"} color="#f59e0b" />
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {showCategoryModal && (
        <ModalShell title="Add Category" onClose={() => setShowCategoryModal(false)} onConfirm={() => void saveCategory()} confirmLabel="Create category">
          <FieldGroup label="Name">
            <input value={categoryForm.name} onChange={(e) => setCategoryForm((p) => ({ ...p, name: e.target.value }))} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label="Description">
            <textarea value={categoryForm.description} onChange={(e) => setCategoryForm((p) => ({ ...p, description: e.target.value }))} style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} />
          </FieldGroup>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <FieldGroup label="Icon (emoji)">
              <input value={categoryForm.icon} onChange={(e) => setCategoryForm((p) => ({ ...p, icon: e.target.value }))} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="Color (hex)">
              <input value={categoryForm.color} onChange={(e) => setCategoryForm((p) => ({ ...p, color: e.target.value }))} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="Sort Order">
              <input type="number" value={categoryForm.sort_order} onChange={(e) => setCategoryForm((p) => ({ ...p, sort_order: e.target.value }))} style={inputStyle} />
            </FieldGroup>
          </div>
        </ModalShell>
      )}

      {showArticleModal && (
        <ModalShell title="Add Article" onClose={() => setShowArticleModal(false)} onConfirm={() => void saveNewArticle()} confirmLabel="Create article">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Category">
              <select value={articleForm.category_id} onChange={(e) => setArticleForm((p) => ({ ...p, category_id: e.target.value }))} style={inputStyle}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FieldGroup>
            <FieldGroup label="Title (required)">
              <input value={articleForm.title} onChange={(e) => setArticleForm((p) => ({ ...p, title: e.target.value }))} style={inputStyle} />
            </FieldGroup>
          </div>
          <FieldGroup label="Content">
            <textarea
              value={articleForm.content}
              onChange={(e) => setArticleForm((p) => ({ ...p, content: e.target.value }))}
              placeholder="Write in markdown..."
              style={{ ...inputStyle, minHeight: 260, resize: "vertical" }}
            />
          </FieldGroup>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <FieldGroup label="Tags">
              <input value={articleForm.tags} onChange={(e) => setArticleForm((p) => ({ ...p, tags: e.target.value }))} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="Link to product (optional)">
              <select value={articleForm.product_id} onChange={(e) => setArticleForm((p) => ({ ...p, product_id: e.target.value }))} style={inputStyle}>
                <option value="">No linked product</option>
                {products.map((prod) => <option key={prod.id} value={prod.id}>{prod.name}</option>)}
              </select>
            </FieldGroup>
            <FieldGroup label="Author">
              <input value={articleForm.author} onChange={(e) => setArticleForm((p) => ({ ...p, author: e.target.value }))} style={inputStyle} />
            </FieldGroup>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <ToggleButton active={articleForm.is_pinned} onClick={() => setArticleForm((p) => ({ ...p, is_pinned: !p.is_pinned }))} label={articleForm.is_pinned ? "Pinned" : "Pin to top"} color="#eab308" />
            <ToggleButton active={articleForm.review_needed} onClick={() => setArticleForm((p) => ({ ...p, review_needed: !p.review_needed }))} label={articleForm.review_needed ? "Review needed" : "Review not needed"} color="#f59e0b" />
          </div>
        </ModalShell>
      )}

      {showPostMortemModal && (
        <ModalShell title="Generate Post-Mortem from Dead Product" onClose={() => setShowPostMortemModal(false)} onConfirm={() => void savePostMortem()} confirmLabel="Create post-mortem">
          <FieldGroup label="Dead product">
            <select value={postMortemProductId} onChange={(e) => setPostMortemProductId(e.target.value)} style={inputStyle}>
              <option value="">Select dead product</option>
              {deadProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </FieldGroup>
          <FieldGroup label="Title">
            <input value={postMortemTitle} onChange={(e) => setPostMortemTitle(e.target.value)} style={inputStyle} />
          </FieldGroup>
          <FieldGroup label="Content">
            <textarea value={postMortemContent} onChange={(e) => setPostMortemContent(e.target.value)} style={{ ...inputStyle, minHeight: 320, resize: "vertical" }} />
          </FieldGroup>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FieldGroup label="Tags">
              <input value={postMortemTags} onChange={(e) => setPostMortemTags(e.target.value)} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="Author">
              <input value={postMortemAuthor} onChange={(e) => setPostMortemAuthor(e.target.value)} style={inputStyle} />
            </FieldGroup>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <ToggleButton active={postMortemPinned} onClick={() => setPostMortemPinned((v) => !v)} label={postMortemPinned ? "Pinned" : "Pin to top"} color="#eab308" />
            <ToggleButton active={postMortemReviewNeeded} onClick={() => setPostMortemReviewNeeded((v) => !v)} label={postMortemReviewNeeded ? "Review needed" : "Review not needed"} color="#f59e0b" />
          </div>
        </ModalShell>
      )}

      <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 4200, display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} />
        ))}
      </div>
    </div>
  );
}

function ModalShell({ title, onClose, onConfirm, confirmLabel, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(2, 6, 23, 0.78)", zIndex: 3300, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
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
    <div style={{ background: isSuccess ? "rgba(22, 163, 74, 0.92)" : "rgba(185, 28, 28, 0.92)", border: `1px solid ${isSuccess ? "rgba(74, 222, 128, 0.45)" : "rgba(252, 165, 165, 0.45)"}`, color: "#f8fafc", borderRadius: 10, padding: "10px 12px", fontSize: 12, fontWeight: 600, boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)" }}>
      {message}
    </div>
  );
}

function categoryItemStyle(active, color) {
  return {
    border: active ? `1px solid ${color}88` : "1px solid #1e293b",
    background: active ? `${color}22` : "#0b1220",
    color: "#e2e8f0",
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

const tagStyle = {
  border: "1px solid #334155",
  background: "#111827",
  color: "#cbd5e1",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 10,
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
