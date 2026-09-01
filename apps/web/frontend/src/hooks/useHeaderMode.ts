import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export type HeaderMode = "hero" | "compact";

// Hysteresis window: scrolling down past ENTER_COMPACT_PX switches to
// "compact"; scrolling back up above EXIT_TO_HERO_PX switches back to
// "hero". EXIT_TO_HERO_PX sits CLOSER to the top than ENTER_COMPACT_PX,
// not further - the gap between the two is a dead zone where the mode
// doesn't change regardless of scroll direction, absorbing scroll
// jitter (trackpad elastic bounce, tiny accidental scrolls, or a
// layout shift from the header's own resize) without the header
// flapping back and forth.
export const ENTER_COMPACT_PX = 90;
export const EXIT_TO_HERO_PX = 40;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Drives the hero/compact header mode (see AppHeader.tsx) from scroll
 * position, using two IntersectionObserver sentinels rather than a
 * scroll-event listener: this is a binary on/off decision (unlike the
 * Recommendations list's own scrollspy in RecommendationsPanel.tsx,
 * which genuinely needs per-frame precision to track a continuously
 * changing "current item" - a different kind of problem)
 * IntersectionObserver is the lighter-weight, more idiomatic tool for
 * "has the user scrolled past point X".
 *
 * The caller must attach sentinelEnterRef/sentinelExitRef to a pair of
 * invisible elements positioned ENTER_COMPACT_PX and EXIT_TO_HERO_PX
 * from the top of the page's scrollable content (see App.tsx) - this
 * hook only observes them, it doesn't create or position them, since
 * their correct position depends on the caller's own layout. Element
 * identity is tracked via state (not a plain ref) specifically so that
 * mounting/unmounting the sentinels at runtime - e.g. the app switching
 * between its mobile and desktop header (see App.tsx) as the window is
 * resized across the breakpoint - correctly re-creates the observer
 * instead of silently going stale.
 *
 * Mode changes are animated via the View Transitions API
 * (document.startViewTransition) when available, falling back to an
 * instant switch otherwise - including when the user has requested
 * reduced motion. Same graceful-degradation spirit as the rest of this
 * app (missing TMDB key, missing external ids, etc. all just omit
 * rather than break).
 *
 * Collapsing/expanding the header also changes how much vertical space
 * it (and the controls row below it) take up in the page's normal flow,
 * which would otherwise yank everything below it up or down by that
 * same amount the instant `mode` flips - visible as content jumping
 * under, or away from, the cursor mid-scroll. `spacerHeight` cancels
 * this: at the moment `mode` changes, it's set to however far the
 * caller's content block (attached via `contentRef`) just shifted in
 * the viewport, measured directly rather than derived from the
 * header/controls' own heights - so it stays correct no matter what
 * else changes size above that block. The caller applies it as padding
 * ABOVE that block's own content (see App.tsx); from then on it's
 * ordinary in-flow spacing and simply scrolls away as the user keeps
 * scrolling, rather than a permanent tax on the available space.
 */
export function useHeaderMode(): {
  mode: HeaderMode;
  sentinelEnterRef: (el: HTMLElement | null) => void;
  sentinelExitRef: (el: HTMLElement | null) => void;
  /** Attach to the block whose viewport position should stay fixed
   * across a mode change (see App.tsx's `.layout3`) - only read at the
   * moment `mode` flips, to measure how far the header's own resize
   * shifted it. */
  contentRef: (el: HTMLElement | null) => void;
  /** Space to add above the block `contentRef` is attached to (see
   * that doc comment above for the full rationale). */
  spacerHeight: number;
} {
  const [mode, setMode] = useState<HeaderMode>("hero");
  const [enterEl, setEnterEl] = useState<HTMLElement | null>(null);
  const [exitEl, setExitEl] = useState<HTMLElement | null>(null);
  const [spacerHeight, setSpacerHeight] = useState(0);
  const contentElRef = useRef<HTMLElement | null>(null);
  const modeRef = useRef<HeaderMode>("hero");
  const enterVisibleRef = useRef(true);
  const exitVisibleRef = useRef(true);

  useEffect(() => {
    if (!enterEl || !exitEl) return;

    const applyMode = (next: HeaderMode) => {
      if (modeRef.current === next) return;
      modeRef.current = next;

      // Two synchronous commits: the first flips `mode` and measures
      // the resulting shift, the second corrects `spacerHeight` by
      // exactly that amount - both wrapped in flushSync so each
      // getBoundingClientRect() read reflects the DOM as it actually
      // is at that instant, not React's (possibly still pending)
      // batched update.
      const commit = () => {
        const contentEl = contentElRef.current;
        const before = contentEl?.getBoundingClientRect().top ?? null;

        flushSync(() => setMode(next));

        if (contentEl && before !== null) {
          const after = contentEl.getBoundingClientRect().top;
          const drift = before - after;
          flushSync(() => setSpacerHeight((h) => Math.max(0, h + drift)));
        }
      };

      const startViewTransition = document.startViewTransition?.bind(document);
      if (!startViewTransition || prefersReducedMotion()) {
        commit();
        return;
      }
      startViewTransition(commit);
    };

    const recompute = () => {
      if (!enterVisibleRef.current) {
        applyMode("compact");
        return;
      }
      if (exitVisibleRef.current) {
        applyMode("hero");
      }
      // Between the two sentinels: hysteresis dead zone, mode unchanged.
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === enterEl) enterVisibleRef.current = entry.isIntersecting;
          if (entry.target === exitEl) exitVisibleRef.current = entry.isIntersecting;
        }
        recompute();
      },
      { threshold: 0 }
    );
    observer.observe(enterEl);
    observer.observe(exitEl);
    return () => observer.disconnect();
  }, [enterEl, exitEl]);

  return {
    mode,
    sentinelEnterRef: useCallback((el: HTMLElement | null) => setEnterEl(el), []),
    sentinelExitRef: useCallback((el: HTMLElement | null) => setExitEl(el), []),
    contentRef: useCallback((el: HTMLElement | null) => {
      contentElRef.current = el;
    }, []),
    spacerHeight,
  };
}