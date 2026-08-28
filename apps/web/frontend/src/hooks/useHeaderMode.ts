import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export type HeaderMode = "hero" | "compact";

// Hysteresis window: scrolling past ENTER_COMPACT_PX switches to
// "compact"; scrolling back above EXIT_TO_HERO_PX switches back to
// "hero". Between the two, the mode simply doesn't change - this dead
// zone absorbs scroll jitter (trackpad elastic bounce, tiny accidental
// scrolls) without the header flapping back and forth.
export const ENTER_COMPACT_PX = 90;
export const EXIT_TO_HERO_PX = 120;

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
 */
export function useHeaderMode(): {
  mode: HeaderMode;
  sentinelEnterRef: (el: HTMLElement | null) => void;
  sentinelExitRef: (el: HTMLElement | null) => void;
} {
  const [mode, setMode] = useState<HeaderMode>("hero");
  const [enterEl, setEnterEl] = useState<HTMLElement | null>(null);
  const [exitEl, setExitEl] = useState<HTMLElement | null>(null);
  const modeRef = useRef<HeaderMode>("hero");
  const enterVisibleRef = useRef(true);
  const exitVisibleRef = useRef(true);

  useEffect(() => {
    if (!enterEl || !exitEl) return;

    const applyMode = (next: HeaderMode) => {
      if (modeRef.current === next) return;
      modeRef.current = next;

      const startViewTransition = document.startViewTransition?.bind(document);
      if (!startViewTransition || prefersReducedMotion()) {
        setMode(next);
        return;
      }
      // flushSync forces React to commit the mode change SYNCHRONOUSLY
      // inside the callback, so the real DOM is already in its final
      // state by the time startViewTransition takes its "after"
      // snapshot - without it, React's default async batching could let
      // the browser snapshot a stale, pre-update DOM.
      startViewTransition(() => {
        flushSync(() => setMode(next));
      });
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
  };
}