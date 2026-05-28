import React, { createContext, useState, useContext } from 'react';

// AuthContext simplifié — cockpit JS-Innov.IA
// Pas d'auth Base44 — accès direct Supabase
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user] = useState({ 
    full_name: 'Julien Pagin', 
    email: 'julien.pagin.pv@gmail.com',
    role: 'admin'
  });

  return (
    <AuthContext.Provider value={{ 
      user,
      isAuthenticated: true,
      isLoadingAuth: false,
      isLoadingPublicSettings: false,
      authError: null,
      appPublicSettings: null,
      authChecked: true,
      logout: () => {},
      navigateToLogin: () => {},
      checkUserAuth: async () => {},
      checkAppState: async () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
