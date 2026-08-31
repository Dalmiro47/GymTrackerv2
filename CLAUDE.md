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

The Coach is a contextual chat embedded in `/log` (workout coaching) and `/routines` (program analysis). It uses Groq (model: `qwen/qwen3.6-27b`, with `reasoning_effort: 'none'`) via a vendor-agnostic LLM provider interface.

**Key files:**
- `src/lib/ai/llm-provider.ts` — `LLMProvider` interface + `GroqProvider` (OpenAI-compatible REST)
- `src/lib/ai/context-builders.ts` — Serializes page data into compact context (log-day + routine-review)
- `src/lib/ai/chat-prompts.ts` — System prompt builders with goal-based volume targets, progressive overload logic, and KNOWN EXERCISES injection
- `src/app/api/coach/chat/route.ts` — **SSE streaming** endpoint: `POST` → `text/event-stream` of `data: {"v":"<delta>"}` chunks. Uses `provider.chatStream()`; `filterThinkingStream` strips qwen3 `<think>…</think>` tokens before forwarding (with a `flush()` for short replies); kept as a safety net now that reasoning is disabled. Requires a Firebase ID token (`Authorization: Bearer <token>`), verified via the Identity Toolkit REST API. `maxTokens: 1500`.
- `src/hooks/use-coach-chat.ts` — Client-side chat state. Reads the SSE stream and appends deltas to the assistant bubble; sends the user's Firebase ID token; history sanitized via `extractTextFromContent()` before being sent to the API. Chat history persists in localStorage per local day.
- `src/components/coach/CoachChatSheet.tsx` — Shared Sheet UI. `SegmentRenderer` renders markdown (bold, italic, headings `#`–`######`, bullet/numbered lists, strips `---`). Raw markdown never shown to user.

**To extend AI features:** Add a new mode in `context-builders.ts` + `chat-prompts.ts`, then use `CoachChatSheet` with `mode="your-mode"`.

### UI Stack

- **shadCN/UI** components in `src/components/ui/` (Radix primitives + Tailwind)
- **Tailwind** with CSS variable theming — colors/fonts defined in `src/app/globals.css` and `tailwind.config.ts`
- **Design tokens (2026-06 redesign)**: single brand accent is `--primary` (violet); `--accent` is a NEUTRAL gray wired to shadcn ghost/outline hovers — never use `bg-accent`/`text-accent` for brand actions (the pre-redesign code did, and it caused the color chaos). No Tailwind palette classes (`text-blue-600` etc.) outside the token system
- Custom fonts: PT Sans (body), Space Grotesk (headlines)
- **PWA** enabled in production only (configured in `next.config.ts`)

### Key Types

All domain types are in `src/types/index.ts` — `Exercise`, `Routine`, `WorkoutLog`, `SetEntry`, `UserProfile`, etc. Set structure variants (straight sets, drop sets, supersets, etc.) are in `src/types/setStructure.ts`.

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
- `AvailableExercisesSelector` renders the muscle-group grid and the filtered list from ONE tree with ONE search `<Input>`. Splitting them into two `return`s (or two components) remounts the input on the first keystroke, dropping focus and closing the mobile keyboard — invisible on desktop and to Playwright (fixed 2026-08)
- `LoggedExerciseCard`'s card border is the set-structure channel (`SET_STRUCTURE_COLORS` / `--ss-*` tokens). Per-card *state* cues must not add a ring there — a rep-goal ring shipped as two competing outlines on superset cards. State lives in a full-bleed band inside `CardContent` instead, always mounted with only its colors toggling, so a cue that flips mid-typing can't remount the set inputs (fixed 2026-08)
- Groq reasoning models spend `max_completion_tokens` on hidden `<think>` tokens BEFORE writing the answer, so leaving reasoning on silently truncates replies mid-sentence (`finish_reason: length`) instead of erroring. `qwen/qwen3.6-27b` burned the full 1500-token budget on a one-line question; `reasoning_effort: 'none'` (Groq accepts only `none` | `default`) is required in `llm-provider.ts` for any budget this small (fixed 2026-08)
- Deload persistence: a log saved with `isDeload` stores the *already-reduced* sets plus `deloadApplied: true`; `currentLog` transforms the baseline ONLY when `isDeload && !deloadApplied`. Dropping that guard re-reduces stored sets on every reload (the original compounding bug in a new coat) (added 2026-08)
- `isProvisional` / `prefill` / `currentPR` / `personalRecordDisplay` are UI-only (stripped in `saveWorkoutLog`). `isProvisional` is DERIVED in `updateExerciseInLog` (`withDerivedProvisional`): true only while an exercise's sets still equal its `prefill` — focus never flips it (a focus-based flip made the coach treat planned exercises as done mid-workout, fixed 2026-08). Coach log-day context splits COMPLETED vs PLANNED on this flag. Any "unsaved changes" check must compare `persistedShape()`, not the whole log
- `cachedFetch` memoizes *resolved* promises, so a service that catches and returns `[]`/`0` pins that empty result for the 5-min TTL. Services in `trainingLogService` rethrow; callers own the toast (fixed 2026-08)
- `getLastNonDeloadPerformance(...).lastPerformedDate` is the date of the newest LOG DOC containing the exercise (today's, once saved — performed or not), NOT the `performanceEntries` doc, which only `saveExercisePerformanceEntries` stamps for non-provisional exercises. "Was this exercise performed on day X?" must read `getLastLoggedPerformance`; the derived one made every saved-as-plan exercise look done on reload (fixed 2026-08)
- Mobile keyboard: `position: fixed` resolves against the LAYOUT viewport, which iOS never shrinks for the keyboard, and `body{overflow:hidden}` does NOT stop iOS touch-scroll chaining. `CoachChatSheet` therefore pins the body (`position:fixed` + negative `top`, scroll restored on close) and sizes its panel from `useVisualViewport` (`visualViewport.offsetTop`/`.height`) ONLY while `keyboardOpen` — idle it uses plain CSS `top`/`bottom` + `env(safe-area-inset-bottom)`, because iOS standalone/PWA reports a `visualViewport.height` LARGER than the visible content box, so measuring then ran the panel's bottom edge (and the composer) off-screen. A `dvh`/centered panel slid under the keyboard and the page behind kept scrolling. Also: any mobile input forced to `text-sm` (<16px) makes iOS zoom on focus, which re-triggers the whole viewport dance — keep the Textarea's base `text-base md:text-sm` (fixed 2026-08)
- Minimum viable plan: match the stated UX outcome with the minimum change needed
- Do not add scope (refactors, extra configurability) unless explicitly asked
- When proposing UX changes, separate effects/polish (welcome) from structural/layout changes (require explicit approval)

## Playwright
- Never run Playwright tests unless explicitly instructed with the phrase "run playwright"
- Never add Playwright test runs to the default dev workflow or pre-commit hooks
- Tests live in /tests/playwright/ and are only executed on demand
- Always use assertion/test spec mode (pass/fail) — never screenshot-only mode
- Screenshot approach is prohibited: Claude reads test output directly, no human review loop needed

## Custom Commands
- `/playwright` — runs Playwright test suite for current feature; creates spec if none exists; auto-corrects until all pass
- `/brain-sync` — captures current session state to Open Brain MCP as a meeting_debrief thought

## Session Workflow
1. Work on feature/fix
2. Run `/playwright` when implementation is done
3. Run `/brain-sync` before ending the session

## Agent Guardrails (non-negotiable)
Keep this file between 200–300 lines max. Every line must earn its keep.

### Error Handling
- Every server call must handle failure with a clear, friendly message in English (the UI language; the AI Coach replies in whatever language the user writes) — never a blank screen or unhandled crash. Use `friendlyErrorMessage()` from `src/lib/errorMessages.ts`; never interpolate `error.message` into a toast
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