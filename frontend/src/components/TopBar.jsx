import { useState, useRef, useEffect } from "react";
import { Home, LayoutGrid, PenLine, Cpu, BookOpen, Bot, LogIn, LogOut, Moon, Sun, Settings } from "lucide-react";
import { C } from "../constants.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { navigate } from "../hooks/useHashRouter.js";
import NotificationBell from "./NotificationBell.jsx";

function activeTab(route) {
  if (route === "welcome") return "welcome";
  if (["registry", "detail"].includes(route)) return "registry";
  if (["intake", "intake-edit"].includes(route)) return "intake";
  if (["upload", "pipeline", "report"].includes(route)) return "pipeline";
  if (route === "agents") return "agents";
  if (route === "framework") return "framework";
  if (route === "admin") return "admin";
  return "welcome";
}

function getInitials(user) {
  const name = user.displayName || user.netid || "";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function UserMenu({ user, logout }) {
  const [open, setOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.getAttribute("data-theme") === "dark");
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggleDark() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("aif-theme", next ? "dark" : "light");
  }

  const initials = getInitials(user);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        aria-label="User menu" aria-expanded={open}
        style={{ width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer",
          background: C.accent, color: "#fff", fontSize: 13, fontWeight: 700,
          fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", justifyContent: "center",
          letterSpacing: 0.3, transition: "box-shadow .15s",
          boxShadow: open ? `0 0 0 2px ${C.bg}, 0 0 0 4px ${C.accent}` : "none" }}>
        {initials}
      </button>

      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 200,
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden" }}>
          {/* User info */}
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{user.displayName || user.netid}</div>
            <div style={{ fontSize: 11, color: C.textDim }}>{user.netid} &middot; {user.role}</div>
          </div>

          {/* Dark mode toggle */}
          <button type="button" onClick={toggleDark}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
              border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: C.text,
              fontFamily: "'DM Sans', sans-serif", textAlign: "left" }}
            onMouseEnter={e => e.currentTarget.style.background = C.surface}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            {darkMode ? <Sun size={14} color={C.warning} /> : <Moon size={14} color={C.textMid} />}
            {darkMode ? "Light Mode" : "Dark Mode"}
          </button>

          {/* Admin links */}
          {user.role === "admin" && (
            <div style={{ borderTop: `1px solid ${C.border}` }}>
              <MenuLink icon={<Settings size={14} />} label="Admin Dashboard" onClick={() => { setOpen(false); navigate("/admin"); }} />
            </div>
          )}

          {/* Sign out */}
          <button type="button" onClick={() => { setOpen(false); logout(); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
              border: "none", borderTop: `1px solid ${C.border}`, background: "transparent", cursor: "pointer",
              fontSize: 13, color: C.danger, fontFamily: "'DM Sans', sans-serif", textAlign: "left" }}
            onMouseEnter={e => e.currentTarget.style.background = C.dangerBg}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: C.text,
        fontFamily: "'DM Sans', sans-serif", textAlign: "left" }}
      onMouseEnter={e => e.currentTarget.style.background = C.surface}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <span style={{ color: C.textMid, display: "flex" }}>{icon}</span> {label}
    </button>
  );
}

export default function TopBar({ route, params }) {
  const { user, logout, config } = useAuth();
  const current = activeTab(route);
  const onPipelinePage = ["upload", "pipeline", "report"].includes(route);

  // Track the active tool for the Code Review tab
  const toolId = params?.toolId;
  if (onPipelinePage && toolId) {
    sessionStorage.setItem("aif-active-tool", toolId);
  }
  const savedToolId = sessionStorage.getItem("aif-active-tool");
  const pipelinePath = savedToolId ? `/upload/${savedToolId}` : null;

  const tabs = [
    { id: "welcome", path: "/welcome", label: "Home", Icon: Home },
    { id: "registry", path: "/registry", label: "Registry", Icon: LayoutGrid },
    ...(user ? [
      { id: "intake", path: "/intake", label: "Intake Form", Icon: PenLine },
      { id: "pipeline", path: pipelinePath, label: "Code Review", Icon: Cpu, disabled: !pipelinePath },
    ] : []),
    { id: "agents", path: "/agents", label: "Agents", Icon: Bot },
    { id: "framework", path: "/framework", label: "Framework", Icon: BookOpen },
  ];

  return (
    <header className="top-bar">
      <div className="top-bar-inner">
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0" }}>
          <button type="button" className="top-bar-brand" onClick={() => navigate("/welcome")}>
            <div className="top-bar-logo">UM</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>AI-Built Tool Code Intake</div>
              <div style={{ fontSize: 11, color: C.textMid }}>{config.institutionName} &middot; Enterprise IT</div>
            </div>
          </button>
        </div>

        {/* Tabs */}
        <nav style={{ display: "flex", gap: 2, flex: 1 }} aria-label="Primary navigation">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`top-bar-tab${current === tab.id ? " is-active" : ""}`}
              style={{ opacity: tab.disabled ? 0.4 : 1, cursor: tab.disabled ? "default" : "pointer" }}
              onClick={() => !tab.disabled && tab.path && navigate(tab.path)}
              aria-current={current === tab.id ? "page" : undefined}
            >
              <span style={{ fontSize: 14, display: "flex" }}><tab.Icon size={14} /></span> {tab.label}
            </button>
          ))}
        </nav>

        {/* User / Sign In */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "14px 0" }}>
          {user ? (
            <>
              <NotificationBell />
              <UserMenu user={user} logout={logout} />
            </>
          ) : (
            <button type="button" onClick={() => window.location.href = "/aif/api/auth/login"}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 16px", borderRadius: 8,
                border: "none", background: C.accent, color: "#fff", cursor: "pointer",
                fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
              <LogIn size={13} /> Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
