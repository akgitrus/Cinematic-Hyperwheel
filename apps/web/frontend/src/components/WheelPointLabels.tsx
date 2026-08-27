import { useMemo } from "react";
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

function connectorPoint(placement: Placement, point: Point): { x: number; y: number } {
  return {
    x: Math.max(placement.x, Math.min(point.x, placement.x + placement.width)),
    y: Math.max(placement.y, Math.min(point.y, placement.y + placement.height)),
  };
}

export default function WheelPointLabels({ circle, size, title, overlays = [] }: Props) {
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
        const target = connectorPoint(placement, point);
        const labelX = placement.x + LABEL_PAD_X;
        const labelY = placement.y + LABEL_PAD_Y;
        return (
          <g key={placement.index}>
            <line
              x1={point.x}
              y1={point.y}
              x2={target.x}
              y2={target.y}
              stroke={placement.reference ? "rgba(110, 231, 255, 0.55)" : "rgba(232, 236, 244, 0.28)"}
              strokeWidth={placement.reference ? 1.15 : 0.8}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={placement.x}
              y={placement.y}
              width={placement.width}
              height={placement.height}
              rx={4}
              fill={placement.reference ? "rgba(10, 13, 20, 0.86)" : "rgba(10, 13, 20, 0.72)"}
              stroke={placement.reference ? "rgba(110, 231, 255, 0.4)" : "rgba(232, 236, 244, 0.12)"}
              strokeWidth={placement.reference ? 1 : 0.7}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={labelX}
              y={labelY + LABEL_FONT}
              fill={placement.reference ? "#e8ecf4" : "#cdd4e2"}
              fontFamily="Inter, system-ui, sans-serif"
              fontSize={LABEL_FONT}
              fontWeight={placement.reference ? 650 : 450}
              textAnchor="start"
              dominantBaseline="alphabetic"
            >
              {placement.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
