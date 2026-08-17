import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SearchBar from "./components/SearchBar";
import Wheel from "./components/Wheel";
import LanguageSwitcher from "./components/LanguageSwitcher";
import {
  MovieHit,
  RecAngle,
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

// Build per-circle recommendation overlays, using each item's z-scores on that
// circle's own PCA plane (falls back to nothing if the plane isn't covered).
function buildOverlays(circle: WheelCircle, recs: RecommendResponse | null): RecAngle[] | undefined {
  if (!recs) return undefined;
  const xp = circle.axis_x.pc;
  const yp = circle.axis_y.pc;
  return recs.angles.map((a) => ({
    angle_deg: a.angle_deg,
    items: a.items
      .filter((it) => it.pc_z && it.pc_z[String(xp)] != null && it.pc_z[String(yp)] != null)
      .map((it) => ({ ...it, z_x: it.pc_z[String(xp)], z_y: it.pc_z[String(yp)] })),
  }));
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

  const [primary, ...secondary] = circles;

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
          {recs && (
            <div className="recommendations">
              <h2 className="recommendations__title">{t("recommendations.title")}</h2>
              {recs.angles.map((a, gi) => (
                <div key={gi} className="recommendations__angle">
                  <div className="recommendations__angle-head">
                    {t("recommendations.angle", { angle: a.angle_deg })}
                  </div>
                  <ol className="recommendations__list">
                    {a.items.map((it) => (
                      <li key={it.item_id} className="recommendations__item">
                        {it.title}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </aside>

        <main className="layout3__center">
          {primary && (
            <Wheel
              circle={primary}
              size={320}
              title={selected?.title}
              overlays={buildOverlays(primary, recs)}
            />
          )}
          {selected && (
            <div className="card">
              <div className="card__title">{selected.title}</div>
              <div className="card__row">
                {t("card.director")}: {selected.directedBy || t("card.unknown")}
              </div>
              <div className="card__row">
                {t("card.starring")}: {selected.starring || t("card.unknown")}
              </div>
              <div className="card__row">
                {t("card.rating")}: {selected.avgRating ?? t("card.unknown")}
              </div>
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
                  overlays={buildOverlays(c, recs)}
                />
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
