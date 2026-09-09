from pathlib import Path
import base64
import json
import shutil

import build_portal_map

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"
SOURCE = ROOT / "assets" / "nichos-v2-src"

ASSETS = [
    "PLN-concavo.png",
    "PLN-convexo.png",
    "SPN-concavo.png",
    "SPN-convexo.png",
]

STANDARD_GRIDS = {
    "PLN-concavo": {
        "zone": "PLN", "side":