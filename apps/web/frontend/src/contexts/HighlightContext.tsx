import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export interface HighlightedMovie {
  /** The circle (axis pair, see utils/circleKey.ts) this highlight
   * originated from - a highlight only ever lights up surfaces that
   * belong to this same circle (its own wheel point, its own legend
   * row when that circle is also the big wheel's active circle, and
   * its own recommendations-list row), never a different circle that
   * happens to recommend the same movie. */
  circleKey: string;
  itemId: number;
}

interface HighlightContextValue {
  highlighted: HighlightedMovie | null;
  /** Marks (circleKey, itemId) as hovered, immediately overriding
   * whatever was highlighted before - called on hover-enter by every
   * highlight-capable surface (wheel points, legend rows, list rows).
   * Also the entry point for a future tap-to-highlight gesture on
   * touch devices - the trigger is irrelevant to this API. */
  setHighlighted: (circleKey: string, itemId: number) => void;
  /** Requests clearing (circleKey, itemId) - takes effect after a short
   * delay, and only if nothing re-highlighted the same pair in the
   * meantime. The delay lets the pointer travel between adjacent
   * surfaces that represent the same movie (e.g. a wheel point and its
   * legend row) without the highlight flickering off in between. */
  clearHighlighted: (circleKey: string, itemId: number) => void;
}

const HighlightContext = createContext<HighlightContextValue | null>(null);

const CLEAR_DELAY_MS = 200;

export function HighlightProvider({ children }: { children: ReactNode }) {
  const [highlighted, setHighlightedState] = useState<HighlightedMovie | null>(null);
  const clearTimerRef = useRef<number | undefined>(undefined);

  const setHighlighted = useCallback((circleKey: string, itemId: number) => {
    window.clearTimeout(clearTimerRef.current);
    setHighlightedState((prev) =>
      prev && prev.circleKey === circleKey && prev.itemId === itemId ? prev : { circleKey, itemId }
    );
  }, []);

  const clearHighlighted = useCallback((circleKey: string, itemId: number) => {
    window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      setHighlightedState((prev) =>
        prev && prev.circleKey === circleKey && prev.itemId === itemId ? null : prev
      );
    }, CLEAR_DELAY_MS);
  }, []);

  const value = useMemo(
    () => ({ highlighted, setHighlighted, clearHighlighted }),
    [highlighted, setHighlighted, clearHighlighted]
  );

  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

export function useHighlight(): HighlightContextValue {
  const ctx = useContext(HighlightContext);
  if (!ctx) throw new Error("useHighlight must be used within a HighlightProvider");
  return ctx;
}

/**
 * The item id currently highlighted within a specific circle, or null.
 * A highlight only ever applies within the circle it originated from
 * (see HighlightedMovie above), so unrelated circles never light up
 * together just because they happen to recommend the same movie.
 */
export function useHighlightedItem(circleKey: string): number | null {
  const { highlighted } = useHighlight();
  return highlighted && highlighted.circleKey === circleKey ? highlighted.itemId : null;
}