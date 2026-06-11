# Manual Smoke Tests — Fix Verification

Setup: `npm run dev` → open http://localhost:9002 and sign in with Google.
Each test maps to a REVIEW.md finding (in parentheses). Total time: ~15 min.

---

## 1. Set structure change doesn't crash (#1 — was a guaranteed crash)

1. Open `/log` on a day that already has a **saved** workout.
2. On any exercise card, change **Session Set Structure** (e.g. Normal → Superset).

✅ **Pass:** badge/border updates, no crash, no console `ReferenceError`. Reload the page — the structure change was persisted.

## 2. Deload Mode doesn't corrupt weights (#4 — the big one)

1. On `/log` with a workout (e.g. a set of 100 kg), note the weights.
2. Toggle **Deload Mode** ON → weights drop (~90 kg) and set count halves.
3. Toggle it OFF and ON again **several times**.
4. While ON, try to type in a reps/weight field.

✅ **Pass:** weights always show the same reduced value (90, never 81/72.9 — no compounding); toggling OFF always restores the originals exactly; inputs are **disabled** while Deload is ON.

## 3. Saving feels fast and PRs update without a reload (#8)

1. On `/log`, enter a new best set for some exercise (heavier than its shown PR).
2. Press **Save Day's Log**.

✅ **Pass:** save completes noticeably faster than before, no full "Loading log data..." flash afterwards, and the PR badge on the card updates immediately.

## 4. "Save Progress" doesn't save phantom data (#9)

1. Pick a routine for an empty day → all exercises pre-fill greyed (provisional).
2. Edit sets on **only the first** exercise and press its **Save Progress**.
3. Reload the page (F5).

✅ **Pass:** only the exercise you touched has saved data; the untouched ones come back as fresh pre-fills, not as "performed" sets with last session's numbers.

## 5. Cancelled login doesn't hang (#5)

1. Log out. On `/login`, click **Sign in with Google**, then **close the popup** without picking an account.

✅ **Pass:** you're back on the login form (no infinite spinner). Sign in normally afterwards still works.

## 6. Coach API rejects strangers (#6)

With the dev server running, from a terminal:

```bash
curl -i -X POST http://localhost:9002/api/coach/chat \
  -H 'Content-Type: application/json' \
  -d '{"mode":"log-day","messages":[{"role":"user","content":"hola"}],"context":{"date":"2026-06-11","exercises":[]}}'
```

✅ **Pass:** `401` with `"No autorizado..."`. Then, in the app, open the AI Coach on `/log` and ask something — it still answers normally (your token is sent automatically).

## 7. Duplicate routine name doesn't overwrite (#7)

1. On `/routines`, create a routine named **Test Push** with one exercise.
2. Create **another** routine also named **Test Push** with a *different* exercise.

✅ **Pass:** both cards exist; the first one kept its original exercise. (Clean up: delete both.)

## 8. Empty sets aren't saved as 0x0 (#14)

1. On `/log`, add an exercise, fill **set 1** with real values, press **Add Set Here** and leave set 2 completely empty.
2. Save the day, then reload.

✅ **Pass:** only the filled set comes back — no `0 reps @ 0 kg` row (also check the Dashboard day details).

## 9. "Edit warm-up settings" link works now (#20)

1. On `/log`, open the 🔥 flame icon on an exercise → click **Edit warm-up settings**.

✅ **Pass:** you land on `/exercises` with that exercise's **edit dialog already open** (previously: nothing opened).

## 10. Squat/deadlift warm-up shows "Empty Bar" (#22)

1. On `/log`, add a barbell squat or deadlift, set a working weight (e.g. 100), open the 🔥 warm-up panel.

✅ **Pass:** the first warm-up row is **Empty Bar — 20 kg** (previously missing).

## 11. Removing a middle set keeps weights aligned (#21)

1. On an exercise with 3 sets at distinct weights (e.g. 50 / 60 / 70), click into a weight field (keep focus inside the card) and delete **set 2** with its trash icon.

✅ **Pass:** the remaining rows show 50 and 70 — values didn't shift onto the wrong rows.

## 12. One delete dialog, three buttons (#23) + general log flow

1. On `/log` (desktop width), open the delete confirmation from the header button, cancel; from the card-footer button, cancel; shrink to mobile width and use the sticky-bar **Delete**.

✅ **Pass:** same single dialog each time; confirming actually deletes the day and the calendar underline disappears.

## 13. Mobile niceties (#29, #24)

1. On a phone (or DevTools device mode): pinch-zoom the app.
2. Ask the coach something at night; check tomorrow morning that the chat reset at **local** midnight.

✅ **Pass:** pinch-zoom works (was blocked); chat history rolls over on your local date.

## 14. Developer gates (#2, #3 — run these last)

```bash
npm run typecheck   # expect: no output, exit 0
npx next lint       # expect: "No ESLint warnings or errors"
npm run build       # expect: compiles, 12/12 pages
```

---

**Not covered here (deferred decisions):** xlsx dependency swap (#30) and the English→Spanish toast sweep (#32) — see REVIEW.md §6.

**Note:** the `firestore.rules` cleanup is content-identical in behavior but only takes effect if you deploy it (`firebase deploy --only firestore:rules`). No test needed — existing reads/writes working (tests 1–12) already proves the active rules are fine.
