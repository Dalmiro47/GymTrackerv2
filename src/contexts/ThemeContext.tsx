"use client";

import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'gt-theme';

interface ThemeContextType {
  /** What the user chose (persisted). */
  theme: ThemePreference;
  /** What is actually applied after resolving `system`. */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Inline script injected in <head> so the `.dark` class is set BEFORE first paint.
 * Must stay in sync with `resolveTheme` below. Kept dependency-free on purpose.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark'||((t===null||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

function readStoredTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable (private mode) */
  }
  return 'system';
}

function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // Start with 'system' to match SSR; the init script already painted the right class.
  const [theme, setThemeState] = useState<ThemePreference>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    setResolvedTheme(resolveTheme(stored));
  }, []);

  // Apply class + follow OS changes while on 'system'.
  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme);
      setResolvedTheme(resolved);
      document.documentElement.classList.toggle('dark', resolved === 'dark');
    };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
};
