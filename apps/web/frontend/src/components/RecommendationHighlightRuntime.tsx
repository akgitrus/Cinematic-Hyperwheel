import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import RecommendationPointHighlight from "./RecommendationPointHighlight";
import { setRecommendationHighlight, useRecommendationHighlight } from "../utils/recommendationHighlight";
import "./RecommendationHighlightRuntime.css";

interface CompactPointTarget {
  svg: SVGSVGElement;
  itemId: number;
  x: number;
  y: number;
}

function collectCompactPointTargets(): CompactPointTarget[] {
  return Array.from(document.querySelectorAll<SVGCircleElement>(".wheel.wheel--compact .wheel__rec-point"))
    .map((point) => {
      const itemId = Number(point.dataset.pointItemId);
      const svg = point.ownerSVGElement;
      const x = Number(point.getAttribute("cx"));
      const y = Number(point.getAttribute("cy"));
      if (!Number.isFinite(itemId) || !svg || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { svg, itemId, x, y };
    })
    .filter((target): target is CompactPointTarget => target !== null);
}

function sameTargets(a: CompactPointTarget[], b: CompactPointTarget[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((target, index) => {
    const other = b[index];
    return target.svg === other.svg && target.itemId === other.itemId && target.x === other.x && target.y === other.y;
  });
}

function nativeLargeWheelHoverId(): number | null {
  const labelSvg = document.querySelector<SVGSVGElement>(".wheel__point-labels");
  if (!labelSvg) return null;

  const pulseGroup = Array.from(labelSvg.querySelectorAll<SVGGElement>("g")).find(
    (group) => group.querySelector("circle[cx][cy]")
  );
  const pulseCircle = pulseGroup?.querySelector<SVGCircleElement>("circle[cx][cy]");
  if (!pulseCircle) return null;

  const cx = pulseCircle.getAttribute("cx");
  const cy = pulseCircle.getAttribute("cy");
  if (cx === null || cy === null) return null;

  const point = Array.from(document.querySelectorAll<SVGCircleElement>(
    ".wheel:not(.wheel--compact) .wheel__rec-point"
  )).find((candidate) => candidate.getAttribute("cx") === cx && candidate.getAttribute("cy") === cy);
  const itemId = Number(point?.dataset.pointItemId);
  return Number.isFinite(itemId) ? itemId : null;
}

function legendTitleForItem(itemId: number): string | null {
  const row = document.querySelector<HTMLElement>(`[data-wheel-legend-item-id="${itemId}"]`);
  return row?.querySelector<HTMLElement>(".rec-row__title")?.textContent?.trim() ?? null;
}

function itemIdForRecommendationRow(row: Element): number | null {
  const title = row.querySelector<HTMLElement>(".rec-row__title")?.textContent?.trim();
  if (!title) return null;

  const legendRow = Array.from(document.querySelectorAll<HTMLElement>("[data-wheel-legend-item-id]")).find(
    (candidate) => candidate.querySelector<HTMLElement>(".rec-row__title")?.textContent?.trim() === title
  );
  const itemId = Number(legendRow?.dataset.wheelLegendItemId);
  return Number.isFinite(itemId) ? itemId : null;
}

function syncRecommendationList(itemId: number | null): void {
  const activeTitle = itemId === null ? null : legendTitleForItem(itemId);

  document.querySelectorAll<HTMLElement>(".rec-circle .rec-row").forEach((row) => {
    const title = row.querySelector<HTMLElement>(".rec-row__title")?.textContent?.trim() ?? null;
    const hidden = row.closest<HTMLElement>(".rec-more:not(.rec-more--open)") !== null;
    row.classList.toggle("recommendation-highlight--row", activeTitle !== null && title === activeTitle && !hidden);
  });

  document.querySelectorAll<HTMLElement>(".rec-circle .rec-row__expand").forEach((button) => {
    const angle = button.closest<HTMLElement>(".rec-angle");
    const hiddenRows = angle?.querySelectorAll<HTMLElement>(".rec-more:not(.rec-more--open) .rec-row") ?? [];
    const shouldHighlight = activeTitle !== null && Array.from(hiddenRows).some((row) => {
      const title = row.querySelector<HTMLElement>(".rec-row__title")?.textContent?.trim() ?? null;
      return title === activeTitle;
    });
    button.classList.toggle("recommendation-highlight--expand", shouldHighlight);
  });
}

export default function RecommendationHighlightRuntime() {
  const activeItemId = useRecommendationHighlight();
  const [compactTargets, setCompactTargets] = useState<CompactPointTarget[]>([]);

  useEffect(() => {
    const refresh = () => {
      const nextTargets = collectCompactPointTargets();
      setCompactTargets((previous) => (sameTargets(previous, nextTargets) ? previous : nextTargets));

      const nativeId = nativeLargeWheelHoverId();
      if (nativeId !== null) setRecommendationHighlight(nativeId);
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    syncRecommendationList(activeItemId);
  }, [activeItemId]);

  useEffect(() => {
    const onPointerOver = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;

      const compactPoint = target.closest<SVGCircleElement>(".wheel.wheel--compact .wheel__rec-point");
      if (compactPoint) {
        const itemId = Number(compactPoint.dataset.pointItemId);
        if (Number.isFinite(itemId)) setRecommendationHighlight(itemId);
        return;
      }

      const legendRow = target.closest<HTMLElement>("[data-wheel-legend-item-id]");
      if (legendRow) {
        const itemId = Number(legendRow.dataset.wheelLegendItemId);
        if (Number.isFinite(itemId)) setRecommendationHighlight(itemId);
        return;
      }

      const recommendationRow = target.closest<HTMLElement>(".rec-circle .rec-row");
      if (recommendationRow) {
        const itemId = itemIdForRecommendationRow(recommendationRow);
        if (itemId !== null) setRecommendationHighlight(itemId);
      }
    };

    const onPointerOut = (event: PointerEvent) => {
      const from = event.target as Element | null;
      const to = event.relatedTarget as Element | null;
      if (!from || (to && from.contains(to))) return;

      if (
        from.closest(".wheel.wheel--compact .wheel__rec-point") ||
        from.closest("[data-wheel-legend-item-id]") ||
        from.closest(".rec-circle .rec-row") ||
        from.closest(".wheel__point-labels")
      ) {
        setRecommendationHighlight(null);
      }
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
    };
  }, []);

  return (
    <>
      {compactTargets.map((target) =>
        target.itemId === activeItemId
          ? createPortal(
              <RecommendationPointHighlight x={target.x} y={target.y} />,
              target.svg
            )
          : null
      )}
    </>
  );
}
