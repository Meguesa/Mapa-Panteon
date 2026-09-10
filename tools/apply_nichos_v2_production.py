from __future__ import annotations

from pathlib import Path
import shutil

import build_nichos_v2_preview as preview_builder
import apply_nichos_v2_png_v12 as v14

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"No se encontro bloque esperado: {label}")
    return source.replace(old, new, 1)


def copy_runtime_files() -> None:
    for name in (
        "nichos-v2-preview.js",
        "nichos-v2-preview.css",
        "nichos-v2-map-integration.js",
    ):
        shutil.copy2(ROOT / name, DEPLOY / name)


def patch_runtime_for_production() -> None:
    runtime_path = DEPLOY / "nichos-v2-preview.js"
    source = runtime_path.read_text(encoding="utf-8")
    source = source.replace(
        "const PREVIEW_ROOT = '/mapa/preview-nichos-v2';",
        "const PREVIEW_ROOT = '/mapa';",
        1,
    )
    source = source.replace(
        "Vista de prueba con referencias visuales actualizadas",
        "Nichos · inventario y referencias visuales actualizadas",
    )
    source = source.replace("PREVIEW V2", "NICHOS")
    runtime_path.write_text(source, encoding="utf-8")


def inject_assets_into_index() -> None:
    index_path = DEPLOY / "index.php"
    source = index_path.read_text(encoding="utf-8")

    if "nichos-v2-preview.css" not in source:
        source = replace_once(
            source,
            '<link rel="stylesheet" href="./portal-integration.css?v=5" />',
            '<link rel="stylesheet" href="./portal-integration.css?v=5" />\n'
            '  <link rel="stylesheet" href="./nichos-v2-preview.css?v=14" />',
            "CSS Nichos V2",
        )

    if "nichos-v2-preview.js" not in source:
        source = replace_once(
            source,
            "</body>",
            '  <script src="./nichos-v2-preview.js?v=14"></script>\n'
            '  <script src="./nichos-v2-map-integration.js?v=14"></script>\n'
            "</body>",
            "JS Nichos V2",
        )

    index_path.write_text(source, encoding="utf-8")


def validate() -> None:
    required = [
        DEPLOY / "index.php",
        DEPLOY / "nichos-v2-preview.js",
        DEPLOY / "nichos-v2-preview.css",
        DEPLOY / "nichos-v2-map-integration.js",
        DEPLOY / "assets" / "PLN-concavo.png",
        DEPLOY / "assets" / "PLN-convexo.png",
        DEPLOY / "assets" / "SPN-concavo.png",
        DEPLOY / "assets" / "SPN-convexo.png",
        DEPLOY / "data" / "PLN-concavo.geojson",
        DEPLOY / "data" / "PLN-convexo.geojson",
        DEPLOY / "data" / "SPN-concavo.geojson",
        DEPLOY / "data" / "SPN-convexo.geojson",
    ]
    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Archivo de produccion faltante o vacio: {path}")

    index = (DEPLOY / "index.php").read_text(encoding="utf-8")
    runtime = (DEPLOY / "nichos-v2-preview.js").read_text(encoding="utf-8")

    for marker in (
        "nichos-v2-preview.css?v=14",
        "nichos-v2-preview.js?v=14",
        "nichos-v2-map-integration.js?v=14",
    ):
        if marker not in index:
            raise RuntimeError(f"Marcador faltante en index.php: {marker}")

    if "const PREVIEW_ROOT = '/mapa';" not in runtime:
        raise RuntimeError("Nichos V2 no apunta al root de produccion /mapa")


def main() -> None:
    # build_portal_map.py debe haberse ejecutado antes.
    copy_runtime_files()
    preview_builder.patch_app_hover()
    preview_builder.patch_sharepoint_niche_codes()
    preview_builder.patch_preview_runtime()

    # Genera PNG/GeoJSON finales y aplica las mejoras funcionales validadas en v14.
    preview_builder.generate_assets_and_geometries()
    v14.regenerate_geometry_for_new_images()
    v14.apply_v11_functionality_without_external_assets()
    v14.add_label_backing_and_bump_cache()

    patch_runtime_for_production()
    inject_assets_into_index()
    validate()
    print("Nichos V2 integrados al paquete de produccion /mapa/.")


if __name__ == "__main__":
    main()
