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

Match highlighting: for the results actually returned (after ranking
and limiting), each field is scanned again for literal
case-insensitive substring hits of the query's tokens, and the
resulting character spans are returned so the frontend can highlight
*why* an item matched. This is a separate, simpler pass from the
fuzzy ranking above (token_set_ratio / partial_ratio): ranking needs
to tolerate reordering/typos, but highlighting needs clean,
contiguous character offsets into the ORIGINAL text shown to the
user - a fuzzy alignment score doesn't give that.

Cast preview: starring can list 15-20 people; showing it in full is
unreadable, and showing only the first few silently hides whichever
actor actually caused the match. build_cast_preview() crops the list
to a small window AROUND the matched name (falling back to "first N"
when the match wasn't in the cast), and remaps the highlight spans
into that cropped string - so the frontend needs no truncation logic
of its own.
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

CAST_PREVIEW_COUNT = 4   # names shown when there's no cast match to center on
CAST_PREVIEW_LEAD = 1    # names of context kept BEFORE the matched name


def _reorder_article(title: str) -> str:
    m = _ARTICLE_RE.match(title.strip())
    if not m:
        return title
    return f"{m.group('article')} {m.group('base')}{m.group('year') or ''}"


def _tokenize(text: str) -> list[str]:
    text = _PUNCT_RE.sub(" ", text.lower())
    return [w for w in text.split() if w not in _STOPWORDS]


def _normalize_for_match(text: str) -> str:
    """
    Lowercase, strip punctuation (commas, parens, ...), drop stopwords.
    fuzz.WRatio/token_set_ratio do NOT case-fold or strip punctuation for
    us - "Wachowski," (as stored, title-cased with a trailing comma) will
    not token-match "wachowski" (as typed) without this.
    """
    return " ".join(_tokenize(text))


def _field_score(query_norm: str, text_norm: str) -> float:
    """
    Whole-token fuzzy score OR substring/prefix score, whichever is
    higher - "air" matches "Airplane!" via partial_ratio (substring) as
    well as "Air Force One" via token_set_ratio (whole-token,
    reorder-tolerant). Deliberately plain partial_ratio, not
    partial_token_set_ratio/WRatio, which saturate to ~100 on any
    shared short token regardless of real relevance.
    """
    if not text_norm:
        return 0.0
    return max(
        fuzz.token_set_ratio(query_norm, text_norm),
        fuzz.partial_ratio(query_norm, text_norm),
    )


def _find_highlights(query_tokens: list[str], raw_text: str) -> list[tuple[int, int]]:
    """
    Case-insensitive substring spans of each query token inside raw_text
    (the ORIGINAL, user-facing string - not the reordered/normalized
    copy used for scoring), merged where they overlap or touch.
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


def _split_names_with_offsets(starring: str) -> list[tuple[str, int, int]]:
    """Comma-separated names -> [(name, start, end)], offsets into the
    ORIGINAL starring string (so highlight spans line up)."""
    names: list[tuple[str, int, int]] = []
    offset = 0
    for raw_piece in starring.split(","):
        piece_start = offset
        stripped = raw_piece.strip()
        if stripped:
            lead = len(raw_piece) - len(raw_piece.lstrip())
            name_start = piece_start + lead
            names.append((stripped, name_start, name_start + len(stripped)))
        offset = piece_start + len(raw_piece) + 1  # +1 for the comma
    return names


def build_cast_preview(
    starring: str, highlights: list[tuple[int, int]]
) -> tuple[str, list[tuple[int, int]]]:
    """
    Crops `starring` to a short, readable preview, keeping whichever
    matched name(s) `highlights` point to in view (falling back to the
    first CAST_PREVIEW_COUNT names when nothing in the cast matched).
    Returns (preview_text, highlight_spans_remapped_into_preview_text).
    """
    names = _split_names_with_offsets(starring)
    if not names:
        return "", []

    matched_idx = [
        i for i, (_, s, e) in enumerate(names)
        if any(hs < e and he > s for hs, he in highlights)
    ]

    total = len(names)
    show_count = min(CAST_PREVIEW_COUNT, total)
    if matched_idx:
        first = min(matched_idx)
        start_idx = max(0, first - CAST_PREVIEW_LEAD)
        end_idx = min(total, start_idx + show_count)
        start_idx = max(0, end_idx - show_count)  # re-clamp if window hit the tail
    else:
        start_idx, end_idx = 0, show_count

    preview = ""
    preview_highlights: list[tuple[int, int]] = []
    if start_idx > 0:
        preview += "… "
    for i in range(start_idx, end_idx):
        name, name_start, name_end = names[i]
        base = len(preview)
        preview += name
        for hs, he in highlights:
            cs, ce = max(hs, name_start), min(he, name_end)
            if cs < ce:
                preview_highlights.append((base + cs - name_start, base + ce - name_start))
        if i != end_idx - 1:
            preview += ", "
    if end_idx < total:
        preview += ", …"

    return preview, preview_highlights


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
        query_tokens = query_norm.split()

        scored: list[tuple[float, float, float, float, int]] = []
        for i in range(len(self.records)):
            title_score = _field_score(query_norm, self._title_norm[i])
            director_score = _field_score(query_norm, self._director_norm[i])
            cast_score = _field_score(query_norm, self._cast_norm[i])

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

            title_hl = _find_highlights(query_tokens, r.title)
            director_hl = _find_highlights(query_tokens, r.directed_by)
            cast_hl = _find_highlights(query_tokens, r.starring)
            cast_preview, cast_preview_hl = build_cast_preview(r.starring, cast_hl)

            results.append({
                "item_id": r.item_id,
                "title": r.title,
                "titleHighlights": title_hl,
                "directedBy": r.directed_by,
                "directedByHighlights": director_hl,
                "castPreview": cast_preview,
                "castPreviewHighlights": cast_preview_hl,
                "starring": r.starring,
                "avgRating": r.avg_rating,
                "imdbId": r.imdb_id,
                "score": round(float(relevance), 1),
            })
        return results
