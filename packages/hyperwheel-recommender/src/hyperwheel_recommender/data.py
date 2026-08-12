"""
Loading and preparing input data.

Two independent paths:
  load_matrix(csv_path)      - streaming (chunked) read of a long-format
                                CSV, straight into a dense numpy array,
                                without ever holding the whole long-format
                                table in memory. Used both for ad-hoc work
                                and as part of `build`.
  save_artifact / load_artifact - compact binary cache (.npz) for the
                                serve stage: a web process should not
                                re-parse hundreds of MB of CSV on every
                                start.

See /docs/math.md, memory-efficiency section, for measurements and
rationale (streaming read: ~353 MB -> ~145 MB peak RSS on a 300 MB CSV
with 10k items x 920 criteria).
"""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd

DEFAULT_CHUNKSIZE = 500_000


def load_matrix(csv_path: str, chunksize: int = DEFAULT_CHUNKSIZE) -> pd.DataFrame:
    """
    Reads a CSV (item,criteria,value) and returns a wide table
    (rows = item, columns = criteria), without materializing the whole
    long-format table in memory at once (important for CSVs in the
    hundreds of MB range on limited RAM).

    Two-pass scheme:
      pass 1 - collect only unique item/criteria values + the value
               range (does not store the actual data rows);
      pass 2 - writes values directly into a preallocated numpy array.

    Missing values are filled with the per-criterion mean. Duplicate
    (item, criteria) pairs are resolved in favour of the last value (same
    as before), without extra memory to store the pairs themselves.
    """
    required = {"item", "criteria", "value"}

    # --- pass 1: only item/criteria dictionaries + value range ---
    item_set: set[str] = set()
    criteria_set: set[str] = set()
    vmin, vmax = np.inf, -np.inf

    reader = pd.read_csv(csv_path, chunksize=chunksize)
    first = True
    for chunk in reader:
        if first:
            missing_cols = required - set(chunk.columns)
            if missing_cols:
                raise ValueError(f"CSV is missing columns: {missing_cols}")
            first = False
        item_set.update(chunk["item"].unique())
        criteria_set.update(chunk["criteria"].unique())
        vmin = min(vmin, chunk["value"].min())
        vmax = max(vmax, chunk["value"].max())

    if vmin < 0 or vmax > 1:
        print(
            f"[warning] value column outside [0,1]: "
            f"min={vmin:.3f}, max={vmax:.3f}. Proceeding without normalization.",
            file=sys.stderr,
        )

    items_sorted = sorted(item_set)
    criteria_sorted = sorted(criteria_set)
    item_idx = {v: i for i, v in enumerate(items_sorted)}
    crit_idx = {v: i for i, v in enumerate(criteria_sorted)}

    # --- pass 2: write straight into the target array ---
    X = np.full((len(items_sorted), len(criteria_sorted)), np.nan, dtype=np.float32)
    total_rows = 0
    for chunk in pd.read_csv(csv_path, chunksize=chunksize):
        total_rows += len(chunk)
        ii = chunk["item"].map(item_idx).to_numpy()
        jj = chunk["criteria"].map(crit_idx).to_numpy()
        vv = chunk["value"].to_numpy(dtype=np.float32)
        X[ii, jj] = vv

    n_filled = int(np.sum(~np.isnan(X)))
    dup = total_rows - n_filled   # exactly the number of rows that overwrote an already-filled cell
    if dup:
        print(
            f"[warning] {dup} duplicate (item, criteria) pairs — "
            f"keeping the last value.",
            file=sys.stderr,
        )

    n_missing = X.size - n_filled
    if n_missing:
        pct = 100 * n_missing / X.size
        print(
            f"[info] missing values: {n_missing}/{X.size} ({pct:.2f}%) — "
            f"filling with the per-criterion mean.",
            file=sys.stderr,
        )
        col_means = np.nanmean(X, axis=0)
        nan_rows, nan_cols = np.where(np.isnan(X))
        X[nan_rows, nan_cols] = col_means[nan_cols]

    return pd.DataFrame(
        X,
        index=pd.Index(items_sorted, name="item"),
        columns=pd.Index(criteria_sorted, name="criteria"),
    )


def save_artifact(wide: pd.DataFrame, path: str) -> None:
    """
    Saves the wide table into a compact binary .npz - for the serve stage,
    so the original CSV doesn't need to be re-parsed on every web-process
    start. The PCA basis is intentionally NOT cached separately: recomputing
    it via eigh on the Gram matrix is now fast enough (a fraction of a
    second even on thousands of items), and not caching it removes the
    risk of serving recommendations from a stale version of the math after
    a code update.
    """
    np.savez_compressed(
        path,
        items=np.array(wide.index, dtype=object),
        criteria=np.array(wide.columns, dtype=object),
        X=wide.to_numpy(dtype=np.float32),
    )


def load_artifact(path: str) -> pd.DataFrame:
    """Loads the wide table from an artifact created by save_artifact."""
    with np.load(path, allow_pickle=True) as data:
        return pd.DataFrame(
            data["X"],
            index=pd.Index(data["items"], name="item"),
            columns=pd.Index(data["criteria"], name="criteria"),
        )


def load_input(path: str, chunksize: int = DEFAULT_CHUNKSIZE) -> pd.DataFrame:
    """Single entry point: .npz -> load_artifact, otherwise -> load_matrix (CSV)."""
    if path.endswith(".npz"):
        return load_artifact(path)
    return load_matrix(path, chunksize=chunksize)