import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SearchBar from "./components/SearchBar";
import Wheel from "./components/Wheel";
import LanguageSwitcher from "./components/LanguageSwitcher";
import RecommendationsPanel from "./components/RecommendationsPanel";
import AboutModal from "./components/AboutModal";
import HeroBackdrop from "./components/HeroBackdrop";
import {
  MovieHit,
  RecommendCircle,
  RecommendResponse,
  WheelCircle,
  getBackdrop,
  getMovieById,
  getRecommendations,
  getWheelCircles,
} from "./api";

const SCHEMES = [
  "complementary",
  "triadic",
  "analogous",
  "split-complementary",
  "tetradic",
];

function findRecCircle(circle: WheelCircle, recs: RecommendResponse | null): RecommendCircle | undefined {
  if (!recs) return undefined;
  return recs.circles.find(
    (c) => c.axis_x.pc === circle.axis_x.pc && c.axis_y.pc === circle.axis_y.pc
  );
}

function toWheelCircle(rc: RecommendCircle): WheelCircle | null {
  if (!rc.reference) return null;
  return {
    primary: rc.primary,
    axis_x: rc.axis_x,
    axis_y: rc.axis_y,
    z_x: rc.reference.z_x,
    z_y: rc.reference.z_y,
    angle_deg: rc.reference.angle_deg,
    radius: rc.reference.radius,
  };
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<MovieHit | null>(null);
  const [circles, setCircles] = useState<WheelCircle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scheme, setScheme] = useState<string>(SCHEMES[0]);
  const [recs, setRecs] = useState<RecommendResponse | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);

  const fetchRecommendations = async (itemId: number, sch: string) => {
    try {
      const r = await getRecommendations(itemId, sch);
      setRecs(r);
      setRecError(null);
    } catch {
      setRecs(null);
      setRecError(t("recommendations.error"));
    }
  };

  // Decorative only - a failed/slow TMDB lookup must never surface as
  // an app-level error (see errors.wheelLookup / recommendations.error
  // for the errors that DO matter). Fired alongside the wheel/recommend
  // calls in handleSelect, not blocking either of them.
  const fetchBackdrop = async (itemId: number) => {
    try {
      const { backdrop_url } = await getBackdrop(itemId);
      setBackdropUrl(backdrop_url);
    } catch {
      setBackdropUrl(null);
    }
  };

  const handleSelect = async (movie: MovieHit) => {
    setSelected(movie);
    setError(null);
    setRecError(null);
    setRecs(null);
    void fetchBackdrop(movie.item_id);
    // Keep the URL in sync with the current reference movie, so it's
    // shareable/bookmarkable and survives a page reload (see the
    // /{item_id} route on the backend and the sync effect below).
    const path = `/${movie.item_id}`;
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    try {
      const res = await getWheelCircles(movie.item_id);
      setCircles(res.circles);
    } catch {
      setCircles([]);
      setError(t("errors.wheelLookup"));
    }
    await fetchRecommendations(movie.item_id, scheme);
  };

  // Resolve a reference movie from just its item_id - used both for the
  // initial /{item_id} deep link and for clicking a recommendation's
  // title (which only carries an item_id, not a full MovieHit).
  const selectById = async (itemId: number) => {
    try {
      const movie = await getMovieById(itemId);
      await handleSelect(movie);
    } catch {
      setError(t("errors.wheelLookup"));
    }
  };

  // Deep-linking: load the reference movie encoded in the URL (e.g.
  // /567) on first render, and keep it in sync with browser back/forward.
  useEffect(() => {
    const syncFromUrl = () => {
      const match = window.location.pathname.match(/^\/(\d+)$/);
      if (match) {
        void selectById(Number(match[1]));
      } else {
        setSelected(null);
        setCircles([]);
        setRecs(null);
        setRecError(null);
        setError(null);
        setBackdropUrl(null);
      }
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSchemeChange = (sch: string) => {
    setScheme(sch);
    if (selected) void fetchRecommendations(selected.item_id, sch);
  };

  const displayCircles: WheelCircle[] =
    recs && !recError
      ? recs.circles.map(toWheelCircle).filter((c): c is WheelCircle => c !== null)
      : circles;

  const [primary, ...secondary] = displayCircles;

  return (
    <>
      <HeroBackdrop url={backdropUrl} />
      <div className="app">
        <div className="topbar">
          <LanguageSwitcher />
          <button
            className="about-trigger"
            onClick={() => setAboutOpen(true)}
            aria-label={t("footer.about")}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9.5" />
              <line x1="12" y1="16.2" x2="12" y2="11.5" />
              <circle cx="12" cy="7.6" r="1.3" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>

        <header className="app__header">
          <h1>{t("app.title")}</h1>
          <p>{t("app.tagline")}</p>
        </header>

        <SearchBar onSelect={handleSelect} selectedTitle={selected?.title ?? null} />

        <div className="rec-form">
          <label className="rec-form__label" htmlFor="scheme">
            {t("scheme.label")}
          </label>
          <select
            id="scheme"
            className="rec-form__select"
            value={scheme}
            onChange={(e) => handleSchemeChange(e.target.value)}
          >
            {SCHEMES.map((s) => (
              <option key={s} value={s}>
                {t(`scheme.${s}`)}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="app__error">{error}</div>}
        {recError && <div className="app__error">{recError}</div>}

        <div className="layout3">
          <aside className="layout3__left">
            {recs && !recError && (
              <RecommendationsPanel circles={recs.circles} onSelectItem={selectById} />
            )}
          </aside>

          <main className="layout3__center">
            {primary && (
              <Wheel
                key={`${primary.axis_x.pc}-${primary.axis_y.pc}`}
                circle={primary}
                size={320}
                title={selected?.title}
                overlays={findRecCircle(primary, recs)?.angles}
              />
            )}
            {selected && (
              <div className="card">
                <div className="card__title">{selected.title}</div>
                {selected.genres.length > 0 ? (
                  <div className="card__genres">
                    {selected.genres.map((g) => (
                      <span key={g} className="card__genre-badge">
                        {g}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="card__row">
                    {t("card.genres")}: {t("card.unknown")}
                  </div>
                )}
              </div>
            )}
          </main>

          <aside className="layout3__right">
            {secondary.length > 0 && (
              <div className="wheel-row__secondary">
                {secondary.map((c) => (
                  <Wheel
                    key={`${c.axis_x.pc}-${c.axis_y.pc}`}
                    circle={c}
                    size={140}
                    overlays={findRecCircle(c, recs)?.angles}
                  />
                ))}
              </div>
            )}
          </aside>
        </div>

        <footer className="app__footer app__footer--slim">
          <p>
            {t("footer.copyright", { year: new Date().getFullYear() })}
            {" · "}
            <button onClick={() => setAboutOpen(true)}>{t("footer.about")}</button>
          </p>
        </footer>

        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      </div>
    </>
  );
}
