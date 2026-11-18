// server-only: src/lib/health/backfill.ts
// Pure core of the Apple Health importer (scripts/health-backfill/run.mts, npm run
// health:import), run by hand every few weeks with a fresh export for a --from..--to
// range. It reads the lines of an Apple Health export (export.xml), builds one day the
// way the iOS Shortcut does, and runs that day through parseHealthPayload, so ranges,
// rounding and the sleep checks are exactly the ones /api/health/ingest applies. The
// fields only the importer writes (sleep stages, exercise minutes) have their own rules
// here. The write is fill only: it never overwrites a field a doc already has.
// No Firebase and no fs import: the script owns the file I/O.
//
// Rules per Berlin day D (a sample belongs to the day its start falls on):
// - steps: the Watch sum and the iPhone sum are kept apart and the larger one wins
//   (a tie keeps the Watch). Other devices never count. Exact duplicates are not removed.
// - activeKcal: Watch samples only; a day with none gets no activeKcal.
// - hrvMs, respRate: the mean of the day's samples. restingHr: the last sample.
// - sleepMin: minutes of every Asleep* segment that starts at or after 18:00 of D-1
//   and before 12:00 of D (Awake never counts, a nap after 12:00 counts on no day).
//   sleepStartAt / sleepEndAt: the earliest start and latest end of those segments.
//   Asleep segments from two sources in one window: no sleep fields, and a note.
// - weigh-in: the last instant of the day with a body mass or body fat sample. The
//   export stores body fat as a fraction (unit "%"), so it is sent as a percentage.
// - vo2max: the last sample of the day.
// - sleep stages (sleepCoreMin, sleepDeepMin, sleepRemMin, sleepAwakeMin): the same
//   segments as sleepMin, summed per stage. Awake counts only from the same source and
//   only when it starts between the first asleep start and the last asleep end. Written
//   all four or none, only when the night has a Core, Deep or REM segment and a
//   sleepMin. Unspecified sleep counts in sleepMin and in no stage.
// - exerciseMin: the sum of the day's Watch exercise-time samples.
import { addDays, berlinMidnightMs, berlinYmd, isRealYmd } from '../mcp/week';
import { parseHealthPayload, type DropReason, type HealthFields } from './ingest';

// ─── Range ───────────────────────────────────────────────────────────

/** The longest range one run takes, as get_health's MAX_HEALTH_DAYS. */
export const MAX_IMPORT_DAYS = 366;

/** The Berlin days of one run, both included. */
export type ImportRange = { from: string; to: string };

export type RangeCheck = { ok: true; range: ImportRange } | { ok: false; errors: string[] };

const DAY_MS = 86_400_000;

/**
 * Checks --from and --to: real days, from <= to, at most 366 days, `to` before Berlin
 * today (today belongs to the Shortcut) and, when given, before the Berlin day of the
 * export (a partial last day would fill a missing field with a partial value for good).
 * Every failing rule is listed.
 */
export function checkImportRange(from: unknown, to: unknown, todayBerlin: string, exportDay?: string): RangeCheck {
  if (!isRealYmd(from) || !isRealYmd(to)) return { ok: false, errors: ['--from and --to must be real YYYY-MM-DD days'] };
  const errors: string[] = [];
  if (from > to) {
    errors.push(`--from ${from} is after --to ${to}`);
  } else {
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
    if (span > MAX_IMPORT_DAYS) errors.push(`${from} to ${to} is ${span} days; the most is ${MAX_IMPORT_DAYS}`);
  }
  if (to >= todayBerlin) errors.push(`--to must be before Berlin today (${todayBerlin})`);
  if (exportDay !== undefined && to >= exportDay) errors.push(`--to must be before the export day (${exportDay})`);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, range: { from, to } };
}

/** True only for a real calendar day inside the range. */
export function isInRange(value: unknown, range: ImportRange): value is string {
  return isRealYmd(value) && value >= range.from && value <= range.to;
}

/** Every day of the range, oldest first. */
export function rangeDates(range: ImportRange): string[] {
  const dates: string[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

// ─── Export lines ────────────────────────────────────────────────────

export type RecordKind =
  | 'steps' | 'activeKcal' | 'restingHr' | 'hrvMs' | 'respRate' | 'sleep' | 'bodyMass' | 'bodyFat' | 'vo2max' | 'exerciseMin';

const KINDS: ReadonlyMap<string, RecordKind> = new Map<string, RecordKind>([
  ['HKQuantityTypeIdentifierStepCount', 'steps'],
  ['HKQuantityTypeIdentifierActiveEnergyBurned', 'activeKcal'],
  ['HKQuantityTypeIdentifierRestingHeartRate', 'restingHr'],
  ['HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'hrvMs'],
  ['HKQuantityTypeIdentifierRespiratoryRate', 'respRate'],
  ['HKCategoryTypeIdentifierSleepAnalysis', 'sleep'],
  ['HKQuantityTypeIdentifierBodyMass', 'bodyMass'],
  ['HKQuantityTypeIdentifierBodyFatPercentage', 'bodyFat'],
  ['HKQuantityTypeIdentifierVO2Max', 'vo2max'],
  ['HKQuantityTypeIdentifierAppleExerciseTime', 'exerciseMin'],
]);

/** The recording device, from the generic model in the `device` attribute. */
export type Device = 'watch' | 'phone' | 'other';

export type HealthRecord = {
  kind: RecordKind;
  startMs: number;
  endMs: number;
  /** The raw `value` attribute: a number, or the sleep category. */
  value: string;
  device: Device;
  /** The `sourceName` attribute, kept only to tell two sleep sources apart. */
  source: string;
};

const TYPE_ATTR = / type="([^"]*)"/;
const ATTR = /([A-Za-z_][\w.-]*)="([^"]*)"/g;
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** The export's date format: "2026-03-10 09:00:00 +0100". */
const EXPORT_DATE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;
const MODEL = /model:([^,>]*)/;

const decode = (text: string) =>
  text.replace(ENTITY, (match, entity: string) => {
    if (entity[0] !== '#') return NAMED_ENTITIES[entity];
    const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });

/** Epoch ms of an export date, or null when it is not one. */
function exportDateMs(text: string | undefined): number | null {
  const m = text === undefined ? null : EXPORT_DATE.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  if (!isRealYmd(`${y}-${mo}-${d}`) || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  const offsetMs = (Number(oh) * 60 + Number(om)) * 60_000 * (sign === '-' ? -1 : 1);
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offsetMs;
}

/** The Berlin day of an export date (the ExportDate value), or null when it is not one. */
export function exportDayOf(text: string): string | null {
  const ms = exportDateMs(text);
  return ms === null ? null : berlinYmd(new Date(ms));
}

function deviceOf(raw: string | undefined): Device {
  const model = raw === undefined ? undefined : MODEL.exec(raw)?.[1].trim();
  return model === 'Watch' ? 'watch' : model === 'iPhone' ? 'phone' : 'other';
}

/**
 * One line of export.xml. Null for anything that is not a `<Record` of a backfilled
 * type; 'unreadable' for such a record with a bad date or no value. Every opening
 * `<Record` tag of an Apple Health export sits on one line.
 */
export function parseRecordLine(line: string): HealthRecord | 'unreadable' | null {
  const text = line.trim();
  if (!text.startsWith('<Record ')) return null;
  const kind = KINDS.get(TYPE_ATTR.exec(text)?.[1] ?? '');
  if (!kind) return null;
  const attrs: Record<string, string> = {};
  for (const [, name, value] of text.matchAll(ATTR)) attrs[name] = decode(value);
  const startMs = exportDateMs(attrs.startDate);
  const endMs = exportDateMs(attrs.endDate);
  if (startMs === null || endMs === null || attrs.value === undefined) return 'unreadable';
  return { kind, startMs, endMs, value: attrs.value, device: deviceOf(attrs.device), source: attrs.sourceName ?? '' };
}

// ─── Days ────────────────────────────────────────────────────────────

/** Records grouped by the Berlin day of their start. */
export type DayIndex = Map<string, HealthRecord[]>;

export function indexByBerlinDay(records: Iterable<HealthRecord>): DayIndex {
  const index: DayIndex = new Map();
  for (const record of records) {
    const day = berlinYmd(new Date(record.startMs));
    const list = index.get(day);
    if (list) list.push(record);
    else index.set(day, [record]);
  }
  return index;
}

/** The fields only the importer writes; /api/health/ingest never sends them. */
export type ImportOnlyFields = {
  /** Minutes of Core sleep in the sleepMin night. */
  sleepCoreMin?: number;
  /** Minutes of Deep sleep in the sleepMin night. */
  sleepDeepMin?: number;
  /** Minutes of REM sleep in the sleepMin night. */
  sleepRemMin?: number;
  /** Minutes awake between the first asleep start and the last asleep end. */
  sleepAwakeMin?: number;
  /** Apple exercise minutes of the day, Watch samples only. */
  exerciseMin?: number;
};

export type ImportFields = HealthFields & ImportOnlyFields;

export type ImportDropReason = DropReason | 'stage_sum_mismatch' | 'no_sleep_min';

/** A refused value; importer fields are named `import.<field>`. */
export type ImportDropped = { field: string; reason: ImportDropReason };

export type BuiltDay = {
  date: string;
  /** What /api/health/ingest would store for this day plus the importer fields, `date` and `updatedAt` aside. */
  fields: ImportFields;
  /** Values the ingest rules or the importer rules refused. */
  dropped: ImportDropped[];
  /** Which device's sum became `steps`. */
  stepsFrom?: 'watch' | 'phone';
  /** Samples left out by the device rule. */
  excluded: { steps: number; activeKcal: number; exerciseMin: number };
  notes: string[];
};

const HOUR_MS = 3_600_000;
const ASLEEP = 'HKCategoryValueSleepAnalysisAsleep';
const AWAKE = 'HKCategoryValueSleepAnalysisAwake';
const STAGE_VALUES = new Set([`${ASLEEP}Core`, `${ASLEEP}Deep`, `${ASLEEP}REM`]);

/** The sleep stage fields: a group written all four or none. */
export const STAGE_FIELDS = ['sleepCoreMin', 'sleepDeepMin', 'sleepRemMin', 'sleepAwakeMin'] as const;

type ImportRule = { decimals: number; min: number; max: number };

/** Ranges and rounding of the importer fields, in the shape of ingest.ts's rules. */
const IMPORT_RULES = {
  sleepCoreMin: { decimals: 0, min: 0, max: 1440 },
  sleepDeepMin: { decimals: 0, min: 0, max: 1440 },
  sleepRemMin: { decimals: 0, min: 0, max: 1440 },
  sleepAwakeMin: { decimals: 0, min: 0, max: 1440 },
  exerciseMin: { decimals: 0, min: 0, max: 1440 },
} satisfies Record<keyof ImportOnlyFields, ImportRule>;

/** Core + Deep + REM may exceed sleepMin by this much (each is rounded on its own). */
const STAGE_SUM_SLACK_MIN = 2;

/** The rounded value, or null when it is out of range. Rounds as ingest.ts does. */
function applyRule(value: number, rule: ImportRule): number | null {
  const factor = 10 ** rule.decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded < rule.min || rounded > rule.max ? null : rounded;
}

/** Raw stage minutes of one night, before rounding. */
export type StageMinutes = { core: number; deep: number; rem: number; awake: number };

/**
 * Rounds and checks the stage minutes of one night. All four fields or none: no
 * sleepMin, a field out of 0..1440, or Core + Deep + REM above sleepMin + 2 drops the group.
 */
export function finishSleepStages(
  raw: StageMinutes,
  sleepMin: number | undefined,
): { fields?: Required<Pick<ImportOnlyFields, (typeof STAGE_FIELDS)[number]>>; dropped: ImportDropped[] } {
  if (sleepMin === undefined) return { dropped: [{ field: 'import.sleepStages', reason: 'no_sleep_min' }] };
  const values = { sleepCoreMin: raw.core, sleepDeepMin: raw.deep, sleepRemMin: raw.rem, sleepAwakeMin: raw.awake };
  const fields: Record<string, number> = {};
  const dropped: ImportDropped[] = [];
  for (const field of STAGE_FIELDS) {
    const value = applyRule(values[field], IMPORT_RULES[field]);
    if (value === null) dropped.push({ field: `import.${field}`, reason: 'out_of_range' });
    else fields[field] = value;
  }
  if (dropped.length > 0) return { dropped };
  const stages = fields as Required<Pick<ImportOnlyFields, (typeof STAGE_FIELDS)[number]>>;
  if (stages.sleepCoreMin + stages.sleepDeepMin + stages.sleepRemMin > sleepMin + STAGE_SUM_SLACK_MIN) {
    return { dropped: [{ field: 'import.sleepStages', reason: 'stage_sum_mismatch' }] };
  }
  return { fields: stages, dropped: [] };
}

type Sample = { record: HealthRecord; value: number };

const byStart = (a: { startMs: number }, b: { startMs: number }) => a.startMs - b.startMs;
const iso = (ms: number) => new Date(ms).toISOString();
const mean = (samples: Sample[]) =>
  samples.length === 0 ? undefined : samples.reduce((sum, s) => sum + s.value, 0) / samples.length;

/** Builds day `ymd` from the index and runs it through the ingest rules. */
export function buildDay(index: DayIndex, ymd: string): BuiltDay {
  const records = [...(index.get(ymd) ?? [])].sort(byStart);
  const notes: string[] = [];
  const excluded = { steps: 0, activeKcal: 0, exerciseMin: 0 };

  const numbers = (kind: RecordKind): Sample[] =>
    records
      .filter(record => record.kind === kind)
      .flatMap(record => {
        const value = record.value.trim() === '' ? NaN : Number(record.value);
        if (Number.isFinite(value)) return [{ record, value }];
        notes.push(`${kind}: a sample with an unreadable value was skipped`);
        return [];
      });

  // Steps: the larger of the Watch and iPhone sums.
  let watchSteps: number | undefined;
  let phoneSteps: number | undefined;
  for (const { record, value } of numbers('steps')) {
    if (record.device === 'watch') watchSteps = (watchSteps ?? 0) + value;
    else if (record.device === 'phone') phoneSteps = (phoneSteps ?? 0) + value;
    else excluded.steps++;
  }
  let stepsFrom: BuiltDay['stepsFrom'];
  if (watchSteps !== undefined || phoneSteps !== undefined) {
    stepsFrom = phoneSteps !== undefined && (watchSteps === undefined || phoneSteps > watchSteps) ? 'phone' : 'watch';
  }
  const steps = stepsFrom === 'watch' ? watchSteps : stepsFrom === 'phone' ? phoneSteps : undefined;

  // Active kcal: the Watch only.
  let activeKcal: number | undefined;
  for (const { record, value } of numbers('activeKcal')) {
    if (record.device === 'watch') activeKcal = (activeKcal ?? 0) + value;
    else excluded.activeKcal++;
  }

  // Exercise minutes: the Watch only.
  let exerciseSum: number | undefined;
  for (const { record, value } of numbers('exerciseMin')) {
    if (record.device === 'watch') exerciseSum = (exerciseSum ?? 0) + value;
    else excluded.exerciseMin++;
  }

  const restingHrSamples = numbers('restingHr');
  if (restingHrSamples.length > 1) notes.push(`restingHr: ${restingHrSamples.length} samples, the last one is kept`);

  const today: Record<string, unknown> = {
    date: ymd,
    steps,
    activeKcal,
    restingHr: restingHrSamples.at(-1)?.value,
    hrvMs: mean(numbers('hrvMs')),
    respRate: mean(numbers('respRate')),
  };

  // Sleep: asleep segments from 18:00 of D-1 up to 12:00 of D. Each bound is counted back
  // from a Berlin midnight with no clock change in between, as ingest.ts does.
  const sleepFrom = berlinMidnightMs(ymd) - 6 * HOUR_MS;
  const sleepBefore = berlinMidnightMs(addDays(ymd, 1)) - 12 * HOUR_MS;
  let stageMinutes: StageMinutes | undefined;
  const segments = [...(index.get(addDays(ymd, -1)) ?? []), ...records].filter(
    r => r.kind === 'sleep' && r.value.startsWith(ASLEEP) && r.startMs >= sleepFrom && r.startMs < sleepBefore,
  );
  if (new Set(segments.map(s => s.source)).size > 1) {
    notes.push('sleep: asleep segments from more than one source, no sleep written');
  } else if (segments.length > 0) {
    today.sleepMin = segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0) / 60_000;
    today.sleepStart = iso(Math.min(...segments.map(s => s.startMs)));
    today.sleepEnd = iso(Math.max(...segments.map(s => s.endMs)));
    if (segments.some(s => STAGE_VALUES.has(s.value))) {
      const minutes = (list: HealthRecord[]) => list.reduce((sum, s) => sum + (s.endMs - s.startMs), 0) / 60_000;
      const stage = (value: string) => minutes(segments.filter(s => s.value === value));
      const first = Math.min(...segments.map(s => s.startMs));
      const last = Math.max(...segments.map(s => s.endMs));
      const awake = [...(index.get(addDays(ymd, -1)) ?? []), ...records].filter(
        r => r.kind === 'sleep' && r.value === AWAKE && r.source === segments[0].source && r.startMs >= first && r.startMs < last,
      );
      stageMinutes = {
        core: stage(`${ASLEEP}Core`),
        deep: stage(`${ASLEEP}Deep`),
        rem: stage(`${ASLEEP}REM`),
        awake: minutes(awake),
      };
    }
  }

  const payload: Record<string, unknown> = { v: 1, today };

  // Weigh-in: the last instant of the day with a scale sample.
  const scale = [...numbers('bodyMass'), ...numbers('bodyFat')];
  if (scale.length > 0) {
    const at = Math.max(...scale.map(s => s.record.startMs));
    const atLast = (kind: RecordKind) => scale.filter(s => s.record.kind === kind && s.record.startMs === at).at(-1)?.value;
    const fraction = atLast('bodyFat');
    payload.weighIn = { weightKg: atLast('bodyMass'), bodyFatPct: fraction === undefined ? undefined : fraction * 100, at: iso(at) };
  }

  const vo2 = numbers('vo2max').at(-1);
  if (vo2) payload.vo2max = { value: vo2.value, at: iso(vo2.record.startMs) };

  // The last millisecond of D in Berlin: D is "today", and every instant of D is in the past.
  const parsed = parseHealthPayload(payload, new Date(berlinMidnightMs(addDays(ymd, 1)) - 1));
  const strays = Object.keys(parsed.days).filter(date => date !== ymd);
  if (strays.length > 0) throw new Error(`backfill: day ${ymd} produced values for ${strays.join(', ')}`);

  // The importer fields, on top of what the ingest rules kept.
  const fields: ImportFields = { ...(parsed.days[ymd] ?? {}) };
  const dropped: ImportDropped[] = [...parsed.dropped];
  if (exerciseSum !== undefined) {
    const value = applyRule(exerciseSum, IMPORT_RULES.exerciseMin);
    if (value === null) dropped.push({ field: 'import.exerciseMin', reason: 'out_of_range' });
    else fields.exerciseMin = value;
  }
  if (stageMinutes !== undefined) {
    const stages = finishSleepStages(stageMinutes, fields.sleepMin);
    dropped.push(...stages.dropped);
    if (stages.fields) Object.assign(fields, stages.fields);
  }

  return { date: ymd, fields, dropped, stepsFrom, excluded, notes };
}

// ─── Activity summary (dry-run check of exerciseMin) ─────────────────

/** One `<ActivitySummary` line: its day and Apple's exercise minutes, or null. */
export function parseActivitySummaryLine(line: string): { date: string; exerciseMin: number } | null {
  const text = line.trim();
  if (!text.startsWith('<ActivitySummary ')) return null;
  const attrs: Record<string, string> = {};
  for (const [, name, value] of text.matchAll(ATTR)) attrs[name] = value;
  const raw = attrs.appleExerciseTime;
  if (!isRealYmd(attrs.dateComponents) || raw === undefined || !/^\d+(\.\d+)?$/.test(raw)) return null;
  return { date: attrs.dateComponents, exerciseMin: Number(raw) };
}

/**
 * Compares the built exerciseMin with Apple's daily summary over `dates`. A day with a
 * summary and no Watch sample counts as 0 minutes; a built day with no summary is counted apart.
 */
export function compareExerciseMin(
  built: ReadonlyMap<string, ImportFields>,
  summaries: ReadonlyMap<string, number>,
  dates: readonly string[],
): { match: number; differ: number; noSummary: number } {
  const counts = { match: 0, differ: 0, noSummary: 0 };
  for (const date of dates) {
    const mine = built.get(date)?.exerciseMin;
    const apple = summaries.get(date);
    if (apple === undefined) {
      if (mine !== undefined) counts.noSummary++;
    } else if ((mine ?? 0) === apple) {
      counts.match++;
    } else {
      counts.differ++;
    }
  }
  return counts;
}

// ─── Golden check ────────────────────────────────────────────────────

const NUMBER_FIELDS = new Set<string>([
  'steps', 'activeKcal', 'restingHr', 'hrvMs', 'respRate', 'sleepMin', 'weightKg', 'bodyFatPct', 'vo2max',
  ...STAGE_FIELDS, 'exerciseMin',
]);
const TIME_FIELDS = new Set<string>(['weighInAt', 'sleepStartAt', 'sleepEndAt', 'vo2maxAt']);
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * One expected value. A number field takes a number and a tolerance in its own unit.
 * A time field (weighInAt, sleepStartAt, sleepEndAt, vo2maxAt) takes an ISO time with
 * an offset and a tolerance in seconds.
 */
export type GoldenEntry = { date: string; field: keyof ImportFields; expected: number | string; tolerance: number };

export type GoldenResult = GoldenEntry & {
  /** The built value: a number, or epoch ms for a time field. Absent when the day has none. */
  actual?: number;
  pass: boolean;
};

/** Validates a parsed golden file: an array of { date, field, expected, tolerance }. */
export function readGoldenEntries(raw: unknown): GoldenEntry[] {
  if (!Array.isArray(raw)) throw new Error('golden: the file must hold a JSON array');
  return raw.map((entry: unknown, i) => {
    const e = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const isTime = TIME_FIELDS.has(String(e.field));
    const fail = (why: string) => new Error(`golden: entry ${i}: ${why}`);
    if (!isRealYmd(e.date)) throw fail('date is not a real YYYY-MM-DD day');
    if (!isTime && !NUMBER_FIELDS.has(String(e.field))) throw fail('unknown field');
    if (typeof e.tolerance !== 'number' || !Number.isFinite(e.tolerance) || e.tolerance < 0) throw fail('tolerance must be a number >= 0');
    if (isTime ? typeof e.expected !== 'string' || !ISO_WITH_OFFSET.test(e.expected) || !Number.isFinite(Date.parse(e.expected))
      : typeof e.expected !== 'number' || !Number.isFinite(e.expected)) {
      throw fail(isTime ? 'expected must be an ISO time with an offset' : 'expected must be a number');
    }
    return { date: e.date, field: e.field as keyof ImportFields, expected: e.expected as number | string, tolerance: e.tolerance };
  });
}

/** Compares each entry with the built days. A missing day or field fails. */
export function checkGolden(entries: GoldenEntry[], days: ReadonlyMap<string, ImportFields>): GoldenResult[] {
  return entries.map(entry => {
    const actual = days.get(entry.date)?.[entry.field];
    if (actual === undefined) return { ...entry, pass: false };
    const pass =
      typeof entry.expected === 'string'
        ? Math.abs(actual - Date.parse(entry.expected)) <= entry.tolerance * 1000
        : Math.abs(actual - entry.expected) <= entry.tolerance + 1e-9;
    return { ...entry, actual, pass };
  });
}

// ─── Reviewed day files ──────────────────────────────────────────────

/** The fields a day file may hold besides `date`: what the ingest route stores plus the importer fields. */
const DAY_FIELDS = new Set<string>([...NUMBER_FIELDS, ...TIME_FIELDS]);
const DAY_FILE_NAME = /^(\d{4}-\d{2}-\d{2})\.json$/;

/** One reviewed day: its date and its stored fields, all finite numbers. */
export type DayDoc = { date: string; fields: Record<string, number> };

/** One entry of the reviewed folder; `text` is null for anything that is not a file. */
export type DayFile = { name: string; text: string | null };

export type DayFilesCheck = { ok: true; days: DayDoc[] } | { ok: false; errors: string[] };

/**
 * Checks the reviewed dry-run folder before anything is written: exactly `expectDays`
 * entries, each named YYYY-MM-DD.json after its own `date`, inside `range`, with only
 * known fields holding finite numbers, and the stage fields all four or none, with
 * sleepMin. Errors name files and fields, never values.
 */
export function checkDayFiles(files: DayFile[], expectDays: number, range: ImportRange): DayFilesCheck {
  const errors: string[] = [];
  if (!Number.isInteger(expectDays) || expectDays < 1) errors.push('--expect-days must be a whole number above 0');
  else if (files.length !== expectDays) errors.push(`the folder holds ${files.length} entries, expected ${expectDays}`);

  const days: DayDoc[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const problem = (why: string) => errors.push(`${file.name}: ${why}`);
    const date = DAY_FILE_NAME.exec(file.name)?.[1];
    if (date === undefined) {
      problem('the name is not YYYY-MM-DD.json');
      continue;
    }
    if (file.text === null) {
      problem('not a file');
      continue;
    }
    if (!isInRange(date, range)) {
      problem(`the date is outside ${range.from}..${range.to} or not a real day`);
      continue;
    }
    let doc: unknown;
    try {
      doc = JSON.parse(file.text);
    } catch {
      problem('not valid JSON');
      continue;
    }
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
      problem('not a JSON object');
      continue;
    }
    const entries = Object.entries(doc);
    if ((doc as Record<string, unknown>).date !== date) {
      problem('the file name is not its date');
      continue;
    }
    const fields: Record<string, number> = {};
    for (const [key, value] of entries) {
      if (key === 'date') continue;
      if (!DAY_FIELDS.has(key)) problem(`unknown field ${key}`);
      else if (typeof value !== 'number' || !Number.isFinite(value)) problem(`${key} is not a finite number`);
      else fields[key] = value;
    }
    const stageCount = STAGE_FIELDS.filter(field => field in fields).length;
    if (stageCount > 0 && (stageCount < STAGE_FIELDS.length || fields.sleepMin === undefined)) {
      problem('the sleep stage fields must come all four, with sleepMin');
    }
    days.push({ date, fields });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, days };
}

// ─── Fill-only planner ───────────────────────────────────────────────

/**
 * Fields that only make sense together. A group is filled only when the doc has none of
 * its fields; a group the doc has in part is skipped whole, so one day never mixes, say,
 * a Shortcut weight with an exported weigh-in time. Every day field is in one group.
 */
export const FIELD_GROUPS: readonly { name: string; fields: readonly string[] }[] = [
  { name: 'steps', fields: ['steps'] },
  { name: 'activeKcal', fields: ['activeKcal'] },
  { name: 'restingHr', fields: ['restingHr'] },
  { name: 'hrvMs', fields: ['hrvMs'] },
  { name: 'respRate', fields: ['respRate'] },
  { name: 'sleepMin', fields: ['sleepMin'] },
  { name: 'sleepWindow', fields: ['sleepStartAt', 'sleepEndAt'] },
  { name: 'weighIn', fields: ['weightKg', 'bodyFatPct', 'weighInAt'] },
  { name: 'vo2max', fields: ['vo2max', 'vo2maxAt'] },
  { name: 'sleepStages', fields: STAGE_FIELDS },
  { name: 'exerciseMin', fields: ['exerciseMin'] },
];

/** A stored sleepMin further than this from the built one skips the stage group. */
const SLEEP_MATCH_MIN = 2;

export type SkipReason = 'partly_present' | 'sleep_mismatch';

/** What the importer does with one day. `fields` are the ones it creates or fills. */
export type DayPlan = {
  date: string;
  outcome: 'create' | 'fill' | 'unchanged';
  fields: Record<string, number>;
  skipped: { group: string; reason: SkipReason }[];
};

/**
 * Fill only. A missing doc (`existing` null) is created with every built field. For an
 * existing doc, a group is filled with its built fields only when the doc has none of
 * the group's fields; a key counts as present whatever its value (also null or a
 * string), and a present key is never written. A group whose built fields are all
 * present is left alone silently; a group present in part is skipped and reported. The
 * stage group is also skipped (sleep_mismatch) when the doc's sleepMin is not a number
 * or differs from the built sleepMin by more than 2 minutes.
 */
export function planDay(existing: Record<string, unknown> | null, day: DayDoc): DayPlan {
  if (existing === null) {
    const create = Object.keys(day.fields).length > 0;
    return { date: day.date, outcome: create ? 'create' : 'unchanged', fields: create ? { ...day.fields } : {}, skipped: [] };
  }
  const has = (field: string) => Object.prototype.hasOwnProperty.call(existing, field);
  const fields: Record<string, number> = {};
  const skipped: DayPlan['skipped'] = [];
  for (const group of FIELD_GROUPS) {
    const built = group.fields.filter(field => day.fields[field] !== undefined);
    if (built.every(has)) continue;
    if (group.fields.some(has)) {
      skipped.push({ group: group.name, reason: 'partly_present' });
      continue;
    }
    if (group.name === 'sleepStages' && has('sleepMin')) {
      const stored = existing.sleepMin;
      const mine = day.fields.sleepMin;
      if (typeof stored !== 'number' || !Number.isFinite(stored) || mine === undefined || Math.abs(stored - mine) > SLEEP_MATCH_MIN) {
        skipped.push({ group: group.name, reason: 'sleep_mismatch' });
        continue;
      }
    }
    for (const field of built) fields[field] = day.fields[field];
  }
  return { date: day.date, outcome: Object.keys(fields).length > 0 ? 'fill' : 'unchanged', fields, skipped };
}

// ─── Plan and write ──────────────────────────────────────────────────

/** The part of a document snapshot the importer reads. */
export type ImportSnapshot = { exists: boolean; data(): Record<string, unknown> | undefined };

/** --plan: a document can only be read. No create, update, set, delete or transaction exists here. */
export type ImportPlanDb = { doc(path: string): { get(): Promise<ImportSnapshot> } };

export type ImportDocRef = { readonly path: string };

/** --write: one transaction per day that reads, then creates or updates. No set or delete exists here. */
export type ImportTransaction = {
  get(ref: ImportDocRef): Promise<ImportSnapshot>;
  create(ref: ImportDocRef, data: Record<string, unknown>): unknown;
  update(ref: ImportDocRef, data: Record<string, unknown>): unknown;
};

/** The slice of the Admin SDK's Firestore the write may use. `adminDb()` satisfies it. */
export type ImportWriteDb = {
  doc(path: string): ImportDocRef;
  runTransaction<T>(fn: (tx: ImportTransaction) => Promise<T>): Promise<T>;
};

type ImportBaseDeps = {
  /** Holds MCP_OWNER_UID, read from .env.local by the script. */
  env: Record<string, string | undefined>;
  isAdminConfigured: () => boolean;
  /** Decides Berlin today for the range check; the real clock by default. */
  now?: () => Date;
};

export type ImportPlanDeps = ImportBaseDeps & {
  /** Called only after the uid, Admin SDK, range and day checks pass. */
  db: () => ImportPlanDb;
};

export type ImportWriteDeps = ImportBaseDeps & {
  /** Called only after the uid, Admin SDK, range and day checks pass. */
  db: () => ImportWriteDb;
  /** The Admin SDK's `FieldValue.serverTimestamp()`; stamps `updatedAt` on a create or a fill. */
  serverTimestamp: () => unknown;
};

export type ImportRunResult =
  | { status: 'refused'; reason: 'owner_config' | 'admin_config' | 'bad_range' | 'bad_day' }
  | {
      status: 'done' | 'stopped';
      /** One plan per day handled, in date order. */
      plans: DayPlan[];
      /** The day that stopped the run and the error code only (a message can hold the doc path). */
      failed?: { date: string; code: string };
    };

/** The owner uid with the ingest handler's checks (readKeyConfig): trimmed, not empty, one path segment. */
export function readOwnerUid(env: Record<string, string | undefined>): string | null {
  const uid = env.MCP_OWNER_UID?.trim();
  return uid && !uid.includes('/') ? uid : null;
}

function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'number' || typeof code === 'string' ? String(code) : 'unknown';
}

/** The checks both modes run before the db is opened. */
function precheck(deps: ImportBaseDeps, range: ImportRange, days: DayDoc[]): { uid: string } | ImportRunResult {
  const uid = readOwnerUid(deps.env);
  if (!uid) return { status: 'refused', reason: 'owner_config' };
  if (!deps.isAdminConfigured()) return { status: 'refused', reason: 'admin_config' };
  if (!checkImportRange(range.from, range.to, berlinYmd(deps.now?.() ?? new Date())).ok) return { status: 'refused', reason: 'bad_range' };
  const valid = days.every(
    day =>
      isInRange(day.date, range) &&
      Object.entries(day.fields).every(([key, value]) => DAY_FIELDS.has(key) && Number.isFinite(value)),
  );
  if (!valid) return { status: 'refused', reason: 'bad_day' };
  return { uid };
}

/** Runs `step` per day in date order; the first error stops the run. */
async function eachDay(days: DayDoc[], step: (day: DayDoc) => Promise<DayPlan>): Promise<ImportRunResult> {
  const plans: DayPlan[] = [];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    try {
      plans.push(await step(day));
    } catch (error) {
      return { status: 'stopped', plans, failed: { date: day.date, code: errorCode(error) } };
    }
  }
  return { status: 'done', plans };
}

/** --plan: reads each day's doc with get and returns what --write would do. Writes nothing. */
export async function planImportDays(deps: ImportPlanDeps, range: ImportRange, days: DayDoc[]): Promise<ImportRunResult> {
  const checked = precheck(deps, range, days);
  if (!('uid' in checked)) return checked;
  const db = deps.db();
  return eachDay(days, async day => {
    const snapshot = await db.doc(`users/${checked.uid}/health/${day.date}`).get();
    return planDay(snapshot.exists ? (snapshot.data() ?? {}) : null, day);
  });
}

/**
 * --write: one transaction per day, in date order. It reads the doc, then creates a
 * missing doc with `date`, the fields and `updatedAt`, or updates an existing one with
 * the missing fields and `updatedAt`. A day with nothing to fill gets no write. Any
 * error stops the run; a rerun finds the days already done unchanged.
 */
export async function writeImportDays(deps: ImportWriteDeps, range: ImportRange, days: DayDoc[]): Promise<ImportRunResult> {
  const checked = precheck(deps, range, days);
  if (!('uid' in checked)) return checked;
  const db = deps.db();
  return eachDay(days, day => {
    const ref = db.doc(`users/${checked.uid}/health/${day.date}`);
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const plan = planDay(snapshot.exists ? (snapshot.data() ?? {}) : null, day);
      if (plan.outcome === 'create') tx.create(ref, { date: day.date, ...plan.fields, updatedAt: deps.serverTimestamp() });
      else if (plan.outcome === 'fill') tx.update(ref, { ...plan.fields, updatedAt: deps.serverTimestamp() });
      return plan;
    });
  });
}
