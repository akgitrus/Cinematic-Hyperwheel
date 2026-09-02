export function imdbSearchUrl(title: string): string {
  return `https://www.imdb.com/find/?q=${encodeURIComponent(title)}&s=tt&ttype=ft`;
}

/**
 * Direct IMDb title page, given the dataset's imdbId (links.csv, via
 * MovieRecord.imdb_id - see apps/web/backend/app/search.py). imdbId is a
 * zero-padded numeric string WITHOUT the "tt" prefix (e.g. "0114709");
 * the leading zeros are significant, so callers must pass it through as
 * a string, never re-parse it as a number.
 */
export function imdbTitleUrl(imdbId: string): string {
  return `https://www.imdb.com/title/tt${imdbId}/`;
}

/**
 * IMDb link for a recommendation item: a direct title-page link when the
 * dataset has a matching imdbId, falling back to a title search
 * otherwise (see "External ids" in apps/web/README.md).
 */
export function imdbUrlForItem(item: { imdb_id: string | null; title: string }): string {
  return item.imdb_id ? imdbTitleUrl(item.imdb_id) : imdbSearchUrl(item.title);
}