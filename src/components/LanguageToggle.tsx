'use client';

import { Languages } from 'lucide-react';
import { useI18n } from '@/contexts/LanguageContext';
import { LANGUAGES, type Language } from '@/i18n';
import { cn } from '@/lib/utils';

const LANGUAGE_SHORT: Record<Language, string> = { en: 'EN', es: 'ES' };
const LANGUAGE_LABEL: Record<Language, 'lang.en' | 'lang.es'> = {
  en: 'lang.en',
  es: 'lang.es',
};

/**
 * Compact EN/ES segmented control for the signed-out pages, where the avatar
 * menu (the usual language switch) doesn't exist yet. Signed out there is no
 * profile doc to write, so `setLanguage` only mirrors the choice locally.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { t, language, setLanguage } = useI18n();

  return (
    <div
      role="group"
      aria-label={t('userNav.language')}
      className={cn('surface inline-flex items-center gap-0.5 rounded-full p-1', className)}
    >
      <Languages className="ml-1.5 mr-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {LANGUAGES.map((lang) => {
        const active = lang === language;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => {
              void setLanguage(lang).catch(() => {
                /* Signed out: nothing to persist remotely. */
              });
            }}
            aria-pressed={active}
            aria-label={t(LANGUAGE_LABEL[lang])}
            className={cn(
              'pressable rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {LANGUAGE_SHORT[lang]}
          </button>
        );
      })}
    </div>
  );
}
