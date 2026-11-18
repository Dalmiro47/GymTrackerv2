// Apple Health importer into users/{uid}/health/{YYYY-MM-DD}, run by hand every few
// weeks with a fresh export (npm run health:import).
//
// Every mode takes --from and --to (YYYY-MM-DD, Berlin days, both included): at most
// 366 days, --to before Berlin today (today belongs to the Shortcut). The dry run also
// needs --to before the Berlin day of the export's ExportDate (a partial last day would
// fill a missing field with a partial value). Four modes, one per run:
//
// 1. Dry run: reads an Apple Health export (export.xml) line by line, builds every day
//    of the range with the rules in src/lib/health/backfill.ts (the same ingest rules as
//    /api/health/ingest, plus the sleep stage and exercise-minute rules), and writes what
//    it would store. No Firestore.
//      npm run health:import -- --export <export.xml> --out <folder> --from <day> --to <day> [--golden <golden.json>]
//    --out     a new or empty folder. Gets days/YYYY-MM-DD.json (one file per day with
//              data) and report.txt. A folder that already holds them is refused.
//    --golden  optional JSON array of { date, field, expected, tolerance }. A number
//              field's tolerance is in its own unit; a time field (weighInAt,
//              sleepStartAt, sleepEndAt, vo2maxAt) takes an ISO time with an offset and
//              a tolerance in seconds. Golden days outside the range are built in memory
//              for the check only and are never written to days/.
//
// 2. Verify: runs only the checks on the reviewed day files. No .env.local, no Firebase.
//      npm run health:import -- --verify-days <days folder> --expect-days <n> --from <day> --to <day>
//
// 3. Plan: the same checks, then one Firestore get() per day, in date order, and prints
//    what --write would do per day. Writes nothing.
//      npm run health:import -- --plan --days <days folder> --expect-days <n> --from <day> --to <day>
//
// 4. Write: the same checks, then one Firestore transaction per day, in date order. Fill
//    only: a missing doc is created; an existing doc gets only the field groups it has
//    none of (see planDay); a field with a value is never overwritten. Prints per day:
//    created, filled (field names), unchanged, skipped groups. Any error stops the run;
//    a rerun finds the days already done unchanged.
//      npm run health:import -- --write --days <days folder> --expect-days <n> --from <day> --to <day>
//    Plan and write read FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
//    NEXT_PUBLIC_FIREBASE_PROJECT_ID and MCP_OWNER_UID from .env.local (the key on one
//    line with \n escapes). Never prints the uid, a credential, a value or a Firestore
//    error message (it can hold the path).
//
// Every path must be outside the repo: health values never enter it.
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BuiltDay, DayDoc, HealthRecord, ImportRange, ImportRunResult, RangeCheck } from '../../src/lib/health/backfill';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The repo has no "type": "module", so tsx loads the .ts modules as CommonJS, whose
// named exports Node cannot see from ESM; the module object is their default export.
const load = async <T,>(rel: string): Promise<T> => {
  const mod = await import(pathToFileURL(path.join(REPO, rel)).href);
  return (mod.default ?? mod) as T;
};
const {
  STAGE_FIELDS,
  buildDay,
  checkDayFiles,
  checkGolden,
  checkImportRange,
  compareExerciseMin,
  exportDayOf,
  indexByBerlinDay,
  isInRange,
  parseActivitySummaryLine,
  parseRecordLine,
  planImportDays,
  rangeDates,
  readGoldenEntries,
  writeImportDays,
} = await load<typeof import('../../src/lib/health/backfill')>('src/lib/health/backfill.ts');
const { addDays, berlinMidnightMs, berlinYmd } = await load<typeof import('../../src/lib/mcp/week')>('src/lib/mcp/week.ts');

const HOUR_MS = 3_600_000;
const FIELDS = [
  'steps', 'activeKcal', 'restingHr', 'hrvMs', 'respRate', 'sleepMin', 'sleepStartAt', 'sleepEndAt',
  'weightKg', 'bodyFatPct', 'weighInAt', 'vo2max', 'vo2maxAt',
  'sleepCoreMin', 'sleepDeepMin', 'sleepRemMin', 'sleepAwakeMin', 'exerciseMin',
] as const;

function fail(message: string): never {
  console.error(`health-backfill: ${message}`);
  process.exit(1);
}

// ─── Arguments ───────────────────────────────────────────────────────

const VALUE_OPTIONS = ['--export', '--out', '--golden', '--verify-days', '--days', '--expect-days', '--from', '--to'];
const FLAG_OPTIONS = ['--write', '--plan'];
const MODES = {
  dryRun: ['--export', '--out', '--golden', '--from', '--to'],
  verify: ['--verify-days', '--expect-days', '--from', '--to'],
  plan: ['--plan', '--days', '--expect-days', '--from', '--to'],
  write: ['--write', '--days', '--expect-days', '--from', '--to'],
};
const MODE_NAMES = { dryRun: 'a dry run', verify: '--verify-days', plan: '--plan', write: '--write' };

const opts = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const name = argv[i];
  if (FLAG_OPTIONS.includes(name)) {
    opts.set(name, '');
  } else if (VALUE_OPTIONS.includes(name)) {
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) fail(`${name} needs a value`);
    opts.set(name, value);
  } else {
    fail(`unknown argument ${name}`);
  }
}

if (opts.has('--write') && opts.has('--plan')) fail('--write and --plan cannot be used together');
const mode = opts.has('--write') ? 'write' : opts.has('--plan') ? 'plan' : opts.has('--verify-days') ? 'verify' : 'dryRun';
const strays = [...opts.keys()].filter(name => !MODES[mode].includes(name));
if (strays.length > 0) fail(`${strays.join(', ')} cannot be used with ${MODE_NAMES[mode]}`);

const insideRepo = (p: string) => {
  const rel = path.relative(REPO, path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const required = (name: string) => opts.get(name) ?? fail(`missing ${name}`);

function outsideRepo(name: string, p: string): string {
  if (insideRepo(p)) fail(`${name} must be outside the repo`);
  return p;
}

// ─── Range ───────────────────────────────────────────────────────────

const today = berlinYmd(new Date());

function rangeOrFail(check: RangeCheck): ImportRange {
  if (check.ok) return check.range;
  console.error('health-backfill: refused, the range is not valid:');
  for (const error of check.errors) console.error(`  ${error}`);
  process.exit(1);
}

// ─── Reviewed day files (verify, plan and write) ────────────────────

function readReviewedDays(folderOption: string, range: ImportRange): DayDoc[] {
  const folder = outsideRepo(folderOption, required(folderOption));
  const expectText = required('--expect-days');
  if (!/^\d+$/.test(expectText)) fail('--expect-days must be a whole number');
  if (!existsSync(folder)) fail(`the ${folderOption} folder does not exist`);
  const files = readdirSync(folder, { withFileTypes: true }).map(entry => ({
    name: entry.name,
    text: entry.isFile() ? readFileSync(path.join(folder, entry.name), 'utf8') : null,
  }));
  const check = checkDayFiles(files, Number(expectText), range);
  if (!check.ok) {
    console.error(`health-backfill: ${check.errors.length} problem(s) in the day files, nothing was written:`);
    for (const error of check.errors) console.error(`  ${error}`);
    process.exit(1);
  }
  return check.days;
}

const rangeOf = (days: DayDoc[]) => (days.length ? `${days[0].date} to ${days[days.length - 1].date}` : 'none');

if (mode === 'verify') {
  const range = rangeOrFail(checkImportRange(required('--from'), required('--to'), today));
  const days = readReviewedDays('--verify-days', range);
  console.log(`health-backfill: verify OK, ${days.length} day files, ${rangeOf(days)}`);
  process.exit(0);
}

/** Prints one line per day (field and group names only, never a value) and the totals. */
function printPlans(result: Extract<ImportRunResult, { plans: unknown }>, wouldPrefix: string) {
  const counts = { create: 0, fill: 0, unchanged: 0 };
  const skippedBy = new Map<string, number>();
  for (const plan of result.plans) {
    counts[plan.outcome]++;
    for (const s of plan.skipped) skippedBy.set(s.reason, (skippedBy.get(s.reason) ?? 0) + 1);
    const names = Object.keys(plan.fields).join(', ');
    const what =
      plan.outcome === 'create' ? `${wouldPrefix}created: ${names}` : plan.outcome === 'fill' ? `${wouldPrefix}filled: ${names}` : 'unchanged';
    const skipped = plan.skipped.map(s => `${s.group} (${s.reason})`).join(', ');
    console.log(`  ${plan.date} ${what}${skipped ? `; skipped ${skipped}` : ''}`);
  }
  console.log(
    `health-backfill: ${wouldPrefix}created ${counts.create}, ${wouldPrefix}filled ${counts.fill}, unchanged ${counts.unchanged} days; ` +
      `skipped groups: ${[...skippedBy].map(([reason, n]) => `${reason} ${n}`).join(', ') || 'none'}`,
  );
}

if (mode === 'plan' || mode === 'write') {
  const range = rangeOrFail(checkImportRange(required('--from'), required('--to'), today));
  const days = readReviewedDays('--days', range);
  const envPath = path.join(REPO, '.env.local');
  if (!existsSync(envPath)) fail('.env.local not found in the repo root');
  const envText = readFileSync(envPath, 'utf8');
  const readEnv = (name: string) => new RegExp(`^${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(envText)?.[1];
  // firebaseAdmin.ts reads these once, when it is imported.
  for (const name of ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID']) {
    const value = readEnv(name);
    if (value !== undefined) process.env[name] = value;
  }
  const admin = await load<typeof import('../../src/lib/firebaseAdmin')>('src/lib/firebaseAdmin.ts');
  const base = { env: { MCP_OWNER_UID: readEnv('MCP_OWNER_UID') }, isAdminConfigured: admin.isAdminConfigured };

  let result: ImportRunResult;
  if (mode === 'plan') {
    console.log(`health-backfill: planning ${days.length} days, ${rangeOf(days)}, read only (get)...`);
    result = await planImportDays({ ...base, db: () => admin.adminDb() }, range, days);
  } else {
    const { FieldValue } = await import('firebase-admin/firestore');
    console.log(`health-backfill: writing ${days.length} days, ${rangeOf(days)}, fill only...`);
    result = await writeImportDays(
      { ...base, db: () => admin.adminDb(), serverTimestamp: () => FieldValue.serverTimestamp() },
      range,
      days,
    );
  }
  if (result.status === 'refused') {
    const why = {
      owner_config: 'MCP_OWNER_UID is missing or not one path segment in .env.local',
      admin_config: 'the Admin SDK is not configured (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID)',
      bad_range: 'the range is not valid (--to must be before Berlin today)',
      bad_day: 'a day failed the checks',
    }[result.reason];
    fail(`refused, nothing was ${mode === 'plan' ? 'read' : 'written'}: ${why}`);
  }
  printPlans(result, mode === 'plan' ? 'would be ' : '');
  if (result.status === 'stopped' && result.failed) {
    console.error(`health-backfill: STOPPED at ${result.failed.date}, error code ${result.failed.code}`);
    console.error(`health-backfill: days done before it: ${result.plans.map(p => p.date).join(', ') || 'none'}`);
    process.exit(1);
  }
  process.exit(0);
}

// ─── Dry run ─────────────────────────────────────────────────────────

const exportPath = outsideRepo('--export', required('--export'));
const outDir = outsideRepo('--out', required('--out'));
const goldenPath = opts.has('--golden') ? outsideRepo('--golden', required('--golden')) : undefined;
if (!existsSync(exportPath)) fail('the export file does not exist');

const daysDir = path.join(outDir, 'days');
const reportPath = path.join(outDir, 'report.txt');
if (existsSync(reportPath) || (existsSync(daysDir) && readdirSync(daysDir).length > 0)) {
  fail('the --out folder already holds a dry run; give a new or empty folder');
}

/** The Berlin day of the export's ExportDate, read from the head of the file; null when absent. */
async function readExportDay(file: string): Promise<string | null> {
  const input = createReadStream(file, { encoding: 'utf8' });
  const head = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const raw of head) {
      const text = raw.trimStart();
      if (text.startsWith('<ExportDate')) return exportDayOf(/value="([^"]*)"/.exec(text)?.[1] ?? '');
      if (text.startsWith('<Record ')) return null;
    }
    return null;
  } finally {
    head.close();
    input.destroy();
  }
}

const exportDay = await readExportDay(exportPath);
if (exportDay === null) fail('the export has no readable ExportDate before its first record');
const range = rangeOrFail(checkImportRange(required('--from'), required('--to'), today, exportDay));

let golden: ReturnType<typeof readGoldenEntries> = [];
if (goldenPath !== undefined) {
  try {
    golden = readGoldenEntries(JSON.parse(readFileSync(goldenPath, 'utf8')));
  } catch (error) {
    fail(error instanceof Error ? error.message : 'the golden file is not valid JSON');
  }
}

// Days to build: the range, plus any golden day outside it (check only).
const datesInRange = rangeDates(range);
const extraDates = [...new Set(golden.map(g => g.date))].filter(d => !isInRange(d, range)).sort();
const allDates = [...datesInRange, ...extraDates].sort();
// Sleep of the first day starts at 18:00 the day before.
const windowStart = berlinMidnightMs(allDates[0]) - 6 * HOUR_MS;
const windowEnd = berlinMidnightMs(addDays(allDates[allDates.length - 1], 1));

const records: HealthRecord[] = [];
let exportDate = '(not found)';
let unreadable = 0;
let inCorrelation = false;
let insideCorrelation = 0;
/** Apple's daily exercise minutes by day, to check exerciseMin. */
const summaries = new Map<string, number>();
const lines = createInterface({ input: createReadStream(exportPath, { encoding: 'utf8' }), crlfDelay: Infinity });
for await (const raw of lines) {
  const text = raw.trimStart();
  if (text.startsWith('<ExportDate')) exportDate = /value="([^"]*)"/.exec(text)?.[1] ?? exportDate;
  if (text.startsWith('<ActivitySummary ')) {
    const summary = parseActivitySummaryLine(text);
    if (summary !== null) summaries.set(summary.date, summary.exerciseMin);
    continue;
  }
  // A record inside a Correlation is also exported at the top level: count it once.
  if (text.startsWith('<Correlation')) inCorrelation = !text.trimEnd().endsWith('/>');
  else if (text.startsWith('</Correlation')) inCorrelation = false;
  if (!text.startsWith('<Record ')) continue;
  const record = parseRecordLine(text);
  if (record === null) continue;
  if (inCorrelation) {
    insideCorrelation++;
    continue;
  }
  if (record === 'unreadable') {
    unreadable++;
    continue;
  }
  if (record.startMs >= windowStart && record.startMs < windowEnd) records.push(record);
}

const index = indexByBerlinDay(records);
const built = new Map<string, BuiltDay>(allDates.map(date => [date, buildDay(index, date)]));
const rangeDays = datesInRange.map(date => built.get(date)!);

mkdirSync(daysDir, { recursive: true });
let filesWritten = 0;
for (const day of rangeDays) {
  if (!isInRange(day.date, range)) fail(`refused to write ${day.date}: outside ${range.from}..${range.to}`);
  if (Object.keys(day.fields).length === 0) continue;
  writeFileSync(path.join(daysDir, `${day.date}.json`), `${JSON.stringify({ date: day.date, ...day.fields }, null, 2)}\n`);
  filesWritten++;
}

const out: string[] = [];
const kinds = new Map<string, number>();
for (const r of records) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);

out.push('Apple Health backfill: dry run (nothing was written to Firestore)');
out.push(`Export date: ${exportDate}`);
out.push(`Range: ${range.from} to ${range.to}, ${datesInRange.length} Berlin days (export day ${exportDay})`);
out.push(`Day files written: ${filesWritten} (days with at least one field)`);
out.push('');
out.push('Records read in the window (start from 18:00 of the day before the first day):');
for (const [kind, n] of [...kinds].sort()) out.push(`  ${kind}: ${n}`);
out.push(`  unreadable record lines: ${unreadable}`);
out.push(`  records inside a Correlation (skipped, exported again at top level): ${insideCorrelation}`);
const excludedSteps = rangeDays.reduce((n, d) => n + d.excluded.steps, 0);
const excludedKcal = rangeDays.reduce((n, d) => n + d.excluded.activeKcal, 0);
out.push(`  step samples from other devices (never counted): ${excludedSteps}`);
out.push(`  kcal samples not from the Watch (never counted): ${excludedKcal}`);
const excludedExercise = rangeDays.reduce((n, d) => n + d.excluded.exerciseMin, 0);
out.push(`  exercise-minute samples not from the Watch (never counted): ${excludedExercise}`);
out.push('');
out.push('Days per field (with / without):');
for (const field of FIELDS) {
  const n = rangeDays.filter(d => d.fields[field] !== undefined).length;
  out.push(`  ${field}: ${n} / ${rangeDays.length - n}`);
}
out.push('');
const watchDays = rangeDays.filter(d => d.stepsFrom === 'watch').length;
const phoneDays = rangeDays.filter(d => d.stepsFrom === 'phone').length;
out.push(`Steps taken from: Watch ${watchDays} days, iPhone ${phoneDays} days`);
out.push('');
const stageDays = rangeDays.filter(d => STAGE_FIELDS.every(field => d.fields[field] !== undefined)).length;
const exerciseDays = rangeDays.filter(d => d.fields.exerciseMin !== undefined).length;
const summaryCheck = compareExerciseMin(new Map(rangeDays.map(d => [d.date, d.fields])), summaries, datesInRange);
out.push(`Sleep stage days (all four fields): ${stageDays}`);
out.push(`exerciseMin days: ${exerciseDays}`);
out.push(
  `exerciseMin against Apple's ActivitySummary: match ${summaryCheck.match}, differ ${summaryCheck.differ}, ` +
    `exerciseMin without a summary ${summaryCheck.noSummary} (a summary day with no Watch sample counts as 0)`,
);
out.push('');
const empty = rangeDays.filter(d => Object.keys(d.fields).length === 0).map(d => d.date);
out.push(`Days with no data: ${empty.length}${empty.length ? `: ${empty.join(', ')}` : ''}`);
out.push('');
const dropped = rangeDays.flatMap(d => d.dropped.map(x => `  ${d.date} ${x.field}: ${x.reason}`));
const droppedBy = new Map<string, number>();
for (const d of rangeDays) for (const x of d.dropped) droppedBy.set(x.reason, (droppedBy.get(x.reason) ?? 0) + 1);
const droppedByText = [...droppedBy].sort().map(([reason, n]) => `${reason} ${n}`).join(', ') || 'none';
out.push(`Dropped values: ${dropped.length} (by reason: ${droppedByText})`);
out.push(...dropped);
out.push('');
const notes = rangeDays.flatMap(d => d.notes.map(n => `  ${d.date} ${n}`));
out.push(`Notes: ${notes.length}`);
out.push(...notes);

let goldenFailed = 0;
if (goldenPath !== undefined) {
  const results = checkGolden(golden, new Map([...built].map(([date, day]) => [date, day.fields])));
  goldenFailed = results.filter(r => !r.pass).length;
  out.push('');
  out.push(`Golden check: ${results.length - goldenFailed} PASS, ${goldenFailed} FAIL`);
  for (const r of results) {
    const isTime = typeof r.expected === 'string';
    const actual = r.actual === undefined ? 'missing' : isTime ? `${new Date(r.actual).toISOString()} (UTC)` : String(r.actual);
    out.push(`  ${r.pass ? 'PASS' : 'FAIL'} ${r.date} ${r.field}: expected ${r.expected}, actual ${actual}, tolerance ${r.tolerance}${isTime ? ' s' : ''}`);
  }
}

writeFileSync(reportPath, `${out.join('\n')}\n`);
console.log(`health-backfill: ${filesWritten} day files and report.txt written to the --out folder`);
console.log(`health-backfill: steps from Watch ${watchDays} days, iPhone ${phoneDays} days; ${dropped.length} dropped values; ${empty.length} days with no data`);
console.log(
  `health-backfill: sleep stage days ${stageDays}, exerciseMin days ${exerciseDays}; ActivitySummary match ` +
    `${summaryCheck.match}, differ ${summaryCheck.differ}, no summary ${summaryCheck.noSummary}; dropped by reason: ${droppedByText}`,
);
if (goldenPath !== undefined) console.log(`health-backfill: golden ${golden.length - goldenFailed} PASS, ${goldenFailed} FAIL`);
if (goldenFailed > 0) process.exitCode = 1;
