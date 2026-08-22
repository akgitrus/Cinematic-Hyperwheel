"""
Reference-item search: literal (non-fuzzy) matching against the movie
title only.

Unlike the previous director/cast-aware, typo-tolerant version
(rapidfuzz token_set_ratio/partial_ratio), this dataset provides only
title + genres (movies.csv: movieId,title,genres - see apps/web/README.md).
Genres are shown to the user but are NOT part of the match. Matching is
intentionally literal, not typo-tolerant: the query's normalized tokens
must each occur as a substring of the normalized title.

movies.csv may optionally also carry imdbId/tmdbId columns (added by
tools/filter_metadata_to_artifact.py's --links merge of links.csv) -
these are external ids used to build direct IMDb/TMDB links instead of
falling back to a title search (see the /api/movie/{item_id} and
/api/movie/{item_id}/recommend endpoints in main.py). They are purely
passthrough metadata here, same as genres: not matched against, only
carried on MovieRecord for callers that need them.

Two data quirks that plain substring-on-raw-title gets wrong (carried
over from the previous version, still true for this dataset):

1. Titles are stored with the leading article moved to the end, e.g.
   "Matrix, The (1999)" instead of "The Matrix (1999)" - a query typed
   the natural way ("The Matrix 1999") then has different token order
   than the stored title. We reorder the article back to the front
   before matching (matching only - the article-inverted `title` is
   still what's returned/displayed).

2. "The"/"a"/"an" are extremely common across the whole catalog and
   contribute noise rather than signal - stripped from both the query
   and the corpus before matching (consistently, so a stripped stopword
   never has to be "found" as a substring).

Ranking (best tier first), since there's no fuzzy score to sort by:
  0. PREFIX    - the whole normalized query is a prefix of the title
  1. PHRASE    - the whole normalized query occurs as a word-boundary-
                 aligned phrase anywhere in the title (e.g. "matrix" in
                 "the matrix reloaded", but not in "dermatrix")
  2. SUBSTRING - the whole normalized query occurs as a plain (possibly
                 mid-word) substring
  3. SCATTERED - fallback: every query token is present as a substring
                 somewhere in the title, in ANY order (word-order-
                 agnostic, but still no typo tolerance)
Within a tier, shorter titles first (a short, closer-to-exact title is
more likely to be what was meant than a long title that happens to
contain the same words), then alphabetically for a stable order.

Match highlighting: after ranking and limiting, each result's ORIGINAL
title is scanned again for literal case-insensitive substring hits of
the query's tokens, and the resulting character spans are returned so
the frontend can highlight *why* an item matched - a separate, simpler
pass from the tiering above, since highlighting needs clean, contiguous
character offsets into the original text, not tier membership.

Performance: this is a plain Python loop over the catalog - no batched
C-level scorer is needed anymore (there's no fuzzy metric to compute),
and str.__contains__/str.find/re.search are themselves C-level
operations. The searchable set is expected to already be filtered down
to only the movies that have Tag Genome data (see
tools/filter_metadata_to_artifact.py, ~13k movies for ml-latest rather
than the full ~86k in movies.csv), well within what a Python-level loop
handles in single-digit milliseconds per keystroke.
"""
from __future__ import annotations

import csv
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

_ARTICLE_RE = re.compile(
    r"^(?P<base>.+),\s*(?P<article>The|A|An)(?P<year>\s*\(\d{4}\))?$",
    re.IGNORECASE,
)
_STOPWORDS = {"the", "a", "an"}
_PUNCT_RE = re.compile(r"[^\w\s]")

_GENRES_SEP = "|"
_NO_GENRES = "(no genres listed)"  # MovieLens' literal sentinel for "no genres"

# Match tiers, best first - see module docstring.
TIER_PREFIX = 0
TIER_PHRASE = 1
TIER_SUBSTRING = 2
TIER_SCATTERED = 3


def _reorder_article(title: str) -> str:
    m = _ARTICLE_RE.match(title.strip())
    if not m:
        return title
    return f"{m.group('article')} {m.group('base')}{m.group('year') or ''}"


def _tokenize(text: str) -> list[str]:
    text = _PUNCT_RE.sub(" ", text.lower())
    return [w for w in text.split() if w not in _STOPWORDS]


def _normalize_for_match(text: str) -> str:
    """Lowercase, strip punctuation, drop stopwords, single-space-joined."""
    return " ".join(_tokenize(text))


def _find_highlights(query_tokens: list[str], raw_text: str) -> list[tuple[int, int]]:
    """
    Case-insensitive substring spans of each query token inside raw_text
    (the ORIGINAL, user-facing string - not the reordered/normalized
    copy used for matching), merged where they overlap or touch.
    """
    if not raw_text or not query_tokens:
        return []
    lower = raw_text.lower()
    spans: list[tuple[int, int]] = []
    for tok in query_tokens:
        if not tok:
            continue
        start = 0
        while True:
            idx = lower.find(tok, start)
            if idx == -1:
                break
            spans.append((idx, idx + len(tok)))
            start = idx + 1
    if not spans:
        return []
    spans.sort()
    merged = [spans[0]]
    for s, e in spans[1:]:
        ls, le = merged[-1]
        if s <= le:
            merged[-1] = (ls, max(le, e))
        else:
            merged.append((s, e))
    return merged


def _parse_genres(raw: str) -> list[str]:
    raw = (raw or "").strip()
    if not raw or raw == _NO_GENRES:
        return []
    return [g for g in raw.split(_GENRES_SEP) if g]


@dataclass
class MovieRecord:
    item_id: int
    title: str
    genres: list[str] = field(default_factory=list)
    # External ids for building direct IMDb/TMDB links (see main.py).
    # None when movies.csv wasn't built with --links (see
    # tools/filter_metadata_to_artifact.py), or when this specific movie
    # had no matching row in links.csv. imdb_id keeps its original
    # zero-padded string form (e.g. "0114709", NOT an int) - the leading
    # zeros are significant for building https://www.imdb.com/title/tt<id>/.
    imdb_id: str | None = None
    tmdb_id: str | None = None


def load_metadata(path: Path) -> list[MovieRecord]:
    """
    Reads movies.csv (movieId,title,genres[,imdbId,tmdbId]) - the
    MovieLens ml-latest catalog file, optionally merged with links.csv by
    tools/filter_metadata_to_artifact.py. Expected to already be filtered
    down to movies that have Tag Genome data (see
    tools/filter_metadata_to_artifact.py) - this function itself does not
    filter against the artifact, it just parses whatever file it's
    pointed at. imdbId/tmdbId are read if present; their absence (either
    the columns are missing entirely, or a specific row's value is blank)
    is not an error - callers get None and fall back to a title search.
    """
    records: list[MovieRecord] = []
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        missing_cols = {"movieId", "title"} - set(reader.fieldnames or [])
        if missing_cols:
            raise ValueError(f"{path} is missing required column(s): {missing_cols}")
        has_links = {"imdbId", "tmdbId"} <= set(reader.fieldnames or [])
        for row in reader:
            raw_id = (row.get("movieId") or "").strip()
            if not raw_id:
                continue
            try:
                item_id = int(raw_id)
            except ValueError:
                print(f"[warning] skipping row with non-numeric movieId: {raw_id!r}", file=sys.stderr)
                continue
            imdb_id = tmdb_id = None
            if has_links:
                imdb_id = (row.get("imdbId") or "").strip() or None
                tmdb_id = (row.get("tmdbId") or "").strip() or None
            records.append(MovieRecord(
                item_id=item_id,
                title=row.get("title") or "",
                genres=_parse_genres(row.get("genres") or ""),
                imdb_id=imdb_id,
                tmdb_id=tmdb_id,
            ))
    return records


class MovieIndex:
    def __init__(self, records: list[MovieRecord]):
        self.records = records
        self._title_norm = [
            _normalize_for_match(_reorder_article(r.title)) for r in records
        ]

    def _match_tier(self, query_norm: str, query_tokens: list[str], title_norm: str) -> int | None:
        if not title_norm:
            return None
        if title_norm.startswith(query_norm):
            return TIER_PREFIX
        if re.search(rf"\b{re.escape(query_norm)}\b", title_norm):
            return TIER_PHRASE
        if query_norm in title_norm:
            return TIER_SUBSTRING
        if all(tok in title_norm for tok in query_tokens):
            return TIER_SCATTERED
        return None

    def search(self, query: str, limit: int = 8) -> list[dict]:
        query_norm = _normalize_for_match(query.strip())
        if not query_norm or not self.records:
            return []
        query_tokens = query_norm.split()

        # Plain Python loop - see module docstring, "Performance". Collect
        # (tier, title_len, title, idx) so a single sort gives the final
        # order: tier primary, then shorter titles, then alphabetically.
        matches: list[tuple[int, int, str, int]] = []
        for i, title_norm in enumerate(self._title_norm):
            tier = self._match_tier(query_norm, query_tokens, title_norm)
            if tier is None:
                continue
            title = self.records[i].title
            matches.append((tier, len(title), title, i))

        if not matches:
            return []

        matches.sort(key=lambda m: (m[0], m[1], m[2]))

        results = []
        for tier, _title_len, _title, i in matches[:limit]:
            r = self.records[i]
            results.append({
                "item_id": r.item_id,
                "title": r.title,
                "titleHighlights": _find_highlights(query_tokens, r.title),
                "genres": r.genres,
            })
        return results
