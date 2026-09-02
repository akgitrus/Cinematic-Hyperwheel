import { useEffect } from "react";
import { useActiveCard } from "../contexts/ActiveCardContext";
import RecommendationInfoCard from "./RecommendationInfoCard";

/**
 * Single, app-wide render site for the recommendation hover/tap info
 * card (see contexts/ActiveCardContext.tsx). Whichever surface - a
 * legend row, a recommendations list row, or a wheel point - most
 * recently triggered it is what's shown; rendering the card once here,
 * rather than letting each trigger surface render its own, is what
 * guarantees at most one card is ever visible at a time.
 */
export default function ActiveRecommendationCard() {
  const { trigger, closeCardNow, showCard, hideCard } = useActiveCard();

  // Escape and window resize close whichever card is open, regardless
  // of which surface triggered it - a resize in particular invalidates
  // every captured anchor rect, not just one source's.
  useEffect(() => {
    if (!trigger) return;
    const key = trigger.key;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCardNow(key);
    };
    const onResize = () => closeCardNow(key);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [trigger, closeCardNow]);

  if (!trigger) return null;

  return (
    <RecommendationInfoCard
      target={trigger}
      onClose={() => closeCardNow(trigger.key)}
      onMouseEnter={() => showCard(trigger)}
      onMouseLeave={() => hideCard(trigger.key)}
    />
  );
}