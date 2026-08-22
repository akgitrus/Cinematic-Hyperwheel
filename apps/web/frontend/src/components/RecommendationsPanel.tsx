import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RecItem, RecommendCircle } from "../api";
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

export default function RecommendationsPanel({
  circles,
  onSelectItem = () => {},
  imdbUrlFor = (item) => (item.imdb_id ? imdbTitleUrl(item.imdb_id) : imdbSearchUrl(item.title)),
  tmdbUrlFor = (item) => (item.tmdb_id ? tmdbTitleUrl(item.tmdb_id) : tmdbSearchUrl(item.title)),
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Only circles that actually turned up at least one recommendation
  // anywhere across their angles are worth showing.
  const populated = circles.filter((c) => c.angles.some((a) => a.items.length > 0));

  if (populated.length === 0) return null;

  return (
    <div className="rec-panel">
      <h2 className="recommendations__title">{t("recommendations.title")}</h2>
      <div className="rec-panel__list scroll-fade">
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

                  return (
                    <div className="rec-angle" key={key}>
                      <RecRow
                        item={top}
                        swatchColor={swatch}
                        onSelectItem={onSelectItem}
                        imdbUrlFor={imdbUrlFor}
                        tmdbUrlFor={tmdbUrlFor}
                        trailing={
                          hasMore ? (
                            <button
                              type="button"
                              className={
                                "rec-row__chevron" + (isOpen ? " rec-row__chevron--open" : "")
                              }
                              onClick={() => toggle(key)}
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
                            {rest.map((it) => (
                              <RecRow
                                key={it.item_id}
                                item={it}
                                swatchColor={swatch}
                                onSelectItem={onSelectItem}
                                imdbUrlFor={imdbUrlFor}
                                tmdbUrlFor={tmdbUrlFor}
                                compact
                              />
                            ))}
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
}

// A single recommendation row: rank, scheme-angle swatch, a title link
// (loads this movie as the new reference via onSelectItem), external
// IMDb/TMDB links, and an optional trailing control (the expand/collapse
// chevron - only ever passed for the top-ranked row of an angle). Each
// interactive zone is its own element, not one big clickable row - the
// title link, the two external links, and the chevron are all
// independently clickable.
function RecRow({ item, swatchColor, onSelectItem, imdbUrlFor, tmdbUrlFor, trailing, compact }: RecRowProps) {
  const { t } = useTranslation();
  return (
    <div className={"rec-row" + (compact ? " rec-row--compact" : "")}>
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