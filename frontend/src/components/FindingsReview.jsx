import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Upload, Check } from "lucide-react";
import { C, TRACK_COLORS } from "../constants.js";
import { navigate } from "../hooks/useHashRouter.js";
import { getTool, getReport, updateToolStatus, getFindingsCsvUrl, getFindingsJsonUrl, getFindingStatuses, saveFindingStatuses } from "../api.js";
import { useToast } from "./Toast.jsx";
import { TrackBadge, Skeleton, ErrorBanner, relativeTime } from "./primitives.jsx";
import { SEV, REPORT_KEY_MAP, extractFindings, FINDING_CATEGORIES, remapFindings, buildFileTree, applyStatuses } from "./findings/utils.js";
import FindingCard from "./findings/FindingCard.jsx";
import FileTreeNode from "./findings/FileTreeNode.jsx";

export default function FindingsReview({ toolId, runId: runIdProp }) {
  const { toast } = useToast();
  const [tool, setTool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [runId, setRunId] = useState(runIdProp || null);
  const [completedRuns, setCompletedRuns] = useState([]);

  // Review state
  const [findings, setFindings] = useState({});
  const [sevFilter, setSevFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [viewMode, setViewMode] = useState("summary");
  const [selectedFile, setSelectedFile] = useState(null);
  const [submitted, setSubmitted] = useState(null);
  const [activeTreePath, setActiveTreePath] = useState(null); // A11Y-04: roving tabindex target

  // Load tool + report + saved statuses
  useEffect(() => {
    setLoading(true);
    setError(null);
    getTool(toolId)
      .then(data => {
        setTool(data.tool);
        const runs = data.runs || [];
        const completed = runs.filter(r => r.status === "completed");
        setCompletedRuns(completed);
        const targetRunId = runIdProp || null;
        const completedRun = targetRunId
          ? runs.find(r => r.id === targetRunId && r.status === "completed")
          : completed[0]; // latest completed
        if (!completedRun) {
          setLoading(false);
          return;
        }
        setRunId(completedRun.id);
        return Promise.all([
          getReport(completedRun.id),
          getFindingStatuses(toolId).catch(() => ({ statuses: {} })),
        ]).then(([reportData, { statuses: saved }]) => {
          const report = reportData.report || reportData;
          if (report?.agents) {
            let mapped = {};
            for (const [key, agentData] of Object.entries(report.agents)) {
              const id = REPORT_KEY_MAP[key] || key;
              mapped[id] = extractFindings(id, agentData);
            }
            mapped = applyStatuses(mapped, saved);
            setFindings(mapped);
          }
        });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [toolId, runIdProp]);

  // Persist finding status changes (debounced)
  const saveTimerRef = useRef(null);
  const pendingRef = useRef({});

  const handleStatusChange = useCallback((findingId, status) => {
    setFindings(prev => {
      const updated = {};
      for (const [agentId, agentFindings] of Object.entries(prev)) {
        updated[agentId] = agentFindings.map(f => f.id === findingId ? { ...f, status } : f);
      }
      return updated;
    });
    pendingRef.current[findingId] = status;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const batch = { ...pendingRef.current };
      pendingRef.current = {};
      saveFindingStatuses(toolId, batch).catch(() => {});
    }, 500);
  }, [toolId]);

  // Computed
  const displayFindings = useMemo(() => remapFindings(findings), [findings]);
  const allFindings = useMemo(() =>
    Object.entries(displayFindings).flatMap(([catId, fs]) => fs.map(f => ({ ...f, categoryId: catId }))),
    [displayFindings]);
  const filteredFindings = useMemo(() =>
    allFindings
      .filter(f => sevFilter === "all" || f.severity === sevFilter)
      .filter(f => agentFilter === "all" || f.categoryId === agentFilter)
      .sort((a, b) => (SEV[a.severity]?.order ?? 4) - (SEV[b.severity]?.order ?? 4)),
    [allFindings, sevFilter, agentFilter]);
  const stats = useMemo(() => ({
    total: allFindings.length,
    critical: allFindings.filter(f => f.severity === "critical").length,
    high: allFindings.filter(f => f.severity === "high").length,
    warning: allFindings.filter(f => f.severity === "warning").length,
    medium: allFindings.filter(f => f.severity === "medium").length,
    low: allFindings.filter(f => f.severity === "low").length,
    info: allFindings.filter(f => f.severity === "info").length,
    open: allFindings.filter(f => f.status === "open").length,
    resolved: allFindings.filter(f => f.status === "resolved").length,
    falsePositive: allFindings.filter(f => f.status === "false_positive").length,
  }), [allFindings]);
  const fileTree = useMemo(() => buildFileTree(allFindings), [allFindings]);
  // Roving tabindex target for the file tree (A11Y-04) — falls back to the
  // first top-level node until the user focuses/selects something else.
  const effectiveTreeActivePath = activeTreePath ?? (fileTree[0]?.name || null);

  // A11Y-04: ARIA APG Tree View keyboard pattern, coordinated across the
  // recursive FileTreeNode instances from this container. Collapsed subtrees
  // don't exist in the DOM, so querying `[role="treeitem"]` in DOM order gives
  // exactly the currently *visible* nodes — no separate "visible nodes" model
  // needs to be maintained.
  //   ArrowDown/ArrowUp — move focus to the next/previous visible node (no wrap).
  //   ArrowRight — on a collapsed dir: expand it, focus stays put.
  //                on an expanded dir: move focus to its first child.
  //                on a file: no-op.
  //   ArrowLeft  — on an expanded dir: collapse it, focus stays put.
  //                on a collapsed dir or a file: move focus to the parent node.
  //   Home/End   — jump to the first/last visible node.
  // Expand/collapse is triggered by calling `.click()` on the treeitem (reuses
  // FileTreeNode's own onClick/setOpen — no separate expand API needed).
  const handleTreeKeyDown = useCallback((e) => {
    const NAV_KEYS = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"];
    if (!NAV_KEYS.includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll('[role="treeitem"]'));
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement);

    const focusItem = (el) => {
      if (!el) return;
      e.preventDefault();
      el.focus();
      const p = el.dataset.path;
      if (p) setActiveTreePath(p);
    };

    switch (e.key) {
      case "ArrowDown":
        focusItem(items[Math.min(currentIndex < 0 ? 0 : currentIndex + 1, items.length - 1)]);
        break;
      case "ArrowUp":
        focusItem(items[Math.max(currentIndex < 0 ? 0 : currentIndex - 1, 0)]);
        break;
      case "Home":
        focusItem(items[0]);
        break;
      case "End":
        focusItem(items[items.length - 1]);
        break;
      case "ArrowRight": {
        if (currentIndex < 0) break;
        const el = items[currentIndex];
        const expanded = el.getAttribute("aria-expanded");
        if (expanded === "false") { e.preventDefault(); el.click(); }
        else if (expanded === "true") focusItem(items[currentIndex + 1]);
        // file (no aria-expanded): no-op
        break;
      }
      case "ArrowLeft": {
        if (currentIndex < 0) break;
        const el = items[currentIndex];
        const expanded = el.getAttribute("aria-expanded");
        if (expanded === "true") { e.preventDefault(); el.click(); }
        else {
          const groupDiv = el.closest('[role="group"]');
          const parentItem = groupDiv?.previousElementSibling;
          if (parentItem?.getAttribute("role") === "treeitem") focusItem(parentItem);
        }
        break;
      }
    }
  }, []);

  if (loading) return <div style={{ padding: 24 }}><Skeleton height={200} /></div>;
  if (error) return <div style={{ padding: 24 }}><ErrorBanner message={error} /></div>;
  if (!tool) return <div style={{ padding: 24 }}><ErrorBanner message="Tool not found" /></div>;
  if (completedRuns.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No completed runs</div>
        <div style={{ fontSize: 13, color: C.textMid, marginBottom: 16 }}>This tool has no completed pipeline runs to review.</div>
        <button onClick={() => navigate(`/tool/${toolId}`)}
          style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
            background: C.accent, color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
          Back to Tool
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Status bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{tool?.name || "Tool"}</div>
          {tool?.track && <TrackBadge track={tool.track} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {completedRuns.length > 1 && (
            <select
              value={runId || ""}
              onChange={e => navigate(`/review/${toolId}/${e.target.value}`)}
              aria-label="Select pipeline run — changes view immediately"
              style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: C.surface,
                fontSize: 12, color: C.text, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>
              {completedRuns.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {i === 0 ? "Latest" : `Run ${completedRuns.length - i}`} — {relativeTime(r.completed_at || r.queued_at)} · Track {r.track}
                </option>
              ))}
            </select>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMid }}>
            <span style={{ fontWeight: 700, color: TRACK_COLORS[4] }}>{stats.open}</span> open
            <span style={{ color: C.border }}>·</span>
            <span style={{ fontWeight: 700, color: TRACK_COLORS[1] }}>{stats.resolved}</span> resolved
          </div>
          <button type="button" onClick={() => navigate(`/upload/${toolId}`)}
            style={{ padding: "6px 14px", borderRadius: 7, border: `1px solid ${C.border}`, background: "transparent",
              cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.textMid,
              fontFamily: "'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Upload size={12} /> Re-scan
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Critical", count: stats.critical, color: SEV.critical.color },
          { label: "High", count: stats.high, color: SEV.high.color },
          { label: "Warning", count: stats.warning, color: SEV.warning.color },
          { label: "Medium", count: stats.medium, color: SEV.medium.color },
          { label: "Info", count: stats.info, color: SEV.info.color },
        ].map(s => (
          <div key={s.label} style={{ padding: "12px 16px", borderRadius: 8, background: C.surface, border: `1px solid ${C.border}`, flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.count > 0 ? s.color : C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{s.count}</div>
            <div style={{ fontSize: 11, color: C.textMid, fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* View mode tabs + filters */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[["summary","Summary"],["findings","Findings"],["files","File Tree"]].map(([v,l]) => (
            <button key={v} onClick={() => setViewMode(v)} aria-pressed={viewMode === v}
              style={{ padding: "7px 16px", borderRadius: 6, border: `1px solid ${viewMode === v ? C.accent : C.border}`,
                background: viewMode === v ? C.accentSoft : "transparent", color: viewMode === v ? C.accent : C.textMid,
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              {l}
            </button>
          ))}
        </div>
        {viewMode === "findings" && (
          <div style={{ display: "flex", gap: 4 }}>
            <select value={sevFilter} onChange={e => setSevFilter(e.target.value)} aria-label="Filter by severity"
              style={{ padding: "5px 10px", borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface,
                color: C.text, fontSize: 12, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>
              <option value="all">All severities</option>
              {Object.entries(SEV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} aria-label="Filter by category"
              style={{ padding: "5px 10px", borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface,
                color: C.text, fontSize: 12, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>
              <option value="all">All categories</option>
              {FINDING_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* VIEW: Findings */}
      {viewMode === "findings" && (
        <div>
          <div style={{ fontSize: 12, color: C.textMid, marginBottom: 12 }}>{filteredFindings.length} findings</div>
          {filteredFindings.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: C.textMid, fontSize: 14 }}>
              {allFindings.length === 0 ? "No findings data available yet." : "No findings match the current filters."}
            </div>
          ) : filteredFindings.map(f => (
            <FindingCard key={f.id} finding={f} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}

      {/* VIEW: File Tree */}
      {viewMode === "files" && (
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>
          <div style={{ padding: 12, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>
              Project Files
            </div>
            {fileTree.length > 0 ? <div role="tree" aria-label="Project files" onKeyDown={handleTreeKeyDown}>{fileTree.map((node, i) => (
              <FileTreeNode key={i} node={node} selectedFile={selectedFile}
                onSelect={f => setSelectedFile(selectedFile === f ? null : f)}
                activePath={effectiveTreeActivePath} onFocusNode={setActiveTreePath} />
            ))}</div> : (
              <div style={{ fontSize: 12, color: C.textMid }}>No file data available.</div>
            )}
          </div>
          <div>
            {selectedFile ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: C.textMid }}>Showing findings in</span>
                <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: C.accent }}>{selectedFile}</span>
                <button onClick={() => setSelectedFile(null)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: `1px solid ${C.border}`, background: "transparent", cursor: "pointer", color: C.textMid }}>Clear</button>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.textMid, marginBottom: 12 }}>Click a file to filter findings by location.</div>
            )}
            {allFindings
              .filter(f => !selectedFile || (f.file && f.file.includes(selectedFile)))
              .sort((a, b) => (SEV[a.severity]?.order ?? 4) - (SEV[b.severity]?.order ?? 4))
              .map(f => (
                <FindingCard key={f.id} finding={f} onStatusChange={handleStatusChange} />
              ))}
            {selectedFile && allFindings.filter(f => f.file && f.file.includes(selectedFile)).length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: C.textMid, fontSize: 13 }}>No findings for this file.</div>
            )}
          </div>
        </div>
      )}

      {/* VIEW: Summary */}
      {viewMode === "summary" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            {FINDING_CATEGORIES.map(cat => {
              const af = displayFindings[cat.id] || [];
              const crit = af.filter(f => f.severity === "critical").length;
              const high = af.filter(f => f.severity === "high").length;
              const open = af.filter(f => f.status === "open").length;
              const resolved = af.filter(f => f.status === "resolved" || f.status === "complete").length;
              const fp = af.filter(f => f.status === "false_positive").length;
              return (
                <div key={cat.id} style={{ padding: 20, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: `${cat.color}12` }}>
                      <cat.Icon size={18} color={cat.color} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{cat.name}</div>
                      <div style={{ fontSize: 11, color: C.textMid }}>{af.length} findings</div>
                    </div>
                  </div>
                  {af.length > 0 && (
                    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 10, background: C.border }}>
                      {["critical","high","warning","medium","info"].map(sev => {
                        const count = af.filter(f => f.severity === sev).length;
                        if (count === 0) return null;
                        return <div key={sev} style={{ width: `${(count / af.length) * 100}%`, background: SEV[sev].color }} />;
                      })}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                    {crit > 0 && <span style={{ color: SEV.critical.color, fontWeight: 700 }}>{crit} critical</span>}
                    {high > 0 && <span style={{ color: SEV.high.color, fontWeight: 700 }}>{high} high</span>}
                    <span style={{ color: C.textMid }}>{open} open</span>
                    <span style={{ color: TRACK_COLORS[1] }}>{resolved} resolved</span>
                    {fp > 0 && <span style={{ color: "#7C3AED" }}>{fp} false +</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Remediation progress */}
          <div style={{ padding: 20, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 14px" }}>Remediation Progress</h3>
            <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: C.border, marginBottom: 12 }}>
              {stats.total > 0 && stats.resolved > 0 && <div style={{ width: `${(stats.resolved / stats.total) * 100}%`, background: TRACK_COLORS[1], transition: "width .3s" }} />}
              {stats.total > 0 && stats.falsePositive > 0 && <div style={{ width: `${(stats.falsePositive / stats.total) * 100}%`, background: "#7C3AED", transition: "width .3s" }} />}
              {stats.total > 0 && allFindings.filter(f => f.status === "wontfix").length > 0 && <div style={{ width: `${(allFindings.filter(f => f.status === "wontfix").length / stats.total) * 100}%`, background: C.textDim, transition: "width .3s" }} />}
            </div>
            <div style={{ display: "flex", gap: 20, fontSize: 13, color: C.textMid }}>
              <span><span style={{ fontWeight: 700, color: TRACK_COLORS[1] }}>{stats.resolved}</span> resolved</span>
              <span><span style={{ fontWeight: 700, color: "#7C3AED" }}>{stats.falsePositive}</span> false positive</span>
              <span><span style={{ fontWeight: 700, color: C.textDim }}>{allFindings.filter(f => f.status === "wontfix").length}</span> won't fix</span>
              <span><span style={{ fontWeight: 700, color: TRACK_COLORS[4] }}>{stats.open}</span> open</span>
              <span style={{ marginLeft: "auto", fontWeight: 700, color: C.text }}>{stats.total} total findings</span>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!submitted && !["under_review", "approved", "active", "changes_requested"].includes(tool?.status) ? (
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <button onClick={async () => {
              const newStatus = (tool?.track || 3) <= 2 ? "active" : "under_review";
              if (tool?.status === newStatus) { setSubmitted(newStatus); return; }
              try {
                await updateToolStatus(toolId, newStatus);
                setSubmitted(newStatus);
              } catch (err) { toast.error(err.message); }
            }}
            style={{ padding: "13px 32px", borderRadius: 10, border: "none", cursor: "pointer",
              background: `linear-gradient(135deg, ${TRACK_COLORS[1]}, #128A42)`, color: "#fff", fontSize: 15, fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif", boxShadow: `0 4px 20px ${TRACK_COLORS[1]}35` }}>
            {(tool?.track || 3) <= 2 ? "Acknowledge Findings & Register \u2192" : "Submit for IT Review \u2192"}
          </button>
          {runId && <>
            <button onClick={() => navigate(`/tool/${toolId}/report/${runId}`)}
              style={{ padding: "13px 24px", borderRadius: 10, border: `1.5px solid ${C.border}`, cursor: "pointer",
                background: "transparent", color: C.textMid, fontSize: 14, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
              View Full Report
            </button>
            <a href={getFindingsCsvUrl(runId)} style={{ padding: "13px 18px", borderRadius: 10, border: `1.5px solid ${C.border}`,
              background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
              textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Export CSV
            </a>
            <a href={getFindingsJsonUrl(runId)} style={{ padding: "13px 18px", borderRadius: 10, border: `1.5px solid ${C.border}`,
              background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
              textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Export JSON
            </a>
          </>}
        </div>
      ) : (
        <div style={{ marginTop: 24, padding: 24, borderRadius: 12, background: C.accentSoft, border: `1px solid ${C.accent30}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Check size={20} color={C.accent} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.accent }}>
              {submitted === "active" ? "Tool Registered" : submitted ? "Submitted for IT Review"
                : tool.status === "active" ? "Tool Active" : tool.status === "approved" ? "Tool Approved" : tool.status === "under_review" ? "Under Review" : "Changes Requested"}
            </h3>
          </div>
          {submitted === "active" ? (
            <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7 }}>
              <p style={{ margin: "0 0 8px" }}><strong>{tool?.name}</strong> has been registered in the institutional registry. No further action is required.</p>
              <p style={{ margin: 0 }}>You can view your tool's status and reports anytime from the registry.</p>
            </div>
          ) : submitted ? (
            <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7 }}>
              <p style={{ margin: "0 0 8px" }}><strong>{tool?.name}</strong> has been submitted for IT security review (Track {tool?.track}).</p>
              <p style={{ margin: "0 0 8px" }}>What happens next:</p>
              <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>
                <li>An IT reviewer will be assigned to evaluate the pipeline findings</li>
                <li>You may be contacted for clarification on specific items</li>
                <li>Critical and high-severity findings must be resolved before approval</li>
                <li>You'll receive notification when the review is complete</li>
              </ol>
              <p style={{ margin: 0 }}>
                <strong>{stats.critical + stats.high}</strong> critical/high findings and <strong>{stats.warning + stats.medium}</strong> warning/medium findings were identified.
                {stats.critical + stats.high > 0 ? " Address critical and high items to expedite review." : ""}
              </p>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={() => navigate(`/tool/${toolId}`)}
              style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                background: C.accent, color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
              View Tool Details
            </button>
            <button onClick={() => navigate("/registry")}
              style={{ padding: "10px 20px", borderRadius: 8, border: `1.5px solid ${C.border}`, cursor: "pointer",
                background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
              Back to Registry
            </button>
            {runId && (
              <button onClick={() => navigate(`/tool/${toolId}/report/${runId}`)}
                style={{ padding: "10px 20px", borderRadius: 8, border: `1.5px solid ${C.border}`, cursor: "pointer",
                  background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                View Full Report
              </button>
            )}
            {runId && <>
              <a href={getFindingsCsvUrl(runId)} style={{ padding: "10px 16px", borderRadius: 8, border: `1.5px solid ${C.border}`,
                background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Export CSV
              </a>
              <a href={getFindingsJsonUrl(runId)} style={{ padding: "10px 16px", borderRadius: 8, border: `1.5px solid ${C.border}`,
                background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Export JSON
              </a>
            </>}
          </div>
        </div>
      )}
    </div>
  );
}
