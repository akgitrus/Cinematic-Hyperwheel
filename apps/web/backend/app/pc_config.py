"""
Human-curated interpretation of individual PCA components.

Produced once, by hand, by running `diagnose` and reading each
component's criteria weights + the real items at each pole (docs/math.md
section 4), then deciding what the axis represents and how to label/color
it for the wheel UI, in every supported language.

Only components with an entry here are eligible to be shown as a circle.
This does double duty:
  - it bounds candidate_components for hue-plane selection - no risk of
    landing on an unreviewed, possibly-noise tail component
    (docs/math.md section 6a);
  - it guarantees every circle we render has a reviewed label/color for
    both poles, in every language the UI supports.

Expected shape per component (see pc_config.json for a filled example):
{
  "<1-based PC index as string>": {
    "excluded_from_hue": bool,       # e.g. true for a known "quality" axis
    "colors": {"negative": "#hex", "positive": "#hex"},
    "labels": {
      "<lang code>": {"axis": str, "negative": str, "positive": str},
      ...
    }
  },
  ...
}
"""
from __future__ import annotations

import json

from .config import PC_CONFIG_PATH


def load_pc_config() -> dict[int, dict]:
    with open(PC_CONFIG_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return {int(k): v for k, v in raw.items()}
