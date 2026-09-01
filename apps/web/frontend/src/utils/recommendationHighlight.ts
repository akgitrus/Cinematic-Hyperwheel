import { useEffect, useState } from "react";

let activeItemId: number | null = null;
const listeners = new Set<(itemId: number | null) => void>();

export function setRecommendationHighlight(itemId: number | null): void {
  if (activeItemId === itemId) return;
  activeItemId = itemId;
  listeners.forEach((listener) => listener(activeItemId));
}

export function useRecommendationHighlight(): number | null {
  const [itemId, setItemId] = useState<number | null>(activeItemId);

  useEffect(() => {
    listeners.add(setItemId);
    return () => listeners.delete(setItemId);
  }, []);

  return itemId;
}
