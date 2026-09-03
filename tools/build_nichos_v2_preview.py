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


def patch_app_hover() -> None:
    """Hace que las zonas de nichos tengan el mismo hover/nombre que secciones."""
    app_path = DEPLOY / "app.js"
    source = app_path.read_text(encoding="utf-8")

    old = """      layer.on('mouseover', () => {
        if (pinnedNichoZonaLayer !== layer) layer.setStyle(hoverStyle(col));
      });
      layer.on('mouseout', () => {
        if (pinnedNichoZonaLayer !== layer) layer.setStyle({ ...hiddenStyle(), color: col, fillColor: col });
      });"""

    new = """      layer.on('mouseover', () => {
        if (pinnedNichoZonaLayer !== layer) layer.setStyle(hoverStyle(col));
        const label = (feature?.properties?.nombre || feature?.properties?.label || feature?.properties?.id || feature?.properties?.zonaId || 'Zona de nichos').toString().trim();
        showHoverNameTooltip(layer, label, 'nicho');
      });
      layer.on('mouseout', () => {
        clearHoverNameTooltip();
        if (pinnedNichoZonaLayer !== layer) layer.setStyle({ ...hiddenStyle(), color: col, fillColor: col });
      });"""

    if old not in source:
        raise RuntimeError("No se encontro el bloque hover esperado de zonas de nichos en deploy/app.js")

    source = source.replace(old, new, 1)
    app_path.write_text(source, encoding="utf-8")


def inject_preview_assets() -> None:
    index_path = DEPLOY / "index.php"
    source = index_path.read_text(encoding="utf-8")

    source = source.replace(
        '<link rel="stylesheet" href="./portal-integration.css?v=5" />',
        '<link rel="stylesheet" href="./portal-integration.css?v=5" />\n'
        '  <link rel="stylesheet" href="./nichos-v2-preview.css?v=3" />',
        1,
    )

    source = source.replace(
        "</body>",
        '  <script src="./nichos-v2-preview.js?v=3"></script>\n'
        '  <script src="./nichos-v2-map-integration.js?v=3"></script>\n'
        '</body>',
        1,
    )

    # El preview vive un nivel debajo de /mapa/. El bootstrap del Portal esta
    # en la raiz del sitio, por lo que hay que subir dos niveles.
    source = source.replace(
        "require_once dirname(__DIR__) . '/includes/bootstrap.php';",
        "require_once dirname(__DIR__, 2) . '/includes/bootstrap.php';",
        1,
    )

    index_path.write_text(source, encoding="utf-8")


def main() -> None:
    build_portal_map.main()

    # El loader existente de sharepoint-inventario.js se conserva intacto.
    # Ese archivo ya intercepta /data/inventario-base.json también dentro de
    # /mapa/preview-nichos-v2/ y obtiene la misma lista real de SharePoint que
    # usa el mapa productivo. Su Redirect URI permanece en /mapa/ para usar la
    # configuración MSAL ya registrada y, con navigateToLoginRequestUrl=true,
    # regresar a la página que inició la autenticación.
    patch_app_hover()

    shutil.copy2(ROOT / "nichos-v2-preview.js", DEPLOY / "nichos-v2-preview.js")
    shutil.copy2(ROOT / "nichos-v2-preview.css", DEPLOY / "nichos-v2-preview.css")
    shutil.copy2(ROOT / "nichos-v2-map-integration.js", DEPLOY / "nichos-v2-map-integration.js")

    legacy_niche_assets = DEPLOY / "assets" / "nichos"
    if legacy_niche_assets.exists():
        shutil.rmtree(legacy_niche_assets)

    for relative_path, url in FILES.items():
        download(url, DEPLOY / relative_path)

    inject_preview_assets()

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
        DEPLOY / "data/PLN-concavo.geojson",
        DEPLOY / "data/PLN-convexo.geojson",
        DEPLOY / "data/SPN-concavo.geojson",
    ]

    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Archivo de preview faltante o vacio: {path}")

    sharepoint_source = (DEPLOY / "sharepoint-inventario.js").read_text(encoding="utf-8")
    if 'listId: "208b6147-b487-48f8-ba3f-97aeb1ba9021"' not in sharepoint_source:
        raise RuntimeError("El preview no contiene el loader de la lista SharePoint esperada")

    app_source = (DEPLOY / "app.js").read_text(encoding="utf-8")
    if "showHoverNameTooltip(layer, label, 'nicho')" not in app_source:
        raise RuntimeError("El hover con nombre de zonas de nichos no quedo integrado")

    print("Preview Nichos V2 preparado para /mapa/preview-nichos-v2/")


if __name__ == "__main__":
    main()
