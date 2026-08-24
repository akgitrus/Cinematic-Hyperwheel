"""
Thin client for the TMDB (The Movie Database) API - used to resolve a
movie's backdrop image for the hero background (see
/api/movie/{item_id}/backdrop in main.py, and HeroBackdrop.tsx on the
frontend) and a small poster image for the Recommendations panel's
hover/tap info card (see /api/movie/{item_id}/poster in main.py, and
RecommendationsPanel.tsx). Both images come from the same TMDB
`/movie/{id}` response, so a single request per tmdb_id resolves both -
whichever endpoint is hit first for a given movie warms the cache for
the other.

Requires TMDB_API_KEY (see config.py) - without it, both
fetch_backdrop_url and fetch_poster_url always return None and the
respective feature degrades to "no image", exactly like a movie with no
tmdb_id at all (see search.py's already-optional imdb_id/tmdb_id
fields). The API key never reaches the client: this module is the only
thing that ever talks to TMDB, and the frontend only ever sees the
resolved image URLs via our own /backdrop and /poster endpoints.

Results are cached in-process (tmdb_id -> resolved backdrop/poster URLs,
or None for each) for the lifetime of the web process - a movie's
images essentially never change, so a tmdb_id already resolved this run
never needs a second TMDB round trip, regardless of which endpoint
resolved it first. Deliberately just a dict, not a real cache layer:
these endpoints are hit at most once per distinct movie a user selects
or hovers.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass

import httpx

from .config import TMDB_API_KEY, TMDB_BACKDROP_SIZE, TMDB_POSTER_SIZE

TMDB_API_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"


@dataclass(frozen=True)
class _Images:
    backdrop_url: str | None
    poster_url: str | None


_NO_IMAGES = _Images(backdrop_url=None, poster_url=None)

_cache: dict[str, _Images] = {}
_warned_missing_key = False
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    # Reused across requests (connection pooling) rather than a fresh
    # AsyncClient per call - this can be hit once per movie selection or
    # hover, so it's worth not re-doing the TLS handshake every time.
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=5.0)
    return _client


async def _fetch_images(tmdb_id: str) -> _Images:
    """
    Resolves (and caches) both the backdrop and poster URL for a
    tmdb_id in a single TMDB request. Never raises - a slow or broken
    TMDB call must not break movie selection or the recommendations
    panel, since both images are purely decorative (see
    fetch_backdrop_url / fetch_poster_url below, which return None
    rather than propagate an error).
    """
    global _warned_missing_key

    if not TMDB_API_KEY:
        if not _warned_missing_key:
            print(
                "[warning] TMDB_API_KEY not set - backdrop/poster images "
                "disabled (see apps/web/README.md, 'Hero backdrop (TMDB)')",
                file=sys.stderr,
            )
            _warned_missing_key = True
        return _NO_IMAGES

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
        _cache[tmdb_id] = _NO_IMAGES
        return _NO_IMAGES

    backdrop_path = data.get("backdrop_path")
    poster_path = data.get("poster_path")
    images = _Images(
        backdrop_url=f"{TMDB_IMAGE_BASE}/{TMDB_BACKDROP_SIZE}{backdrop_path}" if backdrop_path else None,
        poster_url=f"{TMDB_IMAGE_BASE}/{TMDB_POSTER_SIZE}{poster_path}" if poster_path else None,
    )
    _cache[tmdb_id] = images
    return images


async def fetch_backdrop_url(tmdb_id: str) -> str | None:
    """Full backdrop image URL for the given tmdb_id, or None if TMDB
    isn't configured, the movie has no backdrop, or the lookup failed."""
    return (await _fetch_images(tmdb_id)).backdrop_url


async def fetch_poster_url(tmdb_id: str) -> str | None:
    """Small poster image URL for the given tmdb_id, or None if TMDB
    isn't configured, the movie has no poster, or the lookup failed."""
    return (await _fetch_images(tmdb_id)).poster_url