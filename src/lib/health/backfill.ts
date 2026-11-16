// server-only: src/lib/health/backfill.ts
// Pure core of the one-off Apple Health backfill (scripts/health-backfill/run.mts).
// It reads the lines of an Apple Health export (export.xml), builds one day the way
// the iOS Shortcut does, and runs that day through parseHealthPayload, so ranges,
// rounding and the sleep checks are exactly the ones /api/health/ingest applies.
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
import { addDays, berlinMidnightMs, berlinYmd, isRealYmd } from '../mcp/week';
import { parseHealthPayload, type Dropped, type HealthFields } from './ingest';

/** The backfill covers these Berlin days, both included. The Shortcut owns every later day. */
export const BACKFILL_FIRST_DAY = '2025-11-16';
export const BACKFILL_LAST_DAY = '2026-11-13';

/** True only for a real calendar day inside the backfill range. */
export function isBackfillDate(value: unknown): value is string {
  return isRealYmd(value) && value >= BACKFILL_FIRST_DAY && value <= BACKFILL_LAST_DAY;
}

/** Every day of the backfill range, oldest first. */
export function backfillDates(): string[] {
  const dates: string[] = [];
  for (let date = BACKFILL_FIRST_DAY; date <= BACKFILL_LAST_DAY; date = addDays(date, 1)) dates.push(date);
  return dates;
}

// ─── Export lines ────────────────────────────────────────────────────

export type RecordKind = 'steps' | 'activeKcal' | 'restingHr' | 'hrvMs' | 'respRate' | 'sleep' | 'bodyMass' | 'bodyFat' | 'vo2max';

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

export type BuiltDay = {
  date: string;
  /** What /api/health/ingest would store for this day, `date` and `updatedAt` aside. */
  fields: HealthFields;
  /** Values the ingest rules refused. */
  dropped: Dropped[];
  /** Which device's sum became `steps`. */
  stepsFrom?: 'watch' | 'phone';
  /** Samples left out by the device rule. */
  excluded: { steps: number; activeKcal: number };
  notes: string[];
};

const HOUR_MS = 3_600_000;
const ASLEEP = 'HKCategoryValueSleepAnalysisAsleep';

type Sample = { record: HealthRecord; value: number };

const byStart = (a: { startMs: number }, b: { startMs: number }) => a.startMs - b.startMs;
const iso = (ms: number) => new Date(ms).toISOString();
const mean = (samples: Sample[]) =>
  samples.length === 0 ? undefined : samples.reduce((sum, s) => sum + s.value, 0) / samples.length;

/** Builds day `ymd` from the index and runs it through the ingest rules. */
export function buildDay(index: DayIndex, ymd: string): BuiltDay {
  const records = [...(index.get(ymd) ?? [])].sort(byStart);
  const notes: string[] = [];
  const excluded = { steps: 0, activeKcal: 0 };

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
  const segments = [...(index.get(addDays(ymd, -1)) ?? []), ...records].filter(
    r => r.kind === 'sleep' && r.value.startsWith(ASLEEP) && r.startMs >= sleepFrom && r.startMs < sleepBefore,
  );
  if (new Set(segments.map(s => s.source)).size > 1) {
    notes.push('sleep: asleep segments from more than one source, no sleep written');
  } else if (segments.length > 0) {
    today.sleepMin = segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0) / 60_000;
    today.sleepStart = iso(Math.min(...segments.map(s => s.startMs)));
    today.sleepEnd = iso(Math.max(...segments.map(s => s.endMs)));
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

  return { date: ymd, fields: parsed.days[ymd] ?? {}, dropped: parsed.dropped, stepsFrom, excluded, notes };
}

// ─── Golden check ────────────────────────────────────────────────────

const NUMBER_FIELDS = new Set<string>(['steps', 'activeKcal', 'restingHr', 'hrvMs', 'respRate', 'sleepMin', 'weightKg', 'bodyFatPct', 'vo2max']);
const TIME_FIELDS = new Set<string>(['weighInAt', 'sleepStartAt', 'sleepEndAt', 'vo2maxAt']);
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * One expected value. A number field takes a number and a tolerance in its own unit.
 * A time field (weighInAt, sleepStartAt, sleepEndAt, vo2maxAt) takes an ISO time with
 * an offset and a tolerance in seconds.
 */
export type GoldenEntry = { date: string; field: keyof HealthFields; expected: number | string; tolerance: number };

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
    return { date: e.date, field: e.field as keyof HealthFields, expected: e.expected as number | string, tolerance: e.tolerance };
  });
}

/** Compares each entry with the built days. A missing day or field fails. */
export function checkGolden(entries: GoldenEntry[], days: ReadonlyMap<string, HealthFields>): GoldenResult[] {
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

/** The fields a day file may hold besides `date`: exactly what the ingest route stores. */
const DAY_FIELDS = new Set<string>([...NUMBER_FIELDS, ...TIME_FIELDS]);
const DAY_FILE_NAME = /^(\d{4}-\d{2}-\d{2})\.json$/;

/** One reviewed day: its date and its stored fields, all finite numbers. */
export type DayDoc = { date: string; fields: Record<string, number> };

/** One entry of the reviewed folder; `text` is null for anything that is not a file. */
export type DayFile = { name: string; text: string | null };

export type DayFilesCheck = { ok: true; days: DayDoc[] } | { ok: false; errors: string[] };

/**
 * Checks the reviewed dry-run folder before anything is written: exactly `expectDays`
 * entries, each named YYYY-MM-DD.json after its own `date`, inside the backfill range,
 * with only known fields holding finite numbers. Errors name files and fields, never values.
 */
export function checkDayFiles(files: DayFile[], expectDays: number): DayFilesCheck {
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
    if (!isBackfillDate(date)) {
      problem(`the date is outside ${BACKFILL_FIRST_DAY}..${BACKFILL_LAST_DAY} or not a real day`);
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
    days.push({ date, fields });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, days };
}

// ─── Write ───────────────────────────────────────────────────────────

/** A document reference that can only be created: no set, update or delete exists here. */
export type BackfillDocRef = { create(data: Record<string, unknown>): Promise<unknown> };

/** The slice of the Admin SDK's Firestore the write may use. `adminDb()` satisfies it. */
export type BackfillDb = { doc(path: string): BackfillDocRef };

export type BackfillWriteDeps = {
  /** Holds MCP_OWNER_UID, read from .env.local by the script. */
  env: Record<string, string | undefined>;
  isAdminConfigured: () => boolean;
  /** Called only after the uid, Admin SDK and day checks pass. */
  db: () => BackfillDb;
  /** The Admin SDK's `FieldValue.serverTimestamp()`; stamps `updatedAt`. */
  serverTimestamp: () => unknown;
};

export type BackfillWriteResult =
  | { status: 'refused'; reason: 'owner_config' | 'admin_config' | 'bad_day' }
  | {
      status: 'done' | 'stopped';
      written: string[];
      /** Days whose document already existed; never overwritten. */
      skipped: string[];
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

/** gRPC ALREADY_EXISTS is code 6; some wrappers give it a name instead. */
const isAlreadyExists = (code: string) => code === '6' || code === 'already-exists' || code === 'ALREADY_EXISTS';

/**
 * Creates one health doc per day, in date order, with `create` only, so an existing
 * doc is never overwritten: it is skipped and listed. Any other error stops the run.
 * A rerun after a stop skips the days already written.
 */
export async function writeBackfillDays(deps: BackfillWriteDeps, days: DayDoc[]): Promise<BackfillWriteResult> {
  const uid = readOwnerUid(deps.env);
  if (!uid) return { status: 'refused', reason: 'owner_config' };
  if (!deps.isAdminConfigured()) return { status: 'refused', reason: 'admin_config' };
  const valid = days.every(
    day =>
      isBackfillDate(day.date) &&
      Object.entries(day.fields).every(([key, value]) => DAY_FIELDS.has(key) && Number.isFinite(value)),
  );
  if (!valid) return { status: 'refused', reason: 'bad_day' };

  const db = deps.db();
  const written: string[] = [];
  const skipped: string[] = [];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    try {
      await db
        .doc(`users/${uid}/health/${day.date}`)
        .create({ date: day.date, ...day.fields, updatedAt: deps.serverTimestamp() });
      written.push(day.date);
    } catch (error) {
      const code = errorCode(error);
      if (!isAlreadyExists(code)) return { status: 'stopped', written, skipped, failed: { date: day.date, code } };
      skipped.push(day.date);
    }
  }
  return { status: 'done', written, skipped };
}
