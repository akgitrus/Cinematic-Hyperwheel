import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RecommendCircle } from "../api";

interface Props {
  circles: RecommendCircle[];
}

function circleKey(c: RecommendCircle): string {
  return `${c.axis_x.pc}-${c.axis_y.pc}`;
}

function circleTitle(c: RecommendCircle, lang: string): string {
  const lx = c.axis_x.labels[lang] ?? c.axis_x.labels.en;
  const ly = c.axis_y.labels[lang] ?? c.axis_y.labels.en;
  return `${lx.axis} · ${ly.axis}`;
}

export default function RecommendationsPanel({ circles }: Props) {
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
          return (
            <div className={"rec-circle" + (circle.primary ? " rec-circle--primary" : "")} key={cKey}>
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

                  return (
                    <div className="rec-angle" key={key}>
                      <button
                        type="button"
                        className={"rec-angle__row" + (hasMore ? " rec-angle__row--clickable" : "")}
                        onClick={() => hasMore && toggle(key)}
                        aria-expanded={hasMore ? isOpen : undefined}
                        disabled={!hasMore}
                      >
                        <span className="rec-angle__deg">{angle.angle_deg}°</span>
                        <span className="rec-angle__item-title">{top.title}</span>
                        {hasMore && (
                          <span className={"rec-angle__chevron" + (isOpen ? " rec-angle__chevron--open" : "")}>
                            ▾
                          </span>
                        )}
                      </button>

                      {hasMore && (
                        <div className={"rec-more" + (isOpen ? " rec-more--open" : "")}>
                          <div className="rec-more__inner">
                            <ol className="rec-more__list">
                              {rest.map((it) => (
                                <li key={it.item_id} className="rec-more__item">
                                  {it.title}
                                </li>
                              ))}
                            </ol>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}