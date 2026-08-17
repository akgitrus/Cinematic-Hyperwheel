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
    """Color-wheel recommendations (see hyperwheel_recommender.recommend_on_basis).

    Uses the same reviewed plane (axis_x/axis_y) as the reference's main
    wheel circle, reusing the basis built once at startup. Returns the
    top-k matches per scheme angle (k=5) plus the shared axis config.
    """
    if scheme not in SCHEMES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown scheme '{scheme}'. Available: {sorted(SCHEMES)}",
        )
    try:
        circles = _engine.circles_for(item_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Item not found in the PCA basis")

    main = circles[0]
    pc_x = main["axis_x"]["pc"]
    pc_y = main["axis_y"]["pc"]

    try:
        df = recommend_on_basis(
            _engine.basis,
            _engine.X,
            reference_item=item_id,
            scheme=scheme,
            plane=(pc_x, pc_y),
            top_k=5,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    def z(idx: int, pc: int) -> float:
        return float(_engine.scores[idx, pc - 1] / _engine.pc_std[pc - 1])

    # All PCA components used by any of this reference's circles (main +
    # secondary), so the frontend can plot each recommendation on every circle.
    all_pcs = sorted(
        {p for c in circles for p in (c["axis_x"]["pc"], c["axis_y"]["pc"])}
    )

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
                "z_x": round(zx, 4),
                "z_y": round(zy, 4),
                "angle_deg": round((math.degrees(math.atan2(zy, zx)) % 360), 2),
                "pc_z": {str(p): round(z(idx, p), 4) for p in all_pcs},
            })
        angles.append({"angle_deg": angle_deg, "items": items})

    reference = None
    ridx = _engine.id_to_idx.get(item_id)
    if ridx is not None:
        zx, zy = z(ridx, pc_x), z(ridx, pc_y)
        reference = {
            "z_x": round(zx, 4),
            "z_y": round(zy, 4),
            "angle_deg": round((math.degrees(math.atan2(zy, zx)) % 360), 2),
            "radius": round(float(math.hypot(zx, zy)), 4),
        }

    return {
        "item_id": item_id,
        "scheme": scheme,
        "axis_x": main["axis_x"],
        "axis_y": main["axis_y"],
        "reference": reference,
        "angles": angles,
    }


# Serve the built frontend (apps/web/frontend/dist) if present, so the
# whole app is a single Render web service on one origin.
_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
