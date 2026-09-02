/**
 * Whether the current input device has genuine hover (mouse/trackpad),
 * as opposed to touch. Gates hover-only interactions (the recommendation
 * info card, in particular) so they don't half-trigger from a touch
 * device's synthetic mouse events - touch uses its own tap-to-open flow
 * instead (see RecommendationsPanel.tsx).
 */
export function supportsHover(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}