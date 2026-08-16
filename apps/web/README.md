# Cinematic Hyperwheel — web UI (stage 1)

Reference-movie search (fuzzy, matched against title/directedBy/starring)
plus a visualization of the movie as a point on the fixed PC2/PC3 plane.

## Data

Expected under `/data/genome_2021/` by default (overridable via env vars):

- `metadata.jsonl` — as in the sample (`title`, `directedBy`, `starring`, `avgRating`, `imdbId`, `item_id`)
- `artifact.npz` — pre-built once, by hand, via the engine's CLI:

  ```bash
  python -m hyperwheel_recommender build data/genome_2021/ratings_long.csv \
    --out data/genome_2021/artifact.npz
  ```

Paths are overridable via `HYPERWHEEL_DATA_DIR`, `HYPERWHEEL_METADATA_PATH`,
`HYPERWHEEL_ARTIFACT_PATH`.

## Local development

```bash
# backend
pip install -e packages/hyperwheel-recommender
pip install -r apps/web/backend/requirements.txt
cd apps/web/backend && uvicorn app.main:app --reload --port 8000

# frontend (separate terminal)
cd apps/web/frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to :8000
```

## Production build / deploying to Render

A single free Web Service: FastAPI serves the built frontend static
files from the same origin (see `render.yaml` at the repo root). Build:

```bash
pip install -r apps/web/backend/requirements.txt
pip install -e packages/hyperwheel-recommender
cd apps/web/frontend && npm install && npm run build
```

Start: `cd apps/web/backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`

## API

- `GET /api/search?q=...&limit=8` — fuzzy search (rapidfuzz `WRatio`) over
  a combined title+directedBy+starring string. Titles are matched with
  the leading article reordered to the front (`"Matrix, The (1999)"` ->
  `"The Matrix (1999)"`) and common stopwords (the/a/an) stripped, so
  generic words don't produce false-positive matches; the title field is
  weighted above director/cast.
- `GET /api/movie/{item_id}/wheel` — the movie's coordinates on the
  PC2/PC3 plane (z-score, angle, radius, explained variance per axis)

## The wheel

Fixed PC2/PC3 plane (not "auto" — a consistent shared axis across all
movies matters more here than each movie's single most expressive
plane). Axes are labeled loosely:

- horizontal (PC2): blockbuster (−) ↔ arthouse (+)
- vertical (PC3): light/hopeful (−) ↔ dark/violent (+)

The disc's fill is a decorative "mood" gradient, not a literal encoding
of the values — the source of truth is the point's position plus the
text readout (z-score per axis, angle, vector length).

## Localization

The frontend uses `react-i18next`. Currently English (default) and
Russian, with a language switcher in the top-right corner; language
choice is auto-detected from the browser and persisted in
`localStorage`.

To add a new language:
1. add `frontend/src/i18n/locales/<code>.json` with the same keys as `en.json`
2. register it in the `resources` map in `frontend/src/i18n/index.ts`
3. add `{ code: "<code>", label: "..." }` to `LANGUAGES` in `frontend/src/components/LanguageSwitcher.tsx`

The backend currently has no user-facing localized strings (API returns
structured data, not text for display); if that changes later, the
natural approach is an `Accept-Language` header / `?lang=` param read in
`main.py`.

## Next (stage 2, not in this build)

- `auto` / manual hue-plane switching
- actual scheme-based recommendations (complementary/triadic/...) around
  the selected movie, shown as points on the same wheel
