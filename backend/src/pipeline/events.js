import { EventEmitter } from "events";

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emitProgress(runId, event) {
  bus.emit(`run:${runId}`, event);
}

export function onProgress(runId, listener) {
  bus.on(`run:${runId}`, listener);
  return () => bus.removeListener(`run:${runId}`, listener);
}

export function removeAllForRun(runId) {
  bus.removeAllListeners(`run:${runId}`);
}
