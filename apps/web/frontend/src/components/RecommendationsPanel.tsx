import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getPoster, RecItem, RecommendCircle, toWheelCircle } from "../api";
import { colorOnWheel } from "../utils/color";
import { imdbSearchUrl, imdbTitleUrl } from "../utils/imdb";
import { tmdbSearchUrl, tmdbTitleUrl } from "../utils/tmdb";
import Wheel, { RING_PAD } from "./Wheel";

interface Props {
  circles: RecommendCircle[];
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

// Compact label for a scheme angle, shown inside the angle badge on the
// first row of each rec-angle section, e.g. "+30°" / "-120°". Angles are
// always whole numbers (see rotation.ts SCHEMES) and the format itself
// (sign + number + degree symbol) doesn't need localization.
function formatAngle(angleDeg: number): string {
  const rounded = Math.round(angleDeg);
  return `${rounded > 0 ? "+" : ""}${rounded}°`;
}

// Simple hand-drawn "magic wand" glyph - not tied to any specific icon
// library, just a diagonal wand with a sparkle at the tip, matching the
// project's "Get recommendations" action.
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

// Two small rectangles - overlapping in "stacked" (default: list
// overlaid on the wheel) state, pulled apart in "unstacked" state -
// mirrors what the button actually does to the layout.
function StackToggleIcon({ unstacked }: { unstacked: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x={unstacked ? 1.5 : 3.5}
        y={unstacked ? 2 : 3.5}
        width="8"
        height="8"
        rx="1.5"
        fill="currentColor"
        opacity="0.55"
      />
      <rect
        x={unstacked ? 6.5 : 4.5}
        y={unstacked ? 7 : 4.5}
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/**
 * Replaces the old title hyperlink (which navigated the CURRENT tab to
 * this movie as the new reference) - instead opens the same deep link
 * (/{item_id}, see App.tsx's URL sync) in a NEW tab, so browsing
 * recommendations never loses the reference the user is currently
 * looking at.
 */
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

interface AngleSectionsProps {
  circle: RecommendCircle;
  cKey: string;
  bearing: number;
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
  activeCardKey: string | null;
  onCardEnter: (key: string, item: RecItem, el: HTMLElement) => void;
  onCardLeave: () => void;
  onCardToggle: (key: string, item: RecItem, el: HTMLElement) => void;
  imdbUrlFor: (item: RecItem) => string;
  tmdbUrlFor: (item: RecItem) => string;
}

// The per-angle rows for one circle - factored out of RecommendationsPanel
// so the exact same list can be dropped into either the default overlay
// layout or the "unstacked" side-by-side/stacked layout without
// duplicating this block.
function AngleSections({
  circle,
  cKey,
  bearing,
  expanded,
  onToggleExpand,
  activeCardKey,
  onCardEnter,
  onCardLeave,
  onCardToggle,
  imdbUrlFor,
  tmdbUrlFor,
}: AngleSectionsProps) {
  const { t } = useTranslation();
  return (
    <>
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
                angleLabel={formatAngle(angle.angle_deg)}
                imdbUrlFor={imdbUrlFor}
                tmdbUrlFor={tmdbUrlFor}
                cardKey={topCardKey}
                isCardOpen={activeCardKey === topCardKey}
                onCardEnter={onCardEnter}
                onCardLeave={onCardLeave}
                onCardToggle={onCardToggle}
                trailing={
                  hasMore ? (
                    <button
                      type="button"
                      className={"rec-row__expand" + (isOpen ? " rec-row__expand--open" : "")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand(key);
                      }}
                      aria-expanded={isOpen}
                      aria-label={
                        isOpen ? t("recommendations.hide") : t("recommendations.more", { count: rest.length })
                      }
                      title={
                        isOpen ? t("recommendations.hide") : t("recommendations.more", { count: rest.length })
                      }
                    >
                      {isOpen ? "−" : `+${rest.length}`}
                    </button>
                  ) : null
                }
              />

              {hasMore && (
                <div className={"rec-more" + (isOpen ? " rec-more--open" : "")}>
                  <div className="rec-more__inner">
                    {rest.map((it) => {
                      const itemCardKey = `${key}:${it.item_id}`;
                      return (
                        <RecRow
                          key={it.item_id}
                          item={it}
                          swatchColor={swatch}
                          imdbUrlFor={imdbUrlFor}
                          tmdbUrlFor={tmdbUrlFor}
                          cardKey={itemCardKey}
                          isCardOpen={activeCardKey === itemCardKey}
                          onCardEnter={onCardEnter}
                          onCardLeave={onCardLeave}
                          onCardToggle={onCardToggle}
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
    </>
  );
}

// Default per-section wheel size: fills the available column width (see
// the fillWheelSize ResizeObserver effect below) - used both by the
// default overlay layout (angle-section list drawn over the wheel's
// lower edge) and by the "unstacked" layout on narrow viewports (wheel
// stacked above a full-width list, see .rec-circle__layout in
// index.css). Clamped so it never shrinks below legibility nor grows
// large enough to make a long list of sections unreasonably tall.
const SECTION_WHEEL_MIN = 170;
const SECTION_WHEEL_MAX = 380;
// Fixed small wheel size for the "unstacked" layout on wide viewports,
// where the wheel sits beside the list rather than above/behind it.
const SECTION_WHEEL_UNSTACKED = 140;

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

export default function RecommendationsPanel({
  circles,
  imdbUrlFor = (item) => (item.imdb_id ? imdbTitleUrl(item.imdb_id) : imdbSearchUrl(item.title)),
  tmdbUrlFor = (item) => (item.tmdb_id ? tmdbTitleUrl(item.tmdb_id) : tmdbSearchUrl(item.title)),
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeCard, setActiveCard] = useState<RecCardTarget | null>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches

  // Only circles that actually turned up at least one recommendation
  // anywhere across their angles are worth showing.
  const populated = circles.filter((c) => c.angles.some((a) => a.items.length > 0));
  
  // Reactive version of the MOBILE_BREAKPOINT check (resize/orientation
  // change matter here, unlike the one-off canHover capability check
  // above) - drives the section wheel's fill-width sizing below.
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth <= MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Mobile-only: whether every section uses the "stacked" layout
  // (list fully below the wheel) instead of the default "peek" layout
  // (list pulled up over the wheel's lower edge). One switch for the
  // whole panel (see .rec-panel__toolbar). The transition itself is a
  // pure CSS animation (see .rec-circle__mobile--peek/--stacked in
  // index.css) - overflow-anchor on the scroll container (also in
  // index.css) is what keeps the user's scroll position visually
  // stable while it plays
  const [unstacked, setUnstacked] = useState(false);

  // Fill-width sizing for the per-section wheel: measures the
  // scrollable list's own width and sizes the wheel to match it,
  // accounting for RING_PAD (the pole-label ring drawn OUTSIDE the
  // disc) plus a small buffer, so the ring is never clipped. Used by
  // the default overlay layout on every viewport, and by the
  // "unstacked" layout specifically on narrow ones (see
  // .rec-circle__layout in index.css).
  const [fillWheelSize, setFillWheelSize] = useState(SECTION_WHEEL_UNSTACKED);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const apply = (width: number) => {
      const target = Math.floor(width - RING_PAD * 2 - 12);
      setFillWheelSize(Math.max(SECTION_WHEEL_MIN, Math.min(SECTION_WHEEL_MAX, target)));
    };
    apply(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Overlap amount for the "peek" layout - how far the list rides up
  // over the wheel's lower edge, as a fraction of the wheel's own
  // current size (fillWheelSize) rather than a fixed pixel constant, so
  // it scales sensibly across viewport widths.
  const wheelPeek = Math.round(fillWheelSize * 0.34);

  // Reset UI state tied to a specific movie/scheme selection.
  useEffect(() => {
    closeCardNow();
    setUnstacked(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circles]);

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

  if (populated.length === 0) return null;

  return (
    <div className="rec-panel">
      {/* <h2 className="recommendations__title">{t("recommendations.title")}</h2> */}

      {isNarrow && (
        <div className="rec-panel__toolbar">
          <button
            type="button"
            className="rec-circle__stack-toggle"
            onClick={() => setUnstacked((v) => !v)}
            title={unstacked ? t("recommendations.stackAll") : t("recommendations.unstackAll")}
            aria-label={unstacked ? t("recommendations.stackAll") : t("recommendations.unstackAll")}
          >
            <StackToggleIcon unstacked={unstacked} />
            {unstacked ? t("recommendations.stackAll") : t("recommendations.unstackAll")}
          </button>
        </div>
      )}

      <div className="rec-panel__list scroll-fade" ref={listRef}>
        {populated.map((circle) => {
          const cKey = circleKey(circle);
          const bearing = circle.reference
            ? refCompassBearing(circle.reference.z_x, circle.reference.z_y)
            : 0;
          const wheelCircle = toWheelCircle(circle);

          const angleSections = (
            <AngleSections
              circle={circle}
              cKey={cKey}
              bearing={bearing}
              expanded={expanded}
              onToggleExpand={toggle}
              activeCardKey={activeCard?.key ?? null}
              onCardEnter={openCard}
              onCardLeave={scheduleCloseCard}
              onCardToggle={toggleCard}
              imdbUrlFor={imdbUrlFor}
              tmdbUrlFor={tmdbUrlFor}
            />
          );

          // Desktop: fixed small wheel beside the list,
          if (!isNarrow) {
            return (
              <section
                className={"rec-circle" + (circle.primary ? " rec-circle--primary" : "")}
                key={cKey}
              >
                <div className="rec-circle__layout">
                  {wheelCircle && (
                    <div className="rec-circle__wheel">
                      <Wheel circle={wheelCircle} size={SECTION_WHEEL_UNSTACKED} overlays={circle.angles} />
                    </div>
                  )}
                  <div className="rec-circle__content">{angleSections}</div>
                </div>
              </section>
            );
          }

          // Mobile: same DOM in both states, only a modifier class (and
          // --wheel-peek) changes - see .rec-circle__mobile* in
          // index.css for why this needs to stay structurally identical
          // (it's what makes the switch an actual CSS transition).
          return (
            <section
              className={"rec-circle" + (circle.primary ? " rec-circle--primary" : "")}
              key={cKey}
            >
              <div
                className={
                  "rec-circle__mobile" +
                  (unstacked ? " rec-circle__mobile--stacked" : " rec-circle__mobile--peek")
                }
                style={{ "--wheel-peek": `${wheelPeek}px` } as CSSProperties}
              >
                {wheelCircle && (
                  <Wheel
                    circle={wheelCircle}
                    size={fillWheelSize}
                    overlays={circle.angles}
                    showReadout={false}
                  />
                )}
                <div className="rec-circle__mobile-list">{angleSections}</div>
              </div>
            </section>
          );
        })}
      </div>

      {activeCard && (
        <RecInfoCard
          target={activeCard}
          onClose={closeCardNow}
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
  /** Present only on the first row of a rec-angle section - renders a
   * bigger badge with the scheme angle text instead of a plain dot. */
  angleLabel?: string;
  imdbUrlFor: (item: RecItem) => string;
  tmdbUrlFor: (item: RecItem) => string;
  trailing?: ReactNode;
  compact?: boolean;
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
  angleLabel,
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
      {angleLabel ? (
        <span
          className="rec-row__anglebadge"
          style={{ borderColor: swatchColor, color: swatchColor }}
          aria-hidden="true"
        >
          {angleLabel}
        </span>
      ) : (
        <span
          className="rec-row__swatch"
          style={{ background: swatchColor, color: swatchColor }}
          aria-hidden="true"
        />
      )}
      <div className="rec-row__body">
        <span className="rec-row__title">{item.title}</span>
        {item.angular_error_deg != null && (
          <span className="rec-row__meta">
            Δangle: {item.angular_error_deg.toFixed(1)}°
            {item.radius_ratio != null && ` · r-ratio: ${item.radius_ratio.toFixed(2)}`}
          </span>
        )}
      </div>
      <GetRecommendationsButton itemId={item.item_id} label={t("recommendations.getRecommendations")} />
      {trailing}
    </div>
  );
}