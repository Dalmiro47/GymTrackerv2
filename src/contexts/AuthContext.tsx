"use client";

import type { UserProfile as AppUserProfile } from '@/types';
import type { ReactNode } from 'react';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  getAuth, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut as firebaseSignOut,
  type User as FirebaseUser 
} from 'firebase/auth';
import { app } from '@/lib/firebaseConfig'; // Ensure app is initialized
import { useToast } from '@/hooks/use-toast';

interface AuthContextType {
  user: AppUserProfile | null;
  firebaseUser: FirebaseUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AppUserProfile | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const auth = getAuth(app); // Get auth instance

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setFirebaseUser(fbUser);
        const userProfile: AppUserProfile = {
          id: fbUser.uid,
          email: fbUser.email,
          name: fbUser.displayName,
          avatarUrl: fbUser.photoURL,
        };
        setUser(userProfile);
        // Persist user to localStorage if needed, or rely on Firebase's own session management
        // localStorage.setItem('gymflow_user', JSON.stringify(userProfile)); 
      } else {
        setFirebaseUser(null);
        setUser(null);
        // localStorage.removeItem('gymflow_user');
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [auth]);

  const loginWithGoogle = async () => {
    setIsLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      // On success, onAuthStateChanged sets the user and clears isLoading.
    } catch (error) {
      // A failed/cancelled popup never triggers onAuthStateChanged — reset
      // here or the app is stuck on a spinner forever.
      setIsLoading(false);
      const code = (error as { code?: string })?.code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        console.error("Error during Google sign-in:", error);
        toast({
          title: "Error de inicio de sesión",
          description: "No se pudo iniciar sesión con Google. Inténtalo de nuevo.",
          variant: "destructive",
        });
      }
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await firebaseSignOut(auth);
      // On success, onAuthStateChanged clears the user and isLoading.
    } catch (error) {
      setIsLoading(false);
      console.error("Error during sign-out:", error);
      toast({
        title: "Error al cerrar sesión",
        description: "No se pudo cerrar la sesión. Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  return (
    <AuthContext.Provider value={{ user, firebaseUser, isAuthenticated: !!user, isLoading, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
