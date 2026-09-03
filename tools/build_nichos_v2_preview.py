from pathlib import Path
import shutil
import urllib.request

import build_portal_map

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"

V2_RAW = "https://raw.githubusercontent.com/Sabbathycal/Mapa-Panteon/V2"

FILES = {
    "assets/PLN-concavo.png": f"{V2_RAW}/src/assets/images/nichos/normalizadas/PLN-concavo.png",
    "assets/PLN-convexo.png": f"{V2_RAW}/src/assets/images/nichos/normalizadas/PLN-convexo.png",
    "assets/SPN-concavo.png": f"{V2_RAW}/src/assets/images/nichos/normalizadas/SPN-concavo.png",
    "data/PLN-concavo.geojson": f"{V2_RAW}/src/assets/data/nichos/PLN-concavo.geojson",
    "data/PLN-convexo.geojson": f"{V2_RAW}/src/assets/data/nichos/PLN-convexo.geojson",
    "data/SPN-concavo.geojson": f"{V2_RAW}/src/assets/data/nichos/SPN-concavo.geojson",
}


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "JdJP-Mapa-Preview/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        destination.write_bytes(response.read())


def inject_preview_assets() -> None:
    index_path = DEPLOY / "index.php"
    source = index_path.read_text(encoding="utf-8")

    source = source.replace(
        '<link rel="stylesheet" href="./portal-integration.css?v=5" />',
        '<link rel="stylesheet" href="./portal-integration.css?v=5" />\n'
        '  <link rel="stylesheet" href="./nichos-v2-preview.css?v=2" />',
        1,
    )

    source = source.replace(
        "</body>",
        '  <script src="./nichos-v2-preview.js?v=2"></script>\n'
        '  <script src="./nichos-v2-map-integration.js?v=2"></script>\n'
        '</body>',
        1,
    )

    # El preview vive un nivel debajo de /mapa/. El bootstrap del Portal está
    # en la raíz del sitio, por lo que hay que subir dos niveles.
    source = source.replace(
        "require_once dirname(__DIR__) . '/includes/bootstrap.php';",
        "require_once dirname(__DIR__, 2) . '/includes/bootstrap.php';",
        1,
    )

    index_path.write_text(source, encoding="utf-8")


def main() -> None:
    build_portal_map.main()

    shutil.copy2(ROOT / "nichos-v2-preview.js", DEPLOY / "nichos-v2-preview.js")
    shutil.copy2(ROOT / "nichos-v2-preview.css", DEPLOY / "nichos-v2-preview.css")
    shutil.copy2(ROOT / "nichos-v2-map-integration.js", DEPLOY / "nichos-v2-map-integration.js")

    # Las imágenes antiguas de nichos son muy pesadas y no son necesarias para
    # este preview. Se sustituyen por las imágenes normalizadas de V2.
    legacy_niche_assets = DEPLOY / "assets" / "nichos"
    if legacy_niche_assets.exists():
        shutil.rmtree(legacy_niche_assets)

    for relative_path, url in FILES.items():
        download(url, DEPLOY / relative_path)

    inject_preview_assets()

    required = [
        DEPLOY / "index.php",
        DEPLOY / "nichos-v2-preview.js",
        DEPLOY / "nichos-v2-preview.css",
        DEPLOY / "nichos-v2-map-integration.js",
        DEPLOY / "assets/PLN-concavo.png",
        DEPLOY / "assets/PLN-convexo.png",
        DEPLOY / "assets/SPN-concavo.png",
        DEPLOY / "data/PLN-concavo.geojson",
        DEPLOY / "data/PLN-convexo.geojson",
        DEPLOY / "data/SPN-concavo.geojson",
    ]

    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Archivo de preview faltante o vacío: {path}")

    print("Preview Nichos V2 preparado para /mapa/preview-nichos-v2/")


if __name__ == "__main__":
    main()
