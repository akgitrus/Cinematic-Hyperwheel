# Brand assets

Source files for the Cinematic Hyperwheel mark: a cluster of color-wheel
points on a curved stem, echoing the app's own reference-point-plus-
recommendations visual (a movie's vector on the wheel, surrounded by its
recommended points).

## Files in this folder

### `logo-mark.svg`
Primary icon mark. Transparent background, fully vector. Use wherever the
surrounding surface is already dark (site header, docs, slide decks) —
icon only, no name attached.

### `logo-lockup.svg`
Icon + "Cinematic Hyperwheel" + tagline, laid out for a header or footer.
Transparent background; the text color is fixed light (`#e8ecf4` title,
`#8891a7` tagline) for the site's dark theme — don't place it on a light
background as-is.

### `logo-lockup-on-dark.png` (1080×220)
Flattened PNG preview of `logo-lockup.svg`, composited on the site's
actual background color. Use this wherever live SVG text isn't practical
(a GitHub README header, a social share preview), or just to check how
the lockup reads before embedding the SVG.

### `logo-mark-512.png` (512×512, transparent)
Flattened PNG render of the mark alone, for the same "no live SVG" cases
as above.

## Favicon & app icons

Generated from the same mark, simplified (thicker stem, fewer/larger
points) for legibility at tab size, on a dark rounded tile so it reads
against any browser chrome color.

These live in `apps/web/frontend/public/`, not in this folder — Vite only
serves static assets from that directory, so a copy here would just be a
second source of truth to keep in sync by hand. They're referenced from
`apps/web/frontend/index.html`:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
```

| File | Size | Purpose |
|---|---|---|
| `favicon.svg` | vector | Modern browsers; crisp at any zoom |
| `favicon.ico` | 16/32/48 px, multi-resolution | Fallback for browsers without SVG favicon support |
| `apple-touch-icon-180.png` | 180×180 | iOS home-screen icon |
| `icon-512.png` | 512×512 | PWA manifest / large app icon |

## Palette

Colors used across the mark, kept here so a future asset (a new icon, a
loading state, a social banner) can match it without re-eyeballing hex
values from a PNG.

| Swatch | Hex | Used for |
|---|---|---|
| Coral-orange | `#E8622E` | central point |
| Purple | `#7A6BC2` | upper-left point |
| Cyan | `#3FC1E6` | the two smaller points |
| Amber | `#F0B93A` | right-hand point |
| Stem gray | `#9aa3b5` | wand/stem stroke |
| Stem gray (dot) | `#8891a7` | base anchor point |
| Background tile | `#0a0d14` | favicon backdrop; matches `--bg` in `index.css` |

Note: this is a distinct, slightly brighter palette than the per-PC-axis
colors in `apps/web/backend/app/pc_config.json` — the brand mark doesn't
represent any specific axis pair, so it isn't tied to that config and is
free to evolve independently of it.

## Source notes

Built as flat SVG — no filters or blur, for reliable rasterization —
plus one radial gradient for the soft glow behind the central point.
Rasterized with `cairosvg`; `favicon.ico` assembled from three PNG sizes
with Pillow.
