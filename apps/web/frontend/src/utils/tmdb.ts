/** TMDB equivalent of utils/imdb.ts - see there for the rationale. */

export function tmdbSearchUrl(title: string): string {
  return `https://www.themoviedb.org/search?query=${encodeURIComponent(title)}`;
}

/**
 * Direct TMDB movie page, given the dataset's tmdbId (links.csv, via
 * MovieRecord.tmdb_id - see apps/web/backend/app/search.py). Unlike
 * imdbId, tmdbId has no zero-padding or prefix convention to preserve,
 * but is still passed through as a string end-to-end for consistency
 * and because this code never does arithmetic with it.
 */
export function tmdbTitleUrl(tmdbId: string): string {
  return `https://www.themoviedb.org/movie/${tmdbId}`;
}

/** TMDB equivalent of imdb.ts's imdbUrlForItem - see there for the rationale. */
export function tmdbUrlForItem(item: { tmdb_id: string | null; title: string }): string {
  return item.tmdb_id ? tmdbTitleUrl(item.tmdb_id) : tmdbSearchUrl(item.title);
}