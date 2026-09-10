from pathlib import Path
import json
import shutil

import build_portal_map
import nichos_v2_builder_core as core
from nichos_v2_builder_core import *

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"
SRC_JS = ROOT / "src" / "js"
SRC_CSS = ROOT / "src" / "css"


def main():
    build_portal_map.main()
    core.patch_app_hover()
    core.patch_sharepoint_niche_codes()

    shutil.copy2(SRC_JS / "nichos-v2-preview.js", DEPLOY / "nichos-v2-preview.js")
    shutil.copy2(SRC_CSS / "nichos-v2-preview.css", DEPLOY / "nichos-v2-preview.css")
    shutil.copy2(SRC_JS / "nichos-v2-map-integration.js", DEPLOY / "nichos-v2-map-integration.js")

    core.patch_preview_runtime()

    legacy = DEPLOY / "assets" / "nichos"
    if legacy.exists():
        shutil.rmtree(legacy)

    core.generate_assets_and_geometries()
    core.inject_preview_assets()

    required = [
        DEPLOY / "index.php",
        DEPLOY / "app.js",
        DEPLOY / "nichos-v2-preview.js",
        DEPLOY / "nichos-v2-preview.css",
        DEPLOY / "nichos-v2-map-integration.js",
        DEPLOY / "sharepoint-inventario.js",
        DEPLOY / "assets/PLN-concavo.png",
        DEPLOY / "assets/PLN-convexo.png",
        DEPLOY / "assets/SPN-concavo.png",
        DEPLOY / "assets/SPN-convexo.png",
        DEPLOY / "data/PLN-concavo.geojson",
        DEPLOY / "data/PLN-convexo.geojson",
        DEPLOY / "data/SPN-concavo.geojson",
        DEPLOY / "data/SPN-convexo.geojson",
    ]
    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Archivo faltante o vacio: {path}")

    expected_counts = {
        "PLN-concavo": 402,
        "PLN-convexo": 474,
        "SPN-concavo": 306,
        "SPN-convexo": 360,
    }
    for name, expected in expected_counts.items():
        data = json.loads((DEPLOY / "data" / f"{name}.geojson").read_text(encoding="utf-8"))
        actual = len(data.get("features", []))
        if actual != expected:
            raise RuntimeError(f"Conteo inesperado en {name}: {actual} != {expected}")

    print("Preview Nichos V2 preparado con estructura src organizada.")


if __name__ == "__main__":
    main()
