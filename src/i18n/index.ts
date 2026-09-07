// ─── i18n core ───────────────────────────────────────────────────────
// Two dictionaries (EN / ES-LatAm) and a tiny `t()`.
//
// React code should use `useI18n()` (contexts/LanguageContext.tsx), which
// re-renders on language change. The module-level `t()` below reads the
// language last applied by the provider and exists for non-React code paths:
// toasts fired from hooks, error mapping, warm-up labels, window.confirm.

import type { Locale } from 'date-fns';
import { enUS, es as esLocale } from 'date-fns/locale';
import { en } from './en';
import { es } from './es';

export type Language = 'en' | 'es';
export const LANGUAGES: readonly Language[] = ['en', 'es'] as const;
export const DEFAULT_LANGUAGE: Language = 'en';
/** localStorage mirror of the profile's `language` so the UI is right before Firestore answers. */
export const LANGUAGE_STORAGE_KEY = 'gt-lang';

export type TranslationKey = keyof typeof en;
type Params = Record<string, string | number>;

/** Keys that come in `_one` / `_other` pairs, addressed by their shared prefix. */
export type PluralKey = {
  [K in TranslationKey]: K extends `${infer Base}_one` ? Base : never;
}[TranslationKey];

const DICTS: Record<Language, Record<TranslationKey, string>> = { en, es };

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'es';
}

/**
 * Time zones of Spanish-speaking countries. Used as a *geographic* signal when
 * the device locale isn't Spanish (an English-set phone used in Mexico), which
 * is the closest we get to "the country the user is in" without a geo-IP call.
 */
const SPANISH_TIME_ZONES = new Set([
  'Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta',
  'America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey',
  'America/Matamoros', 'America/Chihuahua', 'America/Ciudad_Juarez', 'America/Ojinaga',
  'America/Mazatlan', 'America/Bahia_Banderas', 'America/Hermosillo', 'America/Tijuana',
  'America/Bogota', 'America/Lima', 'America/Caracas', 'America/Guayaquil',
  'America/La_Paz', 'America/Asuncion', 'America/Montevideo', 'America/Santiago',
  'America/Punta_Arenas', 'Pacific/Easter', 'America/Buenos_Aires',
  'America/Panama', 'America/Costa_Rica', 'America/Guatemala', 'America/El_Salvador',
  'America/Tegucigalpa', 'America/Managua', 'America/Havana', 'America/Santo_Domingo',
  'America/Puerto_Rico',
]);

function isSpanishTimeZone(zone: string): boolean {
  return zone.startsWith('America/Argentina/') || SPANISH_TIME_ZONES.has(zone);
}

/**
 * Best guess at the language for a visitor who has never chosen one: the device
 * locale first, then the time zone's country. Browser-only APIs, so it returns
 * the default during SSR. An explicit choice (localStorage / profile) always wins.
 */
export function detectLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  try {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
    if (tags.some((tag) => tag?.toLowerCase().split('-')[0] === 'es')) return 'es';
    // Device locale isn't Spanish — fall back to where the device thinks it is.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isSpanishTimeZone(zone)) return 'es';
  } catch {
    /* Locale/Intl unavailable — keep the default. */
  }
  return DEFAULT_LANGUAGE;
}

let currentLanguage: Language = DEFAULT_LANGUAGE;

export function getLanguage(): Language {
  return currentLanguage;
}

/** Called by the LanguageProvider whenever the active language changes. */
export function setCurrentLanguage(language: Language) {
  currentLanguage = language;
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

export function translate(language: Language, key: TranslationKey, params?: Params): string {
  const template = DICTS[language][key] ?? DICTS.en[key] ?? key;
  return interpolate(template, params);
}

export function translatePlural(language: Language, key: PluralKey, n: number, params?: Params): string {
  const full = `${key}_${n === 1 ? 'one' : 'other'}` as TranslationKey;
  return translate(language, full, { n, ...params });
}

/** Non-reactive `t` bound to the language currently applied by the provider. */
export function t(key: TranslationKey, params?: Params): string {
  return translate(currentLanguage, key, params);
}

/** Non-reactive plural `t`: `tn('exercises.count', 3)` → "3 exercises". */
export function tn(key: PluralKey, n: number, params?: Params): string {
  return translatePlural(currentLanguage, key, n, params);
}

export function dateLocale(language: Language = currentLanguage): Locale {
  return language === 'es' ? esLocale : enUS;
}

/** date-fns' Spanish month/day names are lowercase; standalone labels want a capital. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Display label for a stored muscle group key ("Chest" → "Pecho" in ES). Unknown keys pass through. */
export function muscleGroupLabel(muscleGroup: string, language: Language = currentLanguage): string {
  const key = `muscle.${muscleGroup}` as TranslationKey;
  return key in en ? translate(language, key) : muscleGroup;
}

/** Display label for a set-structure key ("superset" → "Superserie" in ES). */
export function setStructureLabel(structure: string, language: Language = currentLanguage): string {
  const key = `ss.${structure}` as TranslationKey;
  return key in en ? translate(language, key) : structure;
}

/** Display label for a warm-up template key ("HEAVY_BARBELL" → "Barra pesada" in ES). */
export function warmupTemplateLabel(template: string, language: Language = currentLanguage): string {
  const key = `warmupTemplate.${template}` as TranslationKey;
  return key in en ? translate(language, key) : template.replace(/_/g, ' ');
}
