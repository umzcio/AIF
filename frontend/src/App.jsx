import { useEffect, Component } from "react";
import { APP_META, C, ROUTE_META } from "./constants.js";
import { useAuth } from "./hooks/useAuth.jsx";
import { useHashRouter } from "./hooks/useHashRouter.js";

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, textAlign: "center" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>{this.state.error.message}</p>
          <button type="button" onClick={() => { this.setState({ error: null }); window.location.hash = "#/welcome"; }}
            style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#1A6B4B", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
            Go Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import TopBar from "./components/TopBar.jsx";
import Registry from "./components/Registry.jsx";
import IntakeForm from "./components/IntakeForm.jsx";
import CodeUpload from "./components/CodeUpload.jsx";
import FindingsReview from "./components/FindingsReview.jsx";
import ToolDetail from "./components/ToolDetail.jsx";
import Pipeline from "./components/Pipeline.jsx";
import Report from "./components/Report.jsx";
import FrameworkDoc from "./components/FrameworkDoc.jsx";
import AgentsPage from "./components/AgentsPage.jsx";
import Welcome from "./components/Welcome.jsx";
import AdminDashboard from "./components/AdminDashboard.jsx";

export default function App() {
  const { user, loading } = useAuth();
  const { route, params } = useHashRouter();

  useEffect(() => {
    const meta = ROUTE_META[route] || ROUTE_META.registry;
    document.title = `${meta.title} | ${APP_META.productName}`;
    // C1: Focus main content on route change for screen readers
    const main = document.getElementById("main-content");
    if (main) main.focus({ preventScroll: false });
  }, [route]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: C.textMid }}>
        <div style={{ textAlign: "center" }}>
          <div className="eyebrow">Preparing workspace</div>
          <h1 style={{ margin: "8px 0 0", fontSize: 18 }}>{APP_META.productName}</h1>
          <p className="body-copy">Loading...</p>
        </div>
      </div>
    );
  }

  // Routes that require authentication
  const AUTH_REQUIRED = ["intake", "intake-edit", "intake-resubmit", "upload", "review", "pipeline", "admin", "detail", "report"];
  const needsAuth = AUTH_REQUIRED.includes(route);

  if (needsAuth && !user) {
    window.location.href = "/aif/api/auth/login";
    return null;
  }

  function renderView() {
    switch (route) {
      case "welcome":
        return <Welcome />;
      case "registry":
        return <Registry />;
      case "intake":
        return <IntakeForm />;
      case "intake-edit":
        return <IntakeForm draftId={params.draftId} />;
      case "intake-resubmit":
        return <IntakeForm resubmitId={params.toolId} />;
      case "upload":
        return <CodeUpload key={`upload-${params.toolId}`} toolId={params.toolId} user={user} />;
      case "review":
        return <FindingsReview key={`review-${params.toolId}-${params.runId || ""}`} toolId={params.toolId} runId={params.runId} />;
      case "detail":
        return <ToolDetail key={params.toolId} toolId={params.toolId} />;
      case "pipeline":
        return <Pipeline toolId={params.toolId} runId={params.runId} />;
      case "report":
        return <Report key={params.runId} toolId={params.toolId} runId={params.runId} />;
      case "admin":
        if (user?.role !== "admin") return <Welcome />;
        return <AdminDashboard />;
      case "agents":
        return <AgentsPage />;
      case "framework":
        return <FrameworkDoc />;
      default:
        return <Welcome />;
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
      <TopBar route={route} params={params} />
      <main id="main-content" tabIndex={-1} className="app-main">
        <div aria-live="polite" className="sr-only">
          {(ROUTE_META[route] || ROUTE_META.registry).title}
        </div>
        <ErrorBoundary key={route + JSON.stringify(params)}>
          <div className="fade-in">
            {renderView()}
          </div>
        </ErrorBoundary>
      </main>
    </div>
  );
}
