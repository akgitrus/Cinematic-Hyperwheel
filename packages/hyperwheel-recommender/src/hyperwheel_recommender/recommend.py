"""Find real items matching a chosen color-wheel scheme."""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd

from .basis import TasteBasis, build_taste_basis
from .planes import select_hue_plane
from .rotation import SCHEMES, rotate_whitened


def recommend_on_basis(
    basis: TasteBasis,
    X: np.ndarray,
    reference_item: str,
    scheme: str,
    plane: tuple[int, int],
    top_k: int = 5,
) -> pd.DataFrame:
    """
    Same rotation logic as recommend(), but takes a PRE-BUILT TasteBasis and
    the raw criteria matrix X instead of rebuilding PCA from scratch - for
    callers that cache the basis at startup (e.g. a web service) and don't
    want to recompute it on every request.

    plane: explicit 1-based (i, j) component pair forming the hue plane on
        which to rotate (the caller decides it - typically the same reviewed,
        labelled plane the wheel UI shows).

    The returned rows mirror recommend(): {scheme, angle_deg, rank, item,
    distance_to_target}.
    """
    if reference_item not in basis.items:
        raise ValueError(f"Item '{reference_item}' not found in the data.")
    if scheme not in SCHEMES:
        raise ValueError(f"Unknown scheme '{scheme}'. Available: {list(SCHEMES)}")
    if max(plane) > len(basis.pc_std):
        raise ValueError(
            f"plane={plane} requires at least {max(plane)} components "
            f"(basis has {len(basis.pc_std)})."
        )

    ref_idx = basis.items.index(reference_item)
    y_ref = basis.U @ ((basis.Q[ref_idx] - basis.M) / basis.scale)

    plane0 = (plane[0] - 1, plane[1] - 1)   # 1-based -> 0-based

    rows: list[dict] = []
    for angle_deg in SCHEMES[scheme]:
        theta = np.radians(angle_deg)
        y_target = rotate_whitened(y_ref, basis.pc_std, theta, plane=plane0)
        # Add to the reference only the delta introduced by the rotation
        # within the hue plane (see the comment in recommend()).
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

    return pd.DataFrame(rows)


def recommend(
    wide: pd.DataFrame,
    reference_item: str,
    scheme: str,
    n_components: int = 3,
    top_k: int = 5,
    standardize: bool = True,
    hue_components: tuple[int, int] | str = (2, 3),
    exclude_components: tuple[int, ...] = (1,),
    candidate_components: int | None = None,
) -> pd.DataFrame:
    """
    hue_components: either an explicit 1-based (i, j) pair, fixed across
        all reference items, or the string "auto" to pick, per reference,
        the two components on which THAT item is most expressive (see
        planes.select_hue_plane). "auto" is generally the better default
        when the variance spectrum is diffuse (no clearly dominant pair) -
        see /docs/math.md, section 7.
    exclude_components, candidate_components: only used when
        hue_components="auto" - passed straight to select_hue_plane.
    """
    if reference_item not in wide.index:
        raise ValueError(f"Item '{reference_item}' not found in the data.")
    if scheme not in SCHEMES:
        raise ValueError(f"Unknown scheme '{scheme}'. Available: {list(SCHEMES)}")
    if n_components < 2:
        raise ValueError("n_components must be >= 2.")
    if hue_components != "auto" and max(hue_components) > n_components:
        raise ValueError(
            f"hue_components={hue_components} requires n_components >= "
            f"{max(hue_components)} (currently {n_components})."
        )

    basis = build_taste_basis(wide, n_components=n_components, standardize=standardize)
    X = wide.to_numpy(dtype=np.float32)   # see basis.py - float32 instead of float64 for RAM

    ref_idx = basis.items.index(reference_item)
    L_ref = basis.L[ref_idx]
    q_ref = basis.Q[ref_idx]
    y_ref = basis.U @ ((q_ref - basis.M) / basis.scale)   # projection in the scaled, doubly-centered space
    S_ref = np.linalg.norm(q_ref - basis.M)

    if hue_components == "auto":
        resolved_components = select_hue_plane(
            basis, ref_idx,
            exclude_components=exclude_components,
            candidate_components=candidate_components,
        )
        print(
            f"[info] auto-selected hue plane for '{reference_item}': "
            f"PC{resolved_components[0]}/PC{resolved_components[1]} "
            f"(this item's own most expressive axes, excluding {exclude_components})",
            file=sys.stderr,
        )
    else:
        resolved_components = hue_components

    plane = (resolved_components[0] - 1, resolved_components[1] - 1)   # 1-based -> 0-based

    aspect = basis.pc_std[plane[0]] / basis.pc_std[plane[1]] if basis.pc_std[plane[1]] > 0 else float("inf")
    if aspect > 2 or aspect < 0.5:
        print(
            f"[info] spread ratio PC{resolved_components[0]}/PC{resolved_components[1]} = "
            f"{aspect:.2f} - the plane is noticeably elongated, rotation is "
            f"performed in whitened coordinates.",
            file=sys.stderr,
        )

    result = recommend_on_basis(
        basis,
        X,
        reference_item=reference_item,
        scheme=scheme,
        plane=resolved_components,
        top_k=top_k,
    )
    print(
        f"\nReference: {reference_item}  "
        f"(L={L_ref:.3f}, S={S_ref:.3f}, "
        f"PCA explained variance: {basis.explained.sum():.1%})\n"
    )
    return result
