import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SearchBar from "./components/SearchBar";
import Wheel from "./components/Wheel";
import LanguageSwitcher from "./components/LanguageSwitcher";
import RecommendationsPanel from "./components/RecommendationsPanel";
import {
  MovieHit,
  RecommendCircle,
  RecommendResponse,
  WheelCircle,
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

  const handleSelect = async (movie: MovieHit) => {
    setSelected(movie);
    setError(null);
    setRecError(null);
    setRecs(null);
    try {
      const res = await getWheelCircles(movie.item_id);
      setCircles(res.circles);
    } catch {
      setCircles([]);
      setError(t("errors.wheelLookup"));
    }
    await fetchRecommendations(movie.item_id, scheme);
  };

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
    <div className="app">
      <LanguageSwitcher />

      <header className="app__header">
        <h1>{t("app.title")}</h1>
        <p>{t("app.tagline")}</p>
      </header>

      <SearchBar onSelect={handleSelect} />

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
          {recs && !recError && <RecommendationsPanel circles={recs.circles} />}
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

      <footer className="app__footer">
        <p>
          {t("footer.text")}{" "}
          <a
            href="https://grouplens.org/datasets/movielens/latest/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("footer.datasetLink")}
          </a>
          .
        </p>
        <p className="app__footer-citation">{t("footer.citation")}</p>
      </footer>
    </div>
  );
}
