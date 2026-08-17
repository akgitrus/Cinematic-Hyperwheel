import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SearchBar from "./components/SearchBar";
import Wheel from "./components/Wheel";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { MovieHit, WheelCircle, getWheelCircles } from "./api";

export default function App() {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<MovieHit | null>(null);
  const [circles, setCircles] = useState<WheelCircle[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);

  const handleSelect = async (movie: MovieHit) => {
    setSelected(movie);
    setError(null);
    try {
      const res = await getWheelCircles(movie.item_id);
      setCircles(res.circles);
    } catch {
      setCircles([]);
      setError(t("errors.wheelLookup"));
    }
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

      {error && <div className="app__error">{error}</div>}

      {primary && (
        <div className="wheel-row">
          <Wheel circle={primary} size={320} title={selected?.title} />
          {secondary.length > 0 && (
            <div className="wheel-row__secondary">
              {secondary.map((c) => (
                <Wheel key={`${c.axis_x.pc}-${c.axis_y.pc}`} circle={c} size={140} />
              ))}
            </div>
          )}
        </div>
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
    </div>
  );
}
