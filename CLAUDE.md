## Constraints

Read and follow `CONSTRAINTS.md` at the repo root before every task. It defines:
- What you must never do (Section 1)
- When to stop and ask (Section 2)
- How to resolve goal vs. constraint conflicts (Section 3)
- Session hygiene rules (Section 4)
- Project-specific extensions (Section 5)

CONSTRAINTS.md rules are non-negotiable. If a task conflicts with a constraint, stop and surface the conflict — do not silently resolve it.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server with Turbopack (default port 3000 — no -p flag is set, so NOT 9002)
npm run build      # Production build
npm run lint       # Next.js ESLint
npm run typecheck  # TypeScript check (no emit)
```

No test framework is configured — validation is via TypeScript and linting only.

To deploy Firestore security rules:
```bash
firebase deploy --only firestore:rules
```

## Environment Setup

Copy `.env.local` and populate with Firebase project credentials and Groq API key. Required variables:
- `NEXT_PUBLIC_FIREBASE_*` — Firebase project config
- `GROQ_API_KEY` — Groq API key (get from https://console.groq.com)
- `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` — service account (Admin SDK), used ONLY to write the daily AI quota counter. Absent = the app runs but limits are silently unenforced; `isAdminConfigured()` reports it and `/admin` shows a banner. Quote the key in `.env.local` (both quoted and unquoted parse correctly there — verified); paste it UNQUOTED in Vercel, where the value is stored verbatim and a wrapping quote becomes part of the PEM

## Architecture

**Next.js 15 App Router** with Firebase as the sole backend (no custom API server for data — only `/src/app/api/coach/` for AI proxying).

### Route Structure

- `src/app/(app)/` — Protected routes (auth-guarded via `use-require-auth.ts`)
  - `dashboard/`, `exercises/`, `log/`, `routines/`, `settings/`, `profile/`
- `src/app/login/` — Public auth page
- `src/app/api/coach/chat/` — Server-side streaming chat endpoint (Groq)

### Data Flow

1. **Auth** — Firebase Google Sign-In, managed by `AuthContext` (`src/contexts/AuthContext.tsx`), provided at root layout
2. **Data** — All user data lives in Firestore under `users/{userId}/{collection}`. CRUD is abstracted in `src/services/` (`trainingLogService.ts`, `exerciseService.ts`, `routineService.ts`)
3. **State** — No Redux/Zustand. Complex state lives in custom hooks:
   - `useTrainingLog.ts` — Core workout logging state; manages current session, date selection, routine auto-fill, and performance history
   - `use-coach-chat.ts` — Client-side chat state with SSE streaming for AI Coach

### Firestore Schema

```
users/{userId}/
  profile/profile         # User profile
  exercises/{id}          # Exercise library
  routines/{id}           # Workout routines
  workoutLogs/{YYYY-MM-DD} # Daily logs
  performanceEntries/{exerciseId} # PRs & last performance
  routineHistory/{routineId_epochMs} # Routine change snapshots (flat; outlives deleted routines)
```

`firestore.rules` grants access via a single non-recursive `match /users/{userId}/{collection}/{docId}`. Any deeper path (e.g. `users/{uid}/routines/{rid}/versions/{vid}`) falls through to the deny-all default and fails at runtime with permission-denied — new collections must be flat siblings, or the rules need a deploy (a gated destructive op).

### AI Coach

The Coach is a contextual chat embedded in `/log` (workout coaching) and `/routines` (program analysis). It uses Groq (model: `qwen/qwen3.6-27b`, with `reasoning_effort: 'none'`) via a vendor-agnostic LLM provider interface. The client sends the profile `language` with every request and the system prompt forces replies in it (see Internationalization) — the coach never follows the language the user happens to type in.

**Key files:**
- `src/lib/ai/llm-provider.ts` — `LLMProvider` interface + `GroqProvider` (OpenAI-compatible REST)
- `src/lib/ai/context-builders.ts` — Serializes page data into compact context (log-day + routine-review)
- `src/lib/ai/chat-prompts.ts` — System prompt builders with goal-based volume targets, progressive overload logic, and KNOWN EXERCISES injection
- `src/app/api/coach/chat/route.ts` — **SSE streaming** endpoint: `POST` → `text/event-stream` of `data: {"v":"<delta>"}` chunks. Uses `provider.chatStream()`; `filterThinkingStream` strips qwen3 `<think>…</think>` tokens before forwarding (with a `flush()` for short replies); kept as a safety net now that reasoning is disabled. Requires a Firebase ID token (`Authorization: Bearer <token>`), verified via the Identity Toolkit REST API. `maxTokens: 1500`.
- `src/hooks/use-coach-chat.ts` — Client-side chat state. Reads the SSE stream and appends deltas to the assistant bubble; sends the user's Firebase ID token; history sanitized via `extractTextFromContent()` before being sent to the API. Chat history persists in localStorage per local day.
- `src/components/coach/CoachChatSheet.tsx` — Shared Sheet UI. `SegmentRenderer` renders markdown (bold, italic, headings `#`–`######`, bullet/numbered lists, strips `---`). Raw markdown never shown to user.

**To extend AI features:** Add a new mode in `context-builders.ts` + `chat-prompts.ts`, then use `CoachChatSheet` with `mode="your-mode"`.

### Internationalization (EN / ES-LatAm, 2026-09)

- The language is a **profile setting**: `language?: 'en' | 'es'` on `users/{uid}/profile/profile` (`src/lib/types.gym.ts`), switched from the avatar menu (Language submenu next to Theme, `UserNav`) and applied instantly. `LanguageProvider` (`src/contexts/LanguageContext.tsx`) owns the persistence (`setLanguage` merges the field into the profile doc), mirrors it to localStorage (`gt-lang`) for the next visit, reloads it from the profile doc on sign-in, and sets `<html lang>`. `CoachProfileForm` strips `language` from its state so a profile save can never overwrite a later switch
- Dictionaries live in `src/i18n/en.ts` (source of truth) and `src/i18n/es.ts` (typed `Record<keyof typeof en, string>`, so a missing key fails `typecheck`). Components use `const { t, tn, locale, language } = useI18n()`; `tn('exercises.count', n)` picks the `_one`/`_other` key. Non-React code (toasts inside memoised fetchers/hooks, `friendlyErrorMessage`, `unsavedChanges`, warm-up labels, routine-history phrasing) uses the module-level `t`/`tn` from `@/i18n`, which the provider keeps in sync — use it deliberately there so a language switch doesn't re-create fetch callbacks and refetch
- **Stored values stay English**: muscle groups (`"Chest"`), set structures (`'superset'`), goals, genders, warm-up templates are data keys. Display them through `muscleGroupLabel()` / `setStructureLabel()` / `warmupTemplateLabel()` or the option maps in `CoachProfileForm`; never translate what gets written to Firestore
- **Seeded default exercises** are also stored English (deterministic ids = slug of the English name; denormalized `name` copies in logs/routines/history snapshots; `inferWarmupTemplate` keys off English words). `src/lib/defaultExercises.es.ts` holds their Spanish name/targetNotes/setup/overload, applied at DISPLAY time by `src/lib/exerciseDisplay.ts` (`displayExerciseName` / `displayExerciseFields`, per field, only while the stored value still equals the seeded English one). Anything that renders, searches, sorts, or sends an exercise name to the coach goes through it — it resolves by `id` / `exerciseId`, so past logs, routines, progression, and history localize with no migration. The edit dialog pre-fills the displayed text; `ExerciseClientPage` maps untouched fields back to the stored English on save, otherwise "save without changes" would turn a default into a Spanish-named custom exercise. `routineHistory` diffs emit display names (snapshots keep stored names — they are hashed). User-named exercises are shown as-is
- Dates: pass `{ locale }` to date-fns `format`, use the `date.*` pattern keys for long/short forms, `capitalize()` for standalone Spanish month/day names, and `locale={locale}` on `Calendar`
- `/api/coach/chat` returns `{ code, error }`; the client maps `code` to a translated message (`use-coach-chat.ts`), so never rely on the English `error` text in the UI

### UI Stack

- **shadCN/UI** components in `src/components/ui/` (Radix primitives + Tailwind)
- **Tailwind** with CSS variable theming — colors/fonts defined in `src/app/globals.css` and `tailwind.config.ts`
- **Design tokens ("Chalk & Iron", 2026-09)**: dark-first — dark is the DEFAULT theme for a user who never picked one (`DEFAULT_THEME` in `ThemeContext`, mirrored in `THEME_INIT_SCRIPT`; `system` is an explicit opt-in from the avatar menu); single brand accent is `--primary` (sky, the PWA icon's dumbbell); `--warning` (amber) is the deload/plateau signal (`--chart-4` kept identical); `--accent` is a NEUTRAL gray wired to shadcn ghost/outline hovers — never use `bg-accent`/`text-accent` for brand actions (the pre-redesign code did, and it caused the color chaos). No Tailwind palette classes (`text-blue-600` etc.) outside the token system. Off-scale opacities (`bg-primary/12`) are silently dropped by Tailwind — use /10, /15, /20
- Fonts: Hanken Grotesk (`font-body`) + Big Shoulders Display (`font-headline`, dates/stats/day numbers/exercise names). Utilities in `globals.css`: `.surface .eyebrow .pressable .glass .animate-enter .enter-1..6 .no-scrollbar`; CSS-only motion with a reduced-motion guard. The iOS 16px `!important` rule covers `input, select, textarea` only (adding `button` flattens every chip)
- **Shell**: mobile nav is `BottomNav` (tab bar, `--bottomnav-height`); the sidebar is desktop-only; pages can inject app-bar buttons via `AppBarActions`; the Training Log's Save/Delete instead sit in a floating dock centred in the content column at the AI Coach button's height (z-40, under the coach backdrop). Pickers use `ResponsiveSheet` — a floating panel centred in the viewport at every breakpoint (it wraps `Dialog`, not `Sheet`). `Dialog`/`AlertDialog` open with NO entry animation on purpose: the edge-slide sheet and the zoom/slide/blur combo both read as laggy on device, and directional entry (sliding in from the half of the screen you pressed) was tried and rejected — the coach window's plain appear is the reference feel. Do not re-add `animate-in`/`zoom`/`slide`/`backdrop-blur` to these overlays. `DialogTitle` uses the BODY font — `font-headline` (condensed Big Shoulders) reads squashed on a short title (2026-09) `WorkoutCalendar` + `WeekStrip` are shared pure-UI components (dashboard + log). `DialogHeader` reserves `pr-10` for the restyled close button; a header that sets its own padding must restate `pr-12`, otherwise tailwind-merge drops it and the title runs under the X (found 2026-09)
- **PWA** enabled in production only (configured in `next.config.ts`)

### Key Types

All domain types are in `src/types/index.ts` — `Exercise`, `Routine`, `WorkoutLog`, `SetEntry`, `UserProfile`, etc. Set structure variants (straight sets, drop sets, supersets, etc.) are in `src/types/setStructure.ts`. The coach-profile shape (goal, constraints, `language`) is `UserProfile` in `src/lib/types.gym.ts`. `NavItem.title` is a translation key.

### Build Notes

- `next.config.ts` suppresses TypeScript and ESLint build errors (`ignoreBuildErrors: true`) — use `npm run typecheck` and `npm run lint` separately
- `.npmrc` sets `legacy-peer-deps=true` for dependency compatibility

## Constraints (non-negotiable)
- Constraints are hard guardrails, not problems to solve
- Historical bugs mentioned as context = things to avoid, always
- Deload invariant: in `useTrainingLog`, `currentLog` is *derived* (`useMemo`) from `originalLogState` — never store the deload-transformed view in state or write it back to the baseline; doing so compounded weight reductions and corrupted saved logs (fixed 2026-06)
- Exercise identity = name + muscleGroup, never name alone. `dedupeExercisesByNameAndMuscle` feeds the shared picker (routines + Training Log's Add Exercise); keying on name alone silently hid "Dips" (Triceps) behind "Dips" (Chest) — the user only noticed by renaming one (fixed 2026-08)
- `LoggedExercise.id` (composite row id, `${exerciseId}-${date}-${ts}`, used by dnd-kit) is NOT `LoggedExercise.exerciseId` (library `Exercise.id`). Comparing a library exercise against row ids never matches, so the filter silently becomes a no-op that still *looks* correct — this shipped a broken "exclude already-logged" filter in the Replace picker (fixed 2026-08)
- Firestore reads in `src/services/` are memoized via `src/lib/sessionCache.ts` (per-user keys, 5-min TTL, promise-deduped). Any NEW write path in these services must call `invalidateCache` with the matching prefix (`exercises:{uid}`, `routines:{uid}`, `wl:{uid}`) or pages will silently serve stale data (added 2026-08)
- `AvailableExercisesSelector` renders the muscle-group grid and the filtered list from ONE tree with ONE search `<Input>`. Splitting them into two `return`s (or two components) remounts the input on the first keystroke, dropping focus and closing the mobile keyboard — invisible on desktop and to automated tests (fixed 2026-08)
- `LoggedExerciseCard`'s card border is the set-structure channel (`SET_STRUCTURE_COLORS` / `--ss-*` tokens). Per-card *state* cues must not add a ring there — a rep-goal ring shipped as two competing outlines on superset cards. State lives in a full-bleed band inside `CardContent` instead, always mounted with only its colors toggling, so a cue that flips mid-typing can't remount the set inputs (fixed 2026-08)
- Groq reasoning models spend `max_completion_tokens` on hidden `<think>` tokens BEFORE writing the answer, so leaving reasoning on silently truncates replies mid-sentence (`finish_reason: length`) instead of erroring. `qwen/qwen3.6-27b` burned the full 1500-token budget on a one-line question; `reasoning_effort: 'none'` (Groq accepts only `none` | `default`) is required in `llm-provider.ts` for any budget this small (fixed 2026-08)
- Deload persistence: a log saved with `isDeload` stores the *already-reduced* sets plus `deloadApplied: true`; `currentLog` transforms the baseline ONLY when `isDeload && !deloadApplied`. Dropping that guard re-reduces stored sets on every reload (the original compounding bug in a new coat) (added 2026-08)
- `isProvisional` / `prefill` / `currentPR` / `personalRecordDisplay` / `progressionStepKg` are UI-only (stripped in `saveWorkoutLog`). `isProvisional` is DERIVED in `updateExerciseInLog` (`withDerivedProvisional`): true only while an exercise's sets still equal its `prefill` — focus never flips it (a focus-based flip made the coach treat planned exercises as done mid-workout, fixed 2026-08). Coach log-day context splits COMPLETED vs PLANNED on this flag. Any "unsaved changes" check must compare `persistedShape()`, not the whole log
- `cachedFetch` memoizes *resolved* promises, so a service that catches and returns `[]`/`0` pins that empty result for the 5-min TTL. Services in `trainingLogService` rethrow; callers own the toast (fixed 2026-08)
- `getLastNonDeloadPerformance(...).lastPerformedDate` is the date of the newest LOG DOC containing the exercise (today's, once saved — performed or not), NOT the `performanceEntries` doc, which only `saveExercisePerformanceEntries` stamps for non-provisional exercises. "Was this exercise performed on day X?" must read `getLastLoggedPerformance`; the derived one made every saved-as-plan exercise look done on reload (fixed 2026-08)
- Mobile keyboard: `position: fixed` resolves against the LAYOUT viewport, which iOS never shrinks for the keyboard, and `body{overflow:hidden}` does NOT stop iOS touch-scroll chaining. `CoachChatSheet` therefore pins the body (`position:fixed` + negative `top`, scroll restored on close) and bounds its mobile panel by `top`+`bottom` with NO `height`: `top` is a constant, and only `bottom` is offset by `useVisualViewport`'s `keyboardHeight` (`innerHeight - visualViewport.height - offsetTop`, clamped at 0) so the keyboard lifts the bottom edge while the header stays put and the message list shrinks (LinkedIn). Sizing the panel from `visualViewport.height`/`offsetTop` instead moved the whole dialog upward and ran the header off-screen — those absolutes are untrustworthy (iOS standalone/PWA reports a height LARGER than the visible box); only the delta is. A `dvh`/centered panel slid under the keyboard and the page behind kept scrolling. Also: any mobile input forced to `text-sm` (<16px) makes iOS zoom on focus, which re-triggers the whole viewport dance — keep the Textarea's base `text-base md:text-sm`. AND: on input focus / drags with the keyboard open, iOS *pans* the visual viewport (`vv.offsetTop` > 0) — NOT a document scroll, so the body pin can't stop it, and every fixed element slides up by `offsetTop` (header off-screen; background drags resized the panel). Fix: add clamped `offsetTop` to the panel's `top` (fine as a delta, 0 when unpanned) + block background drags with `touch-none` backdrop and a non-passive `touchmove` guard (fixed 2026-08)
- Dialog open latency is a RENDER cost, not an animation one: picker state in `/log` re-rendered every `LoggedExerciseCard` (each runs `useSortable` + its set rows) before the dialog could paint. The cards live in the memoised `ExerciseList`; keep every prop it takes referentially stable (page handlers go through `useStableCallback`, and dnd-kit's `useSensor` memoises on its options OBJECT — an inline literal there silently kills the memo). The AI Coach feels instant purely because its `open` state is local to itself (fixed 2026-09)
- First-run onboarding gates on `onboardedAt` (or a pre-existing `goal`) on the profile doc — NEVER on "the profile doc exists": `ensureExercisesSeeded` writes `seedVersion` and a language switch writes `language`, both before the user has answered anything, so doc-existence silently means the wizard never shows for a new user (added 2026-09)
- Firestore rule matches are UNIONed, never overridden: a broader `match` that also matches a path re-grants what a narrower one withholds. `users/{userId}/{collection}/{docId}` therefore carries `&& collection != 'stats'`, or it would hand the client write access to the quota doc the dedicated `stats` rule exists to deny — a silent security hole that tests green (added 2026-09)
- `firebase-admin` v14 exposes ONLY modular entry points (`firebase-admin/app`, `firebase-admin/firestore`); the `admin.apps` / `admin.credential` namespace is gone. Its firestore module also needs `@opentelemetry/api` installed EXPLICITLY, because `.npmrc`'s `legacy-peer-deps=true` skips the peer dep — without it the dev server dies on `Cannot find module '@opentelemetry/api'` from deep inside firebase-admin, while `typecheck` and `lint` both pass (added 2026-09)
- A control strip must never hide a control behind `overflow-x-auto` + `no-scrollbar` — that pushed `/log`'s primary "Add exercise" off-screen with no affordance once Spanish labels (~30% longer than English) grew. Fix by wrapping, or by letting ONE element flex and truncate (`min-w-0 flex-1`) so it yields space first; `/log` uses the latter. Measure at 360px, not 390 (fixed 2026-09)
- This shell (Git Bash on Windows) MANGLES backslashes inside heredocs: a `<<'EOF'` body containing `\\n` arrives as `\n`, silently changing regex/string semantics. It produced a confidently WRONG env-var test result this session before being caught. Build backslash-bearing content with `chr(92)` in Python, or use the Write tool — never a heredoc (added 2026-09)
- Minimum viable plan: match the stated UX outcome with the minimum change needed
- Do not add scope (refactors, extra configurability) unless explicitly asked
- When proposing UX changes, separate effects/polish (welcome) from structural/layout changes (require explicit approval)

## Custom Commands
- `/brain-sync` — captures current session state to Open Brain MCP as a meeting_debrief thought

## Session Workflow
1. Work on feature/fix
2. Run `/brain-sync` before ending the session

## Agent Guardrails (non-negotiable)
Keep this file between 200–300 lines max. Every line must earn its keep.

### Error Handling
- Every server call must handle failure with a clear, friendly message in the user's profile language (EN or ES — every user-facing string goes through `src/i18n`, never a hardcoded literal) — never a blank screen or unhandled crash. Use `friendlyErrorMessage()` from `src/lib/errorMessages.ts`; never interpolate `error.message` into a toast
- Loading states must always be visible to the user during async operations

### Security
- Row-level security must be enabled — each user may only access their own data
- Never log user emails, session data, or any PII to console or external services
- Secret keys and service role keys must live in environment variables only — never in source code or chat

### Destructive Operations
- Before ANY destructive or irreversible operation, do NOT execute directly. First confirm a recent backup/export exists (or create one), then STOP and ask for explicit confirmation, stating: (a) exactly what will be affected, (b) why it's irreversible, (c) what backup/rollback exists
- Covers (non-exhaustive): deleting or mass-updating Firestore documents or collections, unscoped writes across `users/{userId}/...`, deploying Firestore rules that broaden or remove access (`firebase deploy --only firestore:rules`), deleting files or directories (`rm -rf`, fs deletes), overwriting production data, force-pushing or rewriting git history on shared branches
- "I'll just do it quickly" is not a reason to skip this. Speed is exactly the risk

### Scale Expectation
- This is a gym app (1–5 users). Do not over-engineer for scale. Optimize for simplicity and readability over performance