'use client';

import { useEffect, useState } from 'react';

export type VisualViewportRect = {
  /** Offset of the visible area from the top of the layout viewport (px). */
  top: number;
  /** Height of the visible area, i.e. excluding the on-screen keyboard (px). */
  height: number;
  /** Rough heuristic: the keyboard (or another OS overlay) is covering the page. */
  keyboardOpen: boolean;
};

const KEYBOARD_THRESHOLD_PX = 120;

/**
 * Tracks the mobile *visual* viewport — the part of the page not covered by the
 * on-screen keyboard.
 *
 * `position: fixed` is resolved against the LAYOUT viewport, which iOS does not
 * shrink when the keyboard opens, so a bottom-anchored panel slides underneath
 * the keyboard and disappears. Positioning from these values instead keeps the
 * panel pinned to what the user can actually see.
 *
 * Returns `null` when disabled or unsupported — callers fall back to plain CSS.
 */
export function useVisualViewport(enabled: boolean): VisualViewportRect | null {
  const [rect, setRect] = useState<VisualViewportRect | null>(null);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!enabled || !vv) {
      setRect(null);
      return;
    }

    const read = () => {
      const next: VisualViewportRect = {
        top: vv.offsetTop,
        height: vv.height,
        keyboardOpen: window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX,
      };
      // Keep the same object while nothing moved — vv fires on every scroll tick.
      setRect((prev) =>
        prev && prev.top === next.top && prev.height === next.height ? prev : next,
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
