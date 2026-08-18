"""
Reference-item search: one free-text field matched against title +
director + cast at once.

Two data quirks that plain WRatio-on-concatenated-string gets wrong:

1. Titles are stored with the leading article moved to the end, e.g.
   "Matrix, The (1999)" instead of "The Matrix (1999)" - a query typed
   the natural way ("The Matrix 1999") then has different token order
   than the stored title, which hurts fuzzy matching more than it should.
   We reorder the article back to the front before scoring (matching
   only - the article-inverted `title` is still what's returned/displayed).

2. "The"/"a"/"an" are extremely common across the whole catalog, so they
   contribute noise rather than signal to a fuzzy score - a query
   containing "The" can end up scoring higher against an unrelated title
   that also happens to contain "The" than against the actual match. We
   strip these stopwords before scoring (again, matching only).

Title and director/cast are scored SEPARATELY (not concatenated into one
string) and then combined with a title-dominant weight. Concatenating
them into a single string was actively harmful: a movie with a long cast
list (e.g. 7 actors) produces a much longer combined string than a movie
with 0-1 credited people, and rapidfuzz's WRatio penalizes that length
mismatch against a short query - so a mediocre title match with a short
cast could outscore an exact title match that happened to have a long
cast attached. Scoring the title on its own removes that dependency on
how much cast/crew data happens to exist for a given item.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz

_ARTICLE_RE = re.compile(
    r"^(?P<base>.+),\s*(?P<article>The|A|An)(?P<year>\s*\(\d{4}\))?$",
    re.IGNORECASE,
)
_STOPWORDS = {"the", "a", "an"}
_PUNCT_RE = re.compile(r"[^\w\s]")


def _reorder_article(title: str) -> str:
    """'Matrix, The (1999)' -> 'The Matrix (1999)' (for matching only)."""
    m = _ARTICLE_RE.match(title.strip())
    if not m:
        return title
    return f"{m.group('article')} {m.group('base')}{m.group('year') or ''}"


def _normalize_for_match(text: str) -> str:
    """
    Lowercase, strip punctuation (commas, parens, ...), drop stopwords.
    fuzz.WRatio/token_set_ratio do NOT case-fold or strip punctuation for
    us - "Wachowski," (as stored, title-cased with a trailing comma) will
    not token-match "wachowski" (as typed) without this.
    """
    text = _PUNCT_RE.sub(" ", text.lower())
    words = [w for w in text.split() if w not in _STOPWORDS]
    return " ".join(words)


@dataclass
class MovieRecord:
    item_id: int
    title: str
    directed_by: str
    starring: str
    avg_rating: float | None
    imdb_id: str | None


def load_metadata(path: Path) -> list[MovieRecord]:
    records: list[MovieRecord] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            raw = json.loads(line)
            records.append(MovieRecord(
                item_id=raw["item_id"],
                title=raw.get("title") or "",
                directed_by=raw.get("directedBy") or "",
                starring=raw.get("starring") or "",
                avg_rating=raw.get("avgRating"),
                imdb_id=raw.get("imdbId"),
            ))
    return records


# title carries most of the weight; director/cast only helps disambiguate
# or catch a query that's mostly a person's name
_TITLE_WEIGHT = 0.75
_PEOPLE_WEIGHT = 0.25


class MovieIndex:
    def __init__(self, records: list[MovieRecord]):
        self.records = records
        self._title_norm = [
            _normalize_for_match(_reorder_article(r.title)) for r in records
        ]
        # director/cast now scored as two SEPARATE fields, not one
        # concatenated string - needed so a director match can be
        # ranked above a cast match, per the title -> director -> cast
        # priority (year needs no separate field: it's already inside
        # the stored title string, e.g. "(1999)").
        self._director_norm = [_normalize_for_match(r.directed_by) for r in records]
        self._cast_norm = [_normalize_for_match(r.starring) for r in records]

    def search(self, query: str, limit: int = 8, score_cutoff: float = 45.0) -> list[dict]:
        query_norm = _normalize_for_match(query.strip())
        if not query_norm:
            return []

        scored: list[tuple[float, float, float, float, int]] = []
        for i in range(len(self.records)):
            title_score = fuzz.token_set_ratio(query_norm, self._title_norm[i])

            director_text = self._director_norm[i]
            director_score = fuzz.token_set_ratio(query_norm, director_text) if director_text else 0.0

            cast_text = self._cast_norm[i]
            cast_score = fuzz.token_set_ratio(query_norm, cast_text) if cast_text else 0.0

            # `relevance` is used ONLY for the score_cutoff filter and for the
            # number shown to the caller - it still lets a pure name query
            # ("Kubrick") pass the cutoff even with title_score == 0. It is
            # NOT used for ordering results (see the sort below) - that's the
            # whole point of the fix: a decent cast/director hit must not be
            # able to numerically outscore a real title hit.
            relevance = max(title_score, director_score * 0.9, cast_score * 0.85)
            if relevance >= score_cutoff:
                scored.append((title_score, director_score, cast_score, relevance, i))

        # Strict field priority: title, then director, then cast (year is
        # already part of the stored title string). A match on a
        # higher-priority field ALWAYS outranks a stronger match on a
        # lower-priority one, e.g. a title containing the query word beats
        # a cast list that merely happens to contain a person whose name is
        # that word (e.g. actress "Donna Air" vs a query "air").
        scored.sort(key=lambda t: (-t[0], -t[1], -t[2]))

        results = []
        for title_score, director_score, cast_score, relevance, i in scored[:limit]:
            r = self.records[i]
            results.append({
                "item_id": r.item_id,
                "title": r.title,
                "directedBy": r.directed_by,
                "starring": r.starring,
                "avgRating": r.avg_rating,
                "imdbId": r.imdb_id,
                "score": round(float(relevance), 1),
            })
        return results
