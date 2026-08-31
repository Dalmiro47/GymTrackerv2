# Mobile-safe chat panel (LinkedIn-style composer)

A portable recipe for a floating chat/assistant panel that behaves correctly on
mobile: the on-screen keyboard never buries the composer, the page behind is
frozen, and the text box grows line by line with an optional full-panel expand.

Reference implementation in this repo:
- `src/hooks/use-visual-viewport.ts`
- `src/components/coach/CoachChatSheet.tsx`

Stack assumed: React 18+ (client component), Tailwind. The ideas are plain
DOM/CSS and port to any framework; only the class strings are Tailwind-specific.

---

## The five problems

| # | Symptom | Root cause |
|---|---------|-----------|
| 1 | Keyboard opens, the panel slides up and the composer disappears off-screen | `position: fixed` resolves against the **layout viewport**, which iOS never shrinks for the keyboard |
| 2 | The page behind keeps scrolling under the open panel | `body { overflow: hidden }` does **not** stop iOS touch-scroll chaining |
| 3 | Fixed-height text box: tiny for long messages, wasted space for short ones | No auto-grow, no expand affordance |
| 4 | Panel bottom edge (and part of the composer) runs off the bottom of the screen | JS-measured height from `visualViewport.height`, which **overshoots** the visible content box on iOS standalone/PWA when the keyboard is closed |
| 5 | Keyboard opens and the whole dialog **jumps upward** — header scrolls off the top, leaving a tall empty message area | The panel was positioned by `top` + `height` read from `visualViewport`. Moving `top` is the wrong model: only the **bottom** edge should move. Compare LinkedIn — the dialog stays put and you simply see fewer messages |
| 6 | On input focus the panel **slides up and the header leaves the screen** even with correct top/bottom bounds — and this happens with the body pinned | iOS **pans the visual viewport** (`visualViewport.offsetTop` > 0) to reveal the focused input. This pan is *not* a document scroll — the body pin cannot stop it — and `position: fixed` elements stay in **layout** coordinates, so they visually slide up by `offsetTop` |
| 7 | With the keyboard open you can still drag the page behind, and the chat area **grows/shrinks as you do** | Same pan: while the keyboard is open iOS lets touch drags pan the visual viewport regardless of `body { position: fixed }`. The changing `offsetTop` changes the computed `keyboardHeight`, which moves the panel's `bottom` |

---

## 1. The visual-viewport hook

`window.visualViewport` describes the part of the page **not** covered by the
keyboard. Expose only the **difference** between it and the layout viewport —
i.e. how many pixels of keyboard there are — never its absolute `height`/`top`.
That single number is all a `position: fixed` panel needs, and it is the only
one iOS reports reliably (see problems 4 and 5).

```ts
'use client';
import { useEffect, useState } from 'react';

export type VisualViewportRect = {
  /** Height of the on-screen keyboard, in LAYOUT-viewport px (0 when closed). */
  keyboardHeight: number;
  /** Height of the visible area, i.e. excluding the on-screen keyboard (px). */
  height: number;
  /**
   * How far iOS has PANNED the visual viewport down inside the layout viewport
   * (px, 0 normally). Happens on input focus and on drags while the keyboard is
   * open; it is NOT a document scroll, so pinning the body cannot stop it.
   * Fixed elements slide up by this amount — add it to the panel's `top`.
   * Safe even though iOS absolutes are not: it's a delta that is 0 when
   * nothing panned (problems 6 and 7).
   */
  offsetTop: number;
  /** Rough heuristic: the keyboard (or another OS overlay) is covering the page. */
  keyboardOpen: boolean;
};

const KEYBOARD_THRESHOLD_PX = 120;

/** Returns `null` when disabled or unsupported — callers fall back to plain CSS. */
export function useVisualViewport(enabled: boolean): VisualViewportRect | null {
  const [rect, setRect] = useState<VisualViewportRect | null>(null);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!enabled || !vv) {
      setRect(null);
      return;
    }

    const read = () => {
      // `offsetTop` counts too: it is the slice of the layout viewport scrolled
      // off above the visible area, which is not keyboard and must not be
      // double-counted as such.
      const offsetTop = Math.max(0, vv.offsetTop);
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - offsetTop);
      const next: VisualViewportRect = {
        keyboardHeight,
        height: vv.height,
        offsetTop,
        keyboardOpen: keyboardHeight > KEYBOARD_THRESHOLD_PX,
      };
      // Keep the same object while nothing moved — vv fires on every scroll tick.
      setRect((prev) =>
        prev &&
        prev.keyboardHeight === next.keyboardHeight &&
        prev.height === next.height &&
        prev.offsetTop === next.offsetTop
          ? prev
          : next,
      );
    };

    read();
    vv.addEventListener('resize', read);
    vv.addEventListener('scroll', read);
    return () => {
      vv.removeEventListener('resize', read);
      vv.removeEventListener('scroll', read);
    };
  }, [enabled]);

  return rect;
}
```

Notes:
- The identity check in `setRect` matters — `visualViewport` fires `scroll` on
  every frame of a rubber-band scroll; without it you re-render continuously.
- `enabled` should be `open && isMobile` so nothing is subscribed while closed.
- Returning `null` (not a fake rect) is what lets the caller fall back to CSS.
- The `Math.max(0, …)` clamp is what makes this self-correcting: when iOS
  overreports `vv.height`, the delta goes negative and pins to `0` — exactly the
  no-keyboard answer. An absolute height has no such safe floor.
- Subtracting `offsetTop` also fixes the `keyboardOpen` heuristic: without it, a
  visual viewport that has merely been *scrolled* reads as an open keyboard.

## 2. Panel sizing — never set a height; only offset the bottom edge

This is the part most implementations get wrong, and there are two mistakes
stacked on top of each other.

**Mistake A — measuring a height at all.** With the keyboard closed, iOS
(especially in standalone/PWA display mode) reports a `visualViewport.height`
*larger* than the visible content box, so `height = vv.height - gap` puts the
bottom edge below the screen.

**Mistake B — moving `top` when the keyboard opens.** Even with a correct
height, repositioning the top edge makes the whole dialog visibly jump upward,
and any overshoot in the measured height then pushes the header clean off the
top of the screen. Watch LinkedIn's mobile chat: the panel does not move. Its
top edge stays put, its bottom edge rises to meet the keyboard, and the message
list absorbs the difference.

**The fix is one rule: bound the panel by `top` + `bottom`, never give it a
`height`, and let only `bottom` react to the keyboard.** Because `position:
fixed` resolves against the layout viewport — which iOS never shrinks —
`bottom: keyboardHeight + gap` lands the bottom edge exactly on the keyboard's
top edge. The top edge is a constant in both states, so it cannot drift.

**One correction to "the top edge is a constant": add `offsetTop`.** iOS pans
the visual viewport on input focus (problem 6), which slides every fixed
element up by `offsetTop` in *visible* coordinates. Adding the pan back keeps
the panel glued to the visible area; `offsetTop` is 0 whenever nothing panned,
so in the normal case the top edge really is constant. `keyboardHeight` already
subtracts `offsetTop`, so the `bottom` edge tracks the pan on its own — both
edges move together and the panel appears stationary.

```tsx
const MOBILE_GAP = 8;      // side + bottom inset
const MOBILE_TOP_GAP = 64; // leaves the app header visible behind the panel

const panelStyle: React.CSSProperties = isMobile
  ? {
      left: MOBILE_GAP,
      right: MOBILE_GAP,
      // Constant + the visual-viewport pan (0 when nothing panned).
      top: MOBILE_TOP_GAP + (viewport?.offsetTop ?? 0),
      // The only value that reacts to the keyboard.
      bottom: viewport?.keyboardOpen
        ? viewport.keyboardHeight + MOBILE_GAP
        : `calc(${MOBILE_GAP}px + env(safe-area-inset-bottom, 0px))`,
    }
  : {
      // Desktop: anchored window, bottom-right.
      right: '1.5rem',
      bottom: '5rem',
      width: 'min(360px, calc(100vw - 2rem))',
      height: 'min(680px, calc(100dvh - 7rem))',
    };
```

```tsx
<div
  className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
  style={panelStyle}
/>
```

`env(safe-area-inset-bottom)` requires `viewport-fit=cover` in the viewport meta
tag to be non-zero; the `, 0px` fallback keeps it harmless if it is not set.

For the message list to absorb the shrink instead of shoving the composer out,
the panel body must be a flex column whose scroller carries `min-h-0 flex-1`
(§4). That is what turns "the panel got shorter" into "you see fewer messages".

## 3. Freeze the page behind

`overflow: hidden` on `body` is not enough on iOS — pin the body and restore the
scroll offset on close.

```tsx
useEffect(() => {
  if (!open) return;
  const body = document.body;
  const scrollY = window.scrollY;
  const prev = {
    position: body.style.position, top: body.style.top, left: body.style.left,
    right: body.style.right, width: body.style.width, overflow: body.style.overflow,
  };
  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  return () => {
    Object.assign(body.style, prev);
    window.scrollTo(0, scrollY);
  };
}, [open]);
```

The body pin is necessary but **not sufficient**: while the keyboard is open,
iOS lets touch drags pan the *visual viewport* even over a pinned body
(problem 7), so the page behind still moves and, because the pan changes the
computed `keyboardHeight`, the panel resizes with it. Block those gestures at
the source — `touch-action: none` on the backdrop, plus a non-passive
`touchmove` guard that only lets a drag through when the finger is over an
element inside the panel that can actually scroll:

```tsx
useEffect(() => {
  if (!open || !isMobile) return;
  const canScroll = (el: HTMLElement) => {
    const overflowY = window.getComputedStyle(el).overflowY;
    return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!e.cancelable) return;
    const panel = panelRef.current;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!panel || !target || !panel.contains(target)) {
      e.preventDefault(); // touch on the frozen page: never pan
      return;
    }
    for (let el: HTMLElement | null = target; el && el !== panel; el = el.parentElement) {
      if (canScroll(el)) return; // a real scroller consumes it
    }
    e.preventDefault(); // nothing scrollable under the finger: stop the pan
  };
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  return () => document.removeEventListener('touchmove', onTouchMove);
}, [open, isMobile]);
```

Then stop scroll **chaining** at the edges of the two scrollable surfaces inside
the panel, so a flick at the top of the message list does not grab the document:

```tsx
// Message list (Radix ScrollArea — the scroller is the inner viewport element)
<ScrollArea className="min-h-0 flex-1 px-4 [&>[data-radix-scroll-area-viewport]]:overscroll-contain" />

// Composer textarea
<Textarea className="... overflow-y-auto overscroll-contain" />
```

Plain `<div>` scroller: just `className="overflow-y-auto overscroll-contain"`.

## 4. The composer — auto-grow + expand

### Auto-grow

Reset to `auto` first, then read `scrollHeight`; otherwise the box can only ever
grow. `useLayoutEffect` avoids a one-frame flash at the old height.

```tsx
const COMPOSER_MAX_HEIGHT = 140; // then it scrolls inside itself

useLayoutEffect(() => {
  const el = textareaRef.current;
  if (!el || !open) return;
  if (composerExpanded) {
    el.style.height = '100%';
    return;
  }
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
}, [input, composerExpanded, open]);
```

### Expand / collapse

The expanded composer is `absolute inset-0` over the **body region only** (not
the whole panel), so the header stays reachable. Critically, it is the **same
`<textarea>` element in the same tree position** in both states — only the
classes toggle. Swapping trees (two `return`s, or two components) remounts the
input on the first keystroke, dropping focus and closing the mobile keyboard.
This is invisible on desktop and to Playwright.

```tsx
{/* Body — messages + composer */}
<div className="relative flex min-h-0 flex-1 flex-col">
  <ScrollArea className="min-h-0 flex-1 px-4 [&>[data-radix-scroll-area-viewport]]:overscroll-contain">
    {/* …messages, sentinel <div ref={bottomRef} /> as the LAST child… */}
  </ScrollArea>

  <div className={cn('bg-background',
    composerExpanded ? 'absolute inset-0 z-10 flex flex-col' : 'shrink-0 border-t')}>
    <div className={cn('flex gap-2 px-3',
      composerExpanded ? 'min-h-0 flex-1 flex-col pt-3' : 'items-end py-3')}>
      <div className="relative min-h-0 w-full flex-1">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={1}
          className={cn('resize-none overflow-y-auto overscroll-contain pr-10',
            composerExpanded ? 'h-full min-h-0' : 'min-h-[44px]')}
          style={composerExpanded ? undefined : { maxHeight: COMPOSER_MAX_HEIGHT }}
        />
        <button
          type="button"
          onClick={() => setComposerExpanded((v) => !v)}
          aria-label={composerExpanded ? 'Collapse the text box' : 'Expand the text box'}
          className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {composerExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
      {!composerExpanded && sendButton}
    </div>

    {composerExpanded && (
      <div className="flex shrink-0 items-center justify-end border-t px-3 py-2">
        {sendButton}
      </div>
    )}
  </div>
</div>
```

Extract `sendButton` into a variable so the *same* button renders either inline
or in the expanded bottom bar. Reset `composerExpanded` to `false` on send,
clear, and close.

## 5. Auto-scroll to the newest message

Keep a sentinel `<div ref={bottomRef} />` as the last child of the scroll
content and include the viewport height in the deps, so the view re-pins when
the keyboard resizes the visible area:

```tsx
const lastMsgContent = messages[messages.length - 1]?.content ?? '';
useEffect(() => {
  bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
}, [lastMsgContent, open, viewport?.height]);
```

Depending on `lastMsgContent` (not `messages.length`) keeps it pinned during
token-by-token streaming.

---

## Pitfalls checklist

- [ ] **Never** force the composer below 16px (`text-sm` = 14px). iOS zooms the
      page on focus, which re-triggers the whole viewport dance. Use
      `text-base md:text-sm`.
- [ ] **Never** give the mobile panel a JS-measured `height`, keyboard open or
      closed. Bound it with `top` + `bottom` (problems 4 and 5).
- [ ] **Never** let the keyboard move the panel's `top`. Only `bottom` reacts;
      otherwise the dialog jumps and the header leaves the screen.
- [ ] Use the visual-viewport **delta** (`innerHeight - vv.height - vv.offsetTop`),
      never `vv.height` or `vv.offsetTop` as absolute *positions/heights* — iOS
      misreports both. The clamped `offsetTop` is fine as an additive pan delta.
- [ ] Add `offsetTop` to the panel's `top` — on input focus iOS pans the visual
      viewport (not a document scroll; the body pin can't stop it) and every
      fixed element slides up by that amount.
- [ ] The body pin alone does not stop drags while the keyboard is open — block
      them with `touch-action: none` on the backdrop + a non-passive `touchmove`
      guard that only allows drags over genuinely scrollable panel children.
- [ ] **Never** swap the textarea's tree position between collapsed/expanded — it
      remounts and drops focus.
- [ ] Reset `height = 'auto'` before reading `scrollHeight`, or the box only grows.
- [ ] `min-h-0` on every flex child that must be allowed to shrink — without it a
      flex item refuses to go below its content height and the composer is pushed
      out of the panel.
- [ ] Restore `window.scrollTo(0, scrollY)` when un-pinning the body, or the page
      jumps to the top on close.
- [ ] Debounce/dedupe `visualViewport` state — it fires on every scroll frame.
- [ ] Panel needs `overflow-hidden` so the rounded corners clip its children.
- [ ] Backdrop below the panel (`z-[49]` vs `z-50`) and above any sticky page
      action bar.

---

## Reuse prompt

Paste this into Claude Code (or any coding agent) in the target repo.

````text
Refactor our chat/assistant panel so it behaves correctly on mobile. Today the
on-screen keyboard pushes the composer off-screen, the page behind the panel
still scrolls, and the text box is a fixed height. Implement the recipe below
exactly — each rule exists because the obvious alternative is broken on iOS.

FIRST: find every place a chat panel is rendered and check whether they share one
component. If they do, change only that component. If they don't, tell me before
duplicating anything.

1) Add a `useVisualViewport(enabled: boolean)` hook that subscribes to
   `window.visualViewport` `resize` + `scroll` and returns
   `{ keyboardHeight, height: vv.height, offsetTop, keyboardOpen: keyboardHeight > 120 }`,
   where `offsetTop = Math.max(0, vv.offsetTop)` and
   `keyboardHeight = Math.max(0, window.innerHeight - vv.height - offsetTop)`,
   or `null` when disabled/unsupported. Expose DELTAS only — never `vv.height`
   as a height; iOS misreports it, and the clamped deltas degrade safely to 0
   (= no keyboard, no pan). Dedupe state updates by comparing against the
   previous value — visualViewport fires every scroll frame.
   Call it with `open && isMobile`.

2) Position the panel with `position: fixed` and an inline style object. On
   mobile, bound it by `top` + `bottom` and give it NO `height` in either state:
   - `left/right: 8`, `top: 64 + (viewport?.offsetTop ?? 0)`. The keyboard must
     never move the top edge, but the visual-viewport PAN must: on input focus
     iOS pans the visual viewport (not a document scroll — pinning the body
     cannot stop it) and every `position: fixed` element slides up by
     `offsetTop`, running the header off the top of the screen. Adding the pan
     back glues the panel to the visible area; it is 0 when nothing panned.
   - `bottom`: `viewport.keyboardHeight + 8` when `keyboardOpen`, else
     `calc(8px + env(safe-area-inset-bottom, 0px))`. `position: fixed` resolves
     against the layout viewport, which iOS never shrinks, so this lands the
     bottom edge exactly on the keyboard. The message list shrinks and the panel
     appears to stay put — this is what LinkedIn's mobile chat does.
   - Do NOT set a measured `height` anywhere on mobile: iOS reports a
     visualViewport.height larger than the visible content box in standalone/PWA
     mode, which pushes the panel's bottom edge off the screen.
   - Desktop: anchored bottom-right, e.g. `right: 1.5rem; bottom: 5rem;
     width: min(360px, calc(100vw - 2rem)); height: min(680px, calc(100dvh - 7rem))`.
   Give the panel `overflow-hidden` and a `flex flex-col` layout.

3) While the panel is open, freeze the page: pin `document.body` with
   `position: fixed; top: -${scrollY}px; left:0; right:0; width:100%;
   overflow:hidden`, and on cleanup restore the previous inline styles AND call
   `window.scrollTo(0, scrollY)`. `overflow: hidden` alone does not stop iOS
   touch-scroll chaining. Add `overscroll-contain` to the message scroller and to
   the textarea.
   The pin alone does NOT stop drags while the keyboard is open — iOS pans the
   visual viewport over a pinned body, moving the page behind and resizing the
   panel (the pan changes the computed keyboardHeight). Also add
   `touch-action: none` to the backdrop and a document-level non-passive
   `touchmove` listener (while open on mobile) that `preventDefault()`s unless
   the touch target is inside the panel AND has an ancestor (within the panel)
   with `overflow-y: auto|scroll` and `scrollHeight > clientHeight`.

4) Composer (LinkedIn-style):
   - Auto-grow in a `useLayoutEffect` on `[input, expanded, open]`: set
     `height = 'auto'`, then `height = min(scrollHeight, 140)px`. Collapsed base is
     `min-h-[44px]`, `rows={1}`, `maxHeight: 140`, `overflow-y-auto`.
   - An expand/collapse icon button (Maximize2/Minimize2) pinned top-right inside
     the textarea. Expanded = the composer wrapper becomes `absolute inset-0 z-10
     flex flex-col` over the panel's BODY region only (header stays reachable),
     the textarea becomes `h-full min-h-0`, and the send button moves to a bottom
     bar. Reset expanded on send / clear / close.
   - CRITICAL: it must be the SAME textarea element in the SAME tree position in
     both states — toggle classes only. Swapping trees or components remounts the
     input on the first keystroke and drops focus / closes the mobile keyboard.
   - CRITICAL: never set the composer font below 16px. Use `text-base md:text-sm`.
     Anything smaller makes iOS zoom on focus.

5) Keep a sentinel div as the LAST child of the scroll content and
   `scrollIntoView({ behavior: 'instant', block: 'end' })` in an effect keyed on
   `[lastMessageContent, open, viewport?.height]` (content, not message count, so
   it stays pinned while streaming).

6) Add `min-h-0` to every flex child that must shrink, or the composer gets pushed
   out of the panel.

Do not add scope beyond this. When done, run the project's typecheck and lint.
````
