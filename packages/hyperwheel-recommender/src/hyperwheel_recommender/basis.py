"""
Building the hue basis: double centering (L, M) + PCA.

See /docs/math.md, section 3, for the full mathematical rationale.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class TasteBasis:
    items: list[str]
    criteria: list[str]
    L: np.ndarray             # (n_items,) each item's own mean across criteria
    Q: np.ndarray              # (n_items, n_criteria) shape vectors (row-centered)
    M: np.ndarray               # (n_criteria,) typical shape profile across the whole
                                 # category (mean of Q over items) - removed before PCA,
                                 # otherwise the first component picks up the shape
                                 # common to all items instead of real differences
                                 # between items
    U: np.ndarray               # (n_components, n_criteria) orthonormal basis (in scaled space)
    explained: np.ndarray       # (n_components,) fraction of variance explained
    singular_values: np.ndarray  # full spectrum (for diagnose)
    scale: np.ndarray           # (n_criteria,) std of each criterion (1.0 if standardize=False)
    pc_std: np.ndarray          # (n_components,) actual spread of items along each component -
                                 # needed for whitening before rotation (see rotation.rotate_whitened)
    scores: np.ndarray          # (n_items, n_components) each item's coordinate along each component


def build_taste_basis(
    wide: pd.DataFrame, n_components: int, standardize: bool = True
) -> TasteBasis:
    # float32, not float64 (was dtype=float) - on large catalogs (thousands
    # of items x hundreds of criteria) float64 on every intermediate array
    # (X, Q, Qc, Q_scaled) doubles peak RSS with no meaningful accuracy
    # benefit for PCA on data in the [0,1] range.
    X = wide.to_numpy(dtype=np.float32)
    items = list(wide.index)
    criteria = list(wide.columns)

    L = X.mean(axis=1)
    Q = X - L[:, None]                      # each row sums to 0 (own mean removed)

    # Double centering: besides each item's own mean (L), we also need to
    # remove the category-wide typical shape (M) - otherwise PCA will treat
    # the shape common to all items as the "main difference" instead of
    # real variation between items.
    M = Q.mean(axis=0)
    Qc = Q - M[None, :]

    if standardize:
        # Without this, criteria with a larger random spread would
        # dominate the components purely because of scale, not because of
        # real correlation with other criteria.
        scale = Qc.std(axis=0)
        scale = np.where(scale < 1e-12, 1.0, scale)
    else:
        scale = np.ones(Qc.shape[1])

    Q_scaled = Qc / scale

    # PCA via eigh on the Gram matrix (n_criteria x n_criteria), rather than
    # SVD of the full (n_items x n_criteria) matrix. When n_items >>
    # n_criteria (the typical case: thousands of items, hundreds of
    # criteria), SVD still computes and materializes the left matrix U of
    # size (n_items x n_criteria), which is then discarded - this is both
    # slower (~8x on 10000x920) and requires extra memory just to hold it.
    # The Gram matrix C = Q^T @ Q is small (n_criteria x n_criteria)
    # regardless of the number of items - that's all the basis actually
    # needs.
    C = Q_scaled.T @ Q_scaled
    eigvals, eigvecs = np.linalg.eigh(C)         # ascending order
    order = np.argsort(eigvals)[::-1]
    eigvals_sorted = np.clip(eigvals[order], 0, None)  # guard against small negatives from floating-point error
    S = np.sqrt(eigvals_sorted)                   # equivalent to singular values
    Vt = eigvecs[:, order].T                        # (n_criteria, n_criteria)

    total_var = np.sum(S ** 2)
    explained_full = (S ** 2) / total_var if total_var > 0 else S * 0

    n_components = min(n_components, Vt.shape[0])
    U = Vt[:n_components]
    explained = explained_full[:n_components]

    scores = Q_scaled @ U.T                 # (n_items, n_components)
    pc_std = scores.std(axis=0)
    pc_std = np.where(pc_std < 1e-12, 1.0, pc_std)

    return TasteBasis(
        items=items, criteria=criteria, L=L, Q=Q, M=M, U=U,
        pc_std=pc_std, scores=scores,
        explained=explained, singular_values=S, scale=scale,
    )