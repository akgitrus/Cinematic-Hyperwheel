# Performance and memory efficiency

Measured on a 298 MB CSV, 10,000 items x 920 criteria.

| Stage | Before optimization | After | Change |
|---|---|---|---|
| Reading CSV + building the matrix | 353 MB peak (pandas `pivot`, object dtype) | 182 MB peak (streaming, chunked read straight into numpy) | ~1.9x |
| PCA | full SVD (n_items x n_criteria): 2.16s, +81 MB | eigh on the Gram matrix (n_criteria x n_criteria): 0.27s, +24 MB | ~8x faster |
| float64 → float32 on large intermediate arrays | — | −40% RSS during diagnose/recommend | — |
| **`diagnose`/`recommend` from a ready `.npz`** | — | **~245 MB peak, ~1.5-2s** | the target scenario for the serve stage |

Key architectural decision: **separating build and serve**. `build` runs
once (locally/in CI/as a background job) and streams the source CSV
without ever holding the long-format table in memory at once. The web
process (e.g. on Render's free tier, with limited RAM) never sees the
original CSV — only the compact `.npz` (298 MB → 23 MB compressed), which
loads in a fraction of a second.

The PCA basis is intentionally not cached separately from the `.npz` —
recomputing it via eigh on the Gram matrix is now cheap (a fraction of a
second), and recomputing it on every process start rules out serving
recommendations from a stale version of the math after a code update.

SQLite wouldn't be a good fit for the analytics matrix itself: it's a
row-oriented relational store, and for a dense numeric matrix (thousands
of items x hundreds of criteria) it would be both slower and no lighter
on memory than a dense numpy array — marshaling Python↔SQL for ~9M
numeric cells costs more than reading a binary `.npz` directly. SQLite
remains a reasonable choice for metadata/name search if that need arises
later, but not for the numeric pipeline itself.