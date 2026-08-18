"""Find real items matching a chosen color-wheel scheme."""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd

from .basis import TasteBasis, build_taste_basis
from .planes import select_hue_plane
from .rotation import SCHEMES, rotate_whitened

ANGLE_TOL_RAD = np.radians(5.0)  # bucket width for "angularly tied" candidates in Stage B;
                                   # see /docs/math.md section 6b - radius only breaks ties
                                   # within this window, it never overrides a clearly better angle

def _circular_diff_rad(a: np.ndarray | float, b: float) -> np.ndarray | float:
    """Smallest absolute angular distance between a and b, wrapped to [0, pi]."""
    d = np.abs(a - b) % (2 * np.pi)
    return np.minimum(d, 2 * np.pi - d)


def recommend_on_basis(
    basis: TasteBasis,
    X: np.ndarray,
    reference_item: str,
    scheme: str,
    plane: tuple[int, int],
    top_k: int = 5,
    shortlist_size: int = 50,
) -> pd.DataFrame:
    """
    Same rotation logic as recommend(), but takes a PRE-BUILT TasteBasis and
    the raw criteria matrix X instead of rebuilding PCA from scratch - for
    callers that cache the basis at startup (e.g. a web service) and don't
    want to recompute it on every request.

    plane: explicit 1-based (i, j) component pair forming the hue plane on
        which to rotate (the caller decides it - typically the same reviewed,
        labelled plane the wheel UI shows).

    Selection is two-stage, because a single full-space nearest-neighbor
    search conflates two different things the scheme is supposed to
    deliver at once - "still feels like the reference" and "actually sits
    at the target angle" - and when the hue plane explains only a modest
    share of total variance (see /docs/math.md, section 6b), the first
    criterion silently drowns out the second: target_vec differs from the
    reference in only two of hundreds of dimensions, so full-space
    distance is dominated by everything BUT the rotation.

    Stage A (character shortlist): the `shortlist_size` closest items to
        target_vec by full Euclidean distance, exactly as before. This is
        still what enforces "preserving the reference's overall character"
        (/docs/math.md section 5, readme "Delta reconstruction") - delta is
        nonzero only inside the hue plane, so distance in the OTHER
        dimensions is a genuine measure of shared character.
    Stage B (angular re-rank): among that shortlist, keep the `top_k` whose
        own position in the (whitened) hue plane is angularly closest to
        the target angle - i.e. the ones that actually express the
        requested rotation, not just any nearby item.

    This does not change what target_vec or distance_to_target mean -
    Stage A distances are untouched, so `distance_to_target` in the output
    stays an honest full-space Euclidean distance, not a reweighted one.

    shortlist_size: how many Stage-A candidates are eligible for Stage B.
        Too small and Stage B may have nothing with a decent angle to pick
        from; too large and Stage B degenerates toward "closest angle in
        the whole catalog", losing the character guarantee Stage A gives.
        Must be >= top_k.

    The returned rows mirror the previous shape plus one extra column:
    {scheme, angle_deg, rank, item, distance_to_target, angular_error_deg}.
    angular_error_deg is how far (in degrees, within the hue plane) the
    chosen item's own position sits from the exact target angle - 0 would
    be a perfect angular match.
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
    if shortlist_size < top_k:
        raise ValueError(
            f"shortlist_size ({shortlist_size}) must be >= top_k ({top_k})."
        )

    ref_idx = basis.items.index(reference_item)
    y_ref = basis.U @ ((basis.Q[ref_idx] - basis.M) / basis.scale)

    plane0 = (plane[0] - 1, plane[1] - 1)   # 1-based -> 0-based
    pi, pj = plane0
    std_i, std_j = basis.pc_std[pi], basis.pc_std[pj]

    # Precompute every item's own whitened angle in the hue plane once -
    # basis.scores is already in the same (scaled, doubly-centered) space
    # as y_ref/y_target, so no re-projection from X is needed here.
    z_i_all = basis.scores[:, pi] / std_i
    z_j_all = basis.scores[:, pj] / std_j
    angle_all = np.arctan2(z_j_all, z_i_all)

    rows: list[dict] = []
    for angle_deg in SCHEMES[scheme]:
        theta = np.radians(angle_deg)
        y_target = rotate_whitened(y_ref, basis.pc_std, theta, plane=plane0)
        delta = (basis.U.T @ (y_target - y_ref)) * basis.scale
        target_vec = X[ref_idx] + delta   # (n_criteria,)

        # --- Stage A: character shortlist (unchanged distance metric) ---
        dists = np.linalg.norm(X - target_vec[None, :], axis=1)
        dists[ref_idx] = np.inf
        n_avail = min(shortlist_size, len(dists) - 1)
        shortlist = np.argpartition(dists, n_avail)[:n_avail]
        shortlist = shortlist[np.argsort(dists[shortlist])]

        # --- Stage B: angle-first re-rank, radius as an explicit tie-break ---
        # NOT a single Euclidean distance to the target point in the plane:
        # dist² = r_c² - 2·r_c·r_t·cos(Δθ) + r_t² lets a large-radius,
        # wrong-angle candidate look "closer" than a small-radius,
        # well-angled one whenever target_r is large enough - the same
        # trade-off problem Stage A has in full space, just relocated to
        # 2D. Angle defines what the scheme IS (180°/120°/...); radius is
        # a secondary, desirable-but-not-defining match. So they're kept
        # as separate, explicitly ordered sort keys instead of one blended
        # number.
        z_ti = y_target[pi] / std_i
        z_tj = y_target[pj] / std_j
        target_r = np.hypot(z_ti, z_tj)
        target_angle = np.arctan2(z_tj, z_ti)

        cand_r = np.hypot(z_i_all[shortlist], z_j_all[shortlist])
        angle_err = _circular_diff_rad(angle_all[shortlist], target_angle)
        radius_mismatch = (
            np.abs(np.log(np.maximum(cand_r, 1e-6) / max(target_r, 1e-6)))
            if target_r > 1e-9 else np.zeros_like(cand_r)
        )

        # Coarse angular bucket first (candidates within ~ANGLE_TOL_RAD of
        # each other are treated as angularly "tied"), then radius match
        # breaks ties within a bucket, then exact angle as a final,
        # rarely-reached tiebreak. np.lexsort's LAST key is primary.
        bucket = np.round(angle_err / ANGLE_TOL_RAD)
        order = shortlist[np.lexsort((angle_err, radius_mismatch, bucket))][:top_k]

        cand_r_ord = np.hypot(z_i_all[order], z_j_all[order])
        ang_err_ord = np.degrees(_circular_diff_rad(angle_all[order], target_angle))

        for rank, (idx, ce, ar) in enumerate(zip(order, cand_r_ord, ang_err_ord), start=1):
            rows.append({
                "scheme": scheme,
                "angle_deg": angle_deg,
                "rank": rank,
                "item": basis.items[idx],
                "distance_to_target": round(float(dists[idx]), 4),
                "angular_error_deg": round(float(ar), 2),
                "radius_ratio": round(float(ce / target_r), 3) if target_r > 1e-9 else None,
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
    shortlist_size: int = 50,
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
    shortlist_size: see recommend_on_basis - size of the Stage-A
        character shortlist that Stage B's angular re-rank picks from.
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

    plane_var = basis.explained[plane[0]] + basis.explained[plane[1]]
    print(
        f"[info] hue plane PC{resolved_components[0]}/PC{resolved_components[1]} "
        f"explains {plane_var:.1%} of variance combined - Stage A (shortlist_size="
        f"{shortlist_size}) enforces character similarity on the rest; Stage B "
        f"re-ranks that shortlist by angle in this plane.",
        file=sys.stderr,
    )

    result = recommend_on_basis(
        basis,
        X,
        reference_item=reference_item,
        scheme=scheme,
        plane=resolved_components,
        top_k=top_k,
        shortlist_size=shortlist_size,
    )
    print(
        f"\nReference: {reference_item}  "
        f"(L={L_ref:.3f}, S={S_ref:.3f}, "
        f"PCA explained variance: {basis.explained.sum():.1%})\n"
    )
    return result
