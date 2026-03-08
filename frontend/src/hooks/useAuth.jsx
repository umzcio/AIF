import { createContext, useContext, useState, useEffect } from "react";
import { refreshAuth, logout as apiLogout } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshAuth()
      .then((data) => {
        if (data.authenticated) setUser(data.user);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    try {
      const data = await apiLogout();
      setUser(null);
      if (data.casLogoutUrl) {
        window.location.href = data.casLogoutUrl;
      } else {
        window.location.href = "/aif/api/auth/login";
      }
    } catch {
      window.location.href = "/aif/api/auth/login";
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
