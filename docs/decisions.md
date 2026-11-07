# Decisions

Newest first. Dates carry only the precision that was recorded. Rules live in CLAUDE.md; this file holds the longer why and what was rejected.

`REVIEW.md`, cited below, is the 2026-06-11 code review, removed from the tree and kept in git history (added in commit `aadc5dc`).

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
