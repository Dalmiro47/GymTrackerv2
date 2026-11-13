## Constraints

Universal rules (cited as `CONSTRAINTS` plus a section number) load through the dds plugin import line in `~/.claude/CLAUDE.md`, not a file in this repo; a machine without that line has no constraints. This repo's own rules are under `## Project constraints`. If a task conflicts with a constraint, stop and surface the conflict; do not silently resolve it.

## Commands

```bash
npm run dev        # Dev server with Turbopack, default port 3000 (no -p flag is set, so NOT 9002)
npm run build      # Production build
npm run lint       # Next.js ESLint
npm run typecheck  # TypeScript check, no emit
npm run coach:eval -- [caseFilter] [--repeat=N] [--no-explain]   # Exercise-coach eval (real Groq calls, costs credit)
firebase deploy --only firestore:rules   # Owner only, from their own terminal (see Destructive Operations)
```

Tests: `npm test` (node:test through tsx; no env file, no network). Tests cover `src/lib/mcp/` and the pure doc builders in `src/lib/`; the rest is validated by TypeScript and linting.

`/dds:brain-sync` (shared skill from the dds-kit plugin) captures a session-state milestone to Open Brain via the `capture_thought` MCP tool.

## Environment

`.env.local` is gitignored and there is no example file; create it by hand.

- `NEXT_PUBLIC_FIREBASE_*`: Firebase project config
- `GROQ_API_KEY`: Groq API key (https://console.groq.com)
- `OPEN_ROUTER_API_KEY`: DEV-ONLY, used by `npm run coach:eval` for the judges; the app never reads it, so do not add it to Vercel
- `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`: service account (Admin SDK), used ONLY to write the daily AI quota counter. Absent = the app runs but limits are silently unenforced; `isAdminConfigured()` reports it and `/admin` shows a banner
- `MCP_ACCESS_KEY` / `MCP_OWNER_UID`: server-only, for the MCP endpoint; either one absent = every MCP request answers 401

## Map

Next.js 15 App Router; Firebase is the sole backend, with no custom API server for data. API routes exist only for the AI coach.

- Protected routes (auth-guarded via `src/hooks/use-require-auth.ts`): `src/app/(app)/`: `admin/`, `dashboard/`, `exercises/`, `log/`, `profile/`, `routines/`, `settings/profile/`
- Public auth page: `src/app/login/`
- Coach streaming chat (Groq): `src/app/api/coach/chat/route.ts`; coach allowance: `src/app/api/coach/usage/route.ts`
- Auth (Google Sign-In, provided at root layout): `src/contexts/AuthContext.tsx`
- Firestore CRUD: `src/services/` (`trainingLogService.ts`, `exerciseService.ts`, `routineService.ts`, `routineHistoryService.ts`, `feedbackService.ts`)
- Core logging state (session, date, routine auto-fill, performance history): `src/hooks/useTrainingLog.ts`
- Coach client state (SSE, ID token, per-day localStorage history): `src/hooks/use-coach-chat.ts`
- Coach pages: `/log` (workout), `/routines` (program analysis), dashboard (progression), `/exercises` (library gaps, mode `exercise-library`)
- Coach provider (`LLMProvider`, `GroqProvider`, `DEFAULT_MODEL`): `src/lib/ai/llm-provider.ts`
- Coach context serializers: `src/lib/ai/context-builders.ts`; system prompts (`SWAP_RANKING`, volume targets, overload logic, KNOWN EXERCISES): `src/lib/ai/chat-prompts.ts`
- Coach UI (own fixed panel, `SegmentRenderer`): `src/components/coach/CoachChatSheet.tsx`
- MCP server (owner's data, Admin SDK; 7 read tools, 6 write tools): `src/app/api/mcp/[key]/route.ts`, `src/lib/mcp/` (`auth.ts`, `repo.server.ts` reads, `repo.write.server.ts` writes, `tools.read.ts`, `tools.write.ts`, `week.ts` Berlin date and ISO week, `server.ts`); tests `*.test.ts` beside each module, run with `npm test`
- Doc builders shared by the app services and the MCP write tools: `src/lib/routineDoc.ts`, `src/lib/exerciseDoc.ts`, `src/lib/routineHistoryPlan.ts`
- Daily quota: `src/lib/usageQuota.ts`, `src/lib/limits.ts`, `src/lib/firebaseAdmin.ts`
- Language state (`LanguageProvider`, `gt-lang` mirror, `<html lang>`; set from `UserNav`, or `LanguageToggle` on `/login`): `src/contexts/LanguageContext.tsx`
- Dictionaries: `src/i18n/en.ts` (source of truth), `src/i18n/es.ts`; display helpers and `detectLanguage()`: `src/i18n/index.ts`
- Seeded exercises in Spanish: `src/lib/defaultExercises.es.ts`, applied by `src/lib/exerciseDisplay.ts`
- UI components: `src/components/ui/` (shadCN: Radix primitives + Tailwind); colors and fonts: `src/app/globals.css`, `tailwind.config.ts`
- Shell: `BottomNav` (mobile tab bar, `--bottomnav-height`), desktop-only sidebar, `AppBarActions` (page-injected app-bar buttons): `src/components/layout/`. The Training Log's Save/Delete sit in a floating dock centred in the content column at the AI Coach button's height (z-40, under the coach backdrop)
- Shared calendar UI (dashboard + log): `src/components/dashboard/WorkoutCalendar.tsx`, `src/components/training-log/WeekStrip.tsx`
- PWA (production only): `next.config.ts`; icon master `assets/brand/squat-master.png` (raster, not served), rendered by `scripts/gen-icons.mjs` to `public/icons/` and `src/app/favicon.ico`; `public/sw.js` is next-pwa build output, never hand-edited
- Types: `src/types/index.ts` (`Exercise`, `Routine`, `WorkoutLog`, `LoggedSet`, `UserProfile`), `src/types/setStructure.ts` (`normal`, `superset`, `triset`, `dropSet`, `restPause`); coach-profile `UserProfile` (goal, constraints, `language`): `src/lib/types.gym.ts`
- Coach eval: `scripts/coach-eval/run.mts`; report: `scripts/coach-eval/last-run.txt` (gitignored)
- Decision log: `docs/decisions.md`
- Mobile chat panel recipe: `docs/mobile-chat-panel.md`
- Firestore layout (rules: `firestore.rules`):

```
users/{userId}/
  profile/profile         # User profile
  exercises/{id}          # Exercise library
  routines/{id}           # Workout routines
  workoutLogs/{YYYY-MM-DD} # Daily logs
  performanceEntries/{exerciseId} # PRs & last performance
  routineHistory/{routineId_epochMs} # Routine change snapshots (flat; outlives deleted routines)
  stats/usage             # Daily AI quota: client read-only, Admin SDK writes
feedback/{docId}          # Top-level: anyone signed in may create, only the admin reads
```

## Glossary

- **row id**: `LoggedExercise.id`, composite `${exerciseId}-${date}-${ts}`, used by dnd-kit. Not the library id.
- **exerciseId**: `LoggedExercise.exerciseId`, the library `Exercise.id`.
- **prefill**: an exercise's sets copied from the last session when it is planned.
- **provisional**: `isProvisional`, an exercise whose sets still equal its `prefill`. UI-only, derived.
- **performed**: `LoggedExercise.performed`, persisted; `false` = planned, never lifted; `undefined` = performed.
- **PR**: the heaviest single working set (`isBetterPR`: weight first, reps break a tie only at equal weight).
- **deload**: a session at reduced weight and set count, signalled by `--warning`.
- **coach modes**: `ChatMode`: `log-day`, `routine-review`, `dashboard`, `exercise-library`.
- **nav title**: `NavItem.title` is a translation key, not display text.

## Standards

- State: no Redux/Zustand; complex state lives in custom hooks.
- Strings: components use `const { t, tn, locale, language } = useI18n()`; `tn('exercises.count', n)` picks the `_one`/`_other` key. `es.ts` is typed `Record<keyof typeof en, string>`, so a missing key fails `typecheck`.
- Dates: pass `{ locale }` to date-fns `format`, use the `date.*` pattern keys for long/short forms, `capitalize()` for standalone Spanish month/day names, and `locale={locale}` on `Calendar`.
- Coach swaps: every mode gets the exercise library grouped by muscle plus `SWAP_RANKING`, so swaps come only from exercises the user has; only the Exercises coach may propose new ones.
- Coach language: the client sends the profile `language` with every request and the system prompt forces replies in it; the coach never follows the language the user types in.
- Coach replies render through `SegmentRenderer`; raw markdown is never shown to the user.
- New coach mode: add its context in `context-builders.ts` and prompt in `chat-prompts.ts`, add it to `ChatMode` in `route.ts`, `CoachChatSheet.tsx` and `use-coach-chat.ts` plus the prompt branch in `route.ts`, then use `CoachChatSheet` with `mode="your-mode"`.
- Run `npm run coach:eval` after any change to `buildExerciseLibrarySystemPrompt`.
- Theme: dark is the default for a user who never picked one (`DEFAULT_THEME` in `ThemeContext`, mirrored in `THEME_INIT_SCRIPT`); `system` is an explicit opt-in from the avatar menu.
- Colors: the single brand accent is `--primary` (sky, the app icon's rim light); `--warning` (amber) is the deload/plateau signal (`--chart-4` kept identical). No Tailwind palette classes (`text-blue-600` etc.) outside the token system.
- Fonts: Hanken Grotesk (`font-body`) + Big Shoulders Display (`font-headline`: dates, stats, day numbers, exercise names). Utilities in `globals.css`: `.surface .eyebrow .pressable .glass .animate-enter .enter-1..6 .no-scrollbar`; CSS-only motion with a reduced-motion guard.
- Pickers use `ResponsiveSheet`: a floating panel centred in the viewport at every breakpoint (it wraps `Dialog`, not `Sheet`).
- Session workflow: work on the feature or fix, then the owner runs `/dds:brain-sync` before ending the session.

### Gotchas (learned the hard way)

- `scripts/coach-eval/run.mts` must use the same params as the `exercise-library` branch of `route.ts`; keep them in step.
- The eval judge's `ROLE` must describe everything the coach is GIVEN (weekly sets, unused list), or it flags legitimate uses as fabrication.
- `FIREBASE_PRIVATE_KEY`: quote it in `.env.local` (quoted and unquoted both parse there, verified); paste it UNQUOTED in Vercel, where the value is stored verbatim and a wrapping quote becomes part of the PEM.
- `firestore.rules`' user match `/users/{userId}/{collection}/{docId}` is non-recursive: a deeper path (e.g. `users/{uid}/routines/{rid}/versions/{vid}`) hits deny-all and fails at runtime with permission-denied. New collections must be flat siblings, or the rules need a deploy (a gated destructive op).
- `CoachProfileForm` strips `language` from its state so a profile save can never overwrite a later language switch.
- Never mirror a detected language to `gt-lang` (`applyLanguage(next, false)`): a persisted guess looks like an explicit choice, so detection never runs again on that device. Only a real pick writes it.
- Non-React code (toasts in memoised fetchers/hooks, `friendlyErrorMessage`, `unsavedChanges`, warm-up labels, routine-history phrasing) uses module-level `t`/`tn` from `@/i18n`, deliberately, so a language switch doesn't re-create fetch callbacks and refetch.
- Stored values stay English (muscle groups `"Chest"`, set structures `'superset'`, goals, genders, warm-up templates are data keys): display via `muscleGroupLabel()` / `setStructureLabel()` / `warmupTemplateLabel()` or `CoachProfileForm`'s option maps; never translate what gets written to Firestore.
- Seeded exercises are stored English (ids = slug of the English name; denormalized `name` in logs/routines/snapshots; `inferWarmupTemplate` keys off English words). Anything that renders, searches, sorts, or sends a name to the coach goes through `displayExerciseName` / `displayExerciseFields`; user-named exercises show as-is.
- The exercise edit dialog pre-fills displayed text, so `ExerciseClientPage` maps untouched fields back to the stored English on save; otherwise "save without changes" turns a default into a Spanish-named custom exercise.
- `routineHistory` diffs emit display names, but snapshots keep stored names because they are hashed.
- `/api/coach/chat` returns `{ code, error }`; the client maps `code` to a translated message in `use-coach-chat.ts`, so never rely on the English `error` text in the UI.
- `--accent` is a NEUTRAL gray wired to shadcn ghost/outline hovers: never use `bg-accent`/`text-accent` for brand actions.
- Off-scale opacities (`bg-primary/12`) are silently dropped by Tailwind: use /10, /15, /20.
- The iOS 16px `!important` rule covers `input, select, textarea` only; adding `button` flattens every chip.
- `Dialog`/`AlertDialog` open with NO entry animation on purpose: do not re-add `animate-in`/`zoom`/`slide`/`backdrop-blur` to these overlays.
- `DialogTitle` uses the BODY font: `font-headline` (condensed Big Shoulders) reads squashed on a short title.
- `DialogHeader` reserves `pr-10` for the close button; a header that sets its own padding must restate `pr-12`, or tailwind-merge drops it and the title runs under the X.
- PWA `any` and apple PNGs stay FULL-BLEED opaque squares; only `icon-maskable-512.png` is inset (76% on the master's corner colour) so Android's mask keeps the plates. Rasterize with the `sharp` already in `node_modules` (no ImageMagick/Pillow on this machine). sharp cannot write ICO: `gen-icons.mjs` wraps PNG entries in a hand-built ICO header.
- `public/sw.js`, `public/workbox-*.js`, `public/fallback-*.js` and `public/swe-worker-*.js` (plus `.map`s) are next-pwa build output: gitignored, regenerated by Vercel at each deploy, never edited by hand. `public/offline.html` is hand-written and stays tracked.
- `src/components/AppIcon.tsx` renders the generated `/icons/icon-192.png` (only `InstallGuide` uses it); the header, sidebar and login `Logo` is text only, because the illustration is unreadable at 20 px.
- `next.config.ts` suppresses TypeScript and ESLint build errors (`ignoreBuildErrors: true`), so a passing build proves nothing: run `npm run typecheck` and `npm run lint`.
- In `useTrainingLog`, `currentLog` is *derived* (`useMemo`) from `originalLogState`: never store the deload-transformed view in state or write it back to the baseline, or weight reductions compound and corrupt saved logs.
- Exercise identity = name + muscleGroup, never name alone: `dedupeExercisesByNameAndMuscle` feeds the shared picker, and keying on name silently hid "Dips" (Triceps) behind "Dips" (Chest).
- Compare a library exercise with `LoggedExercise.exerciseId`, never `.id` (row id): it never matches, so the filter is a silent no-op that still looks correct (shipped in the Replace picker).
- MCP writes: a write tool runs only after the user's yes in the chat (no token); the write repo has no delete and no update (`create` for new docs, `set` with merge for a routine's `exercises`); every routine write is ONE batch with its history version (source `'mcp'`; a backfilled baseline keeps `'backfill'`). The Admin SDK skips `firestore.rules`, so the path allowlist in `repo.write.server.ts` is the only scope.
- An MCP write does not reach an open app: `sessionCache` keeps routines and exercises per session, so the app shows old data until a reload (or the 5-min TTL), and a save from a stale routine editor overwrites the MCP change.
- `src/lib/routineHistory.ts` holds a raw NUL byte (the hash separator, line 55): the Edit and Write tools refuse the file. Put new history code in another module, and never change the separator (every stored `snapshotHash` depends on it).
- Service reads are memoized via `src/lib/sessionCache.ts` (per-user keys, 5-min TTL, promise-deduped): any NEW write path must call `invalidateCache` with the matching prefix (`exercises:{uid}`, `routines:{uid}`, `wl:{uid}`) or pages silently serve stale data.
- `AvailableExercisesSelector` renders the muscle-group grid and filtered list from ONE tree with ONE search `<Input>`: splitting into two `return`s or components remounts the input on the first keystroke and closes the mobile keyboard, invisibly on desktop and to automated tests.
- `LoggedExerciseCard`'s border is the set-structure channel (`SET_STRUCTURE_COLORS` / `--ss-*`): per-card state cues must not add a ring. State lives in a full-bleed band inside `CardContent`, always mounted with only its colors toggling, so a cue flipping mid-typing can't remount the set inputs.
- Groq reasoning spends `max_completion_tokens` on hidden `<think>` tokens first and truncates silently (`finish_reason: length`): `reasoning_effort: 'none'` is required in `llm-provider.ts` for 1500-token budgets. Only `exercise-library` reasons (`chatStream({ reasoning: true })`, `reasoning_format: 'hidden'`, `maxTokens: 4000`); never pair reasoning with a 1500 budget.
- A log saved with `isDeload` stores *already-reduced* sets plus `deloadApplied: true`; `currentLog` transforms ONLY when `isDeload && !deloadApplied`. Dropping that guard re-reduces stored sets on every reload.
- `isProvisional` / `prefill` / `currentPR` / `personalRecordDisplay` / `progressionStepKg` are UI-only (stripped in `saveWorkoutLog`). `isProvisional` is derived in `updateExerciseInLog` (`withDerivedProvisional`), never by focus; coach log-day context splits COMPLETED vs PLANNED on it; "unsaved changes" checks must compare `persistedShape()`, not the whole log.
- `cachedFetch` memoizes *resolved* promises, so a service that catches and returns `[]`/`0` pins that empty result for the TTL: services in `trainingLogService` rethrow and callers own the toast.
- `getLastNonDeloadPerformance(...).lastPerformedDate` is the newest LOG DOC containing the exercise, performed or not; the `performanceEntries` doc is stamped by `saveExercisePerformanceEntries` only for non-provisional exercises. "Was it performed on day X?" must read `getLastLoggedPerformance`.
- `CoachChatSheet` mobile panel: pin the body, bound by `top` + `bottom` with NO `height`, only `bottom` reacts to the keyboard, `top` adds clamped `offsetTop`, backdrop `touch-none` + non-passive `touchmove` guard, Textarea stays `text-base md:text-sm` (<16px makes iOS zoom). Full rules: `docs/mobile-chat-panel.md`.
- Dialog open latency in `/log` is a RENDER cost: keep every `ExerciseList` prop referentially stable (page handlers via `useStableCallback`; dnd-kit's `useSensor` memoises on its options OBJECT, so an inline literal kills the memo). The AI Coach feels instant because its `open` state is local to itself.
- `firebase-admin` v14 has ONLY modular entry points (`firebase-admin/app`, `firebase-admin/firestore`), and `.npmrc`'s `legacy-peer-deps=true` skips peer deps, so `@opentelemetry/api` must stay explicit or the dev server dies on `Cannot find module '@opentelemetry/api'` while `typecheck` and `lint` pass.
- MCP tool schemas import `z` from `zod4` (an alias of zod 4): `@modelcontextprotocol/server` v2 rejects zod 3 schemas, and the rest of the app stays on zod 3.
- Server code (`src/app/api/**`, `src/lib/mcp/`) must not import a `"use client"` module anywhere in its import chain, even for a pure helper: `npm test` (tsx) ignores the directive and only `next build` fails, on Vercel, after the merge.
- First-run onboarding gates on `onboardedAt` (or a pre-existing `goal`), NEVER on the profile doc existing: `ensureExercisesSeeded` writes `seedVersion` and a language switch writes `language` before the user answers anything.
- Firestore rule matches are UNIONed: `users/{userId}/{collection}/{docId}` must keep `&& collection != 'stats'`, or it re-grants client write access to the quota doc, a silent security hole that tests green.
- Never hide a control behind `overflow-x-auto` + `no-scrollbar`: wrap, or let ONE element flex and truncate (`min-w-0 flex-1`), as `/log` does. Spanish labels run ~30% longer than English; measure at 360px, not 390.
- The automatic PR path can only RAISE a PR; `recheckPersonalRecord` is the only way down and is user-triggered ONLY (it rescans every log containing the exercise).
- `saveCurrentLog` strips `isProvisional`, so planned-vs-performed at save time is re-derived from the baseline's `prefill` (`plannedIds`), never read from the flag. Coach volume/history built from logs must skip `performed === false`.
- PR scans must skip `performed === false` and treat `undefined` as performed, or the first rescan erases every PR from logs written before the flag existed.
- Mojibake in i18n dictionaries passes typecheck, lint AND build: write accented strings with the Edit/Write tool as literal characters, never via a Python `.encode().decode('unicode_escape')` round-trip.
- This shell (Git Bash on Windows) MANGLES backslashes in heredocs: a `<<'EOF'` body with `\\n` arrives as `\n`. Build such content with `chr(92)` in Python or the Write tool, never a heredoc.
- A Radix dialog opened OVER another must render inside the lower one's `DialogContent` (it still portals), never as a sibling: on touch, Radix decides "pointer down outside" on the later `click`, so the lower dialog dismisses and drops its edits. Mouse-driven tests pass while every phone fails.

## Project constraints
Ship exception: enabled (granted 2026-11-09)
Ship gate: npm run typecheck && npm test
Keep this file between 200–300 lines max. Every line must earn its keep.

### Error Handling
- Every server call must handle failure with a clear, friendly message in the user's profile language (EN or ES — every user-facing string goes through `src/i18n`, never a hardcoded literal) — never a blank screen or unhandled crash. Use `friendlyErrorMessage()` from `src/lib/errorMessages.ts`; never interpolate `error.message` into a toast
- Loading states must always be visible to the user during async operations

### Security
- Row-level security must be enabled — each user may only access their own data
- Never log user emails, session data, or any PII to console or external services
- Secret keys and service role keys must live in environment variables only — never in source code or chat

### Destructive Operations
- Before ANY destructive or irreversible operation, follow CONSTRAINTS.md 4 (snapshot, then ask): do NOT execute directly; make sure a save point or recent backup/export exists, then STOP and ask for explicit confirmation, stating: (a) exactly what will be affected, (b) why it's irreversible, (c) what backup/rollback exists
- Covers (non-exhaustive): deleting or mass-updating Firestore documents or collections, unscoped writes across `users/{userId}/...`, deploying Firestore rules that broaden or remove access (`firebase deploy --only firestore:rules`), deleting files or directories (`rm -rf`, fs deletes), overwriting production data, force-pushing or rewriting git history on shared branches
- `firebase deploy` and `firebase firestore:delete` are denied by the dds guard (`.claude/dds-guard.json`); the owner runs them from their own terminal after the backup and confirmation above
- "I'll just do it quickly" is not a reason to skip this. Speed is exactly the risk

### Scale Expectation
- This is a gym app (1–5 users). Do not over-engineer for scale. Optimize for simplicity and readability over performance

### Working Rules
- Minimum viable plan: match the stated UX outcome with the minimum change needed
- Do not add scope (refactors, extra configurability) unless explicitly asked
- When proposing UX changes, separate effects/polish (welcome) from structural/layout changes (require explicit approval)

## Brain sync

- Topics: gym-tracker, Firestore
