from __future__ import annotations

from pathlib import Path
import shutil

import build_nichos_v2_preview as preview_builder
import apply_nichos_v2_png_v12 as v14
import apply_nichos_v2_v11 as v11

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"
SRC_JS = ROOT / "src" / "js"
SRC_CSS = ROOT / "src" / "css"
NICHOS_IMAGE_VERSION = "15"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"No se encontro bloque esperado: {label}")
    return source.replace(old, new, 1)


def copy_runtime_files() -> None:
    files = {
        SRC_JS / "nichos-v2-preview.js": DEPLOY / "nichos-v2-preview.js",
        SRC_CSS / "nichos-v2-preview.css": DEPLOY / "nichos-v2-preview.css",
        SRC_JS / "nichos-v2-map-integration.js": DEPLOY / "nichos-v2-map-integration.js",
    }
    for source, destination in files.items():
        if not source.is_file():
            raise RuntimeError(f"Archivo fuente faltante: {source}")
        shutil.copy2(source, destination)


def generate_optimized_niche_images() -> None:
    """Genera WebP de visualizacion sin alterar los PNG maestros.

    Las geometrías de Nichos V2 trabajan sobre un lienzo normalizado de 2048 px,
    por lo que 4096 px de ancho conserva 2x de densidad para zoom en pantallas
    retina sin obligar al navegador a descargar PNG de 40-55 MB.
    """
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "Pillow no esta instalado. El workflow debe instalarlo antes del build."
        ) from exc

    assets_dir = DEPLOY / "assets"
    for name in ("PLN-concavo", "PLN-convexo", "SPN-concavo", "SPN-convexo"):
        source = assets_dir / f"{name}.png"
        destination = assets_dir / f"{name}.webp"
        if not source.is_file():
            raise RuntimeError(f"Imagen PNG fuente faltante: {source}")

        with Image.open(source) as image:
            image.load()
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGB")

            if image.width > 4096:
                ratio = 4096 / float(image.width)
                target_height = max(1, round(image.height * ratio))
                image = image.resize((4096, target_height), Image.Resampling.LANCZOS)

            image.save(
                destination,
                format="WEBP",
                quality=86,
                method=6,
            )

        if not destination.is_file() or destination.stat().st_size == 0:
            raise RuntimeError(f"No se genero WebP optimizado: {destination}")

        original_mb = source.stat().st_size / 1024 / 1024
        optimized_mb = destination.stat().st_size / 1024 / 1024
        print(f"{name}: PNG {original_mb:.1f} MB -> WebP {optimized_mb:.1f} MB")


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

    # Produccion usa las copias WebP ligeras. Los PNG quedan como maestros de
    # construccion y respaldo, pero ya no se descargan al abrir un columbario.
    for name in ("PLN-concavo", "PLN-convexo", "SPN-concavo", "SPN-convexo"):
        source = source.replace(
            f"/assets/{name}.png?v=14",
            f"/assets/{name}.webp?v={NICHOS_IMAGE_VERSION}",
        )
        source = source.replace(
            f"/assets/{name}.png`",
            f"/assets/{name}.webp?v={NICHOS_IMAGE_VERSION}`",
        )

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


def apply_preview_functionality_without_version_bump() -> None:
    v11.ASSET_NAMES = ()
    v11.patch_runtime()
    v11.patch_styles()


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
        DEPLOY / "assets" / "PLN-concavo.webp",
        DEPLOY / "assets" / "PLN-convexo.webp",
        DEPLOY / "assets" / "SPN-concavo.webp",
        DEPLOY / "assets" / "SPN-convexo.webp",
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

    for marker in (
        "nichesVisible: true",
        "state.nichesVisible = !state.nichesVisible",
        "function renderVectorLabels",
        "const normalizedWidth = 2048",
        "function fitWholeImage",
        f"SPN-concavo.webp?v={NICHOS_IMAGE_VERSION}",
    ):
        if marker not in runtime:
            raise RuntimeError(f"Funcionalidad Nichos V2 faltante: {marker}")


def main() -> None:
    # build_portal_map.py debe haberse ejecutado antes.
    copy_runtime_files()
    preview_builder.patch_app_hover()
    preview_builder.patch_sharepoint_niche_codes()
    preview_builder.patch_preview_runtime()

    # Genera los PNG maestros/GeoJSON y aplica la calibracion validada.
    preview_builder.generate_assets_and_geometries()
    v14.regenerate_geometry_for_new_images()
    apply_preview_functionality_without_version_bump()
    v14.add_label_backing_and_bump_cache()

    # A partir de los maestros generamos recursos ligeros exclusivamente para
    # la experiencia web de produccion.
    generate_optimized_niche_images()
    patch_runtime_for_production()
    inject_assets_into_index()
    validate()
    print("Nichos V2 integrados al paquete de produccion /mapa/ con imagenes WebP optimizadas.")


if __name__ == "__main__":
    main()
