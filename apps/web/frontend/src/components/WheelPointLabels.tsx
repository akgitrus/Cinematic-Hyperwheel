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
const REFERENCE_LABEL_GAP = 6;

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

function pointRadius(point: Point): number {
  return point.reference ? 10.5 : 6;
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function labelWidth(title: string): number {
  return Math.min(LABEL_MAX_WIDTH, title.length * LABEL_FONT * 0.6);
}

function referenceLabelPosition(point: Point, title: string): { x: number; y: number; textAnchor: "middle" | "start" | "end" } {
  const center = GEOMETRY_SIZE / 2 + RING_PAD;
  const dx = point.x - center;
  const dy = point.y - center;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return { x: point.x + LABEL_GAP, y: point.y, textAnchor: "start" };
  }

  const nx = -dy / length;
  const ny = dx / length;
  const halfWidth = labelWidth(title) / 2;
  const halfHeight = LABEL_FONT / 2;
  const offset = Math.abs(nx) * halfWidth + Math.abs(ny) * halfHeight + REFERENCE_LABEL_GAP;
  const candidates = [
    { x: point.x + nx * offset, y: point.y + ny * offset },
    { x: point.x - nx * offset, y: point.y - ny * offset },
  ];
  const overflow = (candidate: { x: number; y: number }) =>
    Math.max(0, halfWidth - candidate.x) +
    Math.max(0, candidate.x + halfWidth - GEOMETRY_WRAP) +
    Math.max(0, halfHeight - candidate.y) +
    Math.max(0, candidate.y + halfHeight - GEOMETRY_WRAP);
  const candidate = overflow(candidates[0]) <= overflow(candidates[1]) ? candidates[0] : candidates[1];

  return { x: candidate.x, y: candidate.y, textAnchor: "middle" };
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

    return points
      .filter((point) => {
        if (point.reference) return false;
        if (point.index === hoveredPoint.index) return true;

        const hoveredRadius = pointRadius(hoveredPoint);
        const candidateRadius = pointRadius(point) * DIMMED_POINT_SCALE;
        const combinedRadius = hoveredRadius + candidateRadius;
        const overlapDistance = combinedRadius * (1 - POINT_HOVER_CLUSTER_OVERLAP);
        return distanceBetween(point, hoveredPoint) <= overlapDistance;
      })
      .sort((a, b) => a.y - b.y);
  }, [hoveredPoint, points]);

  useEffect(() => {
    const stage = svgRef.current?.parentElement;
    if (!stage) return;

    const activeIndexes = new Set(
      visiblePoints.map((point) => point.index - (title ? 1 : 0))
    );
    const allPoints = stage.querySelectorAll<SVGCircleElement>(".wheel__rec-point");

    allPoints.forEach((point, index) => {
      const active = hoveredPoint !== null && !hoveredPoint.reference && activeIndexes.has(index);
      point.style.opacity = hoveredPoint === null || active ? "" : String(DIMMED_POINT_OPACITY);
      point.style.transform = hoveredPoint === null ? "" : `scale(${DIMMED_POINT_SCALE})`;
    });

    return () => {
      allPoints.forEach((point) => {
        point.style.opacity = "";
        point.style.transform = "";
      });
    };
  }, [hoveredPoint, title, visiblePoints]);

  if (compact || points.length === 0) return null;

  const setHoveredFromPointer = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const pointerPoint = {
      x: ((clientX - rect.left) / rect.width) * GEOMETRY_WRAP,
      y: ((clientY - rect.top) / rect.height) * GEOMETRY_WRAP,
    };

    if (hoveredPoint) {
      const hoveredRadius = pointRadius(hoveredPoint);
      if (distanceBetween(pointerPoint, hoveredPoint) <= hoveredRadius + POINT_HOVER_PADDING) {
        return;
      }
    }

    let nearest: Point | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const point of points) {
      const radius = pointRadius(point);
      const distance = distanceBetween(pointerPoint, point);
      if (distance <= radius + POINT_HOVER_PADDING && distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }

    setHoveredIndex(nearest?.index ?? null);
  };

  const referenceLabel = referencePoint
    ? referenceLabelPosition(referencePoint, referencePoint.title)
    : null;
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
      {referencePoint && referenceLabel && (
        <g key="reference-label" style={{ pointerEvents: "none" }}>
          <text
            x={referenceLabel.x}
            y={referenceLabel.y}
            fill="#ffffff"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize={LABEL_FONT}
            fontWeight={650}
            textAnchor={referenceLabel.textAnchor}
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
                filter: "drop-shadow(0 0 7px #e8ecf4)",
                pointerEvents: "none",
              }}
            >
              {point.title}
            </text>
          </g>
        );
      })}

      {hoveredPoint && !hoveredPoint.reference && (
        <g key={`highlight-${hoveredPoint.index}`}>
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            r={9.5}
            fill="none"
            stroke="rgba(232, 236, 244, 0.75)"
            strokeWidth={1.5}
            opacity={0.95}
            style={{
              filter: "drop-shadow(0 0 9px #e8ecf4)",
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
              values="9.5;12;9.5"
              dur="1.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            r={4.5 * DIMMED_POINT_SCALE}
            fill="#e8ecf4"
            opacity={0.95}
            style={{
              filter: "drop-shadow(0 0 7px #e8ecf4)",
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
