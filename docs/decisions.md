# Decisions

Newest first. Dates carry only the precision that was recorded. Rules live in CLAUDE.md; this file holds the longer why and what was rejected.

`REVIEW.md`, cited below, is the 2026-06-11 code review, removed from the tree and kept in git history (added in commit `aadc5dc`).

## 2026-11-14: A per-day training schedule, written by the MCP and read by `get_week_status`

- **Decision:** a new collection `users/{uid}/schedule/{YYYY-MM-DD}` holds one document per day: `{ date, items, updatedAt }`. An item is `{ kind: 'routine', routineId, routineName }`, `{ kind: 'activity', activity }` (at most 40 characters) or `{ kind: 'rest' }`; a day holds at most 3 items. A ninth write tool, `set_schedule_day({ date, items })`, replaces the items of one day; `items: []` clears the day and the document stays. The input never carries `routineName`: the tool reads it from the routine, which must exist. `rest` must be the only item of its day and a routine can be listed once. The date must be a real calendar day from Monday of the current ISO week (Europe/Berlin) to today + 28 days, both included; outside it the call is refused with `out_of_window` and nothing is written. `get_week_status` adds `scheduled` to each day: the items, or `null` for a day with no document, no items or only unreadable items. No other field of that tool changed. The app has no UI for the schedule yet.
- **Why:** the coach brief could not see which days the owner intends to train. The word is "schedule" everywhere: in a log, "planned" already means exercises saved but not lifted, and the two must not be confused. The write is a merge that always writes all three fields: the write surface only has `set` with merge, a merge replaces an array whole, and a field a later app UI adds survives. The path allowlist gained `schedule` with a stricter id rule (a real date), so no other path widened. `routineName` is a snapshot so that a day still reads after the routine is renamed or deleted. No rules change: the generic `users/{userId}/{collection}/{docId}` match already covers the collection.
- **Rejected:** a plain `set` (it widens the write type for every collection); a delete path; a top-level count of scheduled gym days left (the coach derives it from `days`; the contract stays small); a flag for a renamed or deleted routine; a no-op check (one more read for an `updatedAt` that does not matter); `routineName` in the input.
- **Known limits:** "MCP only" is a convention, not a rule: the owner's client can also write `schedule` under the generic rule, and the app UI will use that. The export does not contain the schedule. An identical call writes again. The generic `write_failed` and timeout messages still say "read the routine or the exercise again".

## 2026-11-13: MCP `set_routine_set_structure` and a group guard on routine writes

- **Decision:** an eighth write tool sets the set structure of exercises in one routine: exactly 2 ids for a superset, exactly 3 for a triset, at consecutive positions (the order of the ids does not matter); 1 or more ids, at any position, for `normal`, `dropSet` and `restPause`. A call that changes nothing writes nothing. Every routine edit that goes through `saveExercises` (add, replace, remove, reorder and the new tool) is refused with `incomplete_group` when it creates or changes an incomplete superset or triset. The check compares the incomplete runs before and after, keyed by structure plus ordered ids. `get_routine` and `list_routines` return `group` (the number of the full chunk) and `groupIncomplete` (every member of a broken run). The rule lives in the pure `src/lib/setStructureGroups.ts`.
- **Why:** a group is not stored; the app derives it from the order (consecutive same-structure exercises, cut into chunks of 2 or 3 from the top of the run). So add, remove and reorder could leave a lone member or shift the pairs. The app's routine editor does not validate groups, so a broken run can already be stored: a check of the whole routine would refuse every single fix of a routine with two broken runs. Two full groups of the same type next to each other are allowed, because that is a normal program and the stored data has one reading only. For replace, the comparison uses the stored list with the new id already in the slot, so a swap is never refused.
- **Rejected:** a check of the whole routine after every write (deadlock on stored broken runs); refusing adjacent groups of the same type; a `setStructure` input on `create_routine` (it stays all-normal; a grouped routine costs extra calls); moving the two components to the helper in the same change (a UI change with no test coverage inside a change that writes production data); a position rule for `normal`, `dropSet` and `restPause` (they never link).
- **Known limits:** the chunking rule lives in 3 places until the components move to the helper. A triset to a superset takes two calls. The tool changes the routine only: a saved log keeps its structure, and no MCP tool writes a log.

## 2026-11-13: MCP `update_exercise` edits a fixed set of exercise fields

- **Decision:** a seventh write tool changes `targetNotes`, `exerciseSetup`, `progressiveOverload`, the warm-up template, and two new optional top-level fields of `Exercise`: `loadIncrementKg` (above 0, at most 25, a multiple of 0.25) and `dumbbellLoad` (`'perHand'` or `'total'`). It writes only the fields that differ from the stored ones; equal values open no batch. The exercise is written with `batch.update`, the template as the field path `warmup.template`, and `null` removes one of the two new fields. `userEdited` and `updatedAt` are set as the app sets them. When a text field changes, every routine that holds the exercise gets the three text fields as the library holds them after the change, in the same batch, with its history versions (source `'mcp'`). `list_exercises` and `get_routine` return `warmupTemplate`, `loadIncrementKg` and `dumbbellLoad` when stored. The rep range stays in the `progressiveOverload` text; the tool answers with the parsed `repRange`.
- **Why:** the coach chat needs the machine's weight step and how a dumbbell weight is logged, and the app stored neither. The app's exercise dialog writes a fixed payload with merge, so a new top-level field survives a save from a stale dialog; `warmup.roundingIncrementKg` would not, has no reader, and a `warmup` map without `template` breaks `getWarmupConfig`. `update` fails when the document is gone, so a delete in the app between the read and the commit writes nothing; a merge would leave a document without a name, which also blocks restoring a hidden default. No screen reads the routine's copy of the text fields (the log and the coach read the library), but `targetNotes` is in the routine history hash, so the cascade keeps history true and matches what the Exercises page does.
- **Rejected:** `name` and `muscleGroup` as inputs (they are the identity and the id); a structured rep-range field (two sources, and the dialog does not know it); `setStructure` (a routine field, a later tool); `trackProgression` (see the known limit); a UI reader for the two new fields in this change; `set` with merge for the exercise; writing the warm-up template into routines (the app does not store warm-up data there).
- **Known limits:** the app does not read `loadIncrementKg` or `dumbbellLoad` yet, so the in-app overload cue still takes its step from history or the template. A warm-up template change applies to new log days only: a saved log keeps its own `warmupConfig`. An edited text of a seeded exercise is shown as stored, no longer translated, as after an app edit. `trackProgression` is read by `computeProgression` (`progression.ts:138`) from log rows, but nothing writes or copies it, so the dashboard always uses the name heuristic.

## 2026-11-13: MCP `get_week_status` infers the routine version; Berlin time only for "today"

- **Decision:** a read tool reports one ISO week: each day's session and each exercise as `performed`, `planned` or `skipped`, plus `sessionsRemaining` (the profile target minus sessions performed) and `routinesNotDone`. It gives both facts and no verdict on what is "missing". A log stores `routineId` but no routine version, so the version of a log day is inferred from `routineHistory`: the newest version created on or before that day (`history`), else the oldest version when it is a `baseline`, else the routine document when there is no history (`current`), else `unknown`, where nothing is marked skipped. `get_routine` also returns the rep range, joined from the exercise documents, as text and as a parsed `repRange`.
- **Why:** the pre-gym brief filtered the week by hand from `get_recent_logs` and got it wrong, and skipped the rep range because it had to cross it from `list_exercises`. A log's `date` is the calendar day picked in the app, with no timezone, so only "today" and "the current week" need a zone; `Intl` with `timeZone: 'Europe/Berlin'` gives it with no dependency, and the week math runs on plain dates. Selecting a routine copies every exercise into the log as planned, so "not lifted" is normally `planned`; `skipped` appears only when a row was removed or replaced by hand.
- **Rejected:** a verdict on which session is missing (routines carry no weekday, and a rotation is wrong with more routines than training days); storing a version id on the log (a schema change and a log write); moving the UTC cut of `get_recent_logs` to Berlin (a change to an existing tool contract); the rep range in `list_routines` (up to 300 extra reads).
- **Known limit:** a routine edit made later on the same day counts as that day's version.

## 2026-11-10: MCP write tools for routines and exercises

- **Decision:** six write tools (`create_exercise`, `create_routine`, and add, replace, remove, reorder of a routine's exercises). Claude proposes, the user says yes in the chat, then the tool writes; there is no confirmation token. The write repo type has `create`, `set` with merge and `commit` only, and one function builds every path: `users/{MCP_OWNER_UID}/(routines|exercises|routineHistory)/{id}`. New documents use `create`. A routine edit merges `{ exercises, updatedAt }`. The routine and its history versions go in one batch, source `'mcp'`. The app services and the tools build documents with the same pure functions (`routineDoc`, `exerciseDoc`, `routineHistoryPlan`). The tools restate the rules the app keeps in its UI: no second exercise with the same name + muscle group, no exercise twice in a routine, at least one exercise. `replace` takes the id expected at the slot and `reorder` takes the full id list, so a stale view is refused.
- **Why:** the Admin SDK skips `firestore.rules`, so scope and validation have to live in code. `create` fails when the id exists, so a race can never overwrite a document. The merge matches the app's `updateDoc` and keeps `name`, `order`, `createdAt` and any field the tool does not know. One batch means a routine never changes without its history (in the app, history is best-effort after the write). Shared builders keep the two writers from drifting apart. A planned version always gets a `createdAtMs` after the latest stored one, because the document id is built from it.
- **Rejected:** a delete of any document, workout-log writes, routine order on the routines page and restoring a history version (out of v1); a full `set` for routine edits (it drops unknown fields and a rename made in the app in between); `set` for new documents (it overwrites on a race); a confirmation token; a `setStructure` input (one exception since PR B2: the `set_routine_set_structure` tool; `create_routine` stays all-normal); source `'mcp'` on the backfilled baseline (it is the state before the change).
- **Known limit:** if the app deletes a routine between the tool's read and its commit, the merge leaves a document without `name` or `order`. The routines list does not show it; it needs a manual cleanup.

## 2026-11-10: Read-only MCP server inside the app

- **Decision:** the MCP endpoint is a route of this app, `/api/mcp/<MCP_ACCESS_KEY>`, built on `@modelcontextprotocol/server` with its stateless web transport. The path key is the only credential and is compared in constant time. The owner uid comes from `MCP_OWNER_UID`, never from a request, and no tool takes a uid. Reads go through the Admin SDK, every one rooted at `users/{MCP_OWNER_UID}` and bounded by a limit or a date range. The route answers the same 401 when either env var is missing, the key is under 32 characters, the key is wrong, or the Admin SDK is not configured.
- **Why:** in-app reuses the deployment, the service account and the pure helpers (`toCoachProfile`, `displayExerciseName`) with no second service to run. A Claude connector registered without sign-in cannot send headers, so the key sits in the path. The Admin SDK bypasses `firestore.rules`, so the scoping has to live in code: one repo bound to the env uid, whose db type has no write method. Failing closed keeps a half-configured deployment from serving the wrong account.
- **Rejected:** a separate MCP service; a uid as tool input; reusing the client-SDK services (they need a signed-in browser session); `mcp-handler` (the server package's own transport covers the route); unbounded collection reads; an `array-contains` history query (it needs a composite index the repo cannot verify).

## 2026-11-07: Squat illustration icon; separate `any` and `maskable` PNGs

- **Decision:** the app icon is a raster illustration (barbell back squat, sky rim light, near-black background) with master `assets/brand/squat-master.png`, kept outside `public/` so it is never served. `scripts/gen-icons.mjs` renders full-bleed `any` icons (192, 512), an opaque 180 `apple-touch-icon`, `src/app/favicon.ico`, and a separate `icon-maskable-512.png`: the illustration at 76% centred on the colour sampled from the master's corner (`#000000`). The manifest `background_color` is `#000000` to match. The header, sidebar and login show only the "DDS Gym Tracker" text; `AppIcon` renders `/icons/icon-192.png` and is used only by the 48 px `InstallGuide`.
- **Why:** the illustration fills its square edge to edge, so one file declared `any maskable` would let Android's mask cut the bar tip and the plates. Measured on the master, at 80% they reach radius 0.41-0.42 of the icon, past the 0.40 minimum safe circle; at 76% everything fits. At 20 px the illustration is unreadable, so small placements use text.
- **Rejected:** one `any maskable` file (plates cut); an 80% inset (bar tip outside the safe circle); the illustration in the app bar and sidebar (unreadable at 20 px); a cropped favicon (the full master was chosen).
- **Supersedes:** "Full-bleed PWA icons (Iron Glass)" (2026-09).

## 2026-11-01: Docs as map

- **Decision:** CLAUDE.md is a map with one-line gotchas, longer whys live here, and the README is a short map (dds-kit 0.9 brain-sync standard).
- **Why:** docs grew into a second description of the code that drifted from it. REVIEW.md finding #10 was a real case: CLAUDE.md described a non-streaming coach endpoint after the code had moved to SSE.
- **Rejected:** none recorded.

## 2026-11-01: Constraints load from the plugin; the repo copy is dropped

- **Decision:** universal constraints reach a session through the dds plugin import line in `~/.claude/CLAUDE.md`; this repo no longer keeps an exported `CONSTRAINTS.md`.
- **Why:** every constraints change needed a PR per repo (dds-kit 0.10.0). The owner confirmed this repo is used only locally with the dds plugin, and nothing in it read the file. A machine without the import line has no constraints.
- **Rejected:** keeping the exported copy, which dds-kit keeps only where the import cannot serve a repo.

## 2026-09: A PR only goes down through a user-triggered recheck

- **Decision:** the automatic path never lowers a PR except for the log that sourced it; `recheckPersonalRecord` is the only other way down.
- **Why:** the automatic path recomputes downward solely for the log that sourced the PR, and an exercise corrected back to its prefill turns provisional and is skipped on save entirely. So a mistyped set leaves a PR nothing supports, and the fix has to be an explicit rescan of every log containing the exercise.
- **Rejected:** none recorded.

## 2026-09: "Chalk & Iron" design tokens: dark-first, one brand accent

- **Decision:** dark is the default theme, `--primary` is the single brand accent, and `--accent` is a neutral gray for shadcn hovers.
- **Why:** the pre-redesign code used `bg-accent`/`text-accent` for brand actions, which caused the color chaos.
- **Rejected:** none recorded.

## 2026-09: Dialogs open with no entry animation

- **Decision:** `Dialog` and `AlertDialog` appear plainly; the coach window's plain appear is the reference feel.
- **Why:** the animated versions read as laggy on device.
- **Rejected:** edge-slide sheet; the zoom/slide/blur combo; directional entry (sliding in from the half of the screen you pressed), which was tried.

## 2026-09: Full-bleed PWA icons ("Iron Glass")

- **Decision:** the PNGs in `public/icons/` are rendered from `public/logo.svg` as full-bleed squares.
- **Why:** the manifest declares one file `any maskable` and iOS masks its own corners.
- **Rejected:** baked-in rounded corners, which leave transparent slivers under Android's squircle.
- **Superseded 2026-11-07:** by "Squat illustration icon; separate `any` and `maskable` PNGs". `public/logo.svg` is removed.

## 2026-09: Stored values stay English; Spanish is applied at display time

- **Decision:** data keys and seeded default exercises are written in English; `src/lib/defaultExercises.es.ts` is applied per field at display time, only while the stored value still equals the seeded English one.
- **Why:** past logs, routines, progression and history localize with no migration. Seeded ids are slugs of the English name, `name` is denormalized into logs, routines and history snapshots, snapshots are hashed, and `inferWarmupTemplate` keys off English words.
- **Rejected:** none recorded.

## 2026-09: Jev grades the coach eval, Sonnet explains the fails

- **Decision:** `npm run coach:eval` grades each reply with Jev (`typesafe/jev-1.13`, an OpenRouter decision model that returns a fail probability and no reason); Sonnet 5 explains only the fails.
- **Why:** on 29 hand-labelled replies Jev scored 25/29 against Sonnet's 18/29, at about 1/100 the cost.
- **Rejected:** Sonnet as the judge.

## 2026-08, 2026-09: Coach reasoning off, except `exercise-library`

- **Decision:** coach modes run with `reasoning_effort: 'none'` and a 1500-token budget; `exercise-library` alone uses `reasoning_effort: 'default'`, `reasoning_format: 'hidden'` and `maxTokens: 4000`.
- **Why:** `qwen/qwen3.6-27b` burned the full 1500-token budget on a one-line question and truncated mid-sentence instead of erroring. Without thinking, the Exercises coach re-suggested exercises the user already had; reasoning used about 1.2-1.6k tokens there.
- **Rejected:** reasoning on at 1500 tokens; reasoning off for `exercise-library`.
- **Update 2026-11-07:** the coach moved to `qwen/qwen3.8-27b` after Groq shut down `qwen/qwen3.6-27b`; the reasoning settings stay the same.

## 2026-08, 2026-09: Provisional is derived, `performed` is persisted

- **Decision:** `isProvisional` is derived from sets versus `prefill` and stays UI-only; `LoggedExercise.performed` is saved in the log.
- **Why:** a log doc also stores the sets of a planned-but-never-performed exercise (a copy of the last session's), so PR scans need a persisted way to tell a real lift from a pre-fill. Trusting the stripped flag on the next save of the day read every untouched exercise as performed: it stamped the `performanceEntries` date and `performed: true`, and reload then showed it done, dropped the overload cue, and the coach called it completed.
- **Rejected:** flipping the flag on focus, which made the coach treat planned exercises as done mid-workout; reading the flag at save time instead of re-deriving it from `prefill`.

## 2026-08: Mobile coach panel is bounded by `top` + `bottom`

- **Decision:** the panel has no measured height; the keyboard moves only its bottom edge and the message list absorbs the difference, as LinkedIn's mobile chat does. Recipe: `docs/mobile-chat-panel.md`.
- **Why:** `position: fixed` resolves against the layout viewport, which iOS never shrinks for the keyboard, and iOS reports `visualViewport` absolutes unreliably (a height LARGER than the visible box in standalone/PWA); only the delta can be trusted.
- **Rejected:** sizing from `visualViewport.height`/`offsetTop`, which moved the whole dialog up and ran the header off-screen; a `dvh`/centered panel, which slid under the keyboard while the page behind kept scrolling; `body{overflow:hidden}` alone, which does not stop iOS touch-scroll chaining.

## 2026-06-11: Deload is a derived view; inputs are disabled while it is on

- **Decision:** `currentLog` is derived from the baseline, and set inputs are disabled while Deload Mode is active.
- **Why:** writing the transformed view into the baseline compounded each edit (100 kg to 90 to 81) and halved set count again, and the corrupted baseline was what got saved (REVIEW.md #4, §6).
- **Rejected:** inverse-transforming edits before writing to the baseline (REVIEW.md §3.2 option b).

## 2026-06-11: `xlsx` stays for now

- **Decision:** keep `xlsx@0.18.5` despite its known advisories.
- **Why:** replacing the dependency or dropping the Excel export is a product decision; export-only use is low risk (REVIEW.md #30, §6).
- **Rejected:** none recorded.
