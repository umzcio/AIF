import { C } from "../constants.js";
import { navigate } from "../hooks/useHashRouter.js";

export default function Breadcrumb({ items }) {
  if (!items || items.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {i > 0 ? (
              <svg width="12" height="12" viewBox="0 0 15 15" fill="none" style={{ color: C.textDim }} aria-hidden="true">
                <path d="M5 2l5.5 5.5L5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
            {isLast ? (
              <span style={{ color: C.textMid, fontSize: 13, fontWeight: 700 }}>{item.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => navigate(item.path)}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  color: C.textDim,
                  fontSize: 13,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                {item.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
