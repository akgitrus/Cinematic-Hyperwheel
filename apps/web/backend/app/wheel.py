"""
The PCA basis and per-movie PC2/PC3 coordinates for the wheel.

Built once at process start from the prebuilt .npz artifact (see
docs/performance.md - eigh on the Gram matrix is cheap enough to redo on
every start, which also guarantees we never serve from a stale basis).
The wheel is intentionally pinned to a fixed (PC2, PC3) plane for every
item for now, unlike recommend.py's per-item "auto" mode - a consistent
axis pair is what makes a single shared "color wheel" meaningful across
different reference movies. Manual axis switching / auto mode for the
wheel itself are a later step.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from hyperwheel_recommender import build_taste_basis, load_input

from .config import ARTIFACT_PATH, N_COMPONENTS, STANDARDIZE, WHEEL_PLANE


@dataclass
class WheelEngine:
    id_to_idx: dict[int, int]
    scores: np.ndarray      # (n_items, n_components)
    pc_std: np.ndarray
    explained: np.ndarray
    plane: tuple[int, int]  # 0-based (i, j)

    def point_for(self, item_id: int) -> dict:
        idx = self.id_to_idx.get(item_id)
        if idx is None:
            raise KeyError(item_id)
        i, j = self.plane
        z_x = float(self.scores[idx, i] / self.pc_std[i])
        z_y = float(self.scores[idx, j] / self.pc_std[j])
        angle = math.degrees(math.atan2(z_y, z_x)) % 360
        radius = math.hypot(z_x, z_y)
        return {
            "item_id": item_id,
            "pc_x": i + 1, "pc_y": j + 1,   # 1-based, for display ("PC2"/"PC3")
            "z_x": round(z_x, 4),
            "z_y": round(z_y, 4),
            "angle_deg": round(angle, 2),
            "radius": round(radius, 4),
            "explained_x": round(float(self.explained[i]), 4),
            "explained_y": round(float(self.explained[j]), 4),
        }


def build_engine() -> WheelEngine:
    wide = load_input(str(ARTIFACT_PATH))
    n_needed = max(N_COMPONENTS, max(WHEEL_PLANE))
    basis = build_taste_basis(wide, n_components=n_needed, standardize=STANDARDIZE)

    # wide.index items are the raw "item" values from the CSV (see
    # data.py) - in this dataset that's the numeric MovieLens item_id,
    # stored as strings; cast back to int to match metadata.jsonl.
    id_to_idx = {int(item): i for i, item in enumerate(basis.items)}
    plane = (WHEEL_PLANE[0] - 1, WHEEL_PLANE[1] - 1)

    return WheelEngine(
        id_to_idx=id_to_idx,
        scores=basis.scores,
        pc_std=basis.pc_std,
        explained=basis.explained,
        plane=plane,
    )
