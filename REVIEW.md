# Code Review — DDS Gym Tracker

Date: 2026-06-11 · Branch: `chore/fable5-code-review` · Scope: full repository · Analysis only (no app code modified)

> Known backlog items intentionally **not** re-proposed here: structured JSON segments for AI Coach responses, coach modal UX fixes (scroll freeze, blur), section divider rendering, response length cap, chat auto-scroll, coach photo input, deload detector. Where a finding touches those areas it is marked *(known item)*.

---

## 1. Architecture Summary

Next.js 15 App Router PWA with Firebase as the sole backend. Protected routes live in `src/app/(app)/` behind a client-side gate (`AppLayout` + `useRequireAuth` + `AuthContext` Google sign-in). All user data is Firestore under `users/{userId}/...` (exercises, routines, workoutLogs keyed by `yyyy-MM-dd`, performanceEntries keyed by exerciseId), enforced by simple owner-only rules in `firestore.rules`. CRUD is wrapped in three services (`exerciseService`, `routineService`, `trainingLogService`); there is no server-side data API.

State is hook-based: `useTrainingLog` (818 lines) is the core of the app — it owns the day's log, a `originalLogState` baseline vs. a derived deload-transformed `currentLog`, routine auto-fill from `performanceEntries`, PR tracking, and all save/delete flows. The log page composes it with dnd-kit reordering, per-exercise cards (`LoggedExerciseCard` → `SetInputRow` with controlled weight-display strings), and warm-up computation (`lib/utils.ts`).

The AI Coach is the only API route (`/api/coach/chat`): the client (`use-coach-chat` + `CoachChatSheet`) serializes page data via `lib/ai/context-builders`, the route builds a system prompt (`chat-prompts`) and **streams** SSE from Groq (`qwen/qwen3-32b`) through a `<think>`-stripping TransformStream, with a hand-rolled markdown renderer on the client. UI is shadcn/Radix + Tailwind; PWA (workbox) is enabled in production builds only.

---

## 2. Findings Table

Severity: **P1** = broken/incorrect behavior or data integrity, **P2** = real defect or meaningful risk, **P3** = quality/polish. Line references verified against current files.

| # | Sev | File / Line | Finding |
|---|-----|-------------|---------|
| 1 | P1 | `src/hooks/useTrainingLog.ts:530` | Calls `saveWorkoutLog(...)`, but the import is renamed to `saveLogService` (line 10) — `saveWorkoutLog` is not in scope. Runtime `ReferenceError` whenever a set-structure override is changed on a day that already has a saved log (the build ships it because errors are suppressed; `tsc` reports TS2304 here). |
| 2 | P1 | `src/types/index.ts` (≈ line 52) | `Routine` and `RoutineData` types do not exist in `@/types`, and `SetStructure` / `MuscleGroup` are imported but never re-exported. This breaks type-checking in 8+ files (`routineService.ts:3`, `useTrainingLog.ts:6`, `routines/page.tsx:6`, `AddEditRoutineDialog.tsx:7`, …) — the entire routines domain is effectively untyped (`any`). |
| 3 | P1 | `package.json:9`, repo root | `npm run lint` cannot run: there is no ESLint config and no `eslint` devDependency — `next lint` drops into an interactive setup prompt. Combined with `next.config.ts:5-6` (`ignoreBuildErrors` for both TS and ESLint) and the 32 baseline `tsc` errors, the project currently has **no working quality gate**, contradicting CLAUDE.md ("validation is via TypeScript and linting"). |
| 4 | P1 | `src/hooks/useTrainingLog.ts:273-294` + `src/app/(app)/log/page.tsx:492` | Deload editing corrupts the baseline: `currentLog` is the deload-*transformed* view, but `onUpdateSets` passes the transformed exercise into `updateExerciseInLog`, which writes it into `originalLogState` via `mutateBaseline` and then re-applies the transform for display. Each edit while Deload Mode is on compounds the reduction (100 kg → 90 → 81 …) and halves set count again, and the corrupted baseline is what gets saved. |
| 5 | P2 | `src/contexts/AuthContext.tsx:57-69`, `src/app/login/page.tsx:44` | If `signInWithPopup` fails or the user closes the popup, `isLoading` is never reset (no `finally`, and `onAuthStateChanged` does not fire on a failed popup). The login page then shows a full-screen spinner forever, with no error message (also violates the "friendly error message, never blank screen" guardrail). |
| 6 | P2 | `src/app/api/coach/chat/route.ts:77` | The coach endpoint has no authentication — any unauthenticated caller can POST and consume the Groq API quota. Firestore is row-level-secured, but this route is wide open. |
| 7 | P2 | `src/services/routineService.ts:57-64` | `addRoutine` writes with `setDoc` to a doc ID slugified from the routine name, with no existence check. Creating a routine whose name slugifies the same as an existing one **silently overwrites** that routine (data loss). |
| 8 | P2 | `src/hooks/useTrainingLog.ts:566-654` (and 680-694) | Save path is N+1 and fully sequential: per exercise it calls `getLastNonDeloadPerformance` (1 `getDoc` + a 10-doc query), then loops `await saveExercisePerformanceEntry` (each = `getDoc` + `setDoc`), then refetches month flags, then `loadLogForDate` re-runs the same per-exercise perf fetches again. An 8-exercise day costs ~35+ round-trips per save — noticeable latency on gym Wi-Fi. |
| 9 | P2 | `src/hooks/useTrainingLog.ts:656-723` | "Save Progress" on one exercise (`saveSingleExercise`) actually persists the **entire log**, including untouched provisional exercises whose pre-filled sets (last session's numbers) get written as if performed today. Only the PR entry is scoped to the chosen exercise. Volume analytics and the coach context then see phantom data. |
| 10 | P2 | `CLAUDE.md` (AI Coach section) vs `route.ts:108-119`, `use-coach-chat.ts:113-147` | Documentation drift: CLAUDE.md states the endpoint is **non-streaming** JSON (`provider.chat()`, `res.json()`, no SSE), but the code is fully SSE-streaming. Since CLAUDE.md drives agent behavior, this actively misleads future changes. |
| 11 | P2 | `src/app/(app)/log/page.tsx:238-264` | Early returns (238-254) occur **before** the `useMemo` at 256 — a rules-of-hooks violation (would be caught by `react-hooks/rules-of-hooks`, but lint doesn't run). Currently masked because `AppLayout` unmounts children while auth loads, but any refactor that renders this page during an auth transition crashes with "Rendered more hooks than during the previous render". The in-render `router.push('/login')` at 247 is also a side effect during render. |
| 12 | P2 | `src/app/api/coach/chat/route.ts:24-74` | `filterThinkingStream`'s TransformStream has no `flush()` handler: a response shorter than 7 chars, or one with an unclosed `<think>` block, leaves `contentBuffer` undelivered — the reply is silently dropped (client falls back to "No se recibio respuesta"). *(adjacent to known coach items, but this is a transport bug, not response formatting)* |
| 13 | P2 | `src/services/trainingLogService.ts:324-375` | `getLastNonDeloadPerformance` accepts `routineId` and every caller passes it expecting routine-scoped history, but the parameter is never used — pre-fill always comes from the global last non-deload session. Misleading API; either implement or drop the param. |
| 14 | P3 | `src/services/trainingLogService.ts:69-86` | `saveWorkoutLog` clamps `null` reps/weight to `0`, so empty manually-added sets are persisted as `0 x 0` rows instead of being filtered out. |
| 15 | P3 | `src/services/trainingLogService.ts:44-47` | `saveWorkoutLog` mutates its input `workoutLogPayload` (reassigns `id`/`date`) — surprising side effect on caller state. |
| 16 | P3 | `src/services/trainingLogService.ts:405-412` | `updatePerformanceEntryOnLogDelete` queries **all** logs containing the exercise with no `limit`; only the first non-deleted doc is used. Unbounded read at scale (minor for 1-5 users). |
| 17 | P3 | `src/components/analytics/VolumeChart.tsx` (whole file; loop at 104-124) | Dead code: component is imported nowhere. If revived, note it fetches every log **sequentially** (`await getDoc` per logged date) instead of one `exerciseIds array-contains` query. |
| 18 | P3 | `src/app/(app)/log/sensors.ts` (whole file) | Dead code by its own comment (lines 4-6); also fails `tsc` (TS2417). |
| 19 | P3 | `src/lib/hash.ts`; `trainingLogService.ts:116-118`; `trainingLogService.ts:183-209` | More dead code: `hash.ts` has no importers; `saveSingleExerciseToLogService` (self-described deprecated) and `getLoggedDateStringsInMonth` are exported but unused. |
| 20 | P3 | `src/components/training-log/LoggedExerciseCard.tsx:75` | "Edit warm-up settings" navigates to `/exercises?edit=<id>`, but `ExerciseClientPage` never reads the `edit` query param — the link lands on the library with nothing opened. |
| 21 | P3 | `src/components/training-log/LoggedExerciseCard.tsx:118-128, 235-240` | `weightDisplays` is index-keyed and not updated by `removeSet`; deleting a middle set while focused inside the card (so `isEditing` blocks the resync effect) shifts weight display strings onto the wrong rows. |
| 22 | P3 | `src/lib/utils.ts:147-154` + `LoggedExerciseCard.tsx:31-36` | The "Empty Bar" warm-up step requires `isLowerBodyBarbell`, but `WarmupConfig` never stores it and `WarmupPanel` never passes it — the branch is unreachable for routine usage (squat/deadlift never show the empty-bar row). |
| 23 | P3 | `src/app/(app)/log/page.tsx:274-307, 569-601, 638-667` | The delete-log confirm `AlertDialog` is duplicated three times (desktop header, card footer, mobile bar) with near-identical content — extract one component. |
| 24 | P3 | `src/hooks/use-coach-chat.ts:13` | Chat storage key uses UTC (`toISOString`) while the rest of the app uses local dates — chats reset at UTC midnight, not local midnight (e.g. 01:00 in Berlin loses the evening's chat). |
| 25 | P3 | `src/hooks/use-coach-chat.ts:59` | `localStorage` read inside the `useState` initializer: server render produces `[]`, client produces stored messages → React hydration mismatch warning when history exists. |
| 26 | P3 | `src/components/dashboard/WorkoutCalendarSection.tsx:56, 127-130` | `today = new Date()` recreated each render and listed in the `useMemo` deps — memo invalidated every render (same pattern: `log/page.tsx:158`). |
| 27 | P3 | `firestore.rules:16-18` | The `users/{userId}/profile/profile` match is redundant — already covered by the `{collection}/{docId}` rule above it. Harmless, but implies a distinction that doesn't exist. |
| 28 | P3 | `src/lib/firebaseConfig.ts:17-20` | Server-side `console.log` of project ID / auth domain on every cold start — diagnostic noise that should be removed (not a secret, but contrary to "no env details in logs" hygiene). |
| 29 | P3 | `src/app/layout.tsx:29` | `maximumScale: 1` disables pinch-zoom — an accessibility regression on iOS/Android (WCAG 1.4.4). |
| 30 | P3 | `package.json:54` | `xlsx@0.18.5` is the last npm release of SheetJS and has known advisories (prototype pollution / ReDoS in parse paths). Export-only usage here is low risk, but it will flag any audit; consider the official SheetJS CDN build or a CSV-only export. |
| 31 | P3 | `src/app/(app)/exercises/page.tsx:2-4` | Unused imports (`PageHeader`, `Button`, `PlusCircle`) with comments claiming they're used elsewhere. |
| 32 | P3 | UI strings, e.g. `useTrainingLog.ts:192,204,210`, `login` flow | CLAUDE.md mandates friendly **Spanish** error messages; nearly all toasts/errors are English (the coach API is Spanish). Decide one language and apply consistently. |

---

## 3. Top 5 Recommended Improvements

### 3.1 Restore the type-safety baseline (fixes #1, #2, #3, #18)

**Rationale.** The two stated quality gates are both down: `tsc` fails with 32 errors and lint cannot run. Among those errors hides a real user-facing crash (#1). Everything else in this review is harder to keep fixed while the gates are off.

**Affected files:** `src/types/index.ts`, `src/hooks/useTrainingLog.ts`, `src/contexts/AuthContext.tsx`, `next.config.ts`, `package.json`, new `.eslintrc.json`, plus the ~10 files with implicit-`any` params.

**Effort:** ~half a day.

**Sketch:**
1. In `src/types/index.ts`: re-export `SetStructure` and `MuscleGroup` (`export type { SetStructure } from './setStructure'; export type { MuscleGroup } from '@/lib/constants';`) and add the missing domain types:
   ```ts
   export interface Routine {
     id: string; name: string; description?: string;
     exercises: RoutineExercise[]; order: number;
   }
   export type RoutineData = Omit<Routine, 'id'>;
   ```
2. `useTrainingLog.ts:530`: `saveWorkoutLog(` → `saveLogService(`.
3. Annotate the handful of implicit-`any` callback params; type `app` in `AuthContext.tsx` (`FirebaseApp`).
4. Fix `trainingLogService.ts:276` by making `ExercisePerformanceEntry.lastPerformedSets` accept `{ reps; weight; id? }` (matches what `validWorkingSets` returns) rather than full `LoggedSet`.
5. Add `eslint` + `eslint-config-next` devDependencies and a minimal `.eslintrc.json` (`{ "extends": "next/core-web-vitals" }`) so `npm run lint` works headlessly; `react-hooks/rules-of-hooks` then catches #11 automatically. Keep `ignoreBuildErrors` for now if desired, but CI/dev validation becomes real.

### 3.2 Make deload a pure view transform (fixes #4)

**Rationale.** Deload Mode currently corrupts the saved baseline on every edit — a silent data-integrity bug in the app's core feature.

**Affected files:** `src/hooks/useTrainingLog.ts`, `src/app/(app)/log/page.tsx`, `src/components/training-log/LoggedExerciseCard.tsx`.

**Effort:** ~half a day + manual test pass.

**Sketch:** keep **one** source of truth (`originalLogState`) and derive the displayed log instead of storing it:
```ts
const displayedLog = useMemo(
  () => (isDeload ? applyDeloadTransform(originalLogState) : originalLogState),
  [isDeload, originalLogState]
);
```
- Delete the `isDeload` effect (lines 273-282) and the `setCurrentLog` half of `mutateBaseline` — mutations only ever write the baseline.
- Edits made *while deload view is active* must either (a) be disabled (simplest, matches "deload is prescriptive" semantics), or (b) be inverse-transformed before writing to baseline. Recommend (a): render set inputs read-only when `isDeload`, which also prevents confusing PR math.
- `saveCurrentLog` already saves the baseline + `deloadParams`, so persistence needs no change.

### 3.3 Batch the save path and stop re-reading what you just wrote (fixes #8, partially #9)

**Rationale.** Saving a day currently costs ~35+ sequential round-trips and ends with a full reload that repeats the per-exercise reads. At gym-floor network quality this is the single biggest UX lag.

**Affected files:** `src/hooks/useTrainingLog.ts`, `src/services/trainingLogService.ts`.

**Effort:** ~1 day.

**Sketch:**
1. In `saveCurrentLog`/`saveSingleExercise`, fetch performance entries **once, in parallel**: `const perfByExercise = new Map(await Promise.all(uniqueIds.map(async id => [id, await getLastNonDeloadPerformance(...)])))`, then build the payload synchronously from the map.
2. Add `saveExercisePerformanceEntries(userId, entries[])` in the service using a single `writeBatch` (it already imports `writeBatch` elsewhere) instead of the sequential `for … await` loop at `useTrainingLog.ts:613-626`.
3. After a successful save, update local state from the payload you just built (you already have PRs and sets in memory) instead of calling `loadLogForDate` (line 647) — keep one `getMonthLogFlags` refresh only.
4. While there: scope `saveSingleExercise` to actually save only the touched exercise (filter provisional ones out of the payload, mirroring `saveCurrentLog`'s PR gating), resolving #9.

### 3.4 Authenticate the coach endpoint (fixes #6)

**Rationale.** `/api/coach/chat` is the only server surface and it is unauthenticated — anyone with the URL can drain the Groq quota. The project rule is row-level security everywhere.

**Affected files:** `src/app/api/coach/chat/route.ts`, `src/hooks/use-coach-chat.ts`, `package.json` (one dependency, or none).

**Effort:** 2-3 hours.

**Sketch (no firebase-admin needed, fits the no-server-infra style):**
1. Client: send the Firebase ID token — `const token = await auth.currentUser?.getIdToken(); fetch('/api/coach/chat', { headers: { Authorization: \`Bearer ${token}\`, ... } })`.
2. Route: verify the token before contacting Groq. Lightest option: call Google's `identitytoolkit` `accounts:lookup` REST endpoint with the project API key; sturdier option: add `firebase-admin` and `verifyIdToken`. Return the existing 401-style Spanish error on failure.
3. While in the file, add a `flush(controller)` to `filterThinkingStream` that emits any remaining `contentBuffer` (fixes #12, ~5 lines).

### 3.5 Harden auth + routine-creation edge cases (fixes #5, #7, #11)

**Rationale.** Three small defects that each produce a "app feels broken" moment: the eternal login spinner, silent routine overwrite, and the latent hooks crash on the log page.

**Affected files:** `src/contexts/AuthContext.tsx`, `src/services/routineService.ts`, `src/app/(app)/log/page.tsx`.

**Effort:** 2-3 hours.

**Sketch:**
1. `AuthContext.loginWithGoogle`: wrap in `try/catch/finally`, `setIsLoading(false)` in `finally`, and surface a toast (decide ES/EN per #32) on non-`auth/popup-closed-by-user` errors.
2. `routineService.addRoutine`: before `setDoc`, `getDoc(routineDocRef)`; if it exists, suffix the slug (`-2`, `-3`, … — same pattern as `exerciseService.addExercise:104-140`) or reject with "ya existe una rutina con ese nombre".
3. `log/page.tsx`: move the `deloadDescription` `useMemo` (line 256) above the early returns, and replace the render-time `router.push` (247) with the existing `useRequireAuth` hook (or simply delete the block — `AppLayout` already gates).

---

## 4. Quick Wins (each < 15 min)

1. **`useTrainingLog.ts:530`** — rename `saveWorkoutLog` → `saveLogService`. One word; removes a guaranteed runtime crash.
2. **`AuthContext.tsx:57-69`** — add `finally { setIsLoading(false) }` to `loginWithGoogle` (and `logout`).
3. **`route.ts` `filterThinkingStream`** — add a `flush()` that flushes `contentBuffer` so short replies aren't swallowed.
4. **Delete dead files** (after confirmation, per repo constraints): `src/app/(app)/log/sensors.ts`, `src/components/analytics/VolumeChart.tsx`, `src/lib/hash.ts`; remove unused exports `saveSingleExerciseToLogService`, `getLoggedDateStringsInMonth`.
5. **`exercises/page.tsx:2-4`** — drop the three unused imports.
6. **`WorkoutCalendarSection.tsx:56` / `log/page.tsx:158`** — hoist `today` into the memo or compute via `useMemo(() => new Date(), [])`-style day anchor.
7. **`firebaseConfig.ts:17-20`** — delete the diagnostic `console.log`s.
8. **`firestore.rules:16-18`** — remove the redundant profile match block (no behavior change; redeploy needed, which is a confirm-first operation).
9. **CLAUDE.md AI Coach section** — update to describe the actual SSE streaming endpoint (`chatStream`, `filterThinkingStream`, SSE parsing in `use-coach-chat`); the current text describes a non-streaming design that no longer exists.
10. **`app/layout.tsx:29`** — drop `maximumScale: 1` to restore pinch-zoom.
11. **`use-coach-chat.ts:13`** — build the storage key with `date-fns format(new Date(), 'yyyy-MM-dd')` (local time) for consistency with log dates.

---

## 5. Verification Results (repo baseline, run 2026-06-11)

- **`npx tsc --noEmit`: FAILS — 32 errors.** Dominated by the missing `Routine`/`RoutineData`/`SetStructure`/`MuscleGroup` exports from `@/types` (#2), plus the genuine `saveWorkoutLog` TS2304 (#1), `sensors.ts` TS2417 (#18), `next.config.ts:32` `skipWaiting` not in `PluginOptions`, `trainingLogService.ts:276` TS2322, and ~14 implicit-`any` parameter errors. The build only succeeds because `next.config.ts` sets `ignoreBuildErrors: true`.
- **`npm run lint`: CANNOT RUN.** No ESLint config file and no `eslint` devDependency exist; `next lint` drops into an interactive "How would you like to configure ESLint?" prompt and exits without linting. (`next lint` is also deprecated in Next 16 — migrating to the ESLint CLI per improvement 3.1 solves both.)

Both results reflect the **pre-existing baseline**: no application code was modified in this review session; the only file created is this `REVIEW.md`.

---

## 6. Resolution Addendum (fixes applied 2026-06-11, same branch)

All findings and quick wins above were implemented in a follow-up session, with two intentional deferrals:

- **#30 (`xlsx` advisories)** — unchanged; replacing the dependency or dropping the Excel export is a product decision.
- **#32 (UI language consistency)** — the existing English toasts were left as-is (a full sweep is a product decision); the *new* error messages added in this pass (login failure, coach 401) follow CLAUDE.md's Spanish-error rule.

Notable implementation choices beyond the sketches in §3: `currentLog` is now fully **derived** (`useMemo`) from the baseline in `useTrainingLog` (eliminating the dual-state sync entirely), set inputs are disabled while Deload Mode is active, `saveWorkoutLog`'s background structure-override save only fires for days that already exist on the backend, and the `/exercises?edit=` deep link was implemented (rather than removing the link). `eslint@8` + `eslint-config-next` were added with `next/core-web-vitals` (`@next/next/no-page-custom-font` disabled — it targets `pages/_document.js`, which this App Router project doesn't use). The redundant `firestore.rules` block was removed in the file only — **rules were not deployed**.

**Post-fix verification:** `npx tsc --noEmit` → 0 errors · `npx next lint` → no warnings or errors · `npm run build` → compiles, 12/12 pages generated.
