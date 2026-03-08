import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./hooks/useAuth.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import App from "./App.jsx";
import "./styles.css";

// Apply saved theme before first paint to prevent flash
const savedTheme = localStorage.getItem("aif-theme");
if (savedTheme === "dark") document.documentElement.setAttribute("data-theme", "dark");

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>
);
