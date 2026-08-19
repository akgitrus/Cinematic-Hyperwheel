"""
Central config for the web backend. All paths are overridable via env
vars (needed on Render, where the working directory differs from local
dev), with sensible defaults matching the layout described by the repo
owner: everything under /data/ml-latest at the repo root.
"""
from __future__ import annotations

import os
from pathlib import Path

# apps/web/backend/app/config.py -> repo root is 4 levels up
REPO_ROOT = Path(__file__).resolve().parents[4]

DATA_DIR = Path(os.environ.get("HYPERWHEEL_DATA_DIR", REPO_ROOT / "data" / "ml-latest"))
METADATA_PATH = Path(os.environ.get("HYPERWHEEL_METADATA_PATH", DATA_DIR / "metadata.jsonl")) # TODO: UPDATE!
ARTIFACT_PATH = Path(os.environ.get("HYPERWHEEL_ARTIFACT_PATH", DATA_DIR / "artifact.npz"))

N_COMPONENTS = int(os.environ.get("HYPERWHEEL_N_COMPONENTS", "20"))
STANDARDIZE = os.environ.get("HYPERWHEEL_NO_STANDARDIZE", "") == ""

# Human-curated per-component labels/colors (see pc_config.py) - lives
# next to the app code, not under DATA_DIR, since it's authored content
# rather than raw/derived data.
PC_CONFIG_PATH = Path(
    os.environ.get("HYPERWHEEL_PC_CONFIG_PATH", Path(__file__).resolve().parent / "pc_config.json")
)
