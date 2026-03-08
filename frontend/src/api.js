export const BASE = "/aif/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
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

export async function getAuthStatus() {
  const res = await fetch(`${BASE}/auth/status`, { credentials: "same-origin" });
  if (!res.ok) return { authenticated: false };
  return res.json();
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
  if (file) form.append("codebase", file);
  return form;
}

async function postForm(path, form) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "same-origin", body: form });
  if (res.status === 401) { window.location.href = `${BASE}/auth/login`; throw new Error("Authentication required"); }
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Request failed: ${res.status}`); }
  return res.json();
}

async function putForm(path, form) {
  const res = await fetch(`${BASE}${path}`, { method: "PUT", credentials: "same-origin", body: form });
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

export async function deleteDraft(draftId) {
  const res = await request(`/intake/draft/${draftId}`, { method: "DELETE" });
  return res.json();
}

export async function submitTool(data, file) {
  return postForm("/intake", buildIntakeForm(data, file));
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
    xhr.send(form);
  });
}

export async function startPipelineRun(toolId, track) {
  const res = await request(`/pipeline/${toolId}/run`, {
    method: "POST",
    body: JSON.stringify({ track }),
  });
  return res.json();
}

export async function getPipelineRun(runId) {
  const res = await request(`/pipeline/${runId}`);
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
