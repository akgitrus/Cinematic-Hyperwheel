"""
Filters metadata.jsonl down to only the movies actually present in the
PCA artifact (.npz) - i.e. movies that have Tag Genome data and can
therefore be shown on the wheel / used for recommendations.

Why this matters:

metadata.jsonl (general MovieLens metadata) covers far more movies than
the Tag Genome does (readme.md: 9,734 movies with tag data). Searching
over the full, unfiltered metadata.jsonl (e.g. 84,661 records) has two
costs:

  - performance: MovieIndex.search() scores EVERY record on every
    keystroke - 8-9x more records than necessary means 8-9x more
    fuzzy-matching work for no benefit;
  - correctness: a movie with no tag data can never resolve a wheel -
    /api/movie/{item_id}/wheel 404s for it - so surfacing it in search
    results just leads to a dead end for the user.

Usage:
    python tools/filter_metadata_to_artifact.py \\
        --metadata data/genome_2021/metadata.jsonl \\
        --artifact data/genome_2021/artifact.npz \\
        --out data/genome_2021/metadata.filtered.jsonl

Then point HYPERWHEEL_METADATA_PATH (or the default METADATA_PATH in
apps/web/backend/app/config.py) at the filtered file, e.g.:

    export HYPERWHEEL_METADATA_PATH=data/genome_2021/metadata.filtered.jsonl

or simply overwrite metadata.jsonl in place once you've checked the
output (this script never writes to --metadata itself, so the original
is safe to diff against first).
"""
from __future__ import annotations

import argparse
import json
import sys

from hyperwheel_recommender import load_artifact


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--metadata", required=True, help="Full metadata.jsonl to filter")
    parser.add_argument("--artifact", required=True, help="artifact.npz (produced by `hyperwheel_recommender build`)")
    parser.add_argument("--out", required=True, help="Where to write the filtered metadata.jsonl")
    args = parser.parse_args()

    wide = load_artifact(args.artifact)
    # wide.index holds the raw "item" values from the source CSV - in this
    # dataset that's the numeric MovieLens item_id, stored as strings (see
    # hyperwheel_recommender/data.py and apps/web/backend/app/wheel.py,
    # which does the same int() cast when building id_to_idx) - cast back
    # to int here to match metadata.jsonl's "item_id" field.
    valid_ids = {int(item) for item in wide.index}
    print(f"[info] artifact has {len(valid_ids)} items with tag data", file=sys.stderr)

    seen_ids: set[int] = set()
    kept = 0
    dropped = 0
    with open(args.metadata, "r", encoding="utf-8") as fin, \
         open(args.out, "w", encoding="utf-8") as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            item_id = record.get("item_id")
            seen_ids.add(item_id)
            if item_id in valid_ids:
                fout.write(line + "\n")
                kept += 1
            else:
                dropped += 1

    print(f"[info] kept {kept} records, dropped {dropped} (no tag data) -> {args.out}", file=sys.stderr)

    missing = valid_ids - seen_ids
    if missing:
        print(
            f"[warning] {len(missing)} artifact item_id(s) have NO entry in "
            f"metadata.jsonl at all (e.g. {sorted(missing)[:5]}...) - those "
            f"items will never be searchable by title/director/cast, though "
            f"/api/movie/{{item_id}}/wheel still works if queried directly.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()