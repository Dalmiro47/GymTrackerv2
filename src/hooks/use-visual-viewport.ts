'use client';

import { useEffect, useState } from 'react';

export type VisualViewportRect = {
  /**
   * Height of the on-screen keyboard, measured in LAYOUT-viewport px (0 when
   * closed). This is the number a `position: fixed` panel needs: iOS never
   * shrinks the layout viewport, so `bottom: keyboardHeight` is what puts an
   * element's bottom edge exactly on top of the keyboard.
   */
  keyboardHeight: number;
  /** Height of the visible area, i.e. excluding the on-screen keyboard (px). */
  height: number;
  /** Rough heuristic: the keyboard (or another OS overlay) is covering the page. */
  keyboardOpen: boolean;
};

const KEYBOARD_THRESHOLD_PX = 120;

/**
 * Tracks how much of the mobile *visual* viewport the on-screen keyboard covers.
 *
 * `position: fixed` is resolved against the LAYOUT viewport, which iOS does not
 * shrink when the keyboard opens, so a bottom-anchored panel slides underneath
 * the keyboard and disappears. Callers offset their `bottom` by `keyboardHeight`
 * to lift the panel's bottom edge clear of it while its top edge stays put.
 *
 * Only the *difference* between the two viewports is exposed on purpose: iOS in
 * standalone/PWA reports a `visualViewport.height` that overshoots the visible
 * content box, so absolute values are not trustworthy, but the delta collapses
 * to <= 0 (clamped to 0) exactly when there is no keyboard.
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
      // `offsetTop` counts too: it is the slice of the layout viewport scrolled
      // off above the visible area, which is not keyboard and must not be
      // double-counted as such.
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const next: VisualViewportRect = {
        keyboardHeight,
        height: vv.height,
        keyboardOpen: keyboardHeight > KEYBOARD_THRESHOLD_PX,
      };
      // Keep the same object while nothing moved — vv fires on every scroll tick.
      setRect((prev) =>
        prev && prev.keyboardHeight === next.keyboardHeight && prev.height === next.height
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
