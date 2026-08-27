import "./WheelPointLabels.css";
import { useMemo, useState } from "react";
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

interface Candidate {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

interface Placement extends Point, Candidate {}

const Z_CLAMP = 3;
const GEOMETRY_SIZE = 460;
const RING_PAD = 36;
const GEOMETRY_WRAP = GEOMETRY_SIZE + RING_PAD * 2;
const LABEL_GAP = 8;
const LABEL_FONT = 10;
const LABEL_PAD_X = 5;
const LABEL_PAD_Y = 3;
const LABEL_MAX_WIDTH = 250;
const POINT_EXCLUSION = 9;
const OVERLAP_WEIGHT = 1000;
const BOUNDARY_WEIGHT = 500;
const POINT_WEIGHT = 250;
const DISTANCE_WEIGHT = 0.8;
const RADIAL_WEIGHT = 12;

const DIRECTIONS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 16;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;
  }
  return measureCtx;
}

function measureTextWidth(text: string): number {
  const ctx = getMeasureCtx();
  if (ctx) {
    ctx.font = `${LABEL_FONT}px Inter, system-ui, sans-serif`;
    return ctx.measureText(text).width;
  }
  return text.length * LABEL_FONT * 0.55;
}

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

function overlapArea(a: Candidate | Placement, b: Candidate | Placement): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function distanceToRect(x: number, y: number, rect: Candidate | Placement): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function boundaryOverflow(candidate: Candidate, width: number, height: number): number {
  return (
    Math.max(0, -candidate.x) +
    Math.max(0, -candidate.y) +
    Math.max(0, candidate.x + candidate.width - width) +
    Math.max(0, candidate.y + candidate.height - height)
  );
}

function radialPenalty(candidate: Candidate, point: Point, centerX: number, centerY: number): number {
  const outwardX = point.x - centerX;
  const outwardY = point.y - centerY;
  const outwardLength = Math.hypot(outwardX, outwardY);
  if (outwardLength < 1) return 0;

  const labelX = candidate.x + candidate.width / 2 - point.x;
  const labelY = candidate.y + candidate.height / 2 - point.y;
  const labelLength = Math.hypot(labelX, labelY);
  if (labelLength < 1) return 0;

  const cosine = (labelX * outwardX + labelY * outwardY) / (labelLength * outwardLength);
  return (1 - cosine) * RADIAL_WEIGHT;
}

function candidatesFor(
  point: Point,
  width: number,
  height: number,
  stageWidth: number,
  stageHeight: number,
  occupied: Placement[],
  allPoints: Point[]
): Candidate[] {
  const centerX = stageWidth / 2;
  const centerY = stageHeight / 2;
  const candidates: Candidate[] = [];

  for (const direction of DIRECTIONS) {
    for (const distance of [LABEL_GAP, LABEL_GAP + 10, LABEL_GAP + 24]) {
      const x = point.x + direction.x * (distance + width / 2) - width / 2;
      const y = point.y + direction.y * (distance + height / 2) - height / 2;
      const candidate: Candidate = { x, y, width, height, score: 0 };
      let score = distance * DISTANCE_WEIGHT;

      score += radialPenalty(candidate, point, centerX, centerY);
      score += boundaryOverflow(candidate, stageWidth, stageHeight) * BOUNDARY_WEIGHT;

      for (const previous of occupied) {
        score += overlapArea(candidate, previous) * OVERLAP_WEIGHT;
      }

      for (const otherPoint of allPoints) {
        if (otherPoint.index === point.index) continue;
        score += Math.max(0, POINT_EXCLUSION - distanceToRect(otherPoint.x, otherPoint.y, candidate)) * POINT_WEIGHT;
      }

      candidates.push({ ...candidate, score });
    }
  }

  return candidates;
}

function layoutLabels(points: Point[], stageWidth: number, stageHeight: number): Placement[] {
  const occupied: Placement[] = [];
  const remaining = [...points];
  const placements: Placement[] = [];

  while (remaining.length > 0) {
    const point = remaining.reduce((best, current) => {
      if (current.reference && !best.reference) return current;
      const currentNeighbors = points.filter(
        (p) => p.index !== current.index && Math.hypot(p.x - current.x, p.y - current.y) < 90
      ).length;
      const bestNeighbors = points.filter(
        (p) => p.index !== best.index && Math.hypot(p.x - best.x, p.y - best.y) < 90
      ).length;
      return currentNeighbors > bestNeighbors ? current : best;
    });
    remaining.splice(remaining.indexOf(point), 1);

    const width = Math.min(LABEL_MAX_WIDTH, measureTextWidth(point.title) + LABEL_PAD_X * 2);
    const height = LABEL_FONT + LABEL_PAD_Y * 2 + 2;
    const candidates = candidatesFor(point, width, height, stageWidth, stageHeight, occupied, points);
    const best = candidates.reduce((current, candidate) =>
      candidate.score < current.score ? candidate : current
    );
    const placement: Placement = { ...point, ...best };
    placements.push(placement);
    occupied.push(placement);
  }

  return placements;
}

function setRecommendationPointOpacity(stage: SVGSVGElement | null, activeIndex: number | null, count: number): void {
  const points = stage?.parentElement?.querySelectorAll<SVGCircleElement>(".wheel__rec-point") ?? [];
  points.forEach((point, index) => {
    point.style.opacity = activeIndex === null || count !== points.length || index === activeIndex ? "" : "0.24";
  });
}

export default function WheelPointLabels({ circle, size, title, overlays = [] }: Props) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
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

  const placements = useMemo(
    () => layoutLabels(points, GEOMETRY_WRAP, GEOMETRY_WRAP),
    [points]
  );

  if (compact || placements.length === 0) return null;

  const hoveredPlacement = hoveredIndex === null
    ? null
    : placements.find((placement) => placement.index === hoveredIndex) ?? null;
  const hoveredPoint = hoveredIndex === null
    ? null
    : points.find((point) => point.index === hoveredIndex) ?? null;

  const setHovered = (index: number | null) => {
    setHoveredIndex(index);
    const recommendationIndex = index === null
      ? null
      : placements.find((placement) => placement.index === index && !placement.reference)?.index ?? null;
    const stage = document.querySelector(".wheel__point-labels")?.parentElement;
    const recPoints = stage?.querySelectorAll<SVGCircleElement>(".wheel__rec-point") ?? [];
    recPoints.forEach((recPoint, i) => {
      recPoint.style.opacity = recommendationIndex === null || i !== recommendationIndex - (title ? 1 : 0) ? "0.24" : "1";
    });
    if (recommendationIndex === null) {
      recPoints.forEach((recPoint) => {
        recPoint.style.opacity = "";
      });
    }
  };

  return (
    <svg
      className="wheel__point-labels"
      viewBox={`0 0 ${GEOMETRY_WRAP} ${GEOMETRY_WRAP}`}
      width={displayWrap}
      height={displayWrap}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, overflow: "visible", zIndex: 3, pointerEvents: "none" }}
    >
      {placements.map((placement) => {
        const point = points.find((item) => item.index === placement.index)!;
        const hovered = hoveredIndex === placement.index;
        const dimmed = hoveredIndex !== null && !hovered;
        const labelX = placement.x + LABEL_PAD_X;
        const labelY = placement.y + LABEL_PAD_Y;
        const glowColor = placement.reference ? "#6ee7ff" : "#e8ecf4";
        return (
          <g key={placement.index} style={{ pointerEvents: "none" }}>
            <circle
              cx={point.x}
              cy={point.y}
              r={placement.reference ? 15 : 12}
              fill="transparent"
              stroke="none"
              className={!placement.reference ? "wheel__point-label-hit--recommendation" : undefined}
              style={{ pointerEvents: "auto", cursor: "default" }}
              onMouseEnter={() => setHovered(placement.index)}
              onMouseLeave={() => setHovered(null)}
            />
            <rect
              x={placement.x}
              y={placement.y}
              width={placement.width}
              height={placement.height}
              fill="transparent"
              stroke="none"
              className={!placement.reference ? "wheel__point-label-hit--recommendation" : undefined}
              style={{ pointerEvents: "auto", cursor: "default" }}
              onMouseEnter={() => setHovered(placement.index)}
              onMouseLeave={() => setHovered(null)}
            />
            <text
              x={labelX}
              y={labelY + LABEL_FONT}
              fill={hovered ? "#ffffff" : placement.reference ? "#e8ecf4" : "#cdd4e2"}
              opacity={dimmed ? 0.45 : 1}
              fontFamily="Inter, system-ui, sans-serif"
              fontSize={LABEL_FONT}
              fontWeight={placement.reference ? 650 : 450}
              textAnchor="start"
              dominantBaseline="alphabetic"
              className="wheel__point-label-text"
              style={{
                filter: hovered ? `drop-shadow(0 0 7px ${glowColor})` : undefined,
                pointerEvents: "none",
              }}
            >
              {point.title}
            </text>
          </g>
        );
      })}
      {hoveredPlacement && hoveredPoint && (
        <>
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            r={hoveredPlacement.reference ? 14 : 11}
            fill="none"
            stroke={hoveredPlacement.reference ? "rgba(110, 231, 255, 0.9)" : "rgba(232, 236, 244, 0.75)"}
            strokeWidth={1.5}
            opacity={0.95}
            style={{
              filter: `drop-shadow(0 0 9px ${hoveredPlacement.reference ? "#6ee7ff" : "#e8ecf4"})`,
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
              values={hoveredPlacement.reference ? "12.5;15;12.5" : "9.5;12;9.5"}
              dur="1.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            r={4.5}
            fill={hoveredPlacement.reference ? "#6ee7ff" : "#e8ecf4"}
            opacity={0.95}
            style={{
              filter: `drop-shadow(0 0 7px ${hoveredPlacement.reference ? "#6ee7ff" : "#e8ecf4"})`,
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
        </>
      )}
    </svg>
  );
}
