"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { useAuth } from '@/contexts/AuthContext';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  dateLocale,
  isLanguage,
  setCurrentLanguage,
  translate,
  translatePlural,
  type Language,
  type PluralKey,
  type TranslationKey,
} from '@/i18n';

type Params = Record<string, string | number>;

interface LanguageContextType {
  language: Language;
  /** Apply a language to the UI at once (and mirror it to localStorage), then
   *  persist it to the profile doc. The returned promise rejects only if that
   *  write fails — the UI has already switched by then. */
  setLanguage: (language: Language) => Promise<void>;
  t: (key: TranslationKey, params?: Params) => string;
  tn: (key: PluralKey, n: number, params?: Params) => string;
  /** date-fns locale matching `language`, for `format(..., { locale })`. */
  locale: ReturnType<typeof dateLocale>;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function readStoredLanguage(): Language {
  try {
    const v = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LANGUAGE;
}

/**
 * The language lives on the user's profile doc (`users/{uid}/profile/profile`,
 * field `language`) and is switched from the avatar menu. localStorage only
 * mirrors it so the UI is already right on the next visit, before Firestore
 * answers. SSR and the very first client render use the default; both are
 * hidden behind the auth spinner, so nothing flashes.
 */
export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  const applyLanguage = useCallback((next: Language) => {
    setCurrentLanguage(next);
    setLanguageState(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const uid = user?.id;
  const setLanguage = useCallback(async (next: Language) => {
    applyLanguage(next);
    if (!uid) return;
    // Merge so the rest of the profile (goal, constraints, tombstones…) is untouched.
    await setDoc(doc(db, 'users', uid, 'profile', 'profile'), { language: next }, { merge: true });
  }, [applyLanguage, uid]);

  // Fast path: whatever this device last used.
  useEffect(() => {
    applyLanguage(readStoredLanguage());
  }, [applyLanguage]);

  // Source of truth: the profile doc, once signed in.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getDoc(doc(db, 'users', user.id, 'profile', 'profile'))
      .then((snap) => {
        if (cancelled) return;
        const stored = snap.data()?.language;
        if (isLanguage(stored)) applyLanguage(stored);
      })
      .catch(() => {
        /* Non-critical: keep the mirrored/default language. */
      });
    return () => { cancelled = true; };
  }, [user?.id, applyLanguage]);

  // Keep the module-level `t()` and <html lang> in step with the active language.
  useEffect(() => {
    setCurrentLanguage(language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<LanguageContextType>(() => ({
    language,
    setLanguage,
    t: (key, params) => translate(language, key, params),
    tn: (key, n, params) => translatePlural(language, key, n, params),
    locale: dateLocale(language),
  }), [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useI18n = (): LanguageContextType => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useI18n must be used within a LanguageProvider');
  return ctx;
};
