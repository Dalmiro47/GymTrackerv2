# Brain Sync — Capture project state to Open Brain

Capture the current state of this project as a milestone thought in Open Brain MCP.

## Steps

0. **CLAUDE.md check** — before capturing to Open Brain, read the conversation and ask yourself one question:

   > "Did this session reveal something that would *genuinely burn future Claude instances* if they didn't know it?"

   The bar is high. Examples that qualify:

   - A constraint discovered through failure (e.g. "LibreOffice silently exits 0 with no output on PPTX")

   - A non-obvious API incompatibility or payload format gotcha

   - A decision where the *wrong* default would corrupt data or waste significant time

   Examples that do NOT qualify:

   - General patterns or code style

   - Things already derivable from reading the code

   - Workflow preferences or "nice to know" context

   - Anything that belongs in Open Brain instead

   If something qualifies: append it to the relevant section in CLAUDE.md (e.g. under an existing heading, or the Ingest Decision Log). One concise line or short paragraph — no new sections unless truly warranted. If nothing qualifies, skip this step entirely.

0b. **README drift audit** — after the CLAUDE.md check, scan this session's actual changes for documentation drift in the repo's README files. In scope: `README.md` (root), `.claude/skills/README.md`, and any `README` co-located with a directory you modified this session. Ask yourself:

   > "If someone followed these READMEs verbatim today, would this session's changes make them wrong, incomplete, or misleading?"

   Typically causes README drift (update warranted):

   - A new / renamed / removed skill or command, or a changed trigger or flag (e.g. a new CLI flag, a changed default value)

   - A changed command, env var, file/directory layout, or canonical workflow step

   - A changed responsibility split, decision-guide entry, or "how to run" instruction

   Does NOT qualify (leave the README alone):

   - Internal-only changes a reader never sees — refactors, test files, a helper function, a bugfix that does not change any documented behavior

   - Session narrative, rationale, or status — that belongs in the Open Brain capture below, not the README

   If a README is now inaccurate: make a **surgical edit** to the specific lines only — match the existing heading/table/voice and change nothing else. Do not restructure or add new sections unless the change genuinely introduces an undocumented surface. In your summary to the user, list each README touched (or state "READMEs: no drift"). If nothing qualifies, skip this step entirely.

0c. **Skill maintenance check** — after the README audit, scan THIS session's actual changes against
   this repo's `.claude/skills/`. Glance at what's there first, then consider three moves. The bar is
   high and most sessions warrant none — that is correct. Evidence is this session's diff, not a full audit.

   If `.claude/skills/` doesn't exist yet, UPDATE and DELETE are automatically N/A — but **CREATE still
   applies**: a session can justify this repo's first skill. Don't add an action item merely to create the
   empty directory; it's created when the first skill is authored. Report `Skills: none yet` when no
   candidate surfaces.

   **CREATE** — a recurring, non-obvious procedure surfaced this session that no existing skill covers
   and that you'd otherwise re-derive next time (e.g. a test-and-deploy loop, an ingest-and-verify
   sequence). → Flag a candidate: name it, suggest a trigger (e.g. `/release-verify`), note it'd live
   in this repo's `.claude/skills/`. Do NOT create it here.

   **UPDATE** — this session's changes made an existing skill inaccurate or misleading (it references a
   renamed command, a changed flag/default, a removed step). → If it's pure factual drift, make a
   **surgical edit** to the specific lines only, matching the skill's existing voice. If the fix changes
   the procedure's logic or triggers, propose the change instead of editing.

   **DELETE** — a skill now encodes a workflow this session removed or fully superseded. → **Propose only,
   never delete.** State which skill and why it looks obsolete, and leave the decision to the user.

   Does NOT qualify (skip): one-off fixes, preferences, anything already a CLAUDE.md rule or Open Brain
   thought, or a skill that's merely unused this session.

   In your summary, list any skill created/updated/proposed-for-deletion (or "Skills: no change").
   Optionally fold one next-step into the capture's `action_items`. Do NOT fire a second capture. If
   nothing qualifies, skip this step entirely.

1. Gather context in **ONE** Bash call (chain with `&&`, do not split into separate calls):

```

   git branch --show-current && git log --oneline -10 && git diff --name-only HEAD~1 HEAD && git status --short

```

   **Wait for the single result. Do NOT re-run any of these commands, and do NOT fire liveness

   probes** (`echo`, `date`, `pwd`, "is the shell alive") between or after tool calls. Tool output can

   arrive batched/delayed — a slow or empty-looking return is NOT a hung shell. Re-running commands that

   already succeeded and probing for liveness is the #1 time-waster in this command; one combined call is

   all that is needed here.

2. Use the Open Brain MCP tool `capture_thought` with these exact parameters:

   - **content**: Concise summary of what was built/changed this session. Include: features shipped, key architecture decisions, files changed, open issues or next steps. **Hard limit: 2000 characters (the API rejects anything longer). Target ≤1800 and count before sending — draft it once, under budget, in a single capture call.** Do NOT fire an over-long draft and retry on rejection; that wastes two round-trips. Capture exactly one thought per session (no parallel/duplicate capture attempts).

   - **access_level**: `secret`

   - **type**: `meeting_debrief`

   - **source**: `claude_code`

   - **topics**: 3–5 relevant tags (e.g. `["Gym Tracker", "AI Coach", "Firestore", "Playwright"]`)

   - **action_items**: Open TODOs or next steps from this session

## Rules

- **Be fast — this is a lightweight wrap-up, not an investigation.** One combined git call (Step 1),

  the README scan, then one capture call. No liveness probes, no re-running succeeded commands, no

  re-reading files already in context. If a tool result looks slow or empty, wait — do not re-fire it.

- Never invent content — only capture what actually happened

- Keep content under 1800 characters (2000 hard cap), compress if needed; never fire a too-long draft and retry

- Always include the branch name in content and at least 3 topics

- If nothing meaningful changed, skip the capture

- **README edits are surgical and evidence-based**: only edit a README when this session's actual diff makes it inaccurate, incomplete, or misleading to a reader. Never invent capabilities, never restructure, touch the minimum lines. The README audit (Step 0b) documents reader-facing surfaces; the Open Brain capture documents the session — keep them separate.

- **Skill edits are surgical and evidence-based**: only touch a skill when this session's actual diff makes it inaccurate; propose (never execute) skill creation and deletion. The skill maintenance check (Step 0c) covers reusable procedures in `.claude/skills/`; keep it driven by the session diff, not a full-corpus audit.

- **Anonymize personal names**: replace "First Last" with "First L." in `content`, `people`, and `action_items`. No full last names anywhere in `secret` thoughts. Examples: "Christina Rodriguez" → "Christina R.", "John Smith" → "John S.". Company and product names (e.g. Intersnack, Comarch, Transporeon) are not affected — only personal names.
