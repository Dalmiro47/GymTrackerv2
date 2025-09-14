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
      // onAuthStateChanged will handle setting the user state
    } catch (error) {
      console.error("Error during Google sign-in:", error);
      // Handle error (e.g., show a toast message)
      // For now, loading will be set to false by onAuthStateChanged eventually
    }
    // setIsLoading(false); // onAuthStateChanged will set loading to false
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await firebaseSignOut(auth);
      // onAuthStateChanged will handle clearing the user state
    } catch (error) {
      console.error("Error during sign-out:", error);
    }
    // setIsLoading(false); // onAuthStateChanged will set loading to false
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
