interface HasPcAxes {
  axis_x: { pc: number };
  axis_y: { pc: number };
}

/**
 * Stable identity for a circle, derived from its axis pair. Shared by
 * every surface that needs to recognize "this is the same circle" -
 * crossfade layers (WheelStack.tsx), the active-section tracker
 * (RecommendationsPanel.tsx), and highlight scoping
 * (contexts/HighlightContext.tsx) all key off this same string.
 */
export function circleKey(circle: HasPcAxes): string {
  return `${circle.axis_x.pc}-${circle.axis_y.pc}`;
}