import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RecAngle, WheelCircle } from "../api";
import { colorOnWheel } from "../utils/color";

interface Props {
  circle: WheelCircle;
  size?: number;
  title?: string;
  /** Optional recommendation overlay points (one per scheme angle). */
  overlays?: RecAngle[];
}

// z-scores are unbounded in principle; clamp to a comfortable display range
const Z_CLAMP = 3;
// below this disc size, skip the four pole-label strings around the disc
// (no room to render them legibly) - full labels are still available as
// a native tooltip on hover
const COMPACT_BELOW = 220;
// Extra page-background margin around the wheel, so the single pole-label
// ring sits OUTSIDE the disc's coloured gradient (radius = size/2).
// Otherwise the curved labels would overlap the "mood" conic gradient and
// blend with it. Compact wheels use a smaller fixed margin because their
// ring labels are shortened to a single "/" segment.
const RING_PAD = 36;

// Ring geometry for the main (non-compact) wheel: all four pole labels
// (axis X negative/positive, axis Y negative/positive) sit on a single ring
// curving around the circle, so the text follows a radius around it instead
// of sitting on straight lines. SVG uses a down-right (+y down) coordinate
// space; angles are measured clockwise from the +x (right).
const HALF_PI = Math.PI / 2;
// Labels sit on arcs of the ring, each sized from the label's measured pixel
// width so the text is never clipped at the arc ends. The cap stays generous:
// on hover the full text is drawn on the same ring and may overlap the
// neighbouring labels while it has focus (that's intentional).
const MAX_HALF_ANGLE = (150 * Math.PI) / 180;

// Approximate the on-screen pixel width of a label (uppercase, with the
// rings' 0.06em letter-spacing) so we can size the host arc correctly.
function measureTextWidth(text: string, fontPx: number): number {
  const spaced = (text.length - 1) * fontPx * 0.06;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = `${fontPx}px Inter, system-ui, sans-serif`;
      return ctx.measureText(text.toUpperCase()).width + spaced;
    }
  }
  return text.length * fontPx * 0.72 + spaced;
}

// Half-angular sweep that guarantees the full label fits on a ring of
// radius r (with a 25% safety margin), capped by MAX_HALF_ANGLE.
function labelArcHalf(r: number, text: string, fontPx: number): number {
  const width = measureTextWidth(text, fontPx);
  return Math.min((width * 1.25) / 2 / r, MAX_HALF_ANGLE);
}

function ringArcPath(
  center: number,
  r: number,
  a0: number,
  a1: number,
  sweep: 0 | 1
): string {
  const s = `${center + r * Math.cos(a0)},${center + r * Math.sin(a0)}`;
  const e = `${center + r * Math.cos(a1)},${center + r * Math.sin(a1)}`;
  return `M ${s} A ${r} ${r} 0 0 ${sweep} ${e}`;
}

// For the small (compact) rings we only draw the first "/" segment of a
// label ("Wilderness / travel ..." -> "Wilderness") so it fits the tiny disc.
function shortLabel(text: string): string {
  const cut = text.indexOf("/");
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

export default function Wheel({ circle, size = 320, title, overlays = [] }: Props) {
  const { t, i18n } = useTranslation();
  const [activeLabel, setActiveLabel] = useState<null | string>(null);
  const [activeOverlay, setActiveOverlay] = useState<number | null>(null);
  const compact = size < COMPACT_BELOW;
  const halfBox = size / 2;
  const pad = compact ? 20 : RING_PAD;
  const wrap = size + pad * 2;
  const center = wrap / 2;
  const discOffset = pad;
  const maxR = halfBox - (compact ? 10 : 28);

  // A single label ring curving around and OUTSIDE the disc (radius >
  // halfBox, on the page background, so it never sits over the coloured
  // gradient). All four pole labels share this one radius: axis X negative
  // left / positive right, axis Y negative top / positive bottom. On the
  // compact (secondary) wheels the ring uses a shorter radius and shortened
  // labels (first "/" segment) so they fit the small disc.
  const ringR = halfBox + (compact ? 8 : 16);
  const pid = `${circle.axis_x.pc}-${circle.axis_y.pc}`;
  const idXNeg = `ring-${pid}-xneg`;
  const idXPos = `ring-${pid}-xpos`;
  const idYNeg = `ring-${pid}-yneg`;
  const idYPos = `ring-${pid}-ypos`;
  const lang = i18n.resolvedLanguage ?? "en";
  const labelsX = circle.axis_x.labels[lang] ?? circle.axis_x.labels.en;
  const labelsY = circle.axis_y.labels[lang] ?? circle.axis_y.labels.en;

  // What is actually drawn on the ring: the full label on the main wheel, the
  // first "/" segment (trimmed) on the compact wheels.
  const gXNeg = compact ? shortLabel(labelsX.negative) : labelsX.negative;
  const gXPos = compact ? shortLabel(labelsX.positive) : labelsX.positive;
  const gYNeg = compact ? shortLabel(labelsY.negative) : labelsY.negative;
  const gYPos = compact ? shortLabel(labelsY.positive) : labelsY.positive;

  // Size each label's host arc from its measured width so long labels are
  // never clipped at the arc ends (fixed tiny arcs used to cut text off).
  const fontPx = 9;
  // Arcs are sized to the FULL label so the hovered (expanded) text fits.
  const hTop = labelArcHalf(ringR, labelsY.negative, fontPx);
  const hBottom = labelArcHalf(ringR, labelsY.positive, fontPx);
  const hRight = labelArcHalf(ringR, labelsX.positive, fontPx);
  const hLeft = labelArcHalf(ringR, labelsX.negative, fontPx);
  // Left (negative) reads bottom->top, right (positive) top->bottom.
  const dXNeg = ringArcPath(center, ringR, Math.PI - hLeft, Math.PI + hLeft, 1);
  const dXPos = ringArcPath(center, ringR, -hRight, hRight, 1);
  // Top (negative) reads left->right, bottom (positive) left->right.
  const dYNeg = ringArcPath(center, ringR, -HALF_PI - hTop, -HALF_PI + hTop, 1);
  const dYPos = ringArcPath(center, ringR, HALF_PI + hBottom, HALF_PI - hBottom, 0);

  // Clamp by VECTOR MAGNITUDE, not per-axis - clamping z_x and z_y
  // independently would let a point near the diagonal (both axes close
  // to the clamp) land in the corner of the surrounding square, whose
  // diagonal (maxR*sqrt(2)) is longer than the disc's radius (maxR) -
  // i.e. visibly outside the ring. Scaling the whole vector keeps it on
  // or inside the circle.
  const rawR = Math.hypot(circle.z_x, circle.z_y);
  const scale = rawR > Z_CLAMP ? Z_CLAMP / rawR : 1;
  const zx = circle.z_x * scale;
  const zy = circle.z_y * scale;

  // +x (right) = axis_x positive pole, +y (down) = axis_y positive pole -
  // screen y grows downward, so +z_y maps to +y directly.
  const x = center + (zx / Z_CLAMP) * maxR;
  const y = center + (zy / Z_CLAMP) * maxR;

  // Point color: same 4-stop interpolation as the disc's background, at
  // this point's own compass bearing - so the marker always reads as
  // "part of" the wheel under it rather than a generic white dot.
  // atan2(dx, -dy): dx = zx (screen-right), -dy = zy negated (screen "up")
  // so 0deg = top/north, increasing clockwise - matches the CSS
  // conic-gradient(from 0deg, ...) orientation used for the disc.
  const bearingDeg = (Math.atan2(zx, -zy) * 180) / Math.PI;
  const pointColor = colorOnWheel(
    bearingDeg,
    circle.axis_x.colors.positive,
    circle.axis_x.colors.negative,
    circle.axis_y.colors.positive,
    circle.axis_y.colors.negative
  );

  // Glow grows with how far the item's UNCLAMPED vector reaches - a
  // point sitting right on the ring because it got clamped (a strong
  // outlier) reads as visually "hotter" than one that naturally landed
  // near the edge with a small radius.
  const glowBase = compact ? 3 : 5;
  const glowScale = compact ? 3 : 6;
  const glowPx = glowBase + Math.min(rawR, 5) * glowScale;

  // Recommendation overlay points - one per recommendation item (all top-k
  // per scheme angle), drawn on the same disc with the same vector-magnitude
  // clamp as the reference point.
  const recPoints = overlays.flatMap((o) =>
    o.items.map((it) => {
      const rr = Math.hypot(it.z_x, it.z_y);
      const rs = rr > Z_CLAMP ? Z_CLAMP / rr : 1;
      return {
        cx: center + ((it.z_x * rs) / Z_CLAMP) * maxR,
        cy: center + ((it.z_y * rs) / Z_CLAMP) * maxR,
        angle: o.angle_deg,
        item: it,
      };
    })
  );

  const gradient =
    `conic-gradient(from 0deg,` +
    `${circle.axis_y.colors.negative} 0deg,` +
    `${circle.axis_x.colors.positive} 90deg,` +
    `${circle.axis_y.colors.positive} 180deg,` +
    `${circle.axis_x.colors.negative} 270deg,` +
    `${circle.axis_y.colors.negative} 360deg)`;

  return (
    <div className={"wheel" + (compact ? " wheel--compact" : "")}>
      <div className="wheel__stage" style={{ width: wrap, height: wrap }}>
        <div
          className="wheel__disc"
          style={{
            width: size,
            height: size,
            left: discOffset,
            top: discOffset,
            background: gradient,
          }}
        />
        <svg width={wrap} height={wrap} viewBox={`0 0 ${wrap} ${wrap}`}>
          <circle cx={center} cy={center} r={maxR} className="wheel__ring" />
          <line
            x1={center} y1={center - maxR + 4}
            x2={center} y2={center + maxR - 4}
            className="wheel__axis"
          />
          <line
            x1={center - maxR + 4} y1={center}
            x2={center + maxR - 4} y2={center}
            className="wheel__axis"
          />
          <line x1={center} y1={center} x2={x} y2={y} className="wheel__vector" />
          <circle
            cx={x} cy={y}
            r={compact ? 4 : 7}
            className="wheel__point"
            fill={pointColor}
            style={{ filter: `drop-shadow(0 0 ${glowPx}px ${pointColor})` }}
          />
          <g className="wheel__rings">
            <defs>
              <path id={idYNeg} d={dYNeg} />
              <path id={idYPos} d={dYPos} />
              <path id={idXNeg} d={dXNeg} />
              <path id={idXPos} d={dXPos} />
            </defs>
            <text
              className={"wheel__ring-text" + (activeLabel === "yneg" ? " wheel__ring-text--active" : "")}
              onMouseEnter={() => setActiveLabel("yneg")}
              onMouseLeave={() => setActiveLabel(null)}
            >
              <textPath href={`#${idYNeg}`} startOffset="50%" textAnchor="middle">
                {activeLabel === "yneg" ? labelsY.negative : gYNeg}
              </textPath>
            </text>
            <text
              className={"wheel__ring-text" + (activeLabel === "ypos" ? " wheel__ring-text--active" : "")}
              onMouseEnter={() => setActiveLabel("ypos")}
              onMouseLeave={() => setActiveLabel(null)}
            >
              <textPath href={`#${idYPos}`} startOffset="50%" textAnchor="middle">
                {activeLabel === "ypos" ? labelsY.positive : gYPos}
              </textPath>
            </text>
            <text
              className={"wheel__ring-text" + (activeLabel === "xneg" ? " wheel__ring-text--active" : "")}
              onMouseEnter={() => setActiveLabel("xneg")}
              onMouseLeave={() => setActiveLabel(null)}
            >
              <textPath href={`#${idXNeg}`} startOffset="50%" textAnchor="middle">
                {activeLabel === "xneg" ? labelsX.negative : gXNeg}
              </textPath>
            </text>
            <text
              className={"wheel__ring-text" + (activeLabel === "xpos" ? " wheel__ring-text--active" : "")}
              onMouseEnter={() => setActiveLabel("xpos")}
              onMouseLeave={() => setActiveLabel(null)}
            >
              <textPath href={`#${idXPos}`} startOffset="50%" textAnchor="middle">
                {activeLabel === "xpos" ? labelsX.positive : gXPos}
              </textPath>
            </text>
          </g>
          {recPoints.map((p, i) => (
            <circle
              key={`${p.item.item_id}-${i}`}
              cx={p.cx}
              cy={p.cy}
              r={compact ? 5 : 8}
              className="wheel__rec-point"
              onMouseEnter={() => setActiveOverlay(i)}
              onMouseLeave={() => setActiveOverlay(null)}
            />
          ))}
        </svg>
        {activeOverlay !== null && recPoints[activeOverlay] && (
          <div
            className="wheel__rec-popup"
            style={{ left: recPoints[activeOverlay].cx + 12, top: recPoints[activeOverlay].cy }}
          >
            <div className="wheel__rec-popup-title">
              Angle {recPoints[activeOverlay].angle}? ? #{recPoints[activeOverlay].item.rank}
            </div>
            <div className="wheel__rec-popup-row">{recPoints[activeOverlay].item.title}</div>
          </div>
        )}
      </div>
      <div className="wheel__readout">
        {!compact && title && <div className="wheel__readout-title">{title}</div>}
        <div className="wheel__readout-axis">
          PC{circle.axis_x.pc}/PC{circle.axis_y.pc}
        </div>
        {!compact && (
          <>
            <div>
              {t("wheel.readout", {
                pcX: circle.axis_x.pc,
                zX: circle.z_x.toFixed(2),
                pcY: circle.axis_y.pc,
                zY: circle.z_y.toFixed(2),
              })}
            </div>
            <div>
              {t("wheel.readoutAngle", {
                angle: circle.angle_deg.toFixed(1),
                radius: circle.radius.toFixed(2),
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
