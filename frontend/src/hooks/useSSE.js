import { useState, useEffect, useRef } from "react";
import { BASE } from "../api.js";

const MAX_RETRIES = 3;
const BACKOFF_BASE = 2000;
const MAX_EVENTS = 500;

export function usePipelineStream(runId) {
  const [state, setState] = useState(null);
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const esRef = useRef(null);
  const retriesRef = useRef(0);

  useEffect(() => {
    if (!runId) return;

    function connect() {
      const es = new EventSource(`${BASE}/pipeline/${runId}/stream`);
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setConnectionLost(false);
        retriesRef.current = 0;
      };

      es.onmessage = (e) => {
        const data = JSON.parse(e.data);
        setEvents((prev) => prev.length >= MAX_EVENTS ? [...prev.slice(-MAX_EVENTS + 1), data] : [...prev, data]);

        if (data.type === "state") {
          setState(data);
        } else if (data.type === "status" && data.status === "completed") {
          setDone(true);
          es.close();
        } else if (data.type === "status" && (data.status === "failed" || data.status === "cancelled")) {
          setFailed(true);
          setDone(true);
          es.close();
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();

        if (retriesRef.current < MAX_RETRIES) {
          const delay = BACKOFF_BASE * Math.pow(2, retriesRef.current);
          retriesRef.current += 1;
          window.setTimeout(connect, delay);
        } else {
          setConnectionLost(true);
        }
      };
    }

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      retriesRef.current = 0;
    };
  }, [runId]);

  return { state, events, connected, done, failed, connectionLost };
}
