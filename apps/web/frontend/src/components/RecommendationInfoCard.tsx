import { useEffect, useState, type CSSProperties } from "react";
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
}

const CARD_WIDTH = 300;
const CARD_MAX_HEIGHT = 360;
const VIEWPORT_MARGIN = 8;
const MOBILE_BREAKPOINT = 640;

function anchoredStyle(rect: DOMRect): CSSProperties {
  let left = rect.right + 12;
  if (left + CARD_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
    left = rect.left - CARD_WIDTH - 12;
  }
  left = Math.min(
    Math.max(left, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN)
  );

  let top = rect.top;
  const maxTop = window.innerHeight - CARD_MAX_HEIGHT - VIEWPORT_MARGIN;
  top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, maxTop));

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

  const style = mobile ? undefined : anchoredStyle(target.rect);

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