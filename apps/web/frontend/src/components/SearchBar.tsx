import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MovieHit, Span, searchMovies } from "../api";

interface Props {
  onSelect: (movie: MovieHit) => void;
}

// Renders `text` with the given character spans wrapped in <mark>.
// Spans come pre-computed from the backend (both the "where did this
// match" offsets and, for cast, the truncation window are decided
// server-side - the client just paints the ranges it's given).
function renderHighlighted(text: string, spans: Span[]) {
  if (!text || spans.length === 0) return text;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={i} className="search__hl">
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
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
              <div className="search__result-main">
                <span className="search__title">
                  {renderHighlighted(r.title, r.titleHighlights)}
                </span>
                <span className="search__meta">
                  {renderHighlighted(r.directedBy, r.directedByHighlights)}
                </span>
              </div>
              {r.castPreview && (
                <div className="search__cast">
                  {renderHighlighted(r.castPreview, r.castPreviewHighlights)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
