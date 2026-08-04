import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';

// ─── AUTH CONTEXT (backend via /api/auth) ────────────────────────────────────
// Le frontend ne parle plus directement à Supabase pour l'auth.
// Tout passe par le backend Express (server-auth.cjs) qui utilise la service_role.
// Le token de session est géré via cookie HttpOnly — le JS ne peut pas le lire.

const STORAGE_KEY = 'cockpit_session_user'; // Stocke uniquement le profil user (pas le token)
const OLD_STORAGE_KEY = 'cockpit_session'; // Ancienne clé — à nettoyer
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  // ─── Restaurer la session au démarrage ─────────────────────────────────────
  // Le cookie HttpOnly est envoyé automatiquement par le navigateur.
  // Le frontend ne voit jamais le token.
  useEffect(() => {
    const restoreSession = async () => {
      try {
        // Nettoyer l'ancienne clé localStorage qui contenait token + userId
        // (le token est désormais dans le cookie HttpOnly, cette clé est obsolète)
        if (localStorage.getItem(OLD_STORAGE_KEY)) {
          localStorage.removeItem(OLD_STORAGE_KEY);
        }

        // Le profil user est mis en cache dans localStorage pour éviter le flash
        // Le token lui-même est dans le cookie HttpOnly (non lisible par JS)
        const cachedUser = localStorage.getItem(STORAGE_KEY);
        if (cachedUser) {
          setUser(JSON.parse(cachedUser));
        }

        // Valider la session via le backend (cookie envoyé automatiquement)
        const res = await fetch('/api/auth/session', {
          credentials: 'same-origin',
        });
        const data = await res.json();

        if (data.valid && data.user) {
          setUser(data.user);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user));
        } else {
          // Session invalide ou expirée — nettoyer
          setUser(null);
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {
        console.error('Session restore error:', e);
        // En cas d'erreur réseau, on garde l'utilisateur en cache si présent
        // (le cookie peut encore être valide même si le serveur ne répond pas)
      }
      setIsLoadingAuth(false);
      setAuthChecked(true);
    };
    restoreSession();
  }, []);

  // ─── LOGIN ────────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    setIsLoadingAuth(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.user) {
        // Nettoyer l'ancienne clé au passage
        localStorage.removeItem(OLD_STORAGE_KEY);
        setUser(data.user);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user));
        setIsLoadingAuth(false);
        return { success: true };
      }

      setIsLoadingAuth(false);
      return { success: false, error: data.error || 'Identifiants incorrects.' };
    } catch (e) {
      console.error('Login error:', e);
      setIsLoadingAuth(false);
      return { success: false, error: 'Erreur de connexion. Réessayez.' };
    }
  }, []);

  // ─── LOGOUT ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch (e) {
      // Non bloquant
    }
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OLD_STORAGE_KEY); // Nettoyer aussi l'ancienne clé
  }, []);

  // ─── REGISTER (Phase 2 — suspendu) ─────────────────────────────────────────
  const register = useCallback(async ({ email, fullName, password, token }) => {
    return { success: false, error: 'Inscription temporairement indisponible.' };
  }, []);

  const navigateToLogin = useCallback(() => { window.location.href = "/login"; }, []);
  const checkUserAuth = useCallback(async () => {}, []);
  const checkAppState = useCallback(async () => {}, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError: null,
      appPublicSettings: null,
      authChecked,
      supabase: null, // Déprécié — le frontend ne parle plus à Supabase directement
      login,
      logout,
      register,
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
