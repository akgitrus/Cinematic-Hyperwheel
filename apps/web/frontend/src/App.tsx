import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SearchBar from "./components/SearchBar";
import Wheel from "./components/Wheel";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { MovieHit, WheelPoint, getWheelPoint } from "./api";

export default function App() {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<MovieHit | null>(null);
  const [point, setPoint] = useState<WheelPoint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);

  const handleSelect = async (movie: MovieHit) => {
    setSelected(movie);
    setError(null);
    try {
      const p = await getWheelPoint(movie.item_id);
      setPoint(p);
    } catch {
      setPoint(null);
      setError(t("errors.wheelLookup"));
    }
  };

  return (
    <div className="app">
      <LanguageSwitcher />

      <header className="app__header">
        <h1>{t("app.title")}</h1>
        <p>{t("app.tagline")}</p>
      </header>

      <SearchBar onSelect={handleSelect} />

      {error && <div className="app__error">{error}</div>}

      <Wheel point={point} title={selected?.title} />

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
