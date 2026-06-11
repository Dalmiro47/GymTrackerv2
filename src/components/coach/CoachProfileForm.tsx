'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { useAuth } from '@/contexts/AuthContext';
import type { UserProfile, Goal, GenderOption } from '@/lib/types.gym';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { stripUndefined } from '@/lib/clean';

const clampSession = (n?: number) =>
  typeof n === 'number' ? Math.min(180, Math.max(20, Math.round(n))) : undefined;

export function CoachProfileForm({ initial, title = 'Profile' }: { initial: UserProfile; title?: string }) {
  const { user } = useAuth();
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
       <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Training targets</p>
       <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 !mt-3">
        {/* Goal */}
        <div className="space-y-1.5">
          <Label>Goal</Label>
          <Select value={form.goal} onValueChange={(v) => setForm({ ...form, goal: v as Goal })}>
            <SelectTrigger><SelectValue placeholder="Goal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Hypertrophy">Hypertrophy</SelectItem>
              <SelectItem value="Strength">Strength</SelectItem>
              <SelectItem value="Strength+Hypertrophy">Strength + Hypertrophy</SelectItem>
              <SelectItem value="Fat Loss">Fat Loss</SelectItem>
              <SelectItem value="General Fitness">General Fitness</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Days/week target */}
        <div className="space-y-1.5">
          <Label>Days/week target</Label>
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
          <Label>Approx. time per session (min)</Label>
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
            placeholder="e.g. 60"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>Constraints</Label>
          <Input
            placeholder="e.g., Lower back sensitivity, Home gym"
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

       <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-t pt-5">About you</p>
       <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 !mt-3">
        <div className="space-y-1.5">
          <Label>Age</Label>
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
          <Label>Gender</Label>
          <Select
            value={gender}
            onValueChange={(v) => {
              const g = v as GenderOption;
              setForm(prev => {
                const next = { ...prev, gender: g };
                if (g === 'Self-describe') {
                  if (next.genderSelfDescribe == null) next.genderSelfDescribe = '';
                } else {
                  delete (next as any).genderSelfDescribe;
                }
                return next;
              });
            }}
          >
            <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Man">Man</SelectItem>
              <SelectItem value="Woman">Woman</SelectItem>
              <SelectItem value="Nonbinary">Nonbinary</SelectItem>
              <SelectItem value="Self-describe">Prefer to self-describe</SelectItem>
              <SelectItem value="Prefer not to say">Decline to state</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Self-describe (col 2, same row as Gender when selected) */}
        {form.gender === 'Self-describe' && (
          <div className="space-y-1.5">
            <Label>Please self-describe</Label>
            <Input
              placeholder="Enter your gender"
              value={form.genderSelfDescribe ?? ''}
              onChange={(e) => setForm({ ...form, genderSelfDescribe: e.target.value })}
            />
          </div>
        )}
       </div>

        <div className="flex items-center gap-3 border-t pt-4 !mt-6">
          <Button onClick={save} disabled={saving || !isDirty}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : 'Save profile'}
          </Button>
          {saved ? (
            <span className="text-sm text-success flex items-center gap-1" aria-live="polite">
              <CheckCircle2 className="h-4 w-4" /> Saved
            </span>
          ) : isDirty ? (
            <span className="text-sm text-muted-foreground" aria-live="polite">Unsaved changes</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
