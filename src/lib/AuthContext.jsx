import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// â”€â”€â”€ SUPABASE CLIENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://gfjpryakxzdzwnazlsfz.supabase.co";
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmanByeWFreHpkenduYXpsc2Z6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDc1MzA2OCwiZXhwIjoyMDk2MzI5MDY4fQ.GAL-v22vtLgAmhq91wU8Z8rE-tD7YywAISQKUYyAhq4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const STORAGE_KEY = 'cockpit_session';
const AuthContext = createContext();

// â”€â”€â”€ HASH PASSWORD (cÃ´tÃ© client simple â€” SHA-256 pour MVP) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'jsinnovia_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// â”€â”€â”€ GENERATE SESSION TOKEN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function generateToken() {
  return crypto.randomUUID().replace(/-/g, '') + Date.now().toString(36);
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  // â”€â”€â”€ Restaurer la session depuis localStorage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const { token, userId } = JSON.parse(stored);
          if (token && userId) {
            // VÃ©rifier la session en base
            const { data: session } = await supabase
              .from('cockpit_sessions')
              .select('user_id, expires_at')
              .eq('token', token)
              .eq('user_id', userId)
              .gt('expires_at', new Date().toISOString())
              .single();

            if (session) {
              // RÃ©cupÃ©rer le profil utilisateur
              const { data: userData } = await supabase
                .from('cockpit_users')
                .select('id, email, full_name, role, avatar_url, organisation, is_active')
                .eq('id', userId)
                .eq('is_active', true)
                .single();

              if (userData) {
                setUser({ ...userData, sessionToken: token });
              } else {
                localStorage.removeItem(STORAGE_KEY);
              }
            } else {
              localStorage.removeItem(STORAGE_KEY);
            }
          }
        }
      } catch (e) {
        console.error('Session restore error:', e);
        localStorage.removeItem(STORAGE_KEY);
      }
      setIsLoadingAuth(false);
      setAuthChecked(true);
    };
    restoreSession();
  }, []);

  // â”€â”€â”€ LOGIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const login = useCallback(async (email, password) => {
    setIsLoadingAuth(true);
    try {
      const pwHash = await hashPassword(password);

      // ─── BOOTSTRAP LOCAL JULIEN — accès de secours sans table Supabase ───────
      if (
        email.toLowerCase().trim() === 'julien.pagin.pv@gmail.com' &&
        password === 'Julien2026!'
      ) {
        const bootstrapUser = {
          id: 'local-superadmin-julien',
          email: 'julien.pagin.pv@gmail.com',
          full_name: 'Julien Pagin',
          role: 'superadmin',
          avatar_url: null,
          organisation: 'JS-Innov.IA',
          is_active: true,
          sessionToken: generateToken(),
        };

        setUser(bootstrapUser);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          token: bootstrapUser.sessionToken,
          userId: bootstrapUser.id,
          localBootstrap: true,
        }));
        setIsLoadingAuth(false);
        return { success: true };
      }

      // Chercher l'utilisateur
      const { data: userData, error } = await supabase
        .from('cockpit_users')
        .select('id, email, full_name, role, avatar_url, organisation, is_active, password_hash')
        .eq('email', email.toLowerCase().trim())
        .eq('is_active', true)
        .single();

      if (error || !userData) {
        setIsLoadingAuth(false);
        return { success: false, error: "Email ou mot de passe incorrect." };
      }

      // VÃ©rifier le mot de passe
      const validHash = userData.password_hash === pwHash;

      // Fallback superadmin hardcodÃ© pour Julien (sÃ©curitÃ© bootstrap)
      const isSuperAdminBootstrap =
        email.toLowerCase() === 'julien.pagin.pv@gmail.com' &&
        password === 'Julien2026!' &&
        userData.role === 'superadmin';

      if (!validHash && !isSuperAdminBootstrap) {
        setIsLoadingAuth(false);
        return { success: false, error: "Email ou mot de passe incorrect." };
      }

      // CrÃ©er une session
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await supabase.from('cockpit_sessions').insert({
        user_id: userData.id,
        token,
        expires_at: expiresAt,
      });

      // Mettre Ã  jour last_login
      await supabase
        .from('cockpit_users')
        .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', userData.id);

      const { password_hash: _, ...safeUser } = userData;
      const sessionUser = { ...safeUser, sessionToken: token };

      setUser(sessionUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, userId: userData.id }));
      setIsLoadingAuth(false);
      return { success: true };
    } catch (e) {
      console.error('Login error:', e);
      setIsLoadingAuth(false);
      return { success: false, error: "Erreur de connexion. RÃ©essayez." };
    }
  }, []);

  // â”€â”€â”€ LOGOUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const logout = useCallback(async () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { token } = JSON.parse(stored);
        if (token) {
          await supabase.from('cockpit_sessions').delete().eq('token', token);
        }
      }
    } catch (e) {}
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // â”€â”€â”€ REGISTER (via invitation) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const register = useCallback(async ({ email, fullName, password, token }) => {
    try {
      // VÃ©rifier le token d'invitation
      const { data: invite } = await supabase
        .from('cockpit_invitations')
        .select('*')
        .eq('token', token)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .single();

      if (!invite) return { success: false, error: "Lien d'invitation invalide ou expirÃ©." };

      const pwHash = await hashPassword(password);

      // ─── BOOTSTRAP LOCAL JULIEN — accès de secours sans table Supabase ───────
      if (
        email.toLowerCase().trim() === 'julien.pagin.pv@gmail.com' &&
        password === 'Julien2026!'
      ) {
        const bootstrapUser = {
          id: 'local-superadmin-julien',
          email: 'julien.pagin.pv@gmail.com',
          full_name: 'Julien Pagin',
          role: 'superadmin',
          avatar_url: null,
          organisation: 'JS-Innov.IA',
          is_active: true,
          sessionToken: generateToken(),
        };

        setUser(bootstrapUser);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          token: bootstrapUser.sessionToken,
          userId: bootstrapUser.id,
          localBootstrap: true,
        }));
        setIsLoadingAuth(false);
        return { success: true };
      }

      // CrÃ©er l'utilisateur
      const { data: newUser, error } = await supabase
        .from('cockpit_users')
        .insert({
          email: email.toLowerCase().trim(),
          full_name: fullName,
          password_hash: pwHash,
          role: invite.role,
          is_active: true,
        })
        .select()
        .single();

      if (error) return { success: false, error: "Email dÃ©jÃ  utilisÃ© ou erreur de crÃ©ation." };

      // Marquer l'invitation comme acceptÃ©e
      await supabase
        .from('cockpit_invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invite.id);

      return { success: true };
    } catch (e) {
      return { success: false, error: "Erreur lors de la crÃ©ation du compte." };
    }
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
      supabase,
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

