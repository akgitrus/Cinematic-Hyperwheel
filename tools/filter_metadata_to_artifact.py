"""
Filters movies.csv down to only the movies actually present in the PCA
artifact (.npz) - i.e. movies that have Tag Genome data and can
therefore be shown on the wheel / used for recommendations.

Why this matters:

movies.csv (general MovieLens catalog) covers far more movies than the
Tag Genome does - GroupLens' ml-latest genome data covers roughly 16k
movies out of 86k+ in movies.csv (see readme.md). Searching over the
full, unfiltered movies.csv has two costs:

  - performance: MovieIndex.search() scores EVERY record on every
    keystroke - several times more records than necessary means several
    times more matching work for no benefit;
  - correctness: a movie with no tag data can never resolve a wheel -
    /api/movie/{item_id}/wheel 404s for it - so surfacing it in search
    results just leads to a dead end for the user.

Optionally also merges in links.csv (movieId,imdbId,tmdbId) - external
ids for building a direct IMDb/TMDB link instead of falling back to an
IMDb title search (see frontend/src/utils/imdb.ts). This is a 1:1 merge
on movieId, done here rather than shipped as a separate file: imdbId/
tmdbId are just more display metadata for the same movie record, needed
at the exact same point title/genres already are (see MovieRecord in
apps/web/backend/app/search.py) - keeping them in one file avoids a
second load + a second per-item_id join at request time for no benefit,
since the two datasets are already 1:1 on movieId.

Usage:
    python tools/filter_metadata_to_artifact.py \\
        --movies data/ml-latest/movies.original.csv \\
        --artifact data/ml-latest/artifact.npz \\
        --links data/ml-latest/links.csv \\
        --out data/ml-latest/movies.csv

Then point HYPERWHEEL_METADATA_PATH (or the default METADATA_PATH in
apps/web/backend/app/config.py) at the filtered file, e.g.:

    export HYPERWHEEL_METADATA_PATH=data/ml-latest/movies.csv

or simply overwrite movies.csv in place once you've checked the output
(this script never writes to --movies itself, so the original is safe
to diff against first).

--links is optional: without it, the output has the same columns as
before (movieId,title,genres) and behaves exactly as it always did.
"""
from __future__ import annotations

import argparse
import csv
import sys

from hyperwheel_recommender import load_artifact

# movies.csv can be large (86k+ rows in ml-latest) and titles/genres can
# contain very long, comma-heavy values in rare cases - bump the default
# field size limit so csv.reader doesn't choke on it. Also applies to
# links.csv, read through the same csv module.
csv.field_size_limit(10_000_000)

REQUIRED_COLUMNS = {"movieId", "title", "genres"}
LINKS_REQUIRED_COLUMNS = {"movieId", "imdbId", "tmdbId"}

# Output column names for the merged external ids. Kept distinct from
# links.csv's own header names only in spirit - re-using the same names
# (imdbId, tmdbId) since movies.csv doesn't already define them, so there
# is no collision to resolve.
IMDB_COL = "imdbId"
TMDB_COL = "tmdbId"


def load_links(path: str) -> dict[int, tuple[str, str]]:
    """
    Reads links.csv (movieId,imdbId,tmdbId) into {movieId: (imdbId, tmdbId)}.

    imdbId is read as a plain string, not int - it's a fixed-width,
    zero-padded numeric code (e.g. "0114709") and the leading zeros are
    significant: an IMDb title URL is https://www.imdb.com/title/tt<imdbId>/,
    and stripping the padding (e.g. via int()) would produce a wrong URL.
    tmdbId is a plain integer id in the source, but is also kept as a
    string here - this script only ever passes it through to a CSV
    column, never does arithmetic with it, and treats it the same as
    imdbId for consistency; it's also occasionally empty in links.csv
    (not every movie has a TMDB match), which a plain string preserves as
    "" rather than needing a sentinel.
    """
    links: dict[int, tuple[str, str]] = {}
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        missing_cols = LINKS_REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing_cols:
            raise ValueError(
                f"{path} is missing required column(s): {missing_cols} "
                f"(found: {reader.fieldnames})"
            )
        for row in reader:
            raw_id = (row.get("movieId") or "").strip()
            if not raw_id:
                continue
            try:
                movie_id = int(raw_id)
            except ValueError:
                print(f"[warning] skipping links.csv row with non-numeric movieId: {raw_id!r}", file=sys.stderr)
                continue
            links[movie_id] = (
                (row.get("imdbId") or "").strip(),
                (row.get("tmdbId") or "").strip(),
            )
    print(f"[info] loaded {len(links)} link(s) from {path}", file=sys.stderr)
    return links


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--movies", required=True, help="Full movies.csv to filter (movieId,title,genres)")
    parser.add_argument("--artifact", required=True, help="artifact.npz (produced by `hyperwheel_recommender build`)")
    parser.add_argument(
        "--links", default=None,
        help="Optional links.csv (movieId,imdbId,tmdbId) to merge in - adds "
             "imdbId/tmdbId columns to --out for building direct IMDb/TMDB "
             "links instead of falling back to an IMDb title search.",
    )
    parser.add_argument("--out", required=True, help="Where to write the filtered movies.csv")
    args = parser.parse_args()

    wide = load_artifact(args.artifact)
    # wide.index holds the raw "item" values from the source CSV - in this
    # dataset that's the numeric MovieLens movieId, stored as strings (see
    # hyperwheel_recommender/data.py and apps/web/backend/app/wheel.py,
    # which does the same int() cast when building id_to_idx) - cast back
    # to int here to match movies.csv's "movieId" column.
    valid_ids = {int(item) for item in wide.index}
    print(f"[info] artifact has {len(valid_ids)} items with tag data", file=sys.stderr)

    links = load_links(args.links) if args.links else None

    seen_ids: set[int] = set()
    kept = 0
    dropped = 0
    links_missing = 0
    with open(args.movies, "r", encoding="utf-8", newline="") as fin, \
         open(args.out, "w", encoding="utf-8", newline="") as fout:
        reader = csv.DictReader(fin)
        missing_cols = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing_cols:
            raise ValueError(
                f"{args.movies} is missing required column(s): {missing_cols} "
                f"(found: {reader.fieldnames})"
            )

        out_fieldnames = list(reader.fieldnames or [])
        if links is not None:
            out_fieldnames += [IMDB_COL, TMDB_COL]

        writer = csv.DictWriter(fout, fieldnames=out_fieldnames)
        writer.writeheader()

        for row in reader:
            raw_id = (row.get("movieId") or "").strip()
            if not raw_id:
                continue
            try:
                item_id = int(raw_id)
            except ValueError:
                print(f"[warning] skipping row with non-numeric movieId: {raw_id!r}", file=sys.stderr)
                continue

            seen_ids.add(item_id)
            if item_id in valid_ids:
                if links is not None:
                    imdb_id, tmdb_id = links.get(item_id, ("", ""))
                    if item_id not in links:
                        links_missing += 1
                    row = {**row, IMDB_COL: imdb_id, TMDB_COL: tmdb_id}
                writer.writerow(row)
                kept += 1
            else:
                dropped += 1

    print(f"[info] kept {kept} records, dropped {dropped} (no tag data) -> {args.out}", file=sys.stderr)

    if links is not None and links_missing:
        print(
            f"[warning] {links_missing} kept record(s) have no matching row in "
            f"links.csv - imdbId/tmdbId left blank for those.",
            file=sys.stderr,
        )

    missing = valid_ids - seen_ids
    if missing:
        print(
            f"[warning] {len(missing)} artifact item_id(s) have NO entry in "
            f"movies.csv at all (e.g. {sorted(missing)[:5]}...) - those "
            f"items will never be searchable by title, though "
            f"/api/movie/{{item_id}}/wheel still works if queried directly.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()