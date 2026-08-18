from __future__ import annotations

import math
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import METADATA_PATH
from .search import MovieIndex, load_metadata
from hyperwheel_recommender import SCHEMES, recommend_on_basis

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
_titles = {r.item_id: r.title for r in _records}


@app.get("/api/search")
def search(q: str = Query(..., min_length=1), limit: int = 8):
    return {"results": _index.search(q, limit=limit)}


@app.get("/api/movie/{item_id}/wheel")
def wheel(item_id: int):
    try:
        circles = _engine.circles_for(item_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Item not found in the PCA basis")
    return {"item_id": item_id, "circles": circles}


@app.get("/api/movie/{item_id}/recommend")
def recommend(item_id: int, scheme: str = Query("complementary")):
    """Color-wheel recommendations, computed INDEPENDENTLY per circle.

    Each circle gets its own recommend_on_basis() call using its own
    plane - Stage A (character shortlist) and Stage B (angle+radius
    re-rank) are both run fresh for each circle's own axes, rather than
    projecting one main-circle result onto the other planes. Because PCA
    components are orthogonal, a good rotation on PC2/PC3 says nothing
    about position on PC5/PC6 - projecting a single result was giving
    secondary circles scattered, unoptimized points. This means each
    circle's top-k items are generally a DIFFERENT set of movies, not the
    same 5 movies viewed from different axes.
    """
    if scheme not in SCHEMES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown scheme '{scheme}'. Available: {sorted(SCHEMES)}",
        )
    try:
        wheel_circles = _engine.circles_for(item_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Item not found in the PCA basis")

    ridx = _engine.id_to_idx.get(item_id)

    def z(idx: int, pc: int) -> float:
        return float(_engine.scores[idx, pc - 1] / _engine.pc_std[pc - 1])

    circles_out = []
    for wc in wheel_circles:
        pc_x = wc["axis_x"]["pc"]
        pc_y = wc["axis_y"]["pc"]

        try:
            df = recommend_on_basis(
                _engine.basis,
                _engine.X,
                reference_item=item_id,
                scheme=scheme,
                plane=(pc_x, pc_y),
                top_k=6,
                shortlist_size=700
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        angles = []
        for angle_deg in SCHEMES[scheme]:
            rows = df[df["angle_deg"] == angle_deg].sort_values("rank")
            items = []
            for r in rows.to_dict("records"):
                iid = int(r["item"])
                idx = _engine.id_to_idx.get(iid)
                if idx is None:
                    continue
                zx, zy = z(idx, pc_x), z(idx, pc_y)
                items.append({
                    "item_id": iid,
                    "title": _titles.get(iid, str(iid)),
                    "rank": r["rank"],
                    "distance_to_target": r["distance_to_target"],
                    "angular_error_deg": r.get("angular_error_deg"),
                    "radius_ratio": r.get("radius_ratio"),
                    "z_x": round(zx, 4),
                    "z_y": round(zy, 4),
                    "angle_deg": round((math.degrees(math.atan2(zy, zx)) % 360), 2),
                })
            angles.append({"angle_deg": angle_deg, "items": items})

        reference = None
        if ridx is not None:
            zx, zy = z(ridx, pc_x), z(ridx, pc_y)
            reference = {
                "z_x": round(zx, 4),
                "z_y": round(zy, 4),
                "angle_deg": round((math.degrees(math.atan2(zy, zx)) % 360), 2),
                "radius": round(float(math.hypot(zx, zy)), 4),
            }

        circles_out.append({
            "primary": wc["primary"],
            "axis_x": wc["axis_x"],
            "axis_y": wc["axis_y"],
            "reference": reference,
            "angles": angles,
        })

    return {"item_id": item_id, "scheme": scheme, "circles": circles_out}


# Serve the built frontend (apps/web/frontend/dist) if present, so the
# whole app is a single Render web service on one origin.
_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
