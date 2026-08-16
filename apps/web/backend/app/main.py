from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import METADATA_PATH
from .search import MovieIndex, load_metadata
from .wheel import build_engine

app = FastAPI(title="Cinematic Hyperwheel API")

# Only relevant for local dev (Vite dev server on a different port). In
# production the frontend is served by this same app on the same origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_records = load_metadata(METADATA_PATH)
_index = MovieIndex(_records)
_engine = build_engine()


@app.get("/api/search")
def search(q: str = Query(..., min_length=1), limit: int = 8):
    return {"results": _index.search(q, limit=limit)}


@app.get("/api/movie/{item_id}/wheel")
def wheel(item_id: int):
    try:
        return _engine.point_for(item_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Item not found in the PCA basis")


# Serve the built frontend (apps/web/frontend/dist) if present, so the
# whole app is a single Render web service on one origin.
_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
