import { C, TRACK_COLORS, TRACK_LABELS, STATUS_META } from "../constants.js";

export function TrackBadge({ track, size = "sm" }) {
  const color = TRACK_COLORS[track];
  if (!color) return null;
  const lg = size === "lg";
  return (
    <span
      className="track-badge"
      style={{
        padding: lg ? "8px 16px" : "4px 10px",
        background: `${color}15`,
        border: `1.5px solid ${color}40`,
        color,
        fontSize: lg ? 15 : 12,
      }}
    >
      <span style={{ fontSize: lg ? 12 : 10 }}>TRACK</span> {track}
      {lg && <span style={{ fontSize: 12, fontWeight: 500, fontFamily: "var(--font-primary)", opacity: 0.85 }}> {TRACK_LABELS[track]}</span>}
    </span>
  );
}

export function Btn({ children, onClick, variant = "primary", disabled, size = "md", className = "", type = "button", fullWidth = false, ...rest }) {
  const cls = {
    primary: "button-primary",
    ghost: "button-ghost",
    subtle: "button-subtle",
    danger: "button-danger",
  }[variant] || "button-primary";
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`button ${cls} ${size === "sm" ? "button-sm" : ""} ${fullWidth ? "button-block" : ""} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return <span className="status-badge" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>;
}

export function Skeleton({ width = "100%", height = 16, radius = 8, style }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}

export function EmptyState({ icon, heading, body, action }) {
  return (
    <div className="section-card" style={{ textAlign: "center", padding: 40 }}>
      {icon ? <div style={{ display: "grid", placeItems: "center", marginBottom: 14, color: C.textDim }}>{icon}</div> : null}
      <h2 style={{ margin: 0, fontSize: 16 }}>{heading}</h2>
      {body ? <p className="body-copy" style={{ maxWidth: 480, marginInline: "auto" }}>{body}</p> : null}
      {action ? <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <div className="error-banner">
      <div>
        <strong style={{ display: "block", marginBottom: 4 }}>Something went wrong</strong>
        <span style={{ lineHeight: 1.6 }}>{message}</span>
      </div>
      {onRetry ? <Btn size="sm" variant="ghost" onClick={onRetry}>Retry</Btn> : null}
    </div>
  );
}

export function Card({ children, style, className = "", padding }) {
  return <section className={`card ${className}`.trim()} style={{ padding, ...style }}>{children}</section>;
}

export function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  );
}

export function relativeTime(dateStr) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function formatDuration(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function formatAbsoluteDate(dateStr) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
