import { useTranslation } from "react-i18next";
import { WheelCircle } from "../api";
import { colorOnWheel } from "../utils/color";

interface Props {
  circle: WheelCircle;
  size?: number;
  title?: string;
}

// z-scores are unbounded in principle; clamp to a comfortable display range
const Z_CLAMP = 3;
// below this disc size, skip the four pole-label strings around the disc
// (no room to render them legibly) - full labels are still available as
// a native tooltip on hover
const COMPACT_BELOW = 220;
// Extra page-background margin around the non-compact wheel, so the two
// pole-label rings sit OUTSIDE the disc's coloured gradient (radius =
// size/2). Otherwise the curved labels would overlap the "mood" conic
// gradient and blend with it. Compact wheels have no rings and no margin.
const RING_PAD = 36;

// Ring geometry for the main (non-compact) wheel: all four pole labels
// (axis X negative/positive, axis Y negative/positive) sit on a single ring
// curving around the circle, so the text follows a radius around it instead
// of sitting on straight lines. SVG uses a down-right (+y down) coordinate
// space; angles are measured clockwise from the +x (right).
const HALF_PI = Math.PI / 2;
// Labels sit on arcs of the two rings; each arc is sized from the label's
// measured pixel width so the text is never clipped at the arc ends. The
// half-angular sweep is capped so a label can't stray toward the adjacent pole.
const MAX_HALF_ANGLE = (45 * Math.PI) / 180;

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

export default function Wheel({ circle, size = 320, title }: Props) {
  const { t, i18n } = useTranslation();
  const compact = size < COMPACT_BELOW;
  const halfBox = size / 2;
  const pad = compact ? 0 : RING_PAD;
  const wrap = size + pad * 2;
  const center = wrap / 2;
  const discOffset = pad;
  const maxR = halfBox - (compact ? 10 : 28);

  // Main wheel only: a single label ring curving around and OUTSIDE the disc
  // (radius > halfBox, on the page background, so it never sits over the
  // coloured gradient). All four pole labels share this one radius: axis X
  // negative left / positive right, axis Y negative top / positive bottom.
  // Compact wheels skip the ring and rely on the readout legend + tooltip.
  const ringR = halfBox + 16;
  const pid = `${circle.axis_x.pc}-${circle.axis_y.pc}`;
  const idXNeg = `ring-${pid}-xneg`;
  const idXPos = `ring-${pid}-xpos`;
  const idYNeg = `ring-${pid}-yneg`;
  const idYPos = `ring-${pid}-ypos`;
  const lang = i18n.resolvedLanguage ?? "en";
  const labelsX = circle.axis_x.labels[lang] ?? circle.axis_x.labels.en;
  const labelsY = circle.axis_y.labels[lang] ?? circle.axis_y.labels.en;

  // Size each label's host arc from its measured width so long labels are
  // never clipped at the arc ends (fixed tiny arcs used to cut text off).
  const fontPx = 9;
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

  const gradient =
    `conic-gradient(from 0deg,` +
    `${circle.axis_y.colors.negative} 0deg,` +
    `${circle.axis_x.colors.positive} 90deg,` +
    `${circle.axis_y.colors.positive} 180deg,` +
    `${circle.axis_x.colors.negative} 270deg,` +
    `${circle.axis_y.colors.negative} 360deg)`;

  const hint =
    `${labelsX.axis}: ${labelsX.negative} \u2194 ${labelsX.positive}  |  ` +
    `${labelsY.axis}: ${labelsY.negative} \u2194 ${labelsY.positive}`;

  return (
    <div className={"wheel" + (compact ? " wheel--compact" : "")} title={hint}>
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
          {!compact && (
            <g className="wheel__rings">
              <defs>
                <path id={idYNeg} d={dYNeg} />
                <path id={idYPos} d={dYPos} />
                <path id={idXNeg} d={dXNeg} />
                <path id={idXPos} d={dXPos} />
              </defs>
              <text className="wheel__ring-text">
                <textPath href={`#${idYNeg}`} startOffset="50%" textAnchor="middle">
                  {labelsY.negative}
                </textPath>
              </text>
              <text className="wheel__ring-text">
                <textPath href={`#${idYPos}`} startOffset="50%" textAnchor="middle">
                  {labelsY.positive}
                </textPath>
              </text>
              <text className="wheel__ring-text">
                <textPath href={`#${idXNeg}`} startOffset="50%" textAnchor="middle">
                  {labelsX.negative}
                </textPath>
              </text>
              <text className="wheel__ring-text">
                <textPath href={`#${idXPos}`} startOffset="50%" textAnchor="middle">
                  {labelsX.positive}
                </textPath>
              </text>
            </g>
          )}
        </svg>
      </div>
      <div className="wheel__readout">
        {!compact && title && <div className="wheel__readout-title">{title}</div>}
        <div className="wheel__readout-axis">
          PC{circle.axis_x.pc}/PC{circle.axis_y.pc}
        </div>
        {compact ? (
          <div className="wheel__readout-legend">
            <div className="wheel__readout-legend-row">
              <span className="wheel__readout-axis-name">{labelsX.axis}</span>
              <span className="wheel__readout-pole">{labelsX.negative}</span>
              <span className="wheel__readout-arrow">\u2194</span>
              <span className="wheel__readout-pole">{labelsX.positive}</span>
            </div>
            <div className="wheel__readout-legend-row">
              <span className="wheel__readout-axis-name">{labelsY.axis}</span>
              <span className="wheel__readout-pole">{labelsY.negative}</span>
              <span className="wheel__readout-arrow">\u2194</span>
              <span className="wheel__readout-pole">{labelsY.positive}</span>
            </div>
          </div>
        ) : (
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
