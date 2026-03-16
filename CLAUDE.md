# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server with Turbopack (http://localhost:9002)
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
```

### AI Coach

The Coach is a contextual chat embedded in `/log` (workout coaching) and `/routines` (program analysis). It uses Groq (model: `meta-llama/llama-4-scout-17b-16e-instruct`) via a vendor-agnostic LLM provider interface.

**Key files:**
- `src/lib/ai/llm-provider.ts` — `LLMProvider` interface + `GroqProvider` (OpenAI-compatible REST)
- `src/lib/ai/context-builders.ts` — Serializes page data into compact context (log-day + routine-review)
- `src/lib/ai/chat-prompts.ts` — System prompt builders with goal-based volume targets and progressive overload logic
- `src/app/api/coach/chat/route.ts` — Single streaming SSE endpoint
- `src/hooks/use-coach-chat.ts` — Client-side chat state + SSE stream reader
- `src/components/coach/CoachChatSheet.tsx` — Shared Sheet UI component

**To extend AI features:** Add a new mode in `context-builders.ts` + `chat-prompts.ts`, then use `CoachChatSheet` with `mode="your-mode"`.

### UI Stack

- **shadCN/UI** components in `src/components/ui/` (Radix primitives + Tailwind)
- **Tailwind** with CSS variable theming — colors/fonts defined in `src/app/globals.css` and `tailwind.config.ts`
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
- Every server call must handle failure with a clear, friendly Spanish message — never a blank screen or unhandled crash
- Loading states must always be visible to the user during async operations

### Security
- Row-level security must be enabled — each user may only access their own data
- Never log user emails, session data, or any PII to console or external services
- Secret keys and service role keys must live in environment variables only — never in source code or chat

### Scale Expectation
- This is a household app (1–5 users). Do not over-engineer for scale. Optimize for simplicity and readability over performance