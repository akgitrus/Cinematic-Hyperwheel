# Cinematic Hyperwheel — web UI (stage 1)

Reference-movie search (fuzzy, matched against title/directedBy/starring)
plus a visualization of the movie as one or more points on PCA-component
planes ("circles"), each labeled by a human-curated config.

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

- `GET /api/search?q=...&limit=8` — fuzzy search over title/director/cast.
  Titles are matched with the leading article reordered to the front
  (`"Matrix, The (1999)"` -> `"The Matrix (1999)"`), lowercased,
  depunctuated, and with common stopwords (the/a/an) stripped before
  scoring. Title and director/cast are scored **separately** (not
  concatenated into one string — a long cast list would otherwise dilute
  the title match) and combined with a title-dominant weight; a strong
  standalone director/cast match can still surface on its own.
- `GET /api/movie/{item_id}/wheel` — `{ item_id, circles: [...] }`, one
  entry per circle (see below), each with `axis_x`/`axis_y` (pc index,
  colors, labels per language, explained variance), `z_x`/`z_y`, `angle_deg`,
  `radius`, and `primary` (true for the main circle).

## PCA component config (`pc_config.json`)

`apps/web/backend/app/pc_config.json` is hand-curated, one component at a
time: run `diagnose`, read a component's criteria weights and the real
items at each pole (docs/math.md section 4), decide what it represents,
then add an entry:

```json
"7": {
  "excluded_from_hue": false,
  "colors": { "negative": "#hex", "positive": "#hex" },
  "labels": {
    "en": { "axis": "...", "negative": "...", "positive": "..." },
    "ru": { "axis": "...", "negative": "...", "positive": "..." }
  }
}
```

`excluded_from_hue: true` marks a component that should never be used for
rotation/display (e.g. PC1, a general "quality/halo" axis — see
docs/math.md section 4) but can still be documented for reference.

Only components listed here are eligible to appear as a circle — this
bounds candidate selection to reviewed, non-noise axes, and guarantees
every circle has a label/color for every supported language. A prefilled
example for PC1–PC3 ships in the repo; extend it as more components get
reviewed.

## The wheel(s)

For a selected movie, the backend picks the two components on which
*that item* is most expressive (largest |z-score|) among the non-excluded
components in `pc_config.json` — this is the **main circle**. The
remaining configured components are ranked by |z-score| and paired
consecutively (rank #3+#4, #5+#6, ...) into **secondary circles**, shown
smaller in a column on the right. No axis is reused across circles: since
PCA components are orthogonal, a cross-pair (e.g. rank #3 with rank #7)
carries no extra signal beyond what each axis's own magnitude already
conveys — so a straight ranked partition covers the item's "signature"
without redundancy, each circle roughly less prominent than the last.

Each disc's fill is a decorative "mood" gradient built from that circle's
axis colors, not a literal encoding of the values — the source of truth
is the point's position plus the text readout (z-score per axis, angle,
vector length).
On both the main and the secondary wheels the four pole labels are drawn
curving along a single ring around the disc (outside its coloured gradient,
on the page background), sized per label so the text is never clipped. On the
smaller secondary circles the labels are shortened to the first "/" segment
("Wilderness / travel ..." -> "Wilderness") so they fit the tiny disc; hovering
a circle still shows the full labels as a tooltip.

## Localization

The frontend uses `react-i18next`. Currently English (default) and
Russian, with a language switcher in the top-right corner; language
choice is auto-detected from the browser and persisted in
`localStorage`. Wheel axis labels are localized through `pc_config.json`
itself (a `labels` entry per language, per component) rather than the
UI's translation files, since they're curated content, not UI chrome.

To add a new UI language:
1. add `frontend/src/i18n/locales/<code>.json` with the same keys as `en.json`
2. register it in the `resources` map in `frontend/src/i18n/index.ts`
3. add `{ code: "<code>", label: "..." }` to `LANGUAGES` in `frontend/src/components/LanguageSwitcher.tsx`
4. add a `"<code>"` entry under `labels` for each component in `pc_config.json`

## Next (stage 2, not in this build)

- actual scheme-based recommendations (complementary/triadic/...) around
  the selected movie, shown as points on the same wheel(s)
