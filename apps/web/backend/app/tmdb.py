"""
Thin client for the TMDB (The Movie Database) API - currently used only
to resolve a movie's backdrop image for the hero background (see
/api/movie/{item_id}/backdrop in main.py, and HeroBackdrop.tsx on the
frontend).

Requires TMDB_API_KEY (see config.py) - without it, fetch_backdrop_url
always returns None and the feature degrades to "no backdrop", exactly
like a movie with no tmdb_id at all (see search.py's already-optional
imdb_id/tmdb_id fields). The API key never reaches the client: this
module is the only thing that ever talks to TMDB, and the frontend only
ever sees the resolved image URL via our own /backdrop endpoint.

Results are cached in-process (tmdb_id -> resolved URL or None) for the
lifetime of the web process - a movie's backdrop essentially never
changes, so a tmdb_id already resolved this run never needs a second
TMDB round trip. Deliberately just a dict, not a real cache layer: this
endpoint is hit at most once per distinct movie a user selects.
"""
from __future__ import annotations

import sys

import httpx

from .config import TMDB_API_KEY, TMDB_BACKDROP_SIZE

TMDB_API_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"

_cache: dict[str, str | None] = {}
_warned_missing_key = False
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    # Reused across requests (connection pooling) rather than a fresh
    # AsyncClient per call - this can be hit once per movie selection,
    # so it's worth not re-doing the TLS handshake every time.
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=5.0)
    return _client


async def fetch_backdrop_url(tmdb_id: str) -> str | None:
    """
    Returns a full backdrop image URL for the given tmdb_id, or None if
    TMDB isn't configured, the movie has no backdrop, or the lookup
    failed. Never raises - a slow or broken TMDB call must not break
    movie selection, since the backdrop is purely decorative (see
    main.py's /backdrop endpoint, which always returns 200 with
    backdrop_url possibly null, never a 4xx/5xx for this).
    """
    global _warned_missing_key

    if not TMDB_API_KEY:
        if not _warned_missing_key:
            print(
                "[warning] TMDB_API_KEY not set - hero backdrops disabled "
                "(see apps/web/README.md, 'Hero backdrop (TMDB)')",
                file=sys.stderr,
            )
            _warned_missing_key = True
        return None

    if tmdb_id in _cache:
        return _cache[tmdb_id]

    try:
        resp = await _get_client().get(
            f"{TMDB_API_BASE}/movie/{tmdb_id}",
            params={"api_key": TMDB_API_KEY},
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        print(f"[warning] TMDB lookup failed for tmdb_id={tmdb_id}: {exc}", file=sys.stderr)
        _cache[tmdb_id] = None
        return None

    backdrop_path = data.get("backdrop_path")
    result = f"{TMDB_IMAGE_BASE}/{TMDB_BACKDROP_SIZE}{backdrop_path}" if backdrop_path else None
    _cache[tmdb_id] = result
    return result