"""CLI: `python -m hyperwheel build|diagnose|recommend ...`"""

from __future__ import annotations

import argparse
import time

from .data import load_input, load_matrix, save_artifact
from .diagnose import diagnose
from .recommend import recommend
from .rotation import SCHEMES


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Hyperwheel item recommender (PCA-based color-wheel schemes for N criteria)"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_build = sub.add_parser(
        "build",
        help="One-off: turn a CSV into a compact .npz artifact - for the "
             "serve stage (a web service should not re-parse the source "
             "CSV on every start)",
    )
    p_build.add_argument("csv_path")
    p_build.add_argument("--out", required=True, help="Where to save the .npz artifact")
    p_build.add_argument("--chunksize", type=int, default=500_000)

    p_diag = sub.add_parser("diagnose", help="How many PCA components are actually needed")
    p_diag.add_argument("input_path", help="CSV or .npz (from build)")
    p_diag.add_argument("--max-components", type=int, default=10)
    p_diag.add_argument(
        "--loadings-components", type=int, default=2,
        help="For how many first components to show criteria weights",
    )
    p_diag.add_argument(
        "--loadings-top", type=int, default=10,
        help="How many criteria to show at each end of the axis",
    )
    p_diag.add_argument(
        "--items-top", type=int, default=10,
        help="How many items to show at each pole of a component",
    )
    p_diag.add_argument(
        "--no-standardize", action="store_true",
        help="Disable z-scoring criteria before PCA (enabled by default - "
             "without it, criteria with a larger spread artificially dominate)",
    )

    p_rec = sub.add_parser("recommend", help="Find items matching a color-wheel scheme")
    p_rec.add_argument("input_path", help="CSV or .npz (from build)")
    p_rec.add_argument("--item", required=True, help="Name of the reference item")
    p_rec.add_argument(
        "--scheme", required=True, choices=list(SCHEMES),
        help="complementary / triadic / analogous / split-complementary / tetradic",
    )
    p_rec.add_argument("--n-components", type=int, default=3)
    p_rec.add_argument("--top-k", type=int, default=5)
    p_rec.add_argument("--out", default=None, help="Save the result to a CSV")
    p_rec.add_argument(
        "--hue-components", default="2,3",
        help="Which 2 components (1-based, comma-separated) to rotate. "
             "Defaults to '2,3' - PC1 is skipped since it often turns out "
             "to be a general-quality axis rather than taste/character. "
             "Check diagnose --items-top to decide which components are "
             "meaningful to rotate.",
    )
    p_rec.add_argument(
        "--no-standardize", action="store_true",
        help="Disable z-scoring criteria before PCA (enabled by default)",
    )

    args = parser.parse_args()

    if args.command == "build":
        t0 = time.time()
        wide = load_matrix(args.csv_path, chunksize=args.chunksize)
        save_artifact(wide, args.out)
        print(
            f"Done: {wide.shape[0]} items x {wide.shape[1]} criteria "
            f"-> {args.out} in {time.time() - t0:.1f}s"
        )
        return

    wide = load_input(args.input_path)

    if args.command == "diagnose":
        diagnose(
            wide,
            max_components=args.max_components,
            loadings_components=args.loadings_components,
            loadings_top=args.loadings_top,
            items_top=args.items_top,
            standardize=not args.no_standardize,
        )
    elif args.command == "recommend":
        hue_components = tuple(int(x) for x in args.hue_components.split(","))
        if len(hue_components) != 2:
            parser.error("--hue-components must contain exactly 2 numbers, e.g. '2,3'")
        result = recommend(
            wide,
            reference_item=args.item,
            scheme=args.scheme,
            n_components=args.n_components,
            top_k=args.top_k,
            standardize=not args.no_standardize,
            hue_components=hue_components,
        )
        print(result.to_string(index=False))
        if args.out:
            result.to_csv(args.out, index=False)
            print(f"\nSaved to {args.out}")


if __name__ == "__main__":
    main()