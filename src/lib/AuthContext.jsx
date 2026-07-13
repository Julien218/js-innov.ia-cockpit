import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_ANON
  ? createClient(SUPABASE_URL, SUPABASE_ANON)
  : null;

const STORAGE_KEY = 'cockpit_session';
const AuthContext = createContext();

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'jsinnovia_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken() {
  return crypto.randomUUID().replace(/-/g, '') + Date.now().toString(36);
}

function requireSupabase() {
  if (!supabase) throw new Error('Configuration Supabase publique manquante.');
  return supabase;
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const client = requireSupabase();
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const { token, userId } = JSON.parse(stored);
          if (token && userId) {
            const { data: session } = await client
              .from('cockpit_sessions')
              .select('user_id, expires_at')
              .eq('token', token)
              .eq('user_id', userId)
              .gt('expires_at', new Date().toISOString())
              .single();

            if (session) {
              const { data: userData } = await client
                .from('cockpit_users')
                .select('id, email, full_name, role, avatar_url, organisation, is_active')
                .eq('id', userId)
                .eq('is_active', true)
                .single();

              if (userData) setUser({ ...userData, sessionToken: token });
              else localStorage.removeItem(STORAGE_KEY);
            } else {
              localStorage.removeItem(STORAGE_KEY);
            }
          }
        }
      } catch (error) {
        console.error('Session restore error:', error);
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    };
    restoreSession();
  }, []);

  const login = useCallback(async (email, password) => {
    setIsLoadingAuth(true);
    try {
      const client = requireSupabase();
      const pwHash = await hashPassword(password);
      const { data: userData, error } = await client
        .from('cockpit_users')
        .select('id, email, full_name, role, avatar_url, organisation, is_active, password_hash')
        .eq('email', email.toLowerCase().trim())
        .eq('is_active', true)
        .single();

      if (error || !userData || userData.password_hash !== pwHash) {
        return { success: false, error: 'Email ou mot de passe incorrect.' };
      }

      const token = generateToken();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error: sessionError } = await client.from('cockpit_sessions').insert({
        user_id: userData.id,
        token,
        expires_at: expiresAt,
      });
      if (sessionError) throw sessionError;

      await client
        .from('cockpit_users')
        .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', userData.id);

      const { password_hash: _, ...safeUser } = userData;
      const sessionUser = { ...safeUser, sessionToken: token };
      setUser(sessionUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, userId: userData.id }));
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message || 'Erreur de connexion.' };
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const client = requireSupabase();
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { token } = JSON.parse(stored);
        if (token) await client.from('cockpit_sessions').delete().eq('token', token);
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const register = useCallback(async ({ email, fullName, password, token }) => {
    try {
      const client = requireSupabase();
      const { data: invite } = await client
        .from('cockpit_invitations')
        .select('*')
        .eq('token', token)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .single();

      if (!invite) return { success: false, error: "Lien d'invitation invalide ou expiré." };

      const pwHash = await hashPassword(password);
      const { error } = await client.from('cockpit_users').insert({
        email: email.toLowerCase().trim(),
        full_name: fullName,
        password_hash: pwHash,
        role: invite.role,
        is_active: true,
      });
      if (error) return { success: false, error: 'Email déjà utilisé ou erreur de création.' };

      await client
        .from('cockpit_invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invite.id);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || 'Erreur lors de la création du compte.' };
    }
  }, []);

  const navigateToLogin = useCallback(() => { window.location.href = '/login'; }, []);
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
