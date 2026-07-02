export const BASE = "/aif/api";

export async function fetchConfig() {
  try {
    const res = await fetch(`${BASE}/config`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function getCsrfToken() {
  const match = document.cookie.split("; ").find(c => c.startsWith("aif_csrf="));
  return match ? match.split("=")[1] : "";
}

async function request(path, options = {}) {
  const csrf = getCsrfToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}), ...options.headers },
    credentials: "same-origin",
    ...options,
  });
  if (res.status === 401) {
    window.location.href = `${BASE}/auth/login`;
    throw new Error("Authentication required");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res;
}

export async function logout() {
  const res = await request("/auth/logout", { method: "POST" });
  return res.json();
}

function buildIntakeForm(data, file) {
  const form = new FormData();
  if (data.draftId) form.append("draftId", data.draftId);
  form.append("name", data.name);
  if (data.description) form.append("description", data.description);
  form.append("submissionType", data.submissionType || "new");
  if (data.artifactType) form.append("artifactType", data.artifactType);
  if (data.intakeAnswers) form.append("intakeAnswers", JSON.stringify(data.intakeAnswers));
  if (data.codebaseUrl) form.append("codebaseUrl", data.codebaseUrl);
  if (data.sandbox) form.append("sandbox", "true");
  if (file) form.append("codebase", file);
  return form;
}

async function postForm(path, form) {
  const csrf = getCsrfToken();
  form.append("_csrf", csrf);
  const res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "same-origin", body: form, headers: csrf ? { "x-csrf-token": csrf } : {} });
  if (res.status === 401) { window.location.href = `${BASE}/auth/login`; throw new Error("Authentication required"); }
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Request failed: ${res.status}`); }
  return res.json();
}

async function putForm(path, form) {
  const csrf = getCsrfToken();
  form.append("_csrf", csrf);
  const res = await fetch(`${BASE}${path}`, { method: "PUT", credentials: "same-origin", body: form, headers: csrf ? { "x-csrf-token": csrf } : {} });
  if (res.status === 401) { window.location.href = `${BASE}/auth/login`; throw new Error("Authentication required"); }
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Request failed: ${res.status}`); }
  return res.json();
}

export async function submitIntake(data, file) {
  return postForm("/intake", buildIntakeForm(data, file));
}

export async function saveDraft(data, file) {
  return postForm("/intake/draft", buildIntakeForm(data, file));
}

export async function updateDraft(draftId, data, file) {
  return putForm(`/intake/draft/${draftId}`, buildIntakeForm(data, file));
}

export async function resubmitIntake(toolId, data, file) {
  return postForm(`/intake/${toolId}/resubmit`, buildIntakeForm(data, file));
}

export async function deleteDraft(draftId) {
  const res = await request(`/intake/draft/${draftId}`, { method: "DELETE" });
  return res.json();
}

export async function getTools(params = {}) {
  const qs = new URLSearchParams();
  if (params.track) qs.set("track", params.track);
  if (params.status) qs.set("status", params.status);
  if (params.page) qs.set("page", params.page);
  if (params.limit) qs.set("limit", params.limit);
  const res = await request(`/registry?${qs}`);
  return res.json();
}

export async function getTool(id) {
  const res = await request(`/registry/${id}`);
  return res.json();
}

export async function deleteTool(id) {
  const res = await request(`/registry/${id}`, { method: "DELETE" });
  return res.json();
}

export async function updateTool(id, data) {
  const res = await request(`/registry/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function toggleSandbox(id, sandbox) {
  const res = await request(`/registry/${id}/sandbox`, {
    method: "PATCH",
    body: JSON.stringify({ sandbox }),
  });
  return res.json();
}

export async function updateToolStatus(id, status) {
  const res = await request(`/registry/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return res.json();
}

export function uploadCodebase(toolId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/pipeline/${toolId}/upload`);
    xhr.withCredentials = true;
    const csrf = getCsrfToken();
    if (csrf) xhr.setRequestHeader("x-csrf-token", csrf);

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress({ loaded: e.loaded, total: e.total });
      });
    }

    xhr.onload = () => {
      if (xhr.status === 401) { window.location.href = `${BASE}/auth/login`; reject(new Error("Authentication required")); return; }
      let body;
      try { body = JSON.parse(xhr.responseText); } catch { body = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Upload failed: ${xhr.status}`));
    };

    xhr.onerror = () => reject(new Error("Upload failed: network error"));

    const form = new FormData();
    form.append("codebase", file);
    form.append("_csrf", getCsrfToken());
    xhr.send(form);
  });
}

export async function startPipelineRun(toolId, mode) {
  const body = {};
  if (mode) body.mode = mode;
  const res = await request(`/pipeline/${toolId}/run`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function getPipelineRun(runId) {
  const res = await request(`/pipeline/${runId}`);
  return res.json();
}

export async function cancelPipelineRun(runId) {
  const res = await request(`/pipeline/${runId}/cancel`, { method: "POST" });
  return res.json();
}

export async function retryPipelineRun(runId) {
  const res = await request(`/pipeline/${runId}/retry`, { method: "POST" });
  return res.json();
}

export async function getReport(runId) {
  const res = await request(`/reports/${runId}`);
  return res.json();
}

export function getHecvatDownloadUrl(runId) {
  return `${BASE}/reports/${runId}/hecvat.xlsx`;
}

export function getDocDownloadUrl(runId, docName) {
  // Request base name — backend serves .docx if available, .md as fallback
  const baseName = docName.replace(/\.(md|docx)$/, "");
  return `${BASE}/reports/${runId}/docs/${baseName}.docx`;
}

export function getFindingsJsonUrl(runId) {
  return `${BASE}/reports/${runId}/findings.json`;
}

export function getFindingsCsvUrl(runId) {
  return `${BASE}/reports/${runId}/findings.csv`;
}

// Finding statuses
export async function getFindingStatuses(toolId) {
  const res = await request(`/reports/tools/${toolId}/finding-statuses`);
  return res.json();
}

export async function saveFindingStatuses(toolId, statuses) {
  const res = await request(`/reports/tools/${toolId}/finding-statuses`, {
    method: "PUT",
    body: JSON.stringify({ statuses }),
  });
  return res.json();
}

// Auth
export async function refreshAuth() {
  const res = await fetch(`${BASE}/auth/refresh`, { credentials: "same-origin" });
  if (!res.ok) return { authenticated: false };
  return res.json();
}

// Review
export async function getReviewNotes(toolId) {
  const res = await request(`/review/${toolId}/notes`);
  return res.json();
}

export async function addReviewNote(toolId, body) {
  const res = await request(`/review/${toolId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  return res.json();
}

export async function submitReviewDecision(toolId, decision, notes) {
  const res = await request(`/review/${toolId}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, notes }),
  });
  return res.json();
}

export async function overrideTrack(toolId, newTrack, reason) {
  const res = await request(`/review/${toolId}/track-override`, {
    method: "POST",
    body: JSON.stringify({ newTrack, reason }),
  });
  return res.json();
}

export async function selfCertify(toolId, payload) {
  const res = await request(`/review/${toolId}/self-certify`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function activateTool(toolId) {
  const res = await request(`/review/${toolId}/activate`, { method: "POST" });
  return res.json();
}

// Notifications
export async function getNotifications(params = {}) {
  const qs = new URLSearchParams();
  if (params.unread) qs.set("unread", "true");
  if (params.limit) qs.set("limit", params.limit);
  if (params.offset) qs.set("offset", params.offset);
  const res = await request(`/notifications?${qs}`);
  return res.json();
}

export async function markNotificationsRead(ids) {
  const res = await request("/notifications/read", {
    method: "PATCH",
    body: JSON.stringify({ ids }),
  });
  return res.json();
}

export async function getNotificationPreferences() {
  const res = await request("/notifications/preferences");
  return res.json();
}

export async function updateNotificationPreferences(prefs) {
  const res = await request("/notifications/preferences", {
    method: "PATCH",
    body: JSON.stringify(prefs),
  });
  return res.json();
}

export async function updateEmail(email) {
  const res = await request("/notifications/email", {
    method: "PATCH",
    body: JSON.stringify({ email }),
  });
  return res.json();
}

// Analytics
export async function getAnalyticsOverview(days = 90) {
  const res = await request(`/analytics/overview?days=${days}`);
  return res.json();
}

export async function getAnalyticsModel(modelName, params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", params.limit);
  if (params.offset) qs.set("offset", params.offset);
  const res = await request(`/analytics/model/${encodeURIComponent(modelName)}?${qs}`);
  return res.json();
}

export async function getAnalyticsRun(runId) {
  const res = await request(`/analytics/run/${runId}`);
  return res.json();
}

export async function getAnalyticsTrends(days = 30) {
  const res = await request(`/analytics/trends?days=${days}`);
  return res.json();
}

export async function getAnalyticsReview() {
  const res = await request(`/analytics/review`);
  return res.json();
}

export async function getAnalyticsDistribution() {
  const res = await request(`/analytics/distribution`);
  return res.json();
}

// Admin
export async function getAdminDashboard() {
  const res = await request("/admin/dashboard");
  return res.json();
}

export async function getUsers() {
  const res = await request("/admin/users");
  return res.json();
}

export async function updateUserRole(userId, role) {
  const res = await request(`/admin/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  return res.json();
}

export async function toggleUserActive(userId, active) {
  const res = await request(`/admin/users/${userId}/active`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
  return res.json();
}

export async function getAuditLog(params = {}) {
  const qs = new URLSearchParams();
  if (params.actor) qs.set("actor", params.actor);
  if (params.entityType) qs.set("entityType", params.entityType);
  if (params.action) qs.set("action", params.action);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.limit) qs.set("limit", params.limit);
  if (params.offset) qs.set("offset", params.offset);
  const res = await request(`/admin/audit?${qs}`);
  return res.json();
}
