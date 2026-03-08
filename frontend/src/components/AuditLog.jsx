import { useEffect, useState } from "react";
import { C } from "../constants.js";
import { Btn, ErrorBanner, Skeleton } from "./primitives.jsx";
import { getAuditLog } from "../api.js";
import Breadcrumb from "./Breadcrumb.jsx";

const PAGE_SIZE = 50;

export default function AuditLog() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => { load(); }, [page]);

  function load() {
    setLoading(true);
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (actorFilter) params.actor = actorFilter;
    if (actionFilter) params.action = actionFilter;
    if (entityTypeFilter) params.entityType = entityTypeFilter;
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;

    getAuditLog(params)
      .then(d => { setEntries(d.entries || []); setTotal(d.total || 0); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  function applyFilters() { setPage(0); load(); }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <Breadcrumb items={[{ label: "Admin", path: "/admin" }, { label: "Audit Log" }]} />
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Audit Log</h3>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMid }}>{total} entries</p>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <FilterInput label="Actor" value={actorFilter} onChange={setActorFilter} placeholder="netid..." />
        <FilterInput label="Action" value={actionFilter} onChange={setActionFilter} placeholder="e.g. review_approved" />
        <FilterInput label="Entity Type" value={entityTypeFilter} onChange={setEntityTypeFilter} placeholder="tool, user..." />
        <FilterInput label="From" value={fromDate} onChange={setFromDate} type="date" />
        <FilterInput label="To" value={toDate} onChange={setToDate} type="date" />
        <Btn size="sm" onClick={applyFilters}>Filter</Btn>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? <Skeleton height={300} /> : (
        <>
          <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div className="registry-table-header" style={{ gridTemplateColumns: "160px 100px 140px 100px 1fr" }}>
              <span>Timestamp</span><span>Actor</span><span>Action</span><span>Entity</span><span>Details</span>
            </div>
            {entries.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: C.textDim }}>No entries found.</div>
            ) : entries.map((entry, i) => (
              <div key={entry.id} className="registry-table-row"
                style={{ background: i % 2 === 0 ? "transparent" : C.surface,
                  gridTemplateColumns: "160px 100px 140px 100px 1fr", cursor: "default" }}>
                <span className="mono" style={{ fontSize: 11, color: C.textDim }}>
                  {new Date(entry.created_at).toLocaleString()}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>{entry.actor_netid}</span>
                <span style={{ fontSize: 12, color: C.textMid }}>{entry.action.replace(/_/g, " ")}</span>
                <span style={{ fontSize: 11, color: C.textDim }}>
                  {entry.entity_type}/{entry.entity_id?.slice(0, 8)}
                </span>
                <span style={{ fontSize: 11, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entry.details ? JSON.stringify(entry.details) : ""}
                </span>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16 }}>
              <Btn size="sm" variant="ghost" onClick={() => setPage(p => p - 1)} disabled={page === 0}>Prev</Btn>
              <span style={{ fontSize: 12, color: C.textMid }}>Page {page + 1} of {totalPages}</span>
              <Btn size="sm" variant="ghost" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder, type = "text" }) {
  const id = `audit-filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <label htmlFor={id} style={{ fontSize: 10, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
      <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.border}`,
          background: C.surface, color: C.text, fontSize: 12, fontFamily: "'DM Sans', sans-serif",
          width: type === "date" ? 130 : 120 }} />
    </div>
  );
}
