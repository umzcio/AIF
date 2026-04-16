# Frontend Architecture

## Summary

The frontend is a React 19 SPA built with Vite and served as a static bundle
by the backend under `BASE_PATH` (default `/aif`). Routing is hash-based, so
the backend only needs one SPA fallback and no server-side rendering. State
management is deliberately light: a single `AuthContext`, per-component
`useState`, and a custom hash-router hook. Server communication goes through a
thin `fetch` wrapper in `frontend/src/api.js` that attaches the CSRF header on
every mutating call. Pipeline progress is streamed over Server-Sent Events via
a dedicated `usePipelineStream` hook with backoff and event-cap protection.

## Component Hierarchy

```
main.jsx
 └─ <AuthProvider>
      └─ <App>
           ├─ <ErrorBoundary>                 (class component, per-route)
           ├─ <TopBar>                        (nav tabs, user menu, bell)
           │    └─ <NotificationBell>
           └─ <main id="main-content">
                └─ <ErrorBoundary key={route}>
                     └─ renderView(route)     (one of the below)
                          ├─ <Welcome>        (#/welcome, default)
                          ├─ <Registry>       (#/registry)
                          ├─ <IntakeForm>     (#/intake, #/intake/:draftId)
                          ├─ <CodeUpload>     (#/upload/:toolId)
                          ├─ <ToolDetail>     (#/tool/:toolId)
                          │    └─ <ReviewPanel>
                          ├─ <Pipeline>       (#/tool/:toolId/pipeline/:runId)
                          ├─ <Report>         (#/tool/:toolId/report/:runId)
                          ├─ <FindingsReview> (#/review/:toolId[/:runId])
                          ├─ <AdminDashboard> (#/admin, admin-only)
                          ├─ <AgentsPage>     (#/agents)
                          └─ <FrameworkDoc>   (#/framework)
```

Primitives (`components/primitives.jsx`) are stateless: `Btn`, `Badge`,
`TrackBadge`, `StatusBadge`, `Skeleton`, `EmptyState`, `ErrorBanner`,
`relativeTime`. Toasts and confirmation dialogs live in `Toast.jsx` with a
focus trap.

## Hash Routing

`frontend/src/hooks/useHashRouter.js` defines a static table of regex patterns
and derives `{ route, params }` from `window.location.hash`.

```js
const routes = [
  { pattern: /^#\/tool\/([^/]+)\/report\/([^/]+)$/,   name: "report",   params: ["toolId","runId"] },
  { pattern: /^#\/tool\/([^/]+)\/pipeline\/([^/]+)$/, name: "pipeline", params: ["toolId","runId"] },
  { pattern: /^#\/tool\/([^/]+)$/,                     name: "detail",   params: ["toolId"]       },
  { pattern: /^#\/intake\/([^/]+)$/,                   name: "intake-edit", params: ["draftId"]   },
  { pattern: /^#\/intake$/,                            name: "intake",   params: []               },
  { pattern: /^#\/review\/([^/]+)\/([^/]+)$/,          name: "review",   params: ["toolId","runId"]},
  { pattern: /^#\/review\/([^/]+)$/,                   name: "review",   params: ["toolId"]       },
  { pattern: /^#\/upload\/([^/]+)$/,                   name: "upload",   params: ["toolId"]       },
  { pattern: /^#\/agents$/,                            name: "agents",   params: []               },
  { pattern: /^#\/framework$/,                         name: "framework",params: []               },
  { pattern: /^#\/registry$/,                          name: "registry", params: []               },
  { pattern: /^#\/admin$/,                             name: "admin",    params: []               },
];
```

A shared `navigate(path)` helper wraps `window.location.hash = ...` so
components do not touch the global. An empty hash resolves to `welcome`. Any
unmatched hash falls through to `welcome` as well.

### Route Guards

`App.jsx:63-69` enforces authentication client-side by redirecting to
`/aif/api/auth/login` when a user is missing for any of the following routes:
`intake`, `intake-edit`, `upload`, `review`, `pipeline`, `admin`, `detail`,
`report`. The server enforces the same list authoritatively — the client-side
check only avoids a flash of unauthorized UI. Admin-only access is a second
gate: `App.jsx:91-93` swaps the admin view for `<Welcome />` if `role !==
"admin"`.

## State Management

There is no Redux, Zustand, or React Query. Patterns in use:

| Scope | Mechanism | Example |
|-------|-----------|---------|
| Auth + institution config | `AuthContext` via `useAuth()` | `hooks/useAuth.jsx` |
| Route and params | `useHashRouter()` | `App.jsx:40` |
| Form drafts | `useState` + localStorage + server PUT | `IntakeForm.jsx` (5s local, 60s server) |
| Pipeline events | `usePipelineStream(runId)` | `Pipeline.jsx` |
| Lists and details | `useEffect` + `fetch` helpers | `Registry.jsx`, `ToolDetail.jsx` |
| Toasts / confirms | Imperative `toast.*` helpers | `Toast.jsx` |

`AuthContext` (`hooks/useAuth.jsx`) runs two fetches on mount in parallel:
`refreshAuth()` against `/aif/api/auth/refresh` to re-issue a fresh JWT and
read back the user, and `fetchConfig()` against `/aif/api/config` to load
institution name / domain for branding. Both failures are non-fatal — the
provider falls back to `APP_META.institutionName` from
`frontend/src/constants.js`.

## API Client

`frontend/src/api.js` exposes one private `request()` helper and dozens of
named exports (`submitIntake`, `getRegistry`, `runPipeline`, etc.). Every call
runs through the same pipeline:

1. Read `aif_csrf` cookie via `getCsrfToken()` (`api.js:13-16`).
2. `fetch` with `credentials: "same-origin"` so the browser sends
   `aif_token`.
3. Attach `x-csrf-token` header when present.
4. On 401: navigate to `/aif/api/auth/login`, throw.
5. On other !ok: parse body `{ error }` and throw.
6. On ok: return `res` (or `res.json()` for convenience exports).

Multipart uploads use `postForm()` which also appends `_csrf` to the form
body so servers that strip headers for multipart still see the token.

## Pipeline SSE Hook

`frontend/src/hooks/useSSE.js` opens `/aif/api/pipeline/:runId/stream`, parses
each `event.data` as JSON, and updates four pieces of state:

```js
{
  state,            // latest "state" event (snapshot)
  events,           // last MAX_EVENTS = 500 events
  connected,        // SSE open flag
  done,             // completed|failed|cancelled seen
  failed,           // failed|cancelled seen
  connectionLost,   // retry budget exhausted
  onPassLog(cb),    // subscribe to high-volume pass_log events
}
```

Design choices, all at `hooks/useSSE.js`:

- **Event cap**: the events array is capped at 500; older events are dropped
  (lines 6, 44). This keeps the DOM bounded for long pipeline runs.
- **Pass-log side channel**: `pass_log` events (streaming CLI stderr) bypass
  the event array and go to a `ref`-stored callback so the log panel can
  render without rerendering the full tree (lines 18-20, 38-42).
- **Retry with backoff**: exponential backoff up to `MAX_RETRIES = 3`
  (`BACKOFF_BASE = 2000` ms). After 3 failures the hook sets `connectionLost`
  and gives up (lines 58-69).
- **Terminal close**: on `status: completed|failed|cancelled`, the hook closes
  the EventSource itself so the server can free resources.

## Styling

A single `styles.css` supplies layout classes and theme tokens; per-component
styling uses inline style objects driven by a shared `C` color constant
(`constants.js`). Themes are CSS custom properties gated on
`[data-theme="dark"]`. The framework is WCAG 2.2 AA; contrast pairs
(`TRACK_COLORS`, `SEVERITY_CONFIG`, `STATUS_META`) are tuned for a 4.5:1
minimum on both light and dark backgrounds.

## Accessibility Architecture

- **Skip link**: `App.jsx:105` renders an anchor to `#main-content` that is
  visible on focus.
- **Focus on route change**: `App.jsx:44-48` focuses the `main` element after
  a route change so screen readers announce the new view.
- **Live region for route title**: `App.jsx:108-109` renders a visually hidden
  live region whose text is the current `ROUTE_META[route].title`.
- **Error boundary scoping**: `ErrorBoundary` is keyed by
  `route + JSON.stringify(params)` (`App.jsx:111`) so a thrown error in one
  view does not persist across navigation.
- **Form validation**: `IntakeForm.jsx` attaches `aria-invalid`, inline field
  messages, and focus-to-first-error on submit.

## Build and Delivery

`frontend/package.json` provides:

- `npm run dev` — Vite dev server with HMR at `localhost:5173`, proxied to
  the backend via the `BASE_PATH`.
- `npm run build` — outputs `frontend/dist/` which the backend serves as
  static assets (`server.js:125-132`).

There is no separate CDN, no image optimization step, and no server-side
rendering. The build is reproducible from a single `package-lock.json`.

## Cross-references

- Backend routing and auth gates: [backend.md](./backend.md)
- Pipeline event shapes (`pass_start`, `pass_complete`, etc.):
  [pipeline-internals.md](./pipeline-internals.md)
- CSRF token flow and cookie attributes: [security.md](./security.md)
- Auth redirect targets and logout URLs: [auth-providers.md](./auth-providers.md)
