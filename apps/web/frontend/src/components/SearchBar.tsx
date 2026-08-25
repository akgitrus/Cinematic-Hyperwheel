import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MovieHit, Span, searchMovies } from "../api";
import "./SearchBar.css";

interface Props {
  onSelect: (movie: MovieHit) => void;
  /**
   * Title of the currently selected reference movie, if any. Keeps the
   * input in sync when the reference changes through a path other than
   * this search box itself - e.g. clicking a recommendation's title, or
   * loading a deep-linked /{item_id} URL.
   */
  selectedTitle?: string | null;
  selectedMovie?: MovieHit | null;
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

function SearchIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </svg>
  );
}

export default function SearchBar({ onSelect, selectedTitle = null, selectedMovie = null }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieHit[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(selectedMovie == null);
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

  // Keep the input in sync with the reference movie set externally (a
  // recommendation title click, or a deep-linked /{item_id} URL) - those
  // paths never touch this component's own query state, so without this
  // the box would keep showing whatever was last typed/picked here.
  useEffect(() => {
    if (selectedTitle == null || selectedTitle === query) return;
    suppressNextSearchRef.current = selectedTitle;
    setQuery(selectedTitle);
    setOpen(false);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTitle]);

  useEffect(() => {
    if (selectedMovie) {
      setQuery(selectedMovie.title);
      setEditing(false);
    } else {
      setEditing(true);
    }
  }, [selectedMovie?.item_id, selectedMovie?.title]);

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

    if (query.trim().length < 2 || !editing) {
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
  }, [query, editing]);

  const handleSelect = (r: MovieHit) => {
    onSelect(r);
    // FIX: mark the upcoming query change as "programmatic" before
    // triggering it, so the effect above ignores it.
    suppressNextSearchRef.current = r.title;
    setQuery(r.title);
    setEditing(false);
    setOpen(false);
  };

  const beginEditing = () => {
    suppressNextSearchRef.current = query;
    setEditing(true);
    requestAnimationFrame(() => {
      document.getElementById("reference-search-input")?.focus();
      (document.getElementById("reference-search-input") as HTMLInputElement | null)?.select();
    });
  };

  const cancelEditing = () => {
    setEditing(false);
    setQuery(selectedMovie?.title ?? query);
    setResults([]);
    setOpen(false);
  };

  const renderSelectedContent = () => (
    <div className="search__selected">
      {editing ? (
        <div className="search__editor">
          <input
            id="reference-search-input"
            className="search__input search__selected-input"
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
            onBlur={() => {
              window.setTimeout(() => {
                setOpen(false);
                if (!selectedMovie) return;
                if (document.activeElement?.closest(".search__editor")) return;
                cancelEditing();
              }, 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && selectedMovie) {
                e.preventDefault();
                cancelEditing();
              }
            }}
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
      ) : (
        <>
          <button
            type="button"
            className="search__selected-title"
            onClick={beginEditing}
            aria-label={t("search.placeholder")}
          >
            {selectedMovie?.title ?? query}
          </button>
          <button
            type="button"
            className="search__selected-search"
            onClick={beginEditing}
            aria-label={t("search.placeholder")}
            title={t("search.placeholder")}
          >
            <SearchIcon />
          </button>
        </>
      )}
      {selectedMovie && (
        selectedMovie.genres.length > 0 ? (
          <div className="search__selected-genres">
            {selectedMovie.genres.map((g) => (
              <span key={g} className="card__genre-badge">
                {g}
              </span>
            ))}
          </div>
        ) : (
          <div className="search__selected-row">
            {t("card.genres")}: {t("card.unknown")}
          </div>
        )
      )}
    </div>
  );

  if (!selectedMovie) {
    return (
      <div className="search">
        {renderSelectedContent()}
      </div>
    );
  }

  return (
    <div className="search card search--selected">
      {renderSelectedContent()}
    </div>
  );
}
