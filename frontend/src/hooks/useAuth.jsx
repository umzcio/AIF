import { createContext, useContext, useState, useEffect } from "react";
import { refreshAuth, logout as apiLogout, fetchConfig } from "../api.js";
import { APP_META } from "../constants.js";

const AuthContext = createContext(null);

const DEFAULT_CONFIG = {
  institutionName: APP_META.institutionName,
  institutionDomain: "",
  basePath: "/aif",
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  useEffect(() => {
    Promise.all([
      refreshAuth().catch(() => ({ authenticated: false })),
      fetchConfig().catch(() => null),
    ]).then(([authData, configData]) => {
      if (authData.authenticated) setUser(authData.user);
      if (configData) setConfig({ ...DEFAULT_CONFIG, ...configData });
    }).finally(() => setLoading(false));
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
    <AuthContext.Provider value={{ user, loading, logout, config }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
