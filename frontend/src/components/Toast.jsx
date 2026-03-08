import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { Btn } from "./primitives.jsx";

const ToastContext = createContext(null);
let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const confirmResolve = useRef(null);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 220);
  }, []);

  const addToast = useCallback((message, type = "info") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type, exiting: false }].slice(-4));
    window.setTimeout(() => removeToast(id), 4200);
    return id;
  }, [removeToast]);

  const toast = {
    success: (message) => addToast(message, "success"),
    error: (message) => addToast(message, "error"),
    info: (message) => addToast(message, "info"),
  };

  const previousFocus = useRef(null);

  const confirm = useCallback((options) => (
    new Promise((resolve) => {
      previousFocus.current = document.activeElement;
      confirmResolve.current = resolve;
      setConfirmState(options);
    })
  ), []);

  function resolveConfirm(result) {
    confirmResolve.current?.(result);
    confirmResolve.current = null;
    setConfirmState(null);
    window.setTimeout(() => {
      previousFocus.current?.focus();
      previousFocus.current = null;
    }, 0);
  }

  return (
    <ToastContext.Provider value={{ toast, confirm }}>
      {children}

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column-reverse",
          gap: 10,
          maxWidth: "min(420px, calc(100vw - 28px))",
        }}
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className="summary-card"
            style={{
              padding: "14px 16px",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              borderColor:
                item.type === "error"
                  ? "rgba(159, 45, 32, 0.3)"
                  : item.type === "success"
                    ? "rgba(22, 101, 52, 0.3)"
                    : "rgba(20, 90, 122, 0.24)",
              background:
                item.type === "error"
                  ? "rgba(251, 231, 228, 0.96)"
                  : item.type === "success"
                    ? "rgba(233, 248, 238, 0.98)"
                    : "rgba(231, 243, 248, 0.98)",
              transform: item.exiting ? "translateY(4px) scale(0.98)" : "none",
              opacity: item.exiting ? 0 : 1,
              transition: "opacity 0.18s ease, transform 0.18s ease",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 26,
                height: 26,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                background:
                  item.type === "error"
                    ? "rgba(159, 45, 32, 0.12)"
                    : item.type === "success"
                      ? "rgba(22, 101, 52, 0.12)"
                      : "rgba(20, 90, 122, 0.12)",
              }}
            >
              {item.type === "error" ? "!" : item.type === "success" ? "✓" : "i"}
            </span>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>{item.message}</div>
          </div>
        ))}
      </div>

      {confirmState ? (
        <ConfirmDialog
          {...confirmState}
          onConfirm={() => resolveConfirm(true)}
          onCancel={() => resolveConfirm(false)}
        />
      ) : null}
    </ToastContext.Provider>
  );
}

function ConfirmDialog({ title, message, destructive, confirmLabel, onConfirm, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return undefined;
    const focusable = node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Tab" && focusable.length > 1) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      style={{ position: "fixed", inset: 0, zIndex: 1100, display: "grid", placeItems: "center", padding: 16 }}
    >
      <div className="sidebar-overlay" onClick={onCancel} />
      <div ref={dialogRef} className="summary-card" style={{ position: "relative", zIndex: 1, width: "min(480px, 100%)" }}>
        <div className="eyebrow">Confirm action</div>
        <h2 id="confirm-title" style={{ margin: "8px 0 0", fontSize: 18, letterSpacing: "-0.02em" }}>{title}</h2>
        <p id="confirm-message" className="body-copy">{message}</p>
        <div className="page-actions" style={{ marginTop: 18 }}>
          <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
          <Btn variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel || (destructive ? "Confirm" : "Continue")}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
