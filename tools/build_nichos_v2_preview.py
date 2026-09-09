from pathlib import Path
import base64
import json
import shutil
import urllib.request

import build_portal_map

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"
SOURCE = ROOT / "assets" / "nichos-v2-src"
V2_RAW = "https://raw.githubusercontent.com/Sabbathycal/Mapa-Panteon/V2"

REMOTE_ASSETS = {
    "PLN-concavo.png": f"{V2_RAW}/src/assets/images/nichos/normalizadas/PLN-concavo.png",
    "PLN-convexo.png": f"{V2_RAW}/src/assets/images/nichos/normalizadas/PLN-convexo.png",
    "SPN-concavo.png": f"{V2_RAW}/src/assets/images/nichos/normalizadas/SPN-concavo.png",
}

STANDARD_GRIDS = {
    "PLN-concavo": {"zone": "PLN", "side": "concavo", "height": 201, "x0": 14.0, "x1": 2034.0, "y0": 22.0, "y1": 192.0, "rows": ["A", "B", "C", "D", "E", "F"], "columns": 67},
    "PLN-convexo": {"zone": "PLN", "side": "convexo", "height": 176, "x0": 12.0, "x1": 2034.0, "y0": 20.0, "y1": 164.0, "rows": ["AX", "BX", "CX", "DX", "EX", "FX"], "columns": 79},
    "SPN-concavo": {"zone": "SPN", "side": "concavo", "height": 251, "x0": 31.0, "x1": 2009.0, "y0": 23.0, "y1": 237.0, "rows": ["A", "B", "C", "D", "E", "F"], "columns": 51},
}

SPN_CONVEXO = {
    "zone": "SPN", "side": "convexo", "height": 110,
    "x0": 11.0, "x1": 1017.0, "y0": 10.0, "y1": 104.0,
    "rows": ["AX", "BX", "CX", "DX", "EX", "FX"],
    "visual_columns": 60,
}


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "JdJP-Mapa-Preview/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        destination.write_bytes(response.read())


def decode_webp(name: str) -> None:
    src = SOURCE / f"{name}.webp.b64"
    if not src.is_file():
        raise RuntimeError(f"No existe el recurso local {src}")
    payload = base64.b64decode(src.read_text(encoding="ascii"), validate=True)
    if not payload.startswith(b"RIFF") or b"WEBP" not in payload[:16]:
        raise RuntimeError(f"{src} no contiene una imagen WebP valida")
    out = DEPLOY / "assets" / f"{name}.webp"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(payload)


def polygon_from_pixels(height, left, right, top, bottom):
    return [[
        [round(left, 6), round(height - top, 6)],
        [round(right, 6), round(height - top, 6)],
        [round(right, 6), round(height - bottom, 6)],
        [round(left, 6), round(height - bottom, 6)],
        [round(left, 6), round(height - top, 6)],
    ]]


def make_feature(zone, side, row, number, grid_row, grid_column, height, left, right, top, bottom):
    code = f"{number}{row}"
    return {
        "type": "Feature",
        "properties": {
            "id": f"{zone}-{side}-{code}", "tipo": "nicho", "zonaId": zone, "cara": side,
            "fila": row, "numero": number, "codigo": code, "estatus_venta": "", "estatus_ocupacion": "",
            "referencia_procap": "", "observaciones": "", "geometryType": "niches",
            "gridRow": grid_row, "gridColumn": grid_column,
        },
        "geometry": {"type": "Polygon", "coordinates": polygon_from_pixels(height, left, right, top, bottom)},
    }


def generate_standard_grid(spec):
    features = []
    cell_w = (spec["x1"] - spec["x0"]) / spec["columns"]
    cell_h = (spec["y1"] - spec["y0"]) / len(spec["rows"])
    for r, row in enumerate(spec["rows"]):
        top = spec["y0"] + r * cell_h
        bottom = spec["y0"] + (r + 1) * cell_h
        for c in range(spec["columns"]):
            left = spec["x0"] + c * cell_w
            right = spec["x0"] + (c + 1) * cell_w
            features.append(make_feature(spec["zone"], spec["side"], row, c + 1, r, c, spec["height"], left, right, top, bottom))
    return {"type": "FeatureCollection", "features": features}


def generate_spn_convexo():
    spec = SPN_CONVEXO
    features = []
    cell_w = (spec["x1"] - spec["x0"]) / spec["visual_columns"]
    cell_h = (spec["y1"] - spec["y0"]) / len(spec["rows"])
    for r, row in enumerate(spec["rows"]):
        top = spec["y0"] + r * cell_h
        bottom = spec["y0"] + (r + 1) * cell_h
        for number in range(1, 26):
            c = number - 1
            features.append(make_feature(spec["zone"], spec["side"], row, number, r, c, spec["height"], spec["x0"] + c * cell_w, spec["x0"] + (c + 1) * cell_w, top, bottom))
        for j in range(9):
            c = 25 + j
            number = r * 9 + j + 1
            features.append(make_feature(spec["zone"], spec["side"], "JP", number, r, c, spec["height"], spec["x0"] + c * cell_w, spec["x0"] + (c + 1) * cell_w, top, bottom))
        for number in range(26, 52):
            c = 34 + (number - 26)
            features.append(make_feature(spec["zone"], spec["side"], row, number, r, c, spec["height"], spec["x0"] + c * cell_w, spec["x0"] + (c + 1) * cell_w, top, bottom))
    return {"type": "FeatureCollection", "features": features}


def write_geojson(name, data):
    path = DEPLOY / "data" / f"{name}.geojson"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def generate_assets_and_geometries():
    for name, url in REMOTE_ASSETS.items():
        download(url, DEPLOY / "assets" / name)
    decode_webp("SPN-convexo")
    for name, spec in STANDARD_GRIDS.items():
        write_geojson(name, generate_standard_grid(spec))
    write_geojson("SPN-convexo", generate_spn_convexo())


def patch_app_hover():
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
    app_path.write_text(source.replace(old, new, 1), encoding="utf-8")


def patch_sharepoint_niche_codes():
    path = DEPLOY / "sharepoint-inventario.js"
    source = path.read_text(encoding="utf-8")
    old = 'String(Number(codigoRaw)).padStart(2, "0")'
    new = 'String(Number(codigoRaw)).padStart(3, "0")'
    if old in source:
        source = source.replace(old, new, 1)
    elif new not in source:
        raise RuntimeError("No se encontro la normalizacion de codigo de nichos en sharepoint-inventario.js")
    path.write_text(source, encoding="utf-8")


def replace_once(source, old, new, label):
    if old not in source:
        raise RuntimeError(f"No se encontro bloque esperado: {label}")
    return source.replace(old, new, 1)


def patch_preview_runtime():
    path = DEPLOY / "nichos-v2-preview.js"
    source = path.read_text(encoding="utf-8")
    old_spn = """    SPN: {
      label: 'SAN PEDRO NICHOS',
      sides: {
        concavo: {
          label: 'Cóncavo',
          image: `${PREVIEW_ROOT}/assets/SPN-concavo.png`,
          geometry: `${PREVIEW_ROOT}/data/SPN-concavo.geojson`,
        },
      },
    },"""
    new_spn = """    SPN: {
      label: 'SAN PEDRO NICHOS',
      sides: {
        concavo: {
          label: 'Cóncavo',
          image: `${PREVIEW_ROOT}/assets/SPN-concavo.png`,
          geometry: `${PREVIEW_ROOT}/data/SPN-concavo.geojson`,
        },
        convexo: {
          label: 'Convexo',
          image: `${PREVIEW_ROOT}/assets/SPN-convexo.webp`,
          geometry: `${PREVIEW_ROOT}/data/SPN-convexo.geojson`,
        },
      },
    },"""
    source = replace_once(source, old_spn, new_spn, "SPN sides")
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
    new_identity = """    let block = row;
    if (side === 'convexo' && block && block !== 'JP' && !block.endsWith('X')) {
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
    source = replace_once(source, old_identity, new_identity, "identity")
    old_load = """    state.inventoryPromise = fetch(INVENTORY_URL, { cache: 'no-store' })"""
    new_load = """    const previousInteractiveInventoryAuth = window.JP_ALLOW_INTERACTIVE_INVENTORY_AUTH;
    window.JP_ALLOW_INTERACTIVE_INVENTORY_AUTH = true;

    state.inventoryPromise = fetch(INVENTORY_URL, { cache: 'no-store' })"""
    source = replace_once(source, old_load, new_load, "interactive inventory flag start")
    old_finally = """      .finally(() => {
        state.inventoryPromise = null;
      });"""
    new_finally = """      .finally(() => {
        window.JP_ALLOW_INTERACTIVE_INVENTORY_AUTH = previousInteractiveInventoryAuth;
        state.inventoryPromise = null;
      });"""
    source = replace_once(source, old_finally, new_finally, "interactive inventory flag restore")
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
    if (!inventory) return 'desconocido';
    if (inventory.estatus) return normalizeStatus(inventory.estatus);
    return 'desconocido';
  }"""
    source = replace_once(source, old_status, new_status, "status")
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
    try {
      if (typeof window.renderNichosZonasLayerPublic === 'function') window.renderNichosZonasLayerPublic();
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible limpiar la seleccion de zona.', error);
    }
  }"""
    source = replace_once(source, old_close, new_close, "close preview")
    source = source.replace('Vista de prueba basada en Sabbathycal/Mapa-Panteon V2', 'Vista de prueba con referencias visuales actualizadas')
    path.write_text(source, encoding="utf-8")


def inject_preview_assets():
    index_path = DEPLOY / "index.php"
    source = index_path.read_text(encoding="utf-8")
    source = source.replace('<link rel="stylesheet" href="./portal-integration.css?v=5" />', '<link rel="stylesheet" href="./portal-integration.css?v=5" />\n  <link rel="stylesheet" href="./nichos-v2-preview.css?v=8" />', 1)
    source = source.replace("</body>", '  <script src="./nichos-v2-preview.js?v=8"></script>\n  <script src="./nichos-v2-map-integration.js?v=8"></script>\n</body>', 1)
    source = source.replace("require_once dirname(__DIR__) . '/includes/bootstrap.php';", "require_once dirname(__DIR__, 2) . '/includes/bootstrap.php';", 1)
    index_path.write_text(source, encoding="utf-8")


def main():
    build_portal_map.main()
    patch_app_hover()
    patch_sharepoint_niche_codes()
    shutil.copy2(ROOT / "nichos-v2-preview.js", DEPLOY / "nichos-v2-preview.js")
    shutil.copy2(ROOT / "nichos-v2-preview.css", DEPLOY / "nichos-v2-preview.css")
    shutil.copy2(ROOT / "nichos-v2-map-integration.js", DEPLOY / "nichos-v2-map-integration.js")
    patch_preview_runtime()
    legacy = DEPLOY / "assets" / "nichos"
    if legacy.exists():
        shutil.rmtree(legacy)
    generate_assets_and_geometries()
    inject_preview_assets()
    required = [DEPLOY / "index.php", DEPLOY / "app.js", DEPLOY / "nichos-v2-preview.js", DEPLOY / "nichos-v2-preview.css", DEPLOY / "nichos-v2-map-integration.js", DEPLOY / "sharepoint-inventario.js", DEPLOY / "assets/PLN-concavo.png", DEPLOY / "assets/PLN-convexo.png", DEPLOY / "assets/SPN-concavo.png", DEPLOY / "assets/SPN-convexo.webp", DEPLOY / "data/PLN-concavo.geojson", DEPLOY / "data/PLN-convexo.geojson", DEPLOY / "data/SPN-concavo.geojson", DEPLOY / "data/SPN-convexo.geojson"]
    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Archivo faltante o vacio: {path}")
    for name, expected in {"PLN-concavo": 402, "PLN-convexo": 474, "SPN-concavo": 306, "SPN-convexo": 360}.items():
        data = json.loads((DEPLOY / "data" / f"{name}.geojson").read_text(encoding="utf-8"))
        if len(data.get("features", [])) != expected:
            raise RuntimeError(f"Conteo inesperado en {name}")
    print("Preview Nichos V2 preparado con imagenes reales y San Pedro Convexo local.")


if __name__ == "__main__":
    main()
