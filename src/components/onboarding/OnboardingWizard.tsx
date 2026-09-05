'use client';

// ─── First-run setup wizard ──────────────────────────────────────────
// Shown exactly once, on the first authenticated visit, by <OnboardingGate />.
// Step 1 is the language (English is the default) so every later step is read
// in the user's own language; the remaining steps fill the coach profile.
// Everything it collects stays editable from Profile afterwards — the wizard
// is never shown again once `onboardedAt` is stamped on the profile doc.

import React, { useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Check, CheckCircle2, ChevronLeft, Loader2, PartyPopper } from 'lucide-react';

import { Dialog, DialogOverlay, DialogPortal, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebaseConfig';
import { stripUndefined } from '@/lib/clean';
import { friendlyErrorMessage } from '@/lib/errorMessages';
import { GENDER_OPTIONS, GOAL_OPTIONS } from '@/lib/profileOptions';
import { ensureExercisesSeeded } from '@/services/exerciseService';
import type { GenderOption, Goal, UserProfile } from '@/lib/types.gym';
import { LANGUAGES, type Language, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';

const LANGUAGE_LABEL: Record<Language, TranslationKey> = { en: 'lang.en', es: 'lang.es' };

const STEPS = ['language', 'goal', 'rhythm', 'about', 'constraints'] as const;
type Step = (typeof STEPS)[number] | 'done';

const DAY_CHOICES = [1, 2, 3, 4, 5, 6, 7];
const SESSION_CHOICES = [30, 45, 60, 75, 90, 120];

/** Skipping still needs a goal: `UserProfile.goal` is required downstream and
 *  the coach prompts read it. Same fallback the profile page already uses. */
const FALLBACK_GOAL: Goal = 'General Fitness';

type Draft = {
  goal?: Goal;
  daysPerWeekTarget?: number;
  sessionTimeTargetMin?: number;
  age?: number;
  gender?: GenderOption;
  genderSelfDescribe?: string;
  constraints: string[];
};

/** A selectable row (language, goal): radio semantics, card presentation. */
function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'pressable flex w-full items-center gap-3 rounded-lg border p-3.5 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card/40 hover:bg-accent hover:text-accent-foreground'
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-snug">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-[13px] text-muted-foreground">{description}</span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
        )}
      >
        {selected ? <Check className="h-3 w-3" /> : null}
      </span>
    </button>
  );
}

/** Single-select chip row (days/week, minutes/session). Tapping again clears. */
function ChipGroup({
  label,
  values,
  selected,
  onSelect,
  format,
}: {
  label: string;
  values: number[];
  selected?: number;
  onSelect: (value?: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {values.map((value) => {
          const isOn = selected === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={isOn}
              onClick={() => onSelect(isOn ? undefined : value)}
              className={cn(
                'pressable tabular h-11 rounded-md border px-4 text-[15px] font-semibold transition-colors',
                isOn
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card/40 hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {format ? format(value) : value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-1.5">
      <DialogTitle className="text-[19px]">{title}</DialogTitle>
      <DialogDescription>{subtitle}</DialogDescription>
    </div>
  );
}

function DoneStep({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="animate-enter flex flex-col items-center gap-4 px-6 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
        <PartyPopper className="h-7 w-7" />
      </span>
      <div className="space-y-1.5">
        <DialogTitle className="text-[19px]">{t('onb.done.title')}</DialogTitle>
        <DialogDescription>{t('onb.done.subtitle')}</DialogDescription>
      </div>
      <Button onClick={onClose} className="mt-2 min-w-[180px]">
        <CheckCircle2 className="h-4 w-4" />
        {t('onb.done.cta')}
      </Button>
    </div>
  );
}

export function OnboardingWizard({ open, onFinished }: { open: boolean; onFinished: () => void }) {
  const { user } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('language');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>({ constraints: [] });
  // Kept as raw text so a trailing comma while typing doesn't fight the parser.
  const [constraintsText, setConstraintsText] = useState('');

  const stepIndex = step === 'done' ? STEPS.length - 1 : STEPS.indexOf(step);
  const isLastQuestion = step === STEPS[STEPS.length - 1];

  const goalChoices = useMemo(
    () => GOAL_OPTIONS.map((opt) => ({ value: opt.value, text: t(opt.label), hint: t(opt.description) })),
    [t]
  );

  // Applies at once and persists on its own (LanguageContext owns the write),
  // so the rest of the wizard is already in the chosen language.
  const chooseLanguage = (next: Language) => {
    if (next === language) return;
    setLanguage(next).catch((error) => {
      console.error('[OnboardingWizard] language save failed:', error);
      toast({
        title: t('common.saveErrorTitle'),
        description: friendlyErrorMessage(error, t('userNav.languageSaveError')),
        variant: 'destructive',
      });
    });
  };

  /** Writes the profile and stamps `onboardedAt`, which retires the wizard. */
  async function persist(profile: Partial<UserProfile>): Promise<boolean> {
    if (!user) return false;
    try {
      setSaving(true);
      await setDoc(
        doc(db, 'users', user.id, 'profile', 'profile'),
        stripUndefined({
          ...profile,
          language,
          onboardedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      );

      // Stock the exercise library now. Seeding used to happen only on a visit
      // to /exercises, so a new user who went straight to /log found an empty
      // "Add Exercise" picker. Failure is non-fatal: /exercises still seeds
      // idempotently, and blocking setup over it would be worse.
      try {
        await ensureExercisesSeeded(user.id);
      } catch (error) {
        console.error('[OnboardingWizard] exercise seeding failed:', error);
      }

      return true;
    } catch (error) {
      console.error('[OnboardingWizard] setup save failed:', error);
      toast({
        title: t('common.saveErrorTitle'),
        description: friendlyErrorMessage(error, t('onb.saveErrorDesc')),
        variant: 'destructive',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  const handleSkip = async () => {
    if (await persist({ goal: draft.goal ?? FALLBACK_GOAL })) onFinished();
  };

  const handleFinish = async () => {
    const ok = await persist({
      goal: draft.goal ?? FALLBACK_GOAL,
      daysPerWeekTarget: draft.daysPerWeekTarget,
      sessionTimeTargetMin: draft.sessionTimeTargetMin,
      age: draft.age,
      gender: draft.gender,
      genderSelfDescribe: draft.gender === 'Self-describe' ? draft.genderSelfDescribe : undefined,
      constraints: draft.constraints.length ? draft.constraints : undefined,
    });
    if (ok) setStep('done');
  };

  const goNext = () => {
    if (isLastQuestion) {
      void handleFinish();
      return;
    }
    setStep(STEPS[stepIndex + 1]);
  };

  const goBack = () => {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
  };

  const canContinue = step !== 'goal' || !!draft.goal;

  return (
    <Dialog open={open}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          // Same geometry as DialogContent, minus the close button: setup is
          // left through Skip or Finish, never by clicking away.
          className="fixed left-[50%] top-[50%] z-50 flex max-h-[85dvh] w-[min(95vw,560px)] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-2xl"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {step === 'done' ? (
            <DoneStep onClose={onFinished} />
          ) : (
            <>
              {/* Progress + escape hatch */}
              <div className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="eyebrow">
                    {t('onb.stepOf', { current: stepIndex + 1, total: STEPS.length })}
                  </span>
                  <div className="flex gap-1.5" aria-hidden>
                    {STEPS.map((s, i) => (
                      <span
                        key={s}
                        className={cn(
                          'h-1 flex-1 rounded-full transition-colors',
                          i <= stepIndex ? 'bg-primary' : 'bg-secondary'
                        )}
                      />
                    ))}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  disabled={saving}
                  className="shrink-0 text-muted-foreground"
                >
                  {t('onb.skip')}
                </Button>
              </div>

              {/* Step body — remounted per step so it animates in */}
              <div key={step} className="animate-enter min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {step === 'language' && (
                  <>
                    <StepHeading title={t('onb.language.title')} subtitle={t('onb.language.subtitle')} />
                    <div className="space-y-2" role="radiogroup" aria-label={t('userNav.language')}>
                      {LANGUAGES.map((lang) => (
                        <ChoiceCard
                          key={lang}
                          selected={language === lang}
                          onSelect={() => chooseLanguage(lang)}
                          title={t(LANGUAGE_LABEL[lang])}
                          description={lang === 'en' ? t('onb.language.default') : undefined}
                        />
                      ))}
                    </div>
                    <p className="text-[13px] text-muted-foreground">{t('onb.language.hint')}</p>
                  </>
                )}

                {step === 'goal' && (
                  <>
                    <StepHeading title={t('onb.goal.title')} subtitle={t('onb.goal.subtitle')} />
                    <div className="space-y-2" role="radiogroup" aria-label={t('profile.goal')}>
                      {goalChoices.map((opt) => (
                        <ChoiceCard
                          key={opt.value}
                          selected={draft.goal === opt.value}
                          onSelect={() => setDraft((d) => ({ ...d, goal: opt.value }))}
                          title={opt.text}
                          description={opt.hint}
                        />
                      ))}
                    </div>
                  </>
                )}

                {step === 'rhythm' && (
                  <>
                    <StepHeading title={t('onb.rhythm.title')} subtitle={t('onb.rhythm.subtitle')} />
                    <ChipGroup
                      label={t('onb.rhythm.daysLabel')}
                      values={DAY_CHOICES}
                      selected={draft.daysPerWeekTarget}
                      onSelect={(v) => setDraft((d) => ({ ...d, daysPerWeekTarget: v }))}
                    />
                    <ChipGroup
                      label={t('onb.rhythm.sessionLabel')}
                      values={SESSION_CHOICES}
                      selected={draft.sessionTimeTargetMin}
                      onSelect={(v) => setDraft((d) => ({ ...d, sessionTimeTargetMin: v }))}
                      format={(v) => t('onb.rhythm.minutes', { n: v })}
                    />
                  </>
                )}

                {step === 'about' && (
                  <>
                    <StepHeading title={t('onb.about.title')} subtitle={t('onb.about.subtitle')} />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="onb-age">{t('profile.age')}</Label>
                        <Input
                          id="onb-age"
                          type="number"
                          inputMode="numeric"
                          min={10}
                          max={100}
                          value={draft.age ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraft((d) => ({ ...d, age: val === '' ? undefined : Number(val) }));
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t('profile.gender')}</Label>
                        <Select
                          value={draft.gender}
                          onValueChange={(v) =>
                            setDraft((d) => ({
                              ...d,
                              gender: v as GenderOption,
                              // Always start blank: nothing is prefilled for the user.
                              genderSelfDescribe: v === 'Self-describe' ? '' : undefined,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('profile.selectGender')} />
                          </SelectTrigger>
                          <SelectContent>
                            {GENDER_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {t(opt.label)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {draft.gender === 'Self-describe' && (
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="onb-self-describe">{t('profile.selfDescribe')}</Label>
                          <Input
                            id="onb-self-describe"
                            name="gender-self-describe"
                            autoComplete="off"
                            placeholder={t('profile.selfDescribePlaceholder')}
                            value={draft.genderSelfDescribe ?? ''}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, genderSelfDescribe: e.target.value }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}

                {step === 'constraints' && (
                  <>
                    <StepHeading
                      title={t('onb.constraints.title')}
                      subtitle={t('onb.constraints.subtitle')}
                    />
                    <div className="space-y-1.5">
                      <Label htmlFor="onb-constraints">
                        {t('profile.constraints')}{' '}
                        <span className="font-normal text-muted-foreground">({t('onb.optional')})</span>
                      </Label>
                      <Textarea
                        id="onb-constraints"
                        rows={3}
                        placeholder={t('profile.constraintsPlaceholder')}
                        value={constraintsText}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setConstraintsText(raw);
                          setDraft((d) => ({
                            ...d,
                            constraints: raw
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          }));
                        }}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Nav */}
              <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-4">
                {stepIndex > 0 ? (
                  <Button variant="ghost" onClick={goBack} disabled={saving}>
                    <ChevronLeft className="h-4 w-4" />
                    {t('common.back')}
                  </Button>
                ) : (
                  <span />
                )}
                <Button onClick={goNext} disabled={saving || !canContinue} className="min-w-[140px]">
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> {t('common.saving')}
                    </>
                  ) : isLastQuestion ? (
                    t('onb.finish')
                  ) : (
                    t('onb.continue')
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
