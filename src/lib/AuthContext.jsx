import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';

const AuthContext = createContext();

const STORAGE_KEY = 'cockpit_user';

// ─── Utilisateurs hardcodés (en attendant Supabase Auth complet) ─────────────
// Pour la prod : remplacer par un vrai appel API Supabase
const DEMO_USERS = [
  {
    id: "1",
    email: "julien.pagin.pv@gmail.com",
    password: "Julien2026!",
    full_name: "Julien Pagin",
    role: "superadmin",
    avatar: "/logo.png",
    company: "JS-Innov.IA",
  },
];

const AuthContext_Context = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Restaurer la session depuis localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setUser(parsed);
      }
    } catch (e) {}
    setIsLoadingAuth(false);
    setAuthChecked(true);
  }, []);

  const login = useCallback(async (email, password) => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      // Vérification locale (MVP) — remplacer par Supabase Auth
      const found = DEMO_USERS.find(
        u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
      );

      // Si pas en local, essayer via l'API backend
      if (!found) {
        // Tentative via le backend Railway
        const apiUrl = import.meta.env.VITE_AGENT_URL || "https://jsinnovia-agent-production.up.railway.app";
        try {
          const res = await fetch(`${apiUrl}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          if (res.ok) {
            const data = await res.json();
            const userData = { ...data.user, token: data.token };
            setUser(userData);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
            setIsLoadingAuth(false);
            return { success: true };
          }
        } catch (e) {}
        setIsLoadingAuth(false);
        return { success: false, error: "Email ou mot de passe incorrect." };
      }

      const { password: _, ...safeUser } = found;
      setUser(safeUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safeUser));
      setIsLoadingAuth(false);
      return { success: true };
    } catch (e) {
      setIsLoadingAuth(false);
      return { success: false, error: "Erreur de connexion." };
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const navigateToLogin = useCallback(() => {
    window.location.href = "/login";
  }, []);

  const checkUserAuth = useCallback(async () => {}, []);
  const checkAppState = useCallback(async () => {}, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      appPublicSettings: null,
      authChecked,
      login,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
