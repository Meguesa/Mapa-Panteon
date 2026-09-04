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


def patch_sharepoint_niche_codes() -> None:
    """Alinea el código derivado de nichos con la nomenclatura oficial de 3 dígitos."""
    path = DEPLOY / "sharepoint-inventario.js"
    source = path.read_text(encoding="utf-8")

    old = 'String(Number(codigoRaw)).padStart(2, "0")'
    new = 'String(Number(codigoRaw)).padStart(3, "0")'

    if old not in source:
        raise RuntimeError("No se encontro padStart(2) de nichos en sharepoint-inventario.js")

    source = source.replace(old, new, 1)
    path.write_text(source, encoding="utf-8")


def patch_preview_runtime() -> None:
    """Adapta el preview V2 a la nomenclatura oficial de BI_Parque_Inventario."""
    path = DEPLOY / "nichos-v2-preview.js"
    source = path.read_text(encoding="utf-8")

    old_identity = """    let block = row;

    if (zone === 'PLN' && side === 'concavo') {
      block = `${row}${String(number).charAt(0)}`;
    }

    const mapNumber = /^\\d+$/.test(number) ? String(Number(number)).padStart(2, '0') : number;

    return {
      zone,
      side,
      row,
      number,
      block,
      code: number,
      mapReference: `${zone}-${mapNumber}-${row}`,
    };"""

    new_identity = """    // Nomenclatura oficial de BI_Parque_Inventario:
    //   Cóncavo -> Manzana A..F
    //   Convexo -> Manzana AX..FX
    let block = row;
    if (side === 'convexo' && block && !block.endsWith('X')) {
      block = `${block}X`;
    }

    const mapNumber = /^\\d+$/.test(number) ? String(Number(number)).padStart(3, '0') : number;

    return {
      zone,
      side,
      row,
      number,
      block,
      code: number,
      mapReference: `${zone} - ${mapNumber} - ${block}`,
    };"""

    if old_identity not in source:
        raise RuntimeError("No se encontro la logica anterior de identidad de nichos V2")

    source = source.replace(old_identity, new_identity, 1)

    old_status = """  function getFeatureStatus(feature) {
    const inventory = getInventoryRecord(feature);
    if (inventory?.estatus) return normalizeStatus(inventory.estatus);

    const p = feature?.properties ?? {};
    const occupancy = normalizeStatus(p.estatus_ocupacion);
    if (occupancy === 'utilizado') return 'utilizado';

    return normalizeStatus(p.estatus_venta || p.estatus || 'desconocido');
  }"""

    new_status = """  function getFeatureStatus(feature) {
    const inventory = getInventoryRecord(feature);

    // La fuente administrativa es SharePoint. Si no hay coincidencia, no
    // tratamos el estatus estático del GeoJSON V2 como si fuera vigente.
    if (!inventory) return 'desconocido';
    if (inventory.estatus) return normalizeStatus(inventory.estatus);

    return 'desconocido';
  }"""

    if old_status not in source:
        raise RuntimeError("No se encontro getFeatureStatus esperado en nichos-v2-preview.js")

    source = source.replace(old_status, new_status, 1)

    old_close = """  function closePreview() {
    if (!state.modal) return;
    state.modal.classList.remove('is-open');
    document.body.style.overflow = state.bodyOverflow;
    state.selectedFeature = null;
    state.zoneFeature = null;
  }"""

    new_close = """  function closePreview() {
    if (!state.modal) return;
    state.modal.classList.remove('is-open');
    document.body.style.overflow = state.bodyOverflow;
    state.selectedFeature = null;
    state.zoneFeature = null;

    // El click que abre Nichos deja fijada la zona azul en el mapa principal.
    // Reconstruir esta pequeña capa (PLN/SPN) limpia pinnedNichoZonaLayer y
    // devuelve el mapa exactamente a su estado hover normal.
    try {
      if (typeof window.renderNichosZonasLayerPublic === 'function') {
        window.renderNichosZonasLayerPublic();
      }
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible limpiar la selección de zona.', error);
    }
  }"""

    if old_close not in source:
        raise RuntimeError("No se encontro closePreview esperado en nichos-v2-preview.js")

    source = source.replace(old_close, new_close, 1)
    path.write_text(source, encoding="utf-8")


def inject_preview_assets() -> None:
    index_path = DEPLOY / "index.php"
    source = index_path.read_text(encoding="utf-8")

    source = source.replace(
        '<link rel="stylesheet" href="./portal-integration.css?v=5" />',
        '<link rel="stylesheet" href="./portal-integration.css?v=5" />\n'
        '  <link rel="stylesheet" href="./nichos-v2-preview.css?v=5" />',
        1,
    )

    source = source.replace(
        "</body>",
        '  <script src="./nichos-v2-preview.js?v=5"></script>\n'
        '  <script src="./nichos-v2-map-integration.js?v=5"></script>\n'
        '</body>',
        1,
    )

    source = source.replace(
        "require_once dirname(__DIR__) . '/includes/bootstrap.php';",
        "require_once dirname(__DIR__, 2) . '/includes/bootstrap.php';",
        1,
    )

    index_path.write_text(source, encoding="utf-8")


def main() -> None:
    build_portal_map.main()

    patch_app_hover()
    patch_sharepoint_niche_codes()

    shutil.copy2(ROOT / "nichos-v2-preview.js", DEPLOY / "nichos-v2-preview.js")
    shutil.copy2(ROOT / "nichos-v2-preview.css", DEPLOY / "nichos-v2-preview.css")
    shutil.copy2(ROOT / "nichos-v2-map-integration.js", DEPLOY / "nichos-v2-map-integration.js")

    patch_preview_runtime()

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
            raise RuntimeError(f"Archivo de preview faltante o vacío: {path}")

    print("Preview Nichos V2 preparado para /mapa/preview-nichos-v2/")


if __name__ == "__main__":
    main()
