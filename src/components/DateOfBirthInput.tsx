"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/contexts/LanguageContext';
import { capitalize } from '@/i18n';
import { DOB_MIN } from '@/lib/age';

interface DateOfBirthInputProps {
  /** `YYYY-MM-DD`, or undefined while incomplete. */
  value?: string;
  onChange: (value: string | undefined) => void;
  id?: string;
}

type Parts = { day: string; month: string; year: string };

const partsOf = (value?: string): Parts => {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  return match
    ? { year: match[1], month: String(Number(match[2])), day: String(Number(match[3])) }
    : { day: '', month: '', year: '' };
};

const daysIn = (month: number, year: number) => new Date(year, month, 0).getDate();

/**
 * Day / Month / Year dropdowns instead of `<input type="date">`: the native
 * picker ignores the app theme and makes reaching a birth year a long
 * month-by-month scroll on mobile. Emits a full date only once all three parts
 * are picked; a partial pick stays local.
 */
export function DateOfBirthInput({ value, onChange, id }: DateOfBirthInputProps) {
  const { t, locale } = useI18n();
  const [parts, setParts] = useState<Parts>(() => partsOf(value));

  // Follow the parent only when it holds a full date (e.g. the profile loading).
  // An undefined value can just mean "incomplete" and must not wipe a partial pick.
  useEffect(() => {
    if (value) setParts(partsOf(value));
  }, [value]);

  const now = new Date();
  const thisYear = now.getFullYear();
  const minYear = Number(DOB_MIN.slice(0, 4));

  const years = useMemo(
    () => Array.from({ length: thisYear - minYear + 1 }, (_, i) => String(thisYear - i)),
    [thisYear, minYear]
  );
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: capitalize(format(new Date(2000, i, 1), 'LLLL', { locale })),
    })),
    [locale]
  );
  // Feb 29 only exists in leap years; with no year yet, allow it.
  const maxDay = parts.month
    ? daysIn(Number(parts.month), parts.year ? Number(parts.year) : 2000)
    : 31;
  const days = Array.from({ length: maxDay }, (_, i) => String(i + 1));

  const update = (patch: Partial<Parts>) => {
    const next = { ...parts, ...patch };
    // Switching to a shorter month clamps the day (31 → 30) instead of dropping it.
    if (next.day && next.month) {
      const max = daysIn(Number(next.month), next.year ? Number(next.year) : 2000);
      if (Number(next.day) > max) next.day = String(max);
    }
    setParts(next);
    if (!next.day || !next.month || !next.year) {
      onChange(undefined);
      return;
    }
    const iso = `${next.year}-${next.month.padStart(2, '0')}-${next.day.padStart(2, '0')}`;
    // A date later today is not a birth date.
    const picked = new Date(Number(next.year), Number(next.month) - 1, Number(next.day));
    onChange(picked > now ? undefined : iso);
  };

  return (
    <div id={id} className="grid grid-cols-[1fr_1.6fr_1.2fr] gap-2">
      <Select value={parts.day} onValueChange={(day) => update({ day })}>
        <SelectTrigger aria-label={t('profile.dobDay')}>
          <SelectValue placeholder={t('profile.dobDay')} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {days.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={parts.month} onValueChange={(month) => update({ month })}>
        <SelectTrigger aria-label={t('profile.dobMonth')}>
          <SelectValue placeholder={t('profile.dobMonth')} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={parts.year} onValueChange={(year) => update({ year })}>
        <SelectTrigger aria-label={t('profile.dobYear')}>
          <SelectValue placeholder={t('profile.dobYear')} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
