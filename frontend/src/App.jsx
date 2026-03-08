import { useEffect } from "react";
import { APP_META, C, ROUTE_META } from "./constants.js";
import { useAuth } from "./hooks/useAuth.jsx";
import { useHashRouter } from "./hooks/useHashRouter.js";
import TopBar from "./components/TopBar.jsx";
import Registry from "./components/Registry.jsx";
import IntakeForm from "./components/IntakeForm.jsx";
import CodeUpload from "./components/CodeUpload.jsx";
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
  const AUTH_REQUIRED = ["intake", "intake-edit", "upload", "pipeline", "admin"];
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
      case "upload":
        return <CodeUpload toolId={params.toolId} />;
      case "detail":
        return <ToolDetail toolId={params.toolId} />;
      case "pipeline":
        return <Pipeline toolId={params.toolId} runId={params.runId} />;
      case "report":
        return <Report toolId={params.toolId} runId={params.runId} />;
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
      <a className="skip-link" href="#main-content">Skip to content</a>
      <TopBar route={route} params={params} />
      <main id="main-content" className="app-main">
        <div aria-live="polite" className="sr-only">
          {(ROUTE_META[route] || ROUTE_META.registry).title}
        </div>
        <div key={route + JSON.stringify(params)} className="fade-in">
          {renderView()}
        </div>
      </main>
    </div>
  );
}
