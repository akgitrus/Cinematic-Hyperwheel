import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MovieHit, searchMovies } from "../api";

interface Props {
  onSelect: (movie: MovieHit) => void;
}

export default function SearchBar({ onSelect }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieHit[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        const hits = await searchMovies(query);
        setResults(hits);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <div className="search">
      <input
        className="search__input"
        placeholder={t("search.placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <ul className="search__results">
          {results.map((r) => (
            <li
              key={r.item_id}
              className="search__result"
              onMouseDown={() => {
                onSelect(r);
                setQuery(r.title);
                setOpen(false);
              }}
            >
              <span className="search__title">{r.title}</span>
              <span className="search__meta">{r.directedBy}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
