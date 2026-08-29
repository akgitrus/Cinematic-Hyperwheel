import "./WheelPointLabels.css";
import { useMemo, useRef, useState } from "react";
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
  const dimmed = hoveredIndex !== null && !point.reference;
  return radius * (dimmed ? DIMMED_POINT_SCALE : 1);
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

  const referencePoint = useMemo(
    () => points.find((point) => point.reference) ?? null,
    [points]
  );

  const hoveredPoint = hoveredIndex === null
    ? null
    : points.find((point) => point.index === hoveredIndex) ?? null;

  const visiblePoints = useMemo(() => {
    if (!hoveredPoint || hoveredPoint.reference) return [];

    const hoveredRadius = pointRadius(hoveredPoint, hoveredIndex);
    return points
      .filter((point) => {
        if (point.reference || point.index === hoveredPoint.index) return false;
        const distance = distanceBetween(point, hoveredPoint);
        const candidateRadius = pointRadius(point, hoveredIndex);
        const combinedRadius = hoveredRadius + candidateRadius;
        const overlapDistance = combinedRadius * (1 - POINT_HOVER_CLUSTER_OVERLAP);
        return distance <= overlapDistance;
      })
      .sort((a, b) => a.y - b.y);
  }, [hoveredIndex, hoveredPoint, points]);

  if (compact || points.length === 0) return null;

  const setHoveredFromPointer = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const x = ((clientX - rect.left) / rect.width) * GEOMETRY_WRAP;
    const y = ((clientY - rect.top) / rect.height) * GEOMETRY_WRAP;
    const pointerPoint = { x, y };

    if (hoveredPoint) {
      const hoveredRadius = hoveredPoint.reference
        ? 10.5
        : 6;
      if (distanceBetween(pointerPoint, hoveredPoint) <= hoveredRadius + POINT_HOVER_PADDING) {
        return;
      }
    }

    let nearest: Point | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const point of points) {
      const radius = point.reference ? 10.5 : 6;
      const distance = distanceBetween(pointerPoint, point);
      if (distance <= radius + POINT_HOVER_PADDING && distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }

    setHoveredIndex(nearest?.index ?? null);
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
      onMouseMove={(event) => setHoveredFromPointer(event.clientX, event.clientY)}
      onMouseLeave={() => setHoveredIndex(null)}
      style={{ position: "absolute", inset: 0, overflow: "visible", zIndex: 3, pointerEvents: "auto" }}
    >
      {referencePoint && (
        <g key="reference-label" style={{ pointerEvents: "none" }}>
          <text
            x={referencePoint.x + (referencePoint.x + LABEL_GAP + labelWidth(referencePoint.title) <= GEOMETRY_WRAP ? LABEL_GAP : -LABEL_GAP)}
            y={referencePoint.y}
            fill="#ffffff"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize={LABEL_FONT}
            fontWeight={650}
            textAnchor={referencePoint.x + LABEL_GAP + labelWidth(referencePoint.title) <= GEOMETRY_WRAP ? "start" : "end"}
            dominantBaseline="middle"
            className="wheel__point-label-text"
            style={{
              filter: "none",
              pointerEvents: "none",
            }}
          >
            {referencePoint.title}
          </text>
        </g>
      )}

      {visiblePoints.map((point, index) => {
        const side = point.x + LABEL_GAP + labelWidth(point.title) <= GEOMETRY_WRAP ? 1 : -1;
        const textAnchor = side === 1 ? "start" : "end";
        const x = point.x + side * LABEL_GAP;
        const y = point.y - labelOffset + index * LABEL_LINE_HEIGHT;
        const glowColor = "#e8ecf4";

        return (
          <g key={`label-${point.index}`} style={{ pointerEvents: "none" }}>
            <text
              x={x}
              y={y}
              fill="#ffffff"
              fontFamily="Inter, system-ui, sans-serif"
              fontSize={LABEL_FONT}
              fontWeight={450}
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

      {hoveredPoint && (
        <g key={`highlight-${hoveredPoint.index}`}>
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            r={hoveredPoint.reference ? 14 : 11}
            fill="none"
            stroke={hoveredPoint.reference ? "rgba(110, 231, 255, 0.9)" : "rgba(232, 236, 244, 0.75)"}
            strokeWidth={1.5}
            opacity={0.95}
            style={{
              filter: `drop-shadow(0 0 9px ${hoveredPoint.reference ? "#6ee7ff" : "#e8ecf4"})`,
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
              values={hoveredPoint.reference ? "12.5;15;12.5" : "9.5;12;9.5"}
              dur="1.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            r={4.5 * (hoveredPoint.reference ? 1 : DIMMED_POINT_SCALE)}
            fill={hoveredPoint.reference ? "#6ee7ff" : "#e8ecf4"}
            opacity={0.95}
            style={{
              filter: `drop-shadow(0 0 7px ${hoveredPoint.reference ? "#6ee7ff" : "#e8ecf4"})`,
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
      )}
    </svg>
  );
}
