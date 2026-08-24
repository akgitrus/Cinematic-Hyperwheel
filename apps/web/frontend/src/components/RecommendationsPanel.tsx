import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getPoster, RecItem, RecommendCircle } from "../api";
import { colorOnWheel } from "../utils/color";
import { imdbSearchUrl, imdbTitleUrl } from "../utils/imdb";
import { tmdbSearchUrl, tmdbTitleUrl } from "../utils/tmdb";

interface Props {
  circles: RecommendCircle[];
  /**
   * Called when a recommendation's title is clicked, to load that movie
   * as the new reference (see App.tsx's selectById). Defaults to a no-op
   * if the caller doesn't wire up navigation.
   */
  onSelectItem?: (itemId: number) => void;
  /**
   * Link builder for the IMDb button. Defaults to a direct title-page
   * link when the dataset has a matching imdbId (see
   * tools/filter_metadata_to_artifact.py's --links merge), falling back
   * to an IMDb title search when it doesn't.
   */
  imdbUrlFor?: (item: RecItem) => string;
  /**
   * Link builder for the TMDB button - same direct-link-with-fallback
   * shape as imdbUrlFor, backed by tmdbId instead of imdbId.
   */
  tmdbUrlFor?: (item: RecItem) => string;
}

function circleKey(c: RecommendCircle): string {
  return `${c.axis_x.pc}-${c.axis_y.pc}`;
}

function circleTitle(c: RecommendCircle, lang: string): string {
  const lx = c.axis_x.labels[lang] ?? c.axis_x.labels.en;
  const ly = c.axis_y.labels[lang] ?? c.axis_y.labels.en;
  return `${lx.axis} · ${ly.axis}`;
}

// Same bearing math as Wheel.tsx's recPoints: the reference's own compass
// bearing (0 = top/north, clockwise) plus this scheme angle's relative
// rotation, so a recommendation's swatch always matches the color its
// point actually has on the wheel overlay - not an independent palette.
function refCompassBearing(refX: number, refY: number): number {
  return ((Math.atan2(refY, refX) * 180) / Math.PI + 90 + 360) % 360;
}

// --- Poster resolution: a small client-side cache shared across every
// mounted RecInfoCard instance and across selections within the same
// page session. A movie's poster essentially never changes, so once
// resolved (or resolved as "unavailable") for a given item_id, hovering
// it again should never re-hit the network. in-flight promises are
// deduplicated too, in case the same item is hovered again before the
// first lookup returns. ---
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

interface   RecCardTarget {
  key: string;
  item: RecItem;
  rect: DOMRect;
}

// Assumed card footprint used to clamp its position within the
// viewport (see anchoredStyle) - matches the CSS width/max-height for
// .rec-card--anchored, so the clamp math and the actual rendered card
// never disagree.
const CARD_WIDTH = 300;
const CARD_MAX_HEIGHT = 360;
const VIEWPORT_MARGIN = 8;
// Below this viewport width, hover has no real equivalent (touch), and
// there's rarely room to anchor a 300px popover next to a full-width
// row anyway - the card renders as a bottom sheet instead (see
// RecInfoCard).
const MOBILE_BREAKPOINT = 640;

function anchoredStyle(rect: DOMRect): CSSProperties {
  // Prefer opening to the right of the row; flip to the left if there
  // isn't enough room, then clamp so the card is never partially off
  // either edge of the viewport.
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

interface RecInfoCardProps {
  target: RecCardTarget;
  onClose: () => void;
  onSelectItem: (itemId: number) => void;
  imdbUrlFor: (item: RecItem) => string;
  tmdbUrlFor: (item: RecItem) => string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

// The hover/tap info card itself: a mini poster (lazily resolved from
// TMDB, or omitted entirely if none is available - see resolvePoster),
// title, genres, and the same IMDb/TMDB links as the row. Rendered via a
// portal into document.body and positioned with `position: fixed`, so it
// is never clipped by the scrollable .rec-panel__list container it's
// triggered from, and it works the same way regardless of how deep the
// list has scrolled.
function RecInfoCard({
  target,
  onClose,
  onSelectItem,
  imdbUrlFor,
  tmdbUrlFor,
  onMouseEnter,
  onMouseLeave,
}: RecInfoCardProps) {
  const { t } = useTranslation();
  // undefined = still loading, null = resolved as unavailable.
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
      className={"rec-card__backdrop" + (mobile ? " rec-card__backdrop--sheet" : "")}
      onClick={onClose}
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
            <a
              className="rec-card__title"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onSelectItem(target.item.item_id);
                onClose();
              }}
            >
              {target.item.title}
            </a>
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

export default function RecommendationsPanel({
  circles,
  onSelectItem = () => {},
  imdbUrlFor = (item) => (item.imdb_id ? imdbTitleUrl(item.imdb_id) : imdbSearchUrl(item.title)),
  tmdbUrlFor = (item) => (item.tmdb_id ? tmdbTitleUrl(item.tmdb_id) : tmdbSearchUrl(item.title)),
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeCard, setActiveCard] = useState<RecCardTarget | null>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --- Hover/tap info card wiring -----------------------------------
  // Hovering a row (desktop) or tapping it (touch) opens the card;
  // moving off the row schedules a delayed close so the pointer has
  // time to travel onto the card itself (which is positioned elsewhere
  // in the DOM via a portal, so it's not a CSS-hoverable descendant of
  // the row) without the card flickering shut in between.
  const cancelPendingClose = () => window.clearTimeout(closeTimerRef.current);

  const openCard = (key: string, item: RecItem, el: HTMLElement) => {
    if (!canHover) return;

    cancelPendingClose();
    setActiveCard({ key, item, rect: el.getBoundingClientRect() });
  };

  const scheduleCloseCard = () => {
    if (!canHover) return;
    
    cancelPendingClose();
    closeTimerRef.current = window.setTimeout(() => setActiveCard(null), 200);
  };

  const closeCardNow = () => {
    cancelPendingClose();
    setActiveCard(null);
  };

  const toggleCard = (key: string, item: RecItem, el: HTMLElement) => {
    cancelPendingClose();
    setActiveCard((prev) => (prev && prev.key === key ? null : { key, item, rect: el.getBoundingClientRect() }));
  };

  // A fresh `circles` prop means a new selection or scheme - any open
  // card refers to a row that's about to be replaced or reordered, so
  // close it rather than let it point at stale data.
  useEffect(() => {
    closeCardNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circles]);

  // Escape, scrolling the list, or resizing the window (which would
  // invalidate the card's captured anchor position) all close the card.
  useEffect(() => {
    if (!activeCard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCardNow();
    };
    const onDismiss = () => closeCardNow();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onDismiss);
    const listEl = listRef.current;
    listEl?.addEventListener("scroll", onDismiss, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onDismiss);
      listEl?.removeEventListener("scroll", onDismiss);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard]);

  // Only circles that actually turned up at least one recommendation
  // anywhere across their angles are worth showing.
  const populated = circles.filter((c) => c.angles.some((a) => a.items.length > 0));

  if (populated.length === 0) return null;

  return (
    <div className="rec-panel">
      <h2 className="recommendations__title">{t("recommendations.title")}</h2>
      <div className="rec-panel__list scroll-fade" ref={listRef}>
        {populated.map((circle) => {
          const cKey = circleKey(circle);
          const bearing = circle.reference
            ? refCompassBearing(circle.reference.z_x, circle.reference.z_y)
            : 0;

          return (
            <section
              className={"rec-circle" + (circle.primary ? " rec-circle--primary" : "")}
              key={cKey}
            >
              <div className="rec-circle__header">
                <span className="rec-circle__badge">
                  PC{circle.axis_x.pc}/PC{circle.axis_y.pc}
                </span>
                <span className="rec-circle__title">{circleTitle(circle, lang)}</span>
              </div>

              {circle.angles
                .filter((a) => a.items.length > 0)
                .map((angle) => {
                  const key = `${cKey}-${angle.angle_deg}`;
                  const isOpen = expanded.has(key);
                  const [top, ...rest] = angle.items;
                  const hasMore = rest.length > 0;
                  const swatch = colorOnWheel(
                    bearing + angle.angle_deg,
                    circle.axis_x.colors.positive,
                    circle.axis_x.colors.negative,
                    circle.axis_y.colors.positive,
                    circle.axis_y.colors.negative
                  );
                  const topCardKey = `${key}:top:${top.item_id}`;

                  return (
                    <div className="rec-angle" key={key}>
                      <RecRow
                        item={top}
                        swatchColor={swatch}
                        onSelectItem={onSelectItem}
                        imdbUrlFor={imdbUrlFor}
                        tmdbUrlFor={tmdbUrlFor}
                        cardKey={topCardKey}
                        isCardOpen={activeCard?.key === topCardKey}
                        onCardEnter={openCard}
                        onCardLeave={scheduleCloseCard}
                        onCardToggle={toggleCard}
                        trailing={
                          hasMore ? (
                            <button
                              type="button"
                              className={
                                "rec-row__chevron" + (isOpen ? " rec-row__chevron--open" : "")
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(key);
                              }}
                              aria-expanded={isOpen}
                              aria-label={t("recommendations.showMore")}
                            >
                              ▾
                            </button>
                          ) : null
                        }
                      />

                      {hasMore && (
                        <div className={"rec-more" + (isOpen ? " rec-more--open" : "")}>
                          <div className="rec-more__inner">
                            {rest.map((it) => {
                              const cardKey = `${key}:${it.item_id}`;
                              return (
                                <RecRow
                                  key={it.item_id}
                                  item={it}
                                  swatchColor={swatch}
                                  onSelectItem={onSelectItem}
                                  imdbUrlFor={imdbUrlFor}
                                  tmdbUrlFor={tmdbUrlFor}
                                  cardKey={cardKey}
                                  isCardOpen={activeCard?.key === cardKey}
                                  onCardEnter={openCard}
                                  onCardLeave={scheduleCloseCard}
                                  onCardToggle={toggleCard}
                                  compact
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </section>
          );
        })}
      </div>

      {activeCard && (
        <RecInfoCard
          target={activeCard}
          onClose={closeCardNow}
          onSelectItem={onSelectItem}
          imdbUrlFor={imdbUrlFor}
          tmdbUrlFor={tmdbUrlFor}
          onMouseEnter={cancelPendingClose}
          onMouseLeave={scheduleCloseCard}
        />
      )}
    </div>
  );
}

interface RecRowProps {
  item: RecItem;
  swatchColor: string;
  onSelectItem: (itemId: number) => void;
  imdbUrlFor: (item: RecItem) => string;
  tmdbUrlFor: (item: RecItem) => string;
  trailing?: ReactNode;
  compact?: boolean;
  /** Unique id for this row's info card, used to track which card (if
   * any) is currently open across the whole panel - see
   * RecommendationsPanel's activeCard state. */
  cardKey: string;
  isCardOpen: boolean;
  onCardEnter: (key: string, item: RecItem, el: HTMLElement) => void;
  onCardLeave: () => void;
  onCardToggle: (key: string, item: RecItem, el: HTMLElement) => void;
}

// A single recommendation row: rank, scheme-angle swatch, a title link
// (loads this movie as the new reference via onSelectItem), external
// IMDb/TMDB links, and an optional trailing control (the expand/collapse
// chevron - only ever passed for the top-ranked row of an angle). Each
// interactive zone is its own element, not one big clickable row - the
// title link, the two external links, and the chevron are all
// independently clickable.
//
// The row as a whole is also the trigger for the hover/tap info card
// (see RecInfoCard): hovering it (desktop) or tapping it (touch) opens
// a small card with a poster, title, and genres next to it. The title
// link, external links, and chevron all stop propagation on click so a
// tap on one of them performs its own action (navigate / open a new
// tab / expand) instead of also toggling the info card.
function RecRow({
  item,
  swatchColor,
  onSelectItem,
  imdbUrlFor,
  tmdbUrlFor,
  trailing,
  compact,
  cardKey,
  isCardOpen,
  onCardEnter,
  onCardLeave,
  onCardToggle,
}: RecRowProps) {
  const { t } = useTranslation();
  return (
    <div
      className={
        "rec-row" +
        (compact ? " rec-row--compact" : "") +
        (isCardOpen ? " rec-row--active" : "")
      }
      onMouseEnter={(e) => onCardEnter(cardKey, item, e.currentTarget)}
      onMouseLeave={onCardLeave}
      onClick={(e) => onCardToggle(cardKey, item, e.currentTarget)}
    >
      <span className="rec-row__rank">{item.rank}</span>
      <span
        className="rec-row__swatch"
        style={{ background: swatchColor, color: swatchColor }}
        aria-hidden="true"
      />
      <div className="rec-row__body">
      <a
          className="rec-row__title"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectItem(item.item_id);
          }}
        >
          {item.title}
        </a>
        {item.angular_error_deg != null && (
          <span className="rec-row__meta">
            Δangle: {item.angular_error_deg.toFixed(1)}°
            {item.radius_ratio != null && ` · r-ratio: ${item.radius_ratio.toFixed(2)}`}
          </span>
        )}
      </div>
      <a
        className="rec-row__extlink rec-row__extlink--imdb"
        href={imdbUrlFor(item)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("recommendations.openImdb")}
        title={t("recommendations.openImdb")}
        onClick={(e) => e.stopPropagation()}
      >
        IMDb
      </a>
      <a
        className="rec-row__extlink rec-row__extlink--tmdb"
        href={tmdbUrlFor(item)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("recommendations.openTmdb")}
        title={t("recommendations.openTmdb")}
        onClick={(e) => e.stopPropagation()}
      >
        TMDB
      </a>
      {trailing}
    </div>
  );
}