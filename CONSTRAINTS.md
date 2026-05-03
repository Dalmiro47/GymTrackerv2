# CONSTRAINTS.md — Intent Engineering Guardrails
# Universal constraints for all DDS projects using Claude Code
# Derived from Open Brain patterns, past failures, and Nate Jones intent engineering framework
# Last updated: 2026-05-03

---

## 1. WHAT I DO NOT WANT THE AGENT TO DO (even if it accomplishes the goal)

### 1.1 Scope & Blast Radius
- **Never rewrite files outside the scope of the current task.** If the task says "update component X", do not refactor component Y even if it's related or "would benefit from it."
- **Never add features, dependencies, or architectural changes not explicitly requested.** Scope creep compounds nonlinearly — small additions cascade into untested surface area.
- **Never create new branches, push commits, or open PRs.** Git workflow is manual. Prompts should focus on file changes and verification steps only.
- **Never delete or overwrite files without explicit instruction.** If a file needs replacing, say so and wait for confirmation. Destructive operations are never implicit.

### 1.2 Data & Content Integrity
- **Never summarize, condense, or paraphrase existing content during structural operations** (splits, migrations, refactors). Copy verbatim. Information loss in institutional knowledge is unacceptable.
- **Never fabricate data points, statistics, citations, or sources.** If data is unavailable, say "I don't have this" — never fill the gap with plausible-sounding fiction.
- **Never silently drop rows, entries, or records** during data transformations. Every input must map to an output or be explicitly flagged as excluded with a reason.

### 1.3 Security
- **Never expose API keys, tokens, passwords, or secrets** in terminal output, command history, code, or any tracked file. Always use `.env.local` (gitignored), Codespaces Secrets, or environment variable managers.
- **Never acquire credentials, permissions, or access beyond what is already available.** If accomplishing the goal seems to require elevated access, stop and ask.
- **Never log, store, or transmit sensitive user data** (emails, payment info, PII) outside explicitly designed secure paths.

### 1.4 Communication & Side Effects
- **Never send emails, messages, API calls, or webhooks** to external systems unless explicitly instructed for that specific action.
- **Never modify production databases, deployed services, or live configurations** unless the task explicitly names the production target and confirms intent.

### 1.5 AI Output Quality
- **Never treat a historical constraint or bug report as a feature request.** When the user says "we had X problem before, don't bring it back," that's a hard guardrail — not an invitation to explore or reproduce the behavior.
- **Never silently produce plausible-looking output that is actually wrong.** Silent failure (correct-seeming but incorrect output) is the most dangerous failure mode. When uncertain, flag uncertainty explicitly.

---

## 2. WHEN TO STOP AND ASK

### 2.1 Ambiguity
- **The task references something you don't have context for** — a file, a system, a decision, a person — and guessing wrong would waste significant effort. Ask which one.
- **The task can be interpreted in two or more meaningfully different ways** that would produce different architectures, outputs, or side effects. State the interpretations; ask which one.

### 2.2 Risk Thresholds
- **The change touches more than 5 files** not mentioned in the original task scope. Pause, list the files you'd touch, and confirm before proceeding.
- **The change would delete, rename, or restructure files/folders** beyond the explicit scope. Confirm the blast radius.
- **You encounter a failing test, lint error, or build error** that was not caused by your current changes. Report it — do not "fix" unrelated breakage without confirmation.
- **Context window usage exceeds 50%.** Signal that quality may degrade and suggest a session restart with a CLAUDE.md scaffold, rather than pushing through.

### 2.3 Missing Information
- **You need to make an assumption about user data, environment, or infrastructure** that isn't stated in CLAUDE.md, the task, or project files. State the assumption explicitly before acting — don't silently proceed.
- **The task requires access to a system, API, or resource you cannot reach.** Say so immediately rather than building a workaround.

### 2.4 Constraint Conflicts
- **The task as stated would require violating any rule in Section 1.** Stop. Quote the conflicting constraint. Ask how to proceed.

---

## 3. GOAL vs. CONSTRAINT CONFLICTS — WHICH WINS

### 3.1 Priority Ladder (highest to lowest)

```
1. SECURITY        — Never compromise. No goal justifies exposing secrets or acquiring unauthorized access.
2. DATA INTEGRITY  — Never lose, fabricate, or silently corrupt data. No deadline justifies information loss.
3. SCOPE BOUNDARY  — Stay within the stated task. No efficiency gain justifies unrequested side effects.
4. QUALITY         — Tests pass, types check, lint clean. No speed justifies shipping broken code.
5. TASK COMPLETION — Accomplish the goal within the above constraints.
```

### 3.2 Conflict Resolution Rules
- **If completing the goal requires violating a higher-priority constraint:** stop, explain the conflict, and propose an alternative path that respects the constraint — even if it's slower or less elegant.
- **If two constraints at the same level conflict:** stop and ask. Do not resolve the tension by picking one silently.
- **If the user explicitly overrides a constraint:** proceed, but acknowledge the override in your response so there's a record of the decision. (Exception: security constraints in 3.1 level 1 are non-overridable.)
- **When in doubt, constraints win over goals.** The agent's default bias is toward task completion; these rules exist to counterbalance that bias. Err on the side of doing less and asking more.

---

## 4. SESSION HYGIENE (from past failures)

- **Snapshot before destructive changes.** Use `git commit` as a save point before any refactor, migration, or split.
- **Restart before context rot.** If the session exceeds ~30 messages or 50% context, quality degrades silently. Restart with CLAUDE.md scaffold rather than pushing through.
- **Verify before editing.** Always read the actual current file content before making edits. Never edit from memory or stale context.
- **Test after every meaningful change.** Run `npx tsc --noEmit && npm run lint` (or project-equivalent) after each change set. Do not batch multiple untested changes.

---

## 5. PROJECT-SPECIFIC EXTENSIONS

> Each project may define additional constraints in its own CLAUDE.md or skill files.
> Project-specific constraints are ADDITIVE — they can tighten but never loosen the rules above.
> If a project constraint conflicts with a universal constraint, the stricter rule wins.

### DRAG Wiki
- Split threshold: 20K+ chars only. Never split below 13K.
- Content-preservation rule: verbatim copy on splits, never summarize.
- Wiki is source of truth over LightRAG when they contradict.
- drag-compile must never create new leaf pages — only write to existing paths.
- Tacit knowledge gate: pause before ingesting formal documents and prompt for human context.

### Pulse
- Dual-fetch retrieval: always run semantic + type-filtered (constraint) searches in parallel.
- Trust hierarchy: constraint > decision > observation > meeting_debrief.
- AI calls via server actions only — never from client components.

### DDeutSche
- No simplifications — full code blocks always.
- English for all code/architecture regardless of chat language.
- Tailwind core utilities only (no compiler available).
- Constraints framed as history ("we had overflow issues") are hard guardrails.

### All DDS Apps
- Row-level security: each user sees only their own data.
- Error handling: always show a friendly message, never blank screen on failure.
- State scale expectations upfront (10 users vs 10,000 users) so architecture matches.
