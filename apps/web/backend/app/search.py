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

Scoring performance: scores for the query against EVERY record are
computed with rapidfuzz.process.cdist (one call per scorer, run as a
single batched C loop over the whole catalog) rather than a Python
`for` loop calling fuzz.token_set_ratio/partial_ratio individually per
record. On a catalog of thousands of items this distinction is the
difference between single-digit-millisecond and multi-second search
latency: rapidfuzz's own comparison work is fast either way, but the
per-call Python/function-call overhead of doing it thousands of times
in a loop dominates the total time - cdist amortizes that overhead
into six batched calls total (token_set_ratio + partial_ratio, x3
fields) regardless of catalog size.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from rapidfuzz import fuzz, process

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


def _batch_field_scores(query_norm: str, texts_norm: list[str]) -> np.ndarray:
    """
    Vectorized equivalent of calling _field_score(query_norm, t) for every
    t in texts_norm: max(token_set_ratio, partial_ratio) per record, via
    two batched rapidfuzz.process.cdist calls instead of a Python loop of
    2 * len(texts_norm) individual fuzz calls. Empty strings score 0
    (rapidfuzz's own behavior, matching the old _field_score early-return).

    workers=-1 lets rapidfuzz split each batched call across all available
    CPU cores (its C loop releases the GIL) - worth it once len(texts_norm)
    is in the thousands; for a handful of records the thread/process setup
    overhead would outweigh the gain, but that's not the regime this is
    used in (it's the whole-catalog case, not the small per-record path).
    """
    if not texts_norm:
        return np.empty(0, dtype=np.float64)
    ts = process.cdist([query_norm], texts_norm, scorer=fuzz.token_set_ratio, workers=-1)[0]
    pr = process.cdist([query_norm], texts_norm, scorer=fuzz.partial_ratio, workers=-1)[0]
    return np.maximum(ts, pr)


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
        if not query_norm or not self.records:
            return []
        query_tokens = query_norm.split()

        # --- vectorized scoring pass: 6 batched C calls total, instead of
        # up to 6 * len(records) individual Python-level fuzz calls (see
        # module docstring, "Scoring performance") ---
        title_score = _batch_field_scores(query_norm, self._title_norm)
        director_score = _batch_field_scores(query_norm, self._director_norm)
        cast_score = _batch_field_scores(query_norm, self._cast_norm)

        # `relevance` is used ONLY for the score_cutoff filter and for the
        # number shown to the caller - it still lets a pure name query
        # ("Kubrick") pass the cutoff even with title_score == 0. It is
        # NOT used for ordering results (see the sort below) - that's the
        # whole point of the fix: a decent cast/director hit must not be
        # able to numerically outscore a real title hit.
        relevance = np.maximum(title_score, np.maximum(director_score * 0.9, cast_score * 0.85))

        candidate_idx = np.nonzero(relevance >= score_cutoff)[0]
        if candidate_idx.size == 0:
            return []

        # Strict field priority: title, then director, then cast (year is
        # already part of the stored title string). A match on a
        # higher-priority field ALWAYS outranks a stronger match on a
        # lower-priority one, e.g. a title containing the query word beats
        # a cast list that merely happens to contain a person whose name is
        # that word (e.g. actress "Donna Air" vs a query "air").
        # np.lexsort's LAST key is primary.
        order = candidate_idx[np.lexsort((
            -cast_score[candidate_idx],
            -director_score[candidate_idx],
            -title_score[candidate_idx],
        ))][:limit]

        results = []
        for i in order:
            i = int(i)
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
                "score": round(float(relevance[i]), 1),
            })
        return results
