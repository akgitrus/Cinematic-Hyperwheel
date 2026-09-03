import { getPoster } from "../api";

/**
 * Client-side poster URL cache, shared by every surface that shows a
 * movie poster (the reference search card, the recommendation
 * hover/tap info card) - avoids re-resolving the same TMDB poster more
 * than once per session.
 */
const posterCache = new Map<number, string | null>();
const posterInFlight = new Map<number, Promise<string | null>>();

export async function resolvePoster(itemId: number): Promise<string | null> {
  if (posterCache.has(itemId)) return posterCache.get(itemId)!;
  let pending = posterInFlight.get(itemId);
  if (!pending) {
    pending = getPoster(itemId)
      .then((r) => r.poster_url)
      .catch(() => null);
    posterInFlight.set(itemId, pending);
  }
  const url = await pending;
  posterCache.set(itemId, url);
  posterInFlight.delete(itemId);
  return url;
}