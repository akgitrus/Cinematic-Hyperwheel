import { useMemo } from "react";
import { RecAngle, WheelCircle } from "../api";
import { RING_PAD } from "./Wheel";

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
  dx: number;
  dy: number;
  score: number;
}

interface Placement extends Point {
  x: number;
  y: number;
  width: number;
  height: number;
  dx: number;
  dy: number;
}

const Z_CLAMP = 3;
const LABEL_GAP = 8;
const LABEL_PAD_X = 5;
const LABEL_PAD_Y = 2;
const LABEL_FONT_MIN = 9;
const LABEL_FONT_MAX = 12;
const LABEL_MAX_WIDTH_RATIO = 0.62;
const POINT_EXCLUSION = 8;
const OVERLAP_WEIGHT = 1000;
const BOUNDARY_WEIGHT = 500;
const POINT_WEIGHT = 300;
const DISTANCE_WEIGHT = 1;
const RADIAL_WEIGHT = 18;
const CONNECTOR_WEIGHT = 0.35;

const DIRECTIONS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
];

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;
  }
  return measureCtx;
}

function measureTextWidth(text: string, fontPx: number): number {
  const ctx = getMeasureCtx();
  if (ctx) {
    ctx.font = `${fontPx}px Inter, system-ui, sans-serif`;
    return ctx.measureText(text).width;
  }
  return text.length * fontPx * 0.55;
}

function clampVector(zx: number, zy: number): [number, number] {
  const radius = Math.hypot(zx, zy);
  if (radius <= Z_CLAMP) return [zx, zy];
  const scale = Z_CLAMP / radius;
  return [zx * scale, zy * scale];
}

function pointPosition(zx: number, zy: number, size: number): { x: number; y: number } {
  const pad = RING_PAD;
  const center = size / 2 + pad;
  const maxR = size / 2 - 28;
  const [clampedX, clampedY] = clampVector(zx, zy);
  return {
    x: center + (clampedX / Z_CLAMP) * maxR,
    y: center + (clampedY / Z_CLAMP) * maxR,
  };
}

function overlapArea(a: Candidate | Placement, b: Candidate | Placement): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function pointDistanceToRect(x: number, y: number, rect: Candidate | Placement): number {
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

  const candidateCenterX = candidate.x + candidate.width / 2;
  const candidateCenterY = candidate.y + candidate.height / 2;
  const offsetX = candidateCenterX - point.x;
  const offsetY = candidateCenterY - point.y;
  const offsetLength = Math.hypot(offsetX, offsetY);
  if (offsetLength < 1) return 0;

  const cosine = (offsetX * outwardX + offsetY * outwardY) / (offsetLength * outwardLength);
  return (1 - cosine) * RADIAL_WEIGHT;
}

function makeCandidates(
  point: Point,
  width: number,
  height: number,
  labelWidth: number,
  labelHeight: number,
  stageWidth: number,
  stageHeight: number,
  centerX: number,
  centerY: number,
  occupied: Placement[],
  allPoints: Point[]
): Candidate[] {
  const orderedDirections = [...DIRECTIONS].sort((a, b) => {
    const pointAngle = Math.atan2(point.y - centerY, point.x - centerX);
    const angleA = Math.abs(Math.atan2(a.dy, a.dx) - pointAngle);
    const angleB = Math.abs(Math.atan2(b.dy, b.dx) - pointAngle);
    return angleA - angleB;
  });

  return orderedDirections.map((direction) => {
    const horizontal = direction.dx;
    const vertical = direction.dy;
    let x = point.x - labelWidth / 2;
    let y = point.y - labelHeight / 2;

    if (horizontal > 0) x = point.x + LABEL_GAP;
    if (horizontal < 0) x = point.x - LABEL_GAP - labelWidth;
    if (vertical > 0) y = point.y + LABEL_GAP;
    if (vertical < 0) y = point.y - LABEL_GAP - labelHeight;

    if (horizontal !== 0 && vertical !== 0) {
      x += horizontal > 0 ? 0 : -horizontal * 0;
      y += vertical > 0 ? 0 : -vertical * 0;
    }

    const candidate: Candidate = {
      x,
      y,
      width,
      height,
      dx: horizontal,
      dy: vertical,
      score: 0,
    };

    let score = radialPenalty(candidate, point, centerX, centerY);
    score +=
      Math.hypot(
        candidate.x + candidate.width / 2 - point.x,
        candidate.y + candidate.height / 2 - point.y
      ) * DISTANCE_WEIGHT;
    score += pointDistanceToRect(point.x, point.y, candidate) < POINT_EXCLUSION ? POINT_WEIGHT : 0;
    score += boundaryOverflow(candidate, stageWidth, stageHeight) * BOUNDARY_WEIGHT;

    for (const previous of occupied) {
      score += overlapArea(candidate, previous) * OVERLAP_WEIGHT;
    }

    for (const otherPoint of allPoints) {
      if (otherPoint.index === point.index) continue;
      const dx = Math.max(candidate.x - otherPoint.x, 0, otherPoint.x - (candidate.x + candidate.width));
      const dy = Math.max(candidate.y - otherPoint.y, 0, otherPoint.y - (candidate.y + candidate.height));
      const distance = Math.hypot(dx, dy);
      if (distance < POINT_EXCLUSION) {
        score += (POINT_EXCLUSION - distance) * POINT_WEIGHT;
      }
    }

    score +=
      Math.hypot(
        candidate.x + candidate.width / 2 - point.x,
        candidate.y + candidate.height / 2 - point.y
      ) * CONNECTOR_WEIGHT;

    return { ...candidate, score };
  });
}

function layoutLabels(points: Point[], stageWidth: number, stageHeight: number, fontPx: number): Placement[] {
  const maxLabelWidth = Math.max(140, stageWidth * LABEL_MAX_WIDTH_RATIO);
  const labelHeight = Math.ceil(fontPx * 1.25 + LABEL_PAD_Y * 2 + 2);
  const centerX = stageWidth / 2;
  const centerY = stageHeight / 2;
  const occupied: Placement[] = [];

  const placements: Placement[] = [];
  for (const point of points) {
    const measuredWidth = measureTextWidth(point.title, fontPx) + LABEL_PAD_X * 2 + 2;
    const width = Math.min(measuredWidth, maxLabelWidth);
    const candidates = makeCandidates(
      point,
      width,
      labelHeight,
      width,
      labelHeight,
      stageWidth,
      stageHeight,
      centerX,
      centerY,
      occupied,
      points
    );
    const best = candidates.reduce((current, candidate) =>
      candidate.score < current.score ? candidate : current
    );
    const placement: Placement = { ...point, ...best };
    placements.push(placement);
    occupied.push(placement);
  }

  return placements;
}

export default function WheelPointLabels({ circle, size, title, overlays = [] }: Props) {
  const wrap = size + RING_PAD * 2;
  const fontPx = Math.max(LABEL_FONT_MIN, Math.min(LABEL_FONT_MAX, size * 0.022));

  const points = useMemo<Point[]>(() => {
    const result: Point[] = [];
    let index = 0;

    if (title) {
      const position = pointPosition(circle.z_x, circle.z_y, size);
      result.push({ x: position.x, y: position.y, title, reference: true, index: index++ });
    }

    for (const angle of overlays) {
      for (const item of angle.items) {
        const position = pointPosition(item.z_x, item.z_y, size);
        result.push({ x: position.x, y: position.y, title: item.title, reference: false, index: index++ });
      }
    }

    return result;
  }, [circle, overlays, size, title]);

  const placements = useMemo(
    () => layoutLabels(points, wrap, wrap, fontPx),
    [fontPx, points, wrap]
  );

  if (placements.length === 0) return null;

  return (
    <div
      className="wheel__point-labels"
      style={{
        position: "absolute",
        inset: 0,
        width: wrap,
        height: wrap,
        pointerEvents: "none",
        overflow: "visible",
        zIndex: 3,
      }}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${wrap} ${wrap}`}
        width={wrap}
        height={wrap}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        {placements.map((placement) => {
          const labelCenterX = placement.x + placement.width / 2;
          const labelCenterY = placement.y + placement.height / 2;
          return (
            <line
              key={`line-${placement.index}`}
              x1={placement.dx === 0 ? placement.x + placement.width / 2 : placement.dx > 0 ? placement.x : placement.x + placement.width}
              y1={placement.dy === 0 ? placement.y + placement.height / 2 : placement.dy > 0 ? placement.y : placement.y + placement.height}
              x2={placement.x + placement.width / 2}
              y2={placement.y + placement.height / 2}
              stroke={placement.reference ? "rgba(110, 231, 255, 0.55)" : "rgba(232, 236, 244, 0.28)"}
              strokeWidth={placement.reference ? 1.15 : 0.8}
            />
          );
        })}
      </svg>
      {placements.map((placement) => {
        const clipped = measureTextWidth(placement.title, fontPx) + LABEL_PAD_X * 2 + 2 > placement.width + 0.5;
        return (
          <div
            key={`label-${placement.index}`}
            title={placement.title}
            className={placement.reference ? "wheel__point-label wheel__point-label--reference" : "wheel__point-label"}
            style={{
              position: "absolute",
              left: placement.x,
              top: placement.y,
              width: placement.width,
              height: placement.height,
              padding: `${LABEL_PAD_Y}px ${LABEL_PAD_X}px`,
              display: "flex",
              alignItems: "center",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: clipped ? "ellipsis" : "clip",
              boxSizing: "border-box",
              borderRadius: 4,
              border: placement.reference
                ? "1px solid rgba(110, 231, 255, 0.4)"
                : "1px solid rgba(232, 236, 244, 0.12)",
              background: placement.reference
                ? "rgba(10, 13, 20, 0.82)"
                : "rgba(10, 13, 20, 0.68)",
              color: placement.reference ? "#e8ecf4" : "#cdd4e2",
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: fontPx,
              fontWeight: placement.reference ? 650 : 450,
              lineHeight: 1.1,
              letterSpacing: "0.01em",
              textShadow: "0 1px 2px rgba(0, 0, 0, 0.8)",
            }}
          >
            {placement.title}
          </div>
        );
      })}
    </div>
  );
}
