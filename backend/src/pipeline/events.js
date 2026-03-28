import { EventEmitter } from "events";

const bus = new EventEmitter();
bus.setMaxListeners(100);

// In-memory tool state cache per run (survives SSE reconnects, lost on server restart)
const toolStatesByRun = new Map();

export function emitProgress(runId, event) {
  // Track tool states in memory for SSE catch-up
  if (event.type === "tool_start") {
    if (!toolStatesByRun.has(runId)) toolStatesByRun.set(runId, {});
    toolStatesByRun.get(runId)[event.tool] = { status: "running", target: event.target };
  } else if (event.type === "tool_complete") {
    if (!toolStatesByRun.has(runId)) toolStatesByRun.set(runId, {});
    toolStatesByRun.get(runId)[event.tool] = {
      status: event.skipped ? "skipped" : "complete",
      target: event.target, elapsed: event.elapsed,
      findings: event.findings || 0, error: event.error,
    };
  }
  bus.emit(`run:${runId}`, event);
}

export function getToolStates(runId) {
  return toolStatesByRun.get(runId) || null;
}

export function onProgress(runId, listener) {
  bus.on(`run:${runId}`, listener);
  return () => bus.removeListener(`run:${runId}`, listener);
}

export function removeAllForRun(runId) {
  bus.removeAllListeners(`run:${runId}`);
  toolStatesByRun.delete(runId);
}
