import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getPoster, RecItem } from "../api";
import "./RecommendationInfoCard.css";

const posterCache = new Map<number, string | null>();
const posterInFlight = new Map<number, Promise<string | null>>();

async function resolvePoster(itemId: number): Promise<string | null> {
  if (posterCache.has(itemId)) return posterCache.get(itemId)!;
  let pending = posterInFlight.get(itemId);
  if (!pending) {
    pending = getPoster(itemId)
      .then((r) => r.poster_url)
      .catch(() => null);
    posterInFlight.set(itemId, pending);
  }
  const url = await pending;
  posterCache.set(itemId, url);
  posterInFlight.delete(itemId);
  return url;
}

export interface RecCardTarget {
  key: string;
  item: RecItem;
  rect: DOMRect;
  /** Bounding rect of this item's own point on the wheel disc (see the
   * matching data-point-item-id circle in Wheel.tsx). When present, the
   * card is nudged the minimum distance needed to stop covering it. */
  avoidRect?: DOMRect;
}

const CARD_WIDTH = 300;
const CARD_MAX_HEIGHT = 360;
const VIEWPORT_MARGIN = 8;
const MOBILE_BREAKPOINT = 640;
// Vertical clearance kept between the card and an avoided rect (the
// wheel disc) - a separate constant from VIEWPORT_MARGIN since this gap
// is against another UI element, not the viewport edge.
const AVOID_GAP = 50;

function computeLeft(rect: DOMRect): number {
  let left = rect.right + 12;
  if (left + CARD_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
    left = rect.left - CARD_WIDTH - 12;
  }
  return Math.min(
    Math.max(left, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN)
  );
}

// Row-level position, clamped to stay fully inside the viewport given
// the card's actual height.
function naturalTop(rect: DOMRect, cardHeight: number): number {
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - cardHeight - VIEWPORT_MARGIN);
  return Math.min(Math.max(rect.top, VIEWPORT_MARGIN), maxTop);
}

// Vertical-only nudge clear of avoidRect (the hovered item's own point
// on the wheel disc - see data-point-item-id in Wheel.tsx), sized from
// the card's OWN actually rendered height rather than its CSS
// max-height: the card is usually shorter than that max (no genres/meta
// line, short title, etc.), so using the real height keeps the shift
// the minimum distance actually needed instead of overshooting into
// space the card never uses.
function avoidOverlap(top: number, cardHeight: number, avoidRect: DOMRect): number {
  const avoidTop = avoidRect.top - AVOID_GAP;
  const avoidBottom = avoidRect.bottom + AVOID_GAP;
  const overlaps = top < avoidBottom && top + cardHeight > avoidTop;
  if (!overlaps) return top;

  const minTop = VIEWPORT_MARGIN;
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - cardHeight - VIEWPORT_MARGIN);
  const aboveTop = avoidTop - cardHeight;
  const belowTop = avoidBottom;
  const aboveValid = aboveTop >= minTop;
  const belowValid = belowTop <= maxTop;

  // Prefer whichever valid side needs the smaller shift from the
  // natural position; a candidate that wouldn't fit the viewport is
  // never chosen, so the card can't be pushed back into the point by a
  // later clamp.
  if (aboveValid && belowValid) {
    return Math.abs(aboveTop - top) <= Math.abs(belowTop - top) ? aboveTop : belowTop;
  }
  if (aboveValid) return aboveTop;
  if (belowValid) return belowTop;
  return top; // neither fits (viewport shorter than the card) - keep natural position
}

function anchoredStyle(rect: DOMRect, avoidRect?: DOMRect): CSSProperties {
  let left = rect.right + 12;
  if (left + CARD_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
    left = rect.left - CARD_WIDTH - 12;
  }
  left = Math.min(
    Math.max(left, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN)
  );

  const minTop = VIEWPORT_MARGIN;
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - CARD_MAX_HEIGHT - VIEWPORT_MARGIN);
  let top = Math.min(Math.max(rect.top, minTop), maxTop);

  if (avoidRect) {
    const avoidTop = avoidRect.top - AVOID_GAP;
    const avoidBottom = avoidRect.bottom + AVOID_GAP;
    const avoidLeft = avoidRect.left - AVOID_GAP;
    const avoidRight = avoidRect.right + AVOID_GAP;
    const overlaps =
      left < avoidRight &&
      left + CARD_WIDTH > avoidLeft &&
      top < avoidBottom &&
      top + CARD_MAX_HEIGHT > avoidTop;

    if (overlaps) {
      // Candidates that place the card fully above or fully below the
      // point. A candidate only counts as valid if it already fits the
      // viewport on its own - clamping an invalid candidate back into
      // range would silently push it back onto the point, undoing the
      // whole point of moving it.
      const above = avoidTop - CARD_MAX_HEIGHT;
      const below = avoidBottom;
      const aboveValid = above >= minTop;
      const belowValid = below <= maxTop;

      if (aboveValid && belowValid) {
        top = Math.abs(above - top) <= Math.abs(below - top) ? above : below;
      } else if (aboveValid) {
        top = above;
      } else if (belowValid) {
        top = below;
      }
      // Neither fits (viewport shorter than the card) - keep the
      // clamped natural position as a last resort.
    }
  }

  return { position: "fixed", left, top, width: CARD_WIDTH };
}

function WandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20 L14 10" />
      <path d="M16 4 L17.5 7.5 L21 9 L17.5 10.5 L16 14 L14.5 10.5 L11 9 L14.5 7.5 Z" />
      <path d="M19 15 V17" />
      <path d="M18 16 H20" />
    </svg>
  );
}

function GetRecommendationsButton({ itemId, label }: { itemId: number; label: string }) {
  return (
    <button
      type="button"
      className="rec-row__wand"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(`/${itemId}`, "_blank", "noopener,noreferrer");
      }}
    >
      <WandIcon />
    </button>
  );
}

interface RecInfoCardProps {
  target: RecCardTarget;
  onClose: () => void;
  imdbUrlFor: (item: RecItem) => string;
  tmdbUrlFor: (item: RecItem) => string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  allowUnderlyingInteraction?: boolean;
}

export default function RecommendationInfoCard({
  target,
  onClose,
  imdbUrlFor,
  tmdbUrlFor,
  onMouseEnter,
  onMouseLeave,
  allowUnderlyingInteraction = false,
}: RecInfoCardProps) {
  const { t } = useTranslation();
  const [posterUrl, setPosterUrl] = useState<string | null | undefined>(undefined);
  const mobile = typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT;
  const cardRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(() => naturalTop(target.rect, CARD_MAX_HEIGHT));

  useEffect(() => {
    let cancelled = false;
    setPosterUrl(undefined);
    resolvePoster(target.item.item_id).then((url) => {
      if (!cancelled) setPosterUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [target.item.item_id]);

  // Recomputes the vertical position from the card's actual rendered
  // height (via cardRef) whenever the hovered target changes - runs
  // before paint, so there's no visible jump between the natural and
  // avoidance-corrected position.
  useLayoutEffect(() => {
    if (mobile) return;
    const cardHeight = cardRef.current?.offsetHeight ?? CARD_MAX_HEIGHT;
    let nextTop = naturalTop(target.rect, cardHeight);
    if (target.avoidRect) nextTop = avoidOverlap(nextTop, cardHeight, target.avoidRect);
    setTop(nextTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.key, mobile]);

  const style: CSSProperties | undefined = mobile
    ? undefined
    : { position: "fixed", left: computeLeft(target.rect), top, width: CARD_WIDTH };

  return createPortal(
    <div
      className={
        "rec-card__backdrop" +
        (mobile ? " rec-card__backdrop--sheet" : "") +
        (allowUnderlyingInteraction ? " rec-card__backdrop--nonblocking" : "")
      }
      onClick={allowUnderlyingInteraction ? undefined : onClose}
    >
      <div
        ref={cardRef}
        className={"rec-card" + (mobile ? " rec-card--sheet" : " rec-card--anchored")}
        style={style}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <button
          type="button"
          className="rec-card__close"
          onClick={onClose}
          aria-label={t("recommendations.close")}
        >
          ✕
        </button>
        <div className="rec-card__body">
          {posterUrl === undefined && (
            <div className="rec-card__poster rec-card__poster--loading" aria-hidden="true" />
          )}
          {posterUrl && (
            <img
              className="rec-card__poster"
              src={posterUrl}
              alt={target.item.title}
              loading="lazy"
            />
          )}
          <div className="rec-card__info">
            <div className="rec-card__title-row">
              <span className="rec-card__title">{target.item.title}</span>
              <GetRecommendationsButton
                itemId={target.item.item_id}
                label={t("recommendations.getRecommendations")}
              />
            </div>
            {target.item.genres.length > 0 && (
              <div className="rec-card__genres">
                {target.item.genres.map((g) => (
                  <span key={g} className="card__genre-badge">
                    {g}
                  </span>
                ))}
              </div>
            )}
            {target.item.angular_error_deg != null && (
              <div className="rec-card__meta">
                Δangle: {target.item.angular_error_deg.toFixed(1)}°
                {target.item.radius_ratio != null &&
                  ` · r-ratio: ${target.item.radius_ratio.toFixed(2)}`}
              </div>
            )}
            <div className="rec-card__links">
              <a
                className="rec-row__extlink rec-row__extlink--imdb"
                href={imdbUrlFor(target.item)}
                target="_blank"
                rel="noopener noreferrer"
              >
                IMDb
              </a>
              <a
                className="rec-row__extlink rec-row__extlink--tmdb"
                href={tmdbUrlFor(target.item)}
                target="_blank"
                rel="noopener noreferrer"
              >
                TMDB
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}