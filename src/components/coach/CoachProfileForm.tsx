'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';
import type { UserProfile, Goal, GenderOption } from '@/lib/types.gym';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { stripUndefined } from '@/lib/clean';
import { useToast } from '@/hooks/use-toast';
import { friendlyErrorMessage } from '@/lib/errorMessages';

const clampSession = (n?: number) =>
  typeof n === 'number' ? Math.min(180, Math.max(20, Math.round(n))) : undefined;

// Stored values stay English (they are data keys the coach prompts read);
// only the labels are translated.
const GOAL_OPTIONS: Array<{ value: Goal; label: TranslationKey }> = [
  { value: 'Hypertrophy', label: 'goal.hypertrophy' },
  { value: 'Strength', label: 'goal.strength' },
  { value: 'Strength+Hypertrophy', label: 'goal.strengthHypertrophy' },
  { value: 'Fat Loss', label: 'goal.fatLoss' },
  { value: 'General Fitness', label: 'goal.general' },
];

const GENDER_OPTIONS: Array<{ value: GenderOption; label: TranslationKey }> = [
  { value: 'Man', label: 'gender.man' },
  { value: 'Woman', label: 'gender.woman' },
  { value: 'Nonbinary', label: 'gender.nonbinary' },
  { value: 'Self-describe', label: 'gender.selfDescribe' },
  { value: 'Prefer not to say', label: 'gender.declineToState' },
];

// `language` is owned by the avatar menu (LanguageContext persists it on its
// own). It is dropped from this form so a save can never write back a stale
// value over a switch made after the page loaded.
const withoutLanguage = ({ language: _language, ...rest }: UserProfile): UserProfile => rest;

export function CoachProfileForm({ initial: rawInitial, title }: { initial: UserProfile; title?: string }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const initial = useMemo(() => withoutLanguage(rawInitial), [rawInitial]);
  const [form, setForm] = useState<UserProfile>(initial);
  const [baseline, setBaseline] = useState<UserProfile>(initial); // for dirty check
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setBaseline(initial), [initial]);

  const gender = form.gender ?? 'Prefer not to say';

  const isDirty = useMemo(() => {
    const A = JSON.stringify(stripUndefined(baseline));
    const B = JSON.stringify(stripUndefined(form));
    return A !== B;
  }, [baseline, form]);

  const { toast } = useToast();

  async function save() {
    if (!user || !isDirty) return;
    try {
      setSaving(true);
      const payload = stripUndefined({
        ...form,
        sessionTimeTargetMin: clampSession(form.sessionTimeTargetMin),
        ...(form.gender === 'Self-describe' ? {} : { genderSelfDescribe: undefined }),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'users', user.id, 'profile', 'profile'), payload, { merge: true });
      setBaseline(form); // reset dirty baseline
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('[CoachProfileForm] save failed:', error);
      toast({
        title: t('common.saveErrorTitle'),
        description: friendlyErrorMessage(error, t('profile.saveErrorDesc')),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="animate-enter enter-1">
      <CardHeader className="border-b">
        <CardTitle>{title ?? t('userNav.profile')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
       <p className="eyebrow">{t('profile.trainingTargets')}</p>
       <div className="!mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Goal */}
        <div className="space-y-1.5">
          <Label>{t('profile.goal')}</Label>
          <Select value={form.goal} onValueChange={(v) => setForm({ ...form, goal: v as Goal })}>
            <SelectTrigger><SelectValue placeholder={t('profile.goal')} /></SelectTrigger>
            <SelectContent>
              {GOAL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{t(opt.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Days/week target */}
        <div className="space-y-1.5">
          <Label>{t('profile.daysPerWeek')}</Label>
          <Input
            type="number"
            value={form.daysPerWeekTarget ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              const n = val === '' ? undefined : Math.min(7, Math.max(1, Number(val)));
              setForm({ ...form, daysPerWeekTarget: n });
            }}
          />
        </div>

        {/* Approx. time per session */}
        <div className="space-y-1.5">
          <Label>{t('profile.sessionTime')}</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={20}
            max={180}
            value={form.sessionTimeTargetMin ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              const n = val === '' ? undefined : Number(val);
              setForm({
                ...form,
                sessionTimeTargetMin: Number.isFinite(n as number) ? (n as number) : undefined,
              });
            }}
            placeholder={t('profile.sessionTimePlaceholder')}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t('profile.constraints')}</Label>
          <Input
            placeholder={t('profile.constraintsPlaceholder')}
            value={(form.constraints || []).join(', ')}
            onChange={(e) =>
              setForm({
                ...form,
                constraints: e.target.value
                  ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  : [],
              })
            }
          />
        </div>
       </div>

       <p className="eyebrow border-t pt-5">{t('profile.aboutYou')}</p>
       <div className="!mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t('profile.age')}</Label>
          <Input
            type="number"
            value={form.age ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              setForm({ ...form, age: val === '' ? undefined : Number(val) });
            }}
          />
        </div>

        {/* Gender (col 1) */}
        <div className="space-y-1.5">
          <Label>{t('profile.gender')}</Label>
          <Select
            value={gender}
            onValueChange={(v) => {
              const g = v as GenderOption;
              setForm(prev => {
                const next = { ...prev, gender: g };
                // Always start blank: a leftover value from an older profile doc
                // must not be prefilled into the self-describe field.
                if (g === 'Self-describe') {
                  next.genderSelfDescribe = '';
                } else {
                  delete (next as any).genderSelfDescribe;
                }
                return next;
              });
            }}
          >
            <SelectTrigger><SelectValue placeholder={t('profile.selectGender')} /></SelectTrigger>
            <SelectContent>
              {GENDER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{t(opt.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Self-describe (col 2, same row as Gender when selected) */}
        {form.gender === 'Self-describe' && (
          <div className="space-y-1.5">
            <Label>{t('profile.selfDescribe')}</Label>
            <Input
              name="gender-self-describe"
              autoComplete="off"
              placeholder={t('profile.selfDescribePlaceholder')}
              value={form.genderSelfDescribe ?? ''}
              onChange={(e) => setForm({ ...form, genderSelfDescribe: e.target.value })}
            />
          </div>
        )}
       </div>

        <div className="!mt-6 flex items-center gap-3 border-t pt-4">
          <Button onClick={save} disabled={saving || !isDirty} className="h-11 min-w-[150px]">
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('common.saving')}</> : t('profile.saveButton')}
          </Button>
          {saved ? (
            <span className="flex items-center gap-1 text-[13px] text-success" aria-live="polite">
              <CheckCircle2 className="h-4 w-4" /> {t('profile.saved')}
            </span>
          ) : isDirty ? (
            <span className="text-[13px] text-muted-foreground" aria-live="polite">{t('common.unsavedChanges')}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
