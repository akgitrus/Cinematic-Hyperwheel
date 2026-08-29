import "./WheelPointLabels.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { RecAngle, WheelCircle } from "../api";

interface Props {
  circle: WheelCircle;
  size: number;
  title?: string;
  overlays?: RecAngle[];
}

interface Point {
  x: number;
  y: number;
  title: string;
  reference: boolean;
  index: number;
}

const Z_CLAMP = 3;
const GEOMETRY_SIZE = 460;
const RING_PAD = 36;
const GEOMETRY_WRAP = GEOMETRY_SIZE + RING_PAD * 2;
const LABEL_GAP = 10;
const LABEL_FONT = 10;
const LABEL_LINE_HEIGHT = 15;
const LABEL_MAX_WIDTH = 250;
const POINT_HOVER_PADDING = 0;
const POINT_HOVER_CLUSTER_OVERLAP = 0.8;
const DIMMED_POINT_OPACITY = 0.24;
const DIMMED_POINT_SCALE = 0.35;

function pointPosition(zx: number, zy: number): { x: number; y: number } {
  const center = GEOMETRY_SIZE / 2 + RING_PAD;
  const maxR = GEOMETRY_SIZE / 2 - 28;
  const radius = Math.hypot(zx, zy);
  const scale = radius > Z_CLAMP ? Z_CLAMP / radius : 1;
  return {
    x: center + ((zx * scale) / Z_CLAMP) * maxR,
    y: center + ((zy * scale) / Z_CLAMP) * maxR,
  };
}

function pointRadius(point: Point, hoveredIndex: number | null): number {
  const radius = point.reference ? 10.5 : 6;
  const dimmed = hoveredIndex !== null && point.index !== hoveredIndex;
  return radius * (dimmed ? DIMMED_POINT_SCALE : 1);
}

function hitRadius(point: Point, hoveredIndex: number | null): number {
  const radius = point.reference ? 10.5 : 6;
  const dimmed = hoveredIndex !== null && !point.reference && point.index !== hoveredIndex;
  return radius * (dimmed ? DIMMED_POINT_SCALE : 1) + POINT_HOVER_PADDING;
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function labelWidth(title: string): number {
  return Math.min(LABEL_MAX_WIDTH, title.length * LABEL_FONT * 0.6);
}

export default function WheelPointLabels({ circle, size, title, overlays = [] }: Props) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const compact = size < 220;
  const displayWrap = size + RING_PAD * 2;

  const points = useMemo<Point[]>(() => {
    if (compact) return [];

    const result: Point[] = [];
    let index = 0;
    if (title) {
      const position = pointPosition(circle.z_x, circle.z_y);
      result.push({ x: position.x, y: position.y, title, reference: true, index: index++ });
    }

    for (const angle of overlays) {
      for (const item of angle.items) {
        const position = pointPosition(item.z_x, item.z_y);
        result.push({ x: position.x, y: position.y, title: item.title, reference: false, index: index++ });
      }
    }
    return result;
  }, [circle, compact, overlays, title]);

  const hoveredPoint = hoveredIndex === null
    ? null
    : points.find((point) => point.index === hoveredIndex) ?? null;

  const visiblePoints = useMemo(() => {
    if (!hoveredPoint) return points.filter((point) => point.reference);

    const hoveredRadius = pointRadius(hoveredPoint, hoveredIndex);
    return points
      .filter((point) => {
        if (point.reference) return true;
        if (point.index === hoveredPoint.index) return true;
        const distance = distanceBetween(point, hoveredPoint);
        const candidateRadius = pointRadius(point, hoveredIndex);
        const combinedRadius = hoveredRadius + candidateRadius;
        const overlapDistance = combinedRadius * (1 - POINT_HOVER_CLUSTER_OVERLAP);
        return distance <= overlapDistance;
      })
      .sort((a, b) => a.y - b.y);
  }, [hoveredIndex, hoveredPoint, points]);

  useEffect(() => {
    const stage = svgRef.current?.parentElement;
    if (!stage) return;

    const activeIndexes = new Set(visiblePoints.map((point) => point.index));
    const allPoints = stage.querySelectorAll<SVGCircleElement>(".wheel__point, .wheel__rec-point");

    allPoints.forEach((point, index) => {
      const active = hoveredIndex !== null && activeIndexes.has(index);
      const referencePoint = index === 0 && title;
      point.style.opacity = hoveredIndex === null || active || referencePoint ? "" : String(DIMMED_POINT_OPACITY);
      point.style.transform = !referencePoint && hoveredIndex !== null && !active ? `scale(${DIMMED_POINT_SCALE})` : "";
    });

    return () => {
      allPoints.forEach((point) => {
        point.style.opacity = "";
        point.style.transform = "";
      });
    };
  }, [hoveredIndex, title, visiblePoints]);

  if (compact || points.length === 0) return null;

  const setHovered = (index: number | null) => {
    setHoveredIndex(index);
  };

  const labelOffset = visiblePoints.length > 1
    ? ((visiblePoints.length - 1) * LABEL_LINE_HEIGHT) / 2
    : 0;

  return (
    <svg
      ref={svgRef}
      className="wheel__point-labels"
      viewBox={`0 0 ${GEOMETRY_WRAP} ${GEOMETRY_WRAP}`}
      width={displayWrap}
      height={displayWrap}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, overflow: "visible", zIndex: 3, pointerEvents: "none" }}
    >
      {points.map((point) => (
        <circle
          key={`hit-${point.index}`}
          cx={point.x}
          cy={point.y}
          r={hitRadius(point, hoveredIndex)}
          fill="transparent"
          stroke="none"
          style={{ pointerEvents: "auto", cursor: "default" }}
          onMouseEnter={() => setHovered(point.index)}
          onMouseLeave={() => setHovered(null)}
        />
      ))}

      {visiblePoints.map((point, index) => {
        const side = point.x + LABEL_GAP + labelWidth(point.title) <= GEOMETRY_WRAP ? 1 : -1;
        const textAnchor = side === 1 ? "start" : "end";
        const x = point.x + side * LABEL_GAP;
        const y = point.y - labelOffset + index * LABEL_LINE_HEIGHT;
        const glowColor = point.reference ? "#6ee7ff" : "#e8ecf4";

        return (
          <g key={`label-${point.index}`} style={{ pointerEvents: "none" }}>
            <text
              x={x}
              y={y}
              fill="#ffffff"
              fontFamily="Inter, system-ui, sans-serif"
              fontSize={LABEL_FONT}
              fontWeight={point.reference ? 650 : 450}
              textAnchor={textAnchor}
              dominantBaseline="middle"
              className="wheel__point-label-text"
              style={{
                filter: `drop-shadow(0 0 7px ${glowColor})`,
                pointerEvents: "none",
              }}
            >
              {point.title}
            </text>
          </g>
        );
      })}

      {visiblePoints.map((point) => {
        const hovered = point.index === hoveredIndex;
        const glowColor = point.reference ? "#6ee7ff" : "#e8ecf4";
        return (
          <g key={`highlight-${point.index}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r={point.reference ? 14 : 11}
              fill="none"
              stroke={point.reference ? "rgba(110, 231, 255, 0.9)" : "rgba(232, 236, 244, 0.75)"}
              strokeWidth={1.5}
              opacity={hovered ? 0.95 : 0.75}
              style={{
                filter: `drop-shadow(0 0 9px ${glowColor})`,
                pointerEvents: "none",
              }}
            >
              <animate
                attributeName="opacity"
                values="0.65;1;0.65"
                dur="1.4s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="r"
                values={point.reference ? "12.5;15;12.5" : "9.5;12;9.5"}
                dur="1.4s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx={point.x}
              cy={point.y}
              r={4.5 * DIMMED_POINT_SCALE}
              fill={point.reference ? "#6ee7ff" : "#e8ecf4"}
              opacity={hovered ? 0.95 : 0.75}
              style={{
                filter: `drop-shadow(0 0 7px ${glowColor})`,
                pointerEvents: "none",
              }}
            >
              <animate
                attributeName="opacity"
                values="0.65;1;0.65"
                dur="1.4s"
                repeatCount="indefinite"
              />
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
