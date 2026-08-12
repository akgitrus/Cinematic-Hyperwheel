"""Find real items matching a chosen color-wheel scheme."""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd

from .basis import build_taste_basis
from .rotation import SCHEMES, rotate_whitened


def recommend(
    wide: pd.DataFrame,
    reference_item: str,
    scheme: str,
    n_components: int = 3,
    top_k: int = 5,
    standardize: bool = True,
    hue_components: tuple[int, int] = (2, 3),
) -> pd.DataFrame:
    if reference_item not in wide.index:
        raise ValueError(f"Item '{reference_item}' not found in the data.")
    if scheme not in SCHEMES:
        raise ValueError(f"Unknown scheme '{scheme}'. Available: {list(SCHEMES)}")
    if n_components < 2:
        raise ValueError("n_components must be >= 2.")
    if max(hue_components) > n_components:
        raise ValueError(
            f"hue_components={hue_components} requires n_components >= "
            f"{max(hue_components)} (currently {n_components})."
        )

    basis = build_taste_basis(wide, n_components=n_components, standardize=standardize)
    X = wide.to_numpy(dtype=np.float32)   # see basis.py - float32 instead of float64 for RAM
    plane = (hue_components[0] - 1, hue_components[1] - 1)   # 1-based -> 0-based

    ref_idx = basis.items.index(reference_item)
    L_ref = basis.L[ref_idx]
    q_ref = basis.Q[ref_idx]
    y_ref = basis.U @ ((q_ref - basis.M) / basis.scale)   # projection in the scaled, doubly-centered space
    S_ref = np.linalg.norm(q_ref - basis.M)

    aspect = basis.pc_std[plane[0]] / basis.pc_std[plane[1]] if basis.pc_std[plane[1]] > 0 else float("inf")
    if aspect > 2 or aspect < 0.5:
        print(
            f"[info] spread ratio PC{hue_components[0]}/PC{hue_components[1]} = "
            f"{aspect:.2f} - the plane is noticeably elongated, rotation is "
            f"performed in whitened coordinates.",
            file=sys.stderr,
        )

    rows = []
    for angle_deg in SCHEMES[scheme]:
        theta = np.radians(angle_deg)
        y_target = rotate_whitened(y_ref, basis.pc_std, theta, plane=plane)
        # IMPORTANT: add to the reference only the delta introduced by the
        # rotation within the hue plane, rather than rebuilding the target
        # from scratch using only the top-k components. Otherwise anything
        # outside the hue plane gets collapsed to the mean - especially
        # critical when the top-k components do not explain all of the
        # variance (see /docs/math.md, section 5).
        # basis.scale converts the delta from the scaled space back into
        # the original criteria units.
        delta = (basis.U.T @ (y_target - y_ref)) * basis.scale
        target_vec = X[ref_idx] + delta   # (n_criteria,)

        dists = np.linalg.norm(X - target_vec[None, :], axis=1)
        dists[ref_idx] = np.inf
        order = np.argsort(dists)[:top_k]

        for rank, idx in enumerate(order, start=1):
            rows.append({
                "scheme": scheme,
                "angle_deg": angle_deg,
                "rank": rank,
                "item": basis.items[idx],
                "distance_to_target": round(float(dists[idx]), 4),
            })

    result = pd.DataFrame(rows)
    print(
        f"\nReference: {reference_item}  "
        f"(L={L_ref:.3f}, S={S_ref:.3f}, "
        f"PCA explained variance: {basis.explained.sum():.1%})\n"
    )
    return result