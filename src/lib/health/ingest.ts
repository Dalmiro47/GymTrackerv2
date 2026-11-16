// server-only: src/lib/health/ingest.ts
// Pure parsing and validation of the health payload an iOS Shortcut posts to
// /api/health/ingest. No Firebase import: the handler writes what this returns.
//
// Rules: "" or a missing value means "do not write that field" (never null, never a
// delete). A value that does not parse or is out of range drops that field only and
// is reported. A day block is accepted only for today or yesterday in Berlin; a
// weigh-in or a VO2 max sample goes to the Berlin day of its `at`, up to 30 days back.
// The sleep window of last night is read from the `today` block only, both times or none.
import { addDays, berlinMidnightMs, berlinYmd, isRealYmd } from '../mcp/week';

export type HealthFields = {
  steps?: number;
  activeKcal?: number;
  restingHr?: number;
  hrvMs?: number;
  respRate?: number;
  sleepMin?: number;
  weightKg?: number;
  bodyFatPct?: number;
  /** The weigh-in instant in epoch milliseconds. */
  weighInAt?: number;
  /** Start of last night's sleep window (awake time included), epoch ms. */
  sleepStartAt?: number;
  /** End of last night's sleep window, epoch ms. */
  sleepEndAt?: number;
  /** Apple Watch Cardio Fitness estimate, ml/kg/min, 1 decimal. */
  vo2max?: number;
  /** The VO2 max sample instant in epoch milliseconds. */
  vo2maxAt?: number;
};

export type DropReason =
  | 'not_a_number'
  | 'out_of_range'
  | 'invalid_block'
  | 'invalid_date'
  | 'date_out_of_window'
  | 'duplicate_date'
  | 'missing_at'
  | 'invalid_at'
  | 'at_out_of_window'
  | 'missing_pair'
  | 'bad_sleep_window';

export type Dropped = { field: string; reason: DropReason };

export type ParsedHealth = {
  /** Fields to write per Berlin day (YYYY-MM-DD). A day with no valid field is absent. */
  days: Record<string, HealthFields>;
  dropped: Dropped[];
};

/** How far back a weigh-in may be, in days. */
export const WEIGH_IN_MAX_AGE_DAYS = 30;
/** Clock skew allowed for a weigh-in in the future. */
const FUTURE_SKEW_MS = 5 * 60_000;
/** Clock skew allowed for the end of the sleep window, after the server's now. */
const SLEEP_END_SKEW_MS = 10 * 60_000;
/** The longest sleep window accepted. */
const SLEEP_MAX_MS = 16 * 3_600_000;
const HOUR_MS = 3_600_000;

type Rule = {
  decimals: number;
  min: number;
  max: number;
  /** A value that rounds to 0 means "no data": not written and not reported. */
  zeroIsEmpty?: boolean;
};

const DAY_RULES = {
  steps: { decimals: 0, min: 0, max: 100_000 },
  activeKcal: { decimals: 1, min: 0, max: 10_000 },
  restingHr: { decimals: 0, min: 25, max: 150 },
  hrvMs: { decimals: 1, min: 1, max: 300 },
  respRate: { decimals: 1, min: 4, max: 40 },
  sleepMin: { decimals: 0, min: 0, max: 1440, zeroIsEmpty: true },
} satisfies Record<string, Rule>;

const WEIGH_IN_RULES = {
  weightKg: { decimals: 2, min: 30, max: 250 },
  bodyFatPct: { decimals: 1, min: 3, max: 60 },
} satisfies Record<string, Rule>;

const VO2MAX_RULES = {
  value: { decimals: 1, min: 10, max: 90 },
} satisfies Record<string, Rule>;

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
/** A date-time with an explicit offset; a time with no zone is ambiguous. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

type NumberResult = { kind: 'empty' } | { kind: 'bad' } | { kind: 'ok'; value: number };

/**
 * A string or a finite number. A lone comma is the decimal point ("81,95");
 * a value with both a comma and a dot, more than one comma, hex or Infinity is bad.
 */
function readNumber(raw: unknown): NumberResult {
  if (raw === undefined || raw === null) return { kind: 'empty' };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { kind: 'ok', value: raw } : { kind: 'bad' };
  if (typeof raw !== 'string') return { kind: 'bad' };
  let text = raw.trim();
  if (text === '') return { kind: 'empty' };
  const commas = text.split(',').length - 1;
  if (commas > 1 || (commas === 1 && text.includes('.'))) return { kind: 'bad' };
  text = text.replace(',', '.');
  if (!DECIMAL.test(text)) return { kind: 'bad' };
  const value = Number(text);
  return Number.isFinite(value) ? { kind: 'ok', value } : { kind: 'bad' };
}

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

type InstantResult = { kind: 'empty' } | { kind: 'bad' } | { kind: 'ok'; ms: number };

/** An ISO date-time with an offset, as epoch ms. "", null or missing is empty. */
function readInstant(raw: unknown): InstantResult {
  const at = typeof raw === 'string' ? raw.trim() : raw;
  if (at === undefined || at === null || at === '') return { kind: 'empty' };
  const ms = typeof at === 'string' && ISO_WITH_OFFSET.test(at) ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? { kind: 'ok', ms } : { kind: 'bad' };
}

/**
 * Berlin clock bounds of the sleep window of day `ymd`. Clocks change only between
 * 02:00 and 03:00, so each bound is counted back from a midnight with no change between:
 * 18:00 of the previous day from midnight of `ymd`, 06:00 and 14:00 from the next midnight.
 */
function sleepBounds(ymd: string) {
  const nextMidnight = berlinMidnightMs(addDays(ymd, 1));
  return {
    earliestStart: berlinMidnightMs(ymd) - 6 * HOUR_MS,
    startBefore: nextMidnight - 18 * HOUR_MS,
    endBefore: nextMidnight - 10 * HOUR_MS,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the fields of `rules` from `block` into `out`, reporting each drop under `prefix`. */
function readFields(
  block: Record<string, unknown>,
  rules: Record<string, Rule>,
  prefix: string,
  out: Record<string, number>,
  dropped: Dropped[],
) {
  for (const [name, rule] of Object.entries(rules)) {
    const parsed = readNumber(block[name]);
    if (parsed.kind === 'empty') continue;
    if (parsed.kind === 'bad') {
      dropped.push({ field: `${prefix}.${name}`, reason: 'not_a_number' });
      continue;
    }
    const value = round(parsed.value, rule.decimals);
    if (rule.zeroIsEmpty && value === 0) continue;
    if (value < rule.min || value > rule.max) {
      dropped.push({ field: `${prefix}.${name}`, reason: 'out_of_range' });
      continue;
    }
    out[name] = value;
  }
}

/**
 * Parses an already-decoded payload object (the handler checks JSON, size and `v`).
 * Unknown keys and `sentAt` are ignored. `now` decides today in Berlin.
 */
export function parseHealthPayload(payload: Record<string, unknown>, now: Date): ParsedHealth {
  const today = berlinYmd(now);
  const yesterday = addDays(today, -1);
  const days: Record<string, HealthFields> = {};
  const dropped: Dropped[] = [];
  const seen = new Set<string>();

  const addToDay = (date: string, fields: Record<string, number>) => {
    if (Object.keys(fields).length === 0) return;
    days[date] = { ...days[date], ...fields };
  };

  // `today` first, so it wins when both blocks name the same date.
  for (const key of ['today', 'yesterday'] as const) {
    const block = payload[key];
    if (block === undefined || block === null) continue;
    if (!isObject(block)) {
      dropped.push({ field: key, reason: 'invalid_block' });
      continue;
    }
    const date = block.date;
    if (!isRealYmd(date)) {
      dropped.push({ field: `${key}.date`, reason: 'invalid_date' });
      continue;
    }
    if (date !== today && date !== yesterday) {
      dropped.push({ field: `${key}.date`, reason: 'date_out_of_window' });
      continue;
    }
    if (seen.has(date)) {
      dropped.push({ field: `${key}.date`, reason: 'duplicate_date' });
      continue;
    }
    seen.add(date);
    const fields: Record<string, number> = {};
    readFields(block, DAY_RULES, key, fields, dropped);
    if (key === 'today') readSleepWindow(block, date, fields);
    addToDay(date, fields);
  }

  /** Both sleep times or none; any failure drops both with the same reason. */
  function readSleepWindow(block: Record<string, unknown>, date: string, out: Record<string, number>) {
    const start = readInstant(block.sleepStart);
    const end = readInstant(block.sleepEnd);
    const dropBoth = (reason: DropReason) => {
      dropped.push({ field: 'today.sleepStart', reason }, { field: 'today.sleepEnd', reason });
    };
    if (start.kind === 'empty' && end.kind === 'empty') return;
    if (start.kind === 'empty' || end.kind === 'empty') return dropBoth('missing_pair');
    if (start.kind === 'bad' || end.kind === 'bad') return dropBoth('invalid_at');
    const bounds = sleepBounds(date);
    if (start.ms < bounds.earliestStart || end.ms > now.getTime() + SLEEP_END_SKEW_MS) {
      return dropBoth('at_out_of_window');
    }
    if (
      end.ms <= start.ms ||
      end.ms - start.ms > SLEEP_MAX_MS ||
      start.ms >= bounds.startBefore ||
      end.ms >= bounds.endBefore
    ) {
      return dropBoth('bad_sleep_window');
    }
    out.sleepStartAt = start.ms;
    out.sleepEndAt = end.ms;
  }

  /**
   * Writes `fields` plus `atField` to the Berlin day of `block.at`, from 30 days back
   * to a few minutes ahead. Shared by the weigh-in and VO2 max blocks.
   */
  const addByAt = (block: Record<string, unknown>, prefix: string, fields: Record<string, number>, atField: string) => {
    if (Object.keys(fields).length === 0) return;
    const at = readInstant(block.at);
    if (at.kind === 'empty') {
      dropped.push({ field: `${prefix}.at`, reason: 'missing_at' });
    } else if (at.kind === 'bad') {
      dropped.push({ field: `${prefix}.at`, reason: 'invalid_at' });
    } else {
      const date = berlinYmd(new Date(at.ms));
      const oldest = addDays(today, -WEIGH_IN_MAX_AGE_DAYS);
      if (date < oldest || date > today || at.ms > now.getTime() + FUTURE_SKEW_MS) {
        dropped.push({ field: `${prefix}.at`, reason: 'at_out_of_window' });
      } else {
        addToDay(date, { ...fields, [atField]: at.ms });
      }
    }
  };

  const weighIn = payload.weighIn;
  if (weighIn !== undefined && weighIn !== null) {
    if (!isObject(weighIn)) {
      dropped.push({ field: 'weighIn', reason: 'invalid_block' });
    } else {
      const fields: Record<string, number> = {};
      readFields(weighIn, WEIGH_IN_RULES, 'weighIn', fields, dropped);
      addByAt(weighIn, 'weighIn', fields, 'weighInAt');
    }
  }

  const vo2max = payload.vo2max;
  if (vo2max !== undefined && vo2max !== null) {
    if (!isObject(vo2max)) {
      dropped.push({ field: 'vo2max', reason: 'invalid_block' });
    } else {
      const read: Record<string, number> = {};
      readFields(vo2max, VO2MAX_RULES, 'vo2max', read, dropped);
      addByAt(vo2max, 'vo2max', read.value === undefined ? {} : { vo2max: read.value }, 'vo2maxAt');
    }
  }

  return { days, dropped };
}
