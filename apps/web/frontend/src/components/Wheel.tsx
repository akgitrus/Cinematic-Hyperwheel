import { useTranslation } from "react-i18next";
import { WheelCircle } from "../api";

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

export default function Wheel({ circle, size = 320, title }: Props) {
  const { t, i18n } = useTranslation();
  const compact = size < COMPACT_BELOW;
  const center = size / 2;
  const maxR = size / 2 - (compact ? 10 : 28);

  const lang = i18n.resolvedLanguage ?? "en";
  const labelsX = circle.axis_x.labels[lang] ?? circle.axis_x.labels.en;
  const labelsY = circle.axis_y.labels[lang] ?? circle.axis_y.labels.en;

  const zx = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, circle.z_x));
  const zy = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, circle.z_y));
  // +x (right) = axis_x positive pole, +y (down) = axis_y positive pole -
  // screen y grows downward, so +z_y maps to +y directly.
  const x = center + (zx / Z_CLAMP) * maxR;
  const y = center + (zy / Z_CLAMP) * maxR;

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
      <div className="wheel__disc" style={{ width: size, height: size, background: gradient }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
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
          <circle cx={x} cy={y} r={compact ? 4 : 7} className="wheel__point" />
        </svg>
        {!compact && (
          <>
            <span className="wheel__label wheel__label--top">{labelsY.negative}</span>
            <span className="wheel__label wheel__label--bottom">{labelsY.positive}</span>
            <span className="wheel__label wheel__label--left">{labelsX.negative}</span>
            <span className="wheel__label wheel__label--right">{labelsX.positive}</span>
          </>
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
