import { useTranslation } from "react-i18next";
import { WheelPoint } from "../api";

interface Props {
  point: WheelPoint | null;
  title?: string;
}

const SIZE = 320;
const CENTER = SIZE / 2;
const MAX_R = SIZE / 2 - 28;
// z-scores are unbounded in principle; clamp to a comfortable display range
const Z_CLAMP = 3;

export default function Wheel({ point, title }: Props) {
  const { t } = useTranslation();
  let x = CENTER;
  let y = CENTER;
  if (point) {
    const zx = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, point.z_x));
    const zy = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, point.z_y));
    // +PC2 (right) = arthouse, +PC3 (down) = dark - matches the axis
    // labels below; screen y grows downward, so +PC3 maps to +y directly.
    x = CENTER + (zx / Z_CLAMP) * MAX_R;
    y = CENTER + (zy / Z_CLAMP) * MAX_R;
  }

  return (
    <div className="wheel">
      <div className="wheel__disc" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={CENTER} cy={CENTER} r={MAX_R} className="wheel__ring" />
          <line x1={CENTER} y1={20} x2={CENTER} y2={SIZE - 20} className="wheel__axis" />
          <line x1={20} y1={CENTER} x2={SIZE - 20} y2={CENTER} className="wheel__axis" />
          {point && (
            <line x1={CENTER} y1={CENTER} x2={x} y2={y} className="wheel__vector" />
          )}
          {point && <circle cx={x} cy={y} r={7} className="wheel__point" />}
        </svg>
        <span className="wheel__label wheel__label--top">{t("wheel.axisLight")}</span>
        <span className="wheel__label wheel__label--bottom">{t("wheel.axisDark")}</span>
        <span className="wheel__label wheel__label--left">{t("wheel.axisBlockbuster")}</span>
        <span className="wheel__label wheel__label--right">{t("wheel.axisArthouse")}</span>
      </div>
      {point && (
        <div className="wheel__readout">
          <div className="wheel__readout-title">{title}</div>
          <div>
            {t("wheel.readout", {
              pcX: point.pc_x,
              zX: point.z_x.toFixed(2),
              pcY: point.pc_y,
              zY: point.z_y.toFixed(2),
            })}
          </div>
          <div>
            {t("wheel.readoutAngle", {
              angle: point.angle_deg.toFixed(1),
              radius: point.radius.toFixed(2),
            })}
          </div>
        </div>
      )}
    </div>
  );
}
