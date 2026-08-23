import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onClose: () => void;
}

const GITHUB_URL = import.meta.env.VITE_GITHUB_URL;
const AUTHOR_URL = import.meta.env.VITE_AUTHOR_URL;
const TMDB_URL = "https://www.themoviedb.org/";
const GROUPLENS_URL = "https://grouplens.org/datasets/movielens/latest/";


export default function AboutModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [creditsOpen, setCreditsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="about__backdrop" onClick={onClose}>
      <div
        className="about__panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="about__close" onClick={onClose} aria-label={t("about.close")}>
          ✕
        </button>

        <h2 className="about__title">{t("about.title")}</h2>

        <section className="about__section">
          <h3 className="about__heading">{t("about.project.heading")}</h3>
          <p>{t("about.project.text")}</p>
        </section>

        <section className="about__section">
          <h3 className="about__heading">{t("about.license.heading")}</h3>
          <p>{t("about.license.text")}</p>
          <p className="about__fine">{t("about.license.copyright")}</p>
        </section>

        {(GITHUB_URL || AUTHOR_URL) && (
          <section className="about__section about__links">
            {GITHUB_URL && (
              <a className="about__linkbtn" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38
                       0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
                       1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
                       0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6
                       7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08
                       2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54
                       1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                </svg>
                {t("about.source.github")}
              </a>
            )}

            {AUTHOR_URL && (
              <a
                className="about__linkbtn"
                href={AUTHOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                title={t("about.author.tooltip")}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                {t("about.author.button")}
              </a>
            )}
          </section >
        )}

        <section className="about__section about__credits">
          <button
            type="button"
            className="about__credits-toggle"
            onClick={() => setCreditsOpen((v) => !v)}
            aria-expanded={creditsOpen}
          >
            <h3 className="about__heading about__heading--inline">{t("about.credits.heading")}</h3>
            <span className={"about__credits-chevron" + (creditsOpen ? " about__credits-chevron--open" : "")}>
              ▾
            </span>
          </button>

          <div className={"about__credits-body" + (creditsOpen ? " about__credits-body--open" : "")}>
            <div className="about__credits-inner">
              <div className="about__credits-item">
                <h4 className="about__credits-item-heading">{t("about.credits.movielens.heading")}</h4>
                <p>{t("about.credits.movielens.text")}</p>
                <p>
                  <a href={GROUPLENS_URL} target="_blank" rel="noopener noreferrer">
                    {t("footer.datasetLink")}
                  </a>
                </p>
                <p className="about__fine">{t("footer.citation")}</p>
              </div>

              <div className="about__credits-item">
                <h4 className="about__credits-item-heading">{t("about.credits.tmdb.heading")}</h4>
                <p>
                  <a href={TMDB_URL} target="_blank" rel="noopener noreferrer">TMDB</a>
                </p>
                {/* Required notice, kept verbatim in English per TMDB's
                    API attribution terms - not translated, same as any
                    fixed legal/trademark notice. */}
                <p className="about__fine">{t("about.credits.tmdb.text")}</p>
              </div>
            </div>
          </div>
        </section>
      </div >
    </div >
  );
}