"""
Central config for the web backend. All paths are overridable via env
vars (needed on Render, where the working directory differs from local
dev), with sensible defaults matching the layout described by the repo
owner: everything under /data/genome_2021 at the repo root.
"""
from __future__ import annotations

import os
from pathlib import Path

# apps/web/backend/app/config.py -> repo root is 4 levels up
REPO_ROOT = Path(__file__).resolve().parents[4]

DATA_DIR = Path(os.environ.get("HYPERWHEEL_DATA_DIR", REPO_ROOT / "data" / "genome_2021"))
METADATA_PATH = Path(os.environ.get("HYPERWHEEL_METADATA_PATH", DATA_DIR / "metadata.jsonl"))
ARTIFACT_PATH = Path(os.environ.get("HYPERWHEEL_ARTIFACT_PATH", DATA_DIR / "artifact.npz"))

N_COMPONENTS = int(os.environ.get("HYPERWHEEL_N_COMPONENTS", "20"))
STANDARDIZE = os.environ.get("HYPERWHEEL_NO_STANDARDIZE", "") == ""

# Fixed hue plane for the wheel visualization (1-based, same convention as
# the CLI / docs/math.md). Per-item "auto" and manual switching are a
# later step - see docs/math.md section 6a.
WHEEL_PLANE = (2, 3)  # PC2 / PC3
