import { useState, useEffect, useCallback } from "react";

const routes = [
  { pattern: /^#\/tool\/([^/]+)\/report\/([^/]+)$/, name: "report", params: ["toolId", "runId"] },
  { pattern: /^#\/tool\/([^/]+)\/pipeline\/([^/]+)$/, name: "pipeline", params: ["toolId", "runId"] },
  { pattern: /^#\/tool\/([^/]+)$/, name: "detail", params: ["toolId"] },
  { pattern: /^#\/intake\/([^/]+)$/, name: "intake-edit", params: ["draftId"] },
  { pattern: /^#\/intake$/, name: "intake", params: [] },
  { pattern: /^#\/welcome$/, name: "welcome", params: [] },
  { pattern: /^#\/upload\/([^/]+)$/, name: "upload", params: ["toolId"] },
  { pattern: /^#\/agents$/, name: "agents", params: [] },
  { pattern: /^#\/framework$/, name: "framework", params: [] },
  { pattern: /^#\/registry$/, name: "registry", params: [] },
];

function parseHash(hash) {
  if (!hash || hash === "#" || hash === "#/") return { route: "welcome", params: {} };
  for (const r of routes) {
    const m = hash.match(r.pattern);
    if (m) {
      const params = {};
      r.params.forEach((key, i) => { params[key] = m[i + 1]; });
      return { route: r.name, params };
    }
  }
  return { route: "welcome", params: {} };
}

export function navigate(path) {
  window.location.hash = path.startsWith("#") ? path : `#${path}`;
}

export function useHashRouter() {
  const [state, setState] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    function onHashChange() {
      setState(parseHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return state;
}
