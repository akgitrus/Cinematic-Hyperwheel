"""
The PCA basis and the set of "circles" (axis-pair visualizations) shown
for a given reference movie.

Circle selection
-----------------
Only PCA components with a human-curated entry in pc_config.json are
eligible to appear (see pc_config.py) - this bounds the tail-noise
problem (docs/math.md section 6a) by construction, and guarantees every
shown axis has a reviewed label/color for both poles, in every language.

Among those eligible components (excluding any flagged
excluded_from_hue, e.g. PC1 - a general "quality" axis, docs/math.md
section 4):

  - the MAIN circle uses the two components on which this specific item
    is most expressive (largest |z-score|) - the "auto" plane from
    planes.select_hue_plane, but restricted to the curated component set
    rather than a contiguous 1..N range.
  - each SECONDARY circle pairs the next two components by |z-score|,
    consecutively and without reusing an axis. Since PCA components are
    orthogonal, an item's standing on one axis says nothing about its
    standing on another - an arbitrary cross-pair (e.g. rank #3 with
    rank #7) carries no extra "interaction" signal beyond what each
    axis's own magnitude already conveys on its own. Consecutive pairing
    exhausts the ranked list exactly once, with no axis repeated across
    circles, and each subsequent circle has a naturally decreasing
    combined magnitude (a leftover unpaired axis, if the candidate count
    is odd, is simply dropped).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from hyperwheel_recommender import TasteBasis, build_taste_basis, load_input

from .config import ARTIFACT_PATH, N_COMPONENTS, STANDARDIZE
from .pc_config import load_pc_config


@dataclass
class WheelEngine:
    id_to_idx: dict[int, int]
    scores: np.ndarray       # (n_items, n_components)
    pc_std: np.ndarray
    explained: np.ndarray
    pc_config: dict[int, dict]
    basis: TasteBasis        # prebuilt basis, reused by the recommend endpoint
    X: np.ndarray            # (n_items, n_criteria) raw criteria matrix

    def _axis_payload(self, pc: int) -> dict:
        cfg = self.pc_config[pc]
        return {
            "pc": pc,
            "colors": cfg["colors"],
            "labels": cfg["labels"],
            "explained": round(float(self.explained[pc - 1]), 4),
        }

    def circles_for(self, item_id: int) -> list[dict]:
        idx = self.id_to_idx.get(item_id)
        if idx is None:
            raise KeyError(item_id)

        candidates = [
            pc for pc, cfg in self.pc_config.items()
            if not cfg.get("excluded_from_hue", False)
        ]
        if len(candidates) < 2:
            raise ValueError(
                "pc_config needs at least 2 non-excluded components to form a circle "
                f"(currently {len(candidates)}: {candidates})"
            )

        z = {pc: float(self.scores[idx, pc - 1] / self.pc_std[pc - 1]) for pc in candidates}
        ranked = sorted(candidates, key=lambda pc: -abs(z[pc]))

        circles = []
        # consecutive, non-overlapping pairs from the ranked list; an odd
        # leftover at the end (zip stops at the shorter sequence) is dropped
        for rank, (a, b) in enumerate(zip(ranked[0::2], ranked[1::2])):
            pc_x, pc_y = sorted((a, b))
            z_x, z_y = z[pc_x], z[pc_y]
            angle = math.degrees(math.atan2(z_y, z_x)) % 360
            radius = math.hypot(z_x, z_y)
            circles.append({
                "primary": rank == 0,
                "axis_x": self._axis_payload(pc_x),
                "axis_y": self._axis_payload(pc_y),
                "z_x": round(z_x, 4),
                "z_y": round(z_y, 4),
                "angle_deg": round(angle, 2),
                "radius": round(radius, 4),
            })
        return circles


def build_engine() -> WheelEngine:
    pc_config = load_pc_config()
    n_needed = max(N_COMPONENTS, max(pc_config))
    wide = load_input(str(ARTIFACT_PATH))
    basis = build_taste_basis(wide, n_components=n_needed, standardize=STANDARDIZE)

    # wide.index items are the raw "item" values from the CSV (see
    # data.py) - in this dataset that's the numeric MovieLens item_id,
    # stored as strings; cast back to int to match metadata.jsonl.
    id_to_idx = {int(item): i for i, item in enumerate(basis.items)}

    return WheelEngine(
        id_to_idx=id_to_idx,
        scores=basis.scores,
        pc_std=basis.pc_std,
        explained=basis.explained,
        pc_config=pc_config,
        basis=basis,
        X=wide.to_numpy(dtype=np.float32),
    )
