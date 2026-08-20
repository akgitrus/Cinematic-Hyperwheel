import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MovieHit, Span, searchMovies } from "../api";

interface Props {
  onSelect: (movie: MovieHit) => void;
}

// Renders `text` with the given character spans wrapped in <mark>.
// Spans come pre-computed from the backend - the client just paints the
// ranges it's given.
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
  // FIX: monotonically increasing id per fired request, so that when
  // several searches are in flight at once (typing faster than the
  // debounce window lets them settle), a late-arriving response for an
  // OLDER keystroke can be detected and dropped instead of clobbering
  // the results of a newer one that already resolved - this is what was
  // causing the "flicker" of stale result sets while typing fast.
  const requestIdRef = useRef(0);
  // FIX: sentinel query value we just set programmatically (on select),
  // so the search effect can recognize "this change came from picking a
  // result, not from typing" and skip re-searching/reopening for it.
  const suppressNextSearchRef = useRef<string | null>(null);

  useEffect(() => {
    window.clearTimeout(debounceRef.current);

    // FIX: if this exact query value was just set by handleSelect below,
    // consume the flag and skip firing a search for it - otherwise the
    // debounced search resolves ~250ms+ after selection and calls
    // setOpen(true) again, making the dropdown pop back open on its own.
    if (suppressNextSearchRef.current === query) {
      suppressNextSearchRef.current = null;
      return;
    }

    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      const myRequestId = ++requestIdRef.current;
      try {
        const hits = await searchMovies(query);
        // FIX: a newer request was fired (and possibly already resolved)
        // while this one was in flight - discard this stale response.
        if (myRequestId !== requestIdRef.current) return;
        setResults(hits);
        setOpen(true);
      } catch {
        if (myRequestId !== requestIdRef.current) return;
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(debounceRef.current);
  }, [query]);

  const handleSelect = (r: MovieHit) => {
    onSelect(r);
    // FIX: mark the upcoming query change as "programmatic" before
    // triggering it, so the effect above ignores it.
    suppressNextSearchRef.current = r.title;
    setQuery(r.title);
    setOpen(false);
  };

  return (
    <div className="search">
      <input
        className="search__input"
        placeholder={t("search.placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={(e) => {
          // Select-all on focus, so clicking/tabbing into an already-filled
          // field (e.g. after picking a result) lets the user immediately
          // retype instead of having to manually clear it first.
          e.target.select();
          if (results.length) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <ul className="search__results">
          {results.map((r) => (
            <li
              key={r.item_id}
              className="search__result"
              onMouseDown={() => handleSelect(r)}
            >
              <div className="search__result-main">
                <span className="search__title">
                  {renderHighlighted(r.title, r.titleHighlights)}
                </span>
              </div>
              {/* Genres are shown but never highlighted - they aren't
                  part of the match, only the title is (see search.py). */}
              {r.genres.length > 0 && (
                <div className="search__genres">
                  {r.genres.map((g) => (
                    <span key={g} className="search__genre-badge">
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
