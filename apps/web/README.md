# Cinematic Hyperwheel — web UI (stage 1)

Reference-movie search (literal, title-only) plus a visualization of the
movie as one or more points on PCA-component planes ("circles"), each
labeled by a human-curated config.

## Data

MovieLens Latest Dataset (`ml-latest`, full) - see the root
[readme.md](../../readme.md#data) for the dataset link, required
citations, and the GroupLens Usage License terms (acknowledgement,
no-commercial-use-without-permission, etc.) that apply to anyone
standing up their own instance.

Expected under `/data/ml-latest/` by default (overridable via env vars):

- `movies.csv` (`movieId,title,genres`, as downloaded) - **must be
  filtered down first** to only the movies that have Tag Genome data,
  via `tools/filter_metadata_to_artifact.py` (see below); pointing
  `HYPERWHEEL_METADATA_PATH` at the raw, unfiltered `movies.csv` works
  but wastes search time on ~86k movies where the ~13k with genome data
  would do, and surfaces movies that will 404 on `/wheel`.
- `artifact.npz` — pre-built once, by hand, via the engine's CLI:

  ```bash
  python -m hyperwheel_recommender build data/ml-latest/genome-scores.csv \
    --tags-path data/ml-latest/genome-tags.csv \
    --out data/ml-latest/artifact.npz
  ```

  then filter the catalog against it:

  ```bash
  python tools/filter_metadata_to_artifact.py \
    --movies data/ml-latest/movies.original.csv \
    --artifact data/ml-latest/artifact.npz \
    --out data/ml-latest/movies.csv

  export HYPERWHEEL_METADATA_PATH=data/ml-latest/movies.csv
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

- `GET /api/search?q=...&limit=8` — literal (non-fuzzy) search over the
  movie **title only**; `genres` are returned for display but are not
  matched against. Titles are matched with the leading article reordered
  to the front (`"Matrix, The (1999)"` -> `"The Matrix (1999)"`),
  lowercased, depunctuated, and with common stopwords (the/a/an) stripped
  before matching. Results are ranked into tiers rather than by a
  continuous fuzzy score: exact prefix, then word-boundary phrase match,
  then plain substring, then a word-order-agnostic fallback (every query
  token present as a substring, in any order) - see
  `apps/web/backend/app/search.py` for the full tiering rationale. No
  typo tolerance: unlike the previous rapidfuzz-based version, a
  misspelled query will not match.
- `GET /api/movie/{item_id}/recommend?scheme=...` — color-wheel
  recommendations (complementary/triadic/analogous/split-complementary/tetradic),
  computed **independently for each circle** shown on `/wheel` for this
  item. A single `recommend_many_planes` call resolves every circle's own
  axis pair at once (see `docs/math.md` section 6c) — Stage A (character
  shortlist in standardized shape space) and Stage B (angle+radius
  re-rank within that shortlist, see `docs/math.md` section 6b) both run
  fresh per circle; only the one-time reference-relative distance term is
  now shared across circles instead of recomputed per circle. Because PCA
  components are orthogonal, a movie well-rotated on one circle's axes
  says nothing about its position on another circle's axes — so **each
  circle generally returns a different set of top-5 movies**, not the
  same 5 movies re-projected onto different axes (that was the earlier,
  less accurate approach).
  Response shape: `{ item_id, scheme, circles: [...] }`, one entry per
  circle (same `axis_x`/`axis_y`/`primary` as `/wheel`), each carrying
  its own `reference` coordinate and, per scheme angle, its own top-5
  matches (`rank`, `title`, `z_x`/`z_y`, `angle_deg`, `distance_to_target`,
  `angular_error_deg`, `radius_ratio`).
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

For a selected movie, the backend builds **every possible axis pair**
(combination) from the non-excluded components in `pc_config.json` and
ranks them by that item's aggregate z-score across the two axes
(|z_a| + |z_b|, descending). The top-ranked pair - the axes on which the
item is most expressive overall - is the **main circle**; the remaining
pairs fill the **secondary circles**, shown smaller in a column on the
right, in descending order of prominence. Generating all combinations
(C(n,2) circles, e.g. 9 curated axes -> 36) means any axis can participate
in the main circle and can later be swapped by the user to pivot the main
plane, unlike the previous straight ranked partition that used each axis
exactly once.

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

### Recommendations per circle

Unlike the wheel's own point (a single fixed coordinate per circle),
recommendations are re-derived per circle rather than shared across them.
Earlier versions ran the color-wheel search once, on the main circle's
plane only, and projected the resulting 5 movies onto every other
circle's axes for display — cheap, but the projected points landed
essentially at random on secondary circles, since a movie's position on
one PCA plane is uninformative about its position on another orthogonal
plane. A later version fixed the accuracy problem by calling
`recommend_on_basis` once per circle with that circle's own axis pair,
but at C(n,2) circles (e.g. 9 curated axes → 36) that meant redoing the
one expensive full-catalog distance computation once per circle. The
current backend instead calls `recommend_many_planes` once per request
with every circle's axis pair at once (see
`packages/hyperwheel-recommender/docs/math.md` section 6c): the
expensive part of Stage A is shared across all circles algebraically,
and each circle still gets its own independently optimized Stage A/B
result — same accuracy as the per-circle-call version, without paying
for the shared part C(n,2) times.

The left-hand "Recommendations" panel intentionally stays tied to the
**main circle only** (its titles list is not repeated per secondary
circle); the secondary circles still show their own, independently
computed points as overlays with a hover tooltip, they just aren't
duplicated as text in the side panel.

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

- richer recommendation UI over the scheme-based overlays now implemented
  (currently: scheme selector, per-circle independent top-5 lists overlaid
  on each wheel with a hover popup, and a text list for the main circle
  only in the left panel)
