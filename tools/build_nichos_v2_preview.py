from pathlib import Path
import base64
import json
import shutil

import build_portal_map

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"
ASSET_SOURCE = ROOT / "assets" / "nichos-v2-src"

ASSETS = [
    "PLN-concavo.png",
    "PLN-convexo.png",
    "SPN-concavo.png",
    "SPN-convexo.png",
]

STANDARD_GRIDS = {
    "PLN-concavo": {
        "zone": "PLN", "side": "concavo", "height": 201,
        "x0": 14.0, "x1": 2034.0, "y0": 22.0, "y1": 192.0,
        "rows": ["A", "B", "C", "D", "E", "F"], "columns": 67,
    },
    "PLN-convexo": {
        "zone": "PLN", "side": "convexo", "height": 176,
        "x0": 12.0, "x1": 2034.0, "y0": 20.0, "y1": 164.0,
        "rows": ["AX", "BX", "CX", "DX", "EX", "FX"], "columns": 79,
    },
    "SPN-concavo": {
        "zone": "SPN", "side": "concavo", "height": 251,
        "x0": 31.0, "x1": 2009.0, "y0": 23.0, "y1": 237.0,
        "rows": ["A", "B", "C", "D", "E", "F"], "columns": 51,
    },
}

SPN_CONVEXO = {
    "zone": "SPN", "side": "convexo", "height": 219,
    "x0": 22.0, "x1": 2034.0, "y0": 20.0, "y1": 207.0,
    "rows": ["AX", "BX", "CX", "DX", "EX", "FX"],
    # 25 columnas normales + 9 columnas JP + 26 columnas normales.
    "visual_columns": 60,
}


def decode_asset(name: str) -> None:
    parts = sorted(ASSET_SOURCE.glob(f"{name}.b64.*"))
    if not parts:
        raise RuntimeError(f"No se encontraron partes base64 para {name}")

    encoded = "".join(part.read_text(encoding="ascii").strip() for part in parts)
    try:
        payload = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise RuntimeError(f"Base64 invalido para {name}: {exc}") from exc

    if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError(f"El recurso {name} no es un PNG valido")

    destination = DEPLOY / "assets" / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)


def polygon_from_pixels(height: float, left: float, right: float, top: float, bottom: float):
    # Leaflet CRS.Simple usa Y hacia arriba; la imagen usa Y hacia abajo.
    y_top = height - top
    y_bottom = height - bottom
    return [[
        [round(left, 6), round(y_top, 6)],
        [round(right, 6), round(y_top, 6)],
        [round(right, 6), round(y_bottom, 6)],
        [round(left, 6), round(y_bottom, 6)],
        [round(left, 6), round(y_top, 6)],
    ]]


def make_feature(zone: str, side: str, row: str, number: int, grid_row: int, grid_column: int,
                 height: float, left: float, right: float, top: float, bottom: float):
    code = f"{number}{row}"
    return {
        "type": "Feature",
        "properties": {
            "id": f"{zone}-{side}-{code}",
            "tipo": "nicho",
            "zonaId": zone,
            "cara": side,
            "fila": row,
            "numero": number,
            "codigo": code,
            "estatus_venta": "",
            "estatus_ocupacion": "",
            "referencia_procap": "",
            "observaciones": "",
            "geometryType": "niches",
            "gridRow": grid_row,
            "gridColumn": grid_column,
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": polygon_from_pixels(height, left, right, top, bottom),
        },
    }


def generate_standard_grid(spec: dict):
    row_count = len(spec["rows"])
    col_count = spec["columns"]
    cell_w = (spec["x1"] - spec["x0"]) / col_count
    cell_h = (spec["y1"] - spec["y0"]) / row_count
    features = []

    for r, row in enumerate(spec["rows"]):
        top = spec["y0"] + r * cell_h
        bottom = spec["y0"] + (r + 1) * cell_h
        for c in range(col_count):
            left = spec["x0"] + c * cell_w
            right = spec["x0"] + (c + 1) * cell_w
            features.append(make_feature(
                spec["zone"], spec["side"], row, c + 1, r, c,
                spec["height"], left, right, top, bottom,
            ))

    return {"type": "FeatureCollection", "features": features}


def generate_spn_convexo():
    spec = SPN_CONVEXO
    cell_w = (spec["x1"] - spec["x0"]) / spec["visual_columns"]
    cell_h = (spec["y1"] - spec["y0"]) / len(spec["rows"])
    features = []

    for r, row in enumerate(spec["rows"]):
        top = spec["y0"] + r * cell_h
        bottom = spec["y0"] + (r + 1) * cell_h

        # Izquierda: 1AX..25FX.
        for number in range(1, 26):
            c = number - 1
            left = spec["x0"] + c * cell_w
            right = spec["x0"] + (c + 1) * cell_w
            features.append(make_feature(
                spec["zone"], spec["side"], row, number, r, c,
                spec["height"], left, right, top, bottom,
            ))

        # Centro: 54 nichos JP, 9 por fila (1JP..54JP).
        for j in range(9):
            c = 25 + j
            number = r * 9 + j + 1
            left = spec["x0"] + c * cell_w
            right = spec["x0"] + (c + 1) * cell_w
            features.append(make_feature(
                spec["zone"], spec["side"], "JP", number, r, c,
                spec["height"], left, right, top, bottom,
            ))

        # Derecha: 26AX..51FX.
        for number in range(26, 52):
            c = 34 + (number - 26)
            left = spec["x0"] + c * cell_w
            right = spec["x0"] + (c + 1) * cell_w
            features.append(make_feature(
                spec["zone"], spec["side"], row, number, r, c,
                spec["height"], left, right, top, bottom,
            ))

    return {"type": "FeatureCollection", "features": features}


def write_geojson(name: str, data: dict) -> None:
    destination = DEPLOY / "data" / f"{name}.geojson"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def generate_geometries() -> None:
    for name, spec in STANDARD_GRIDS.items():
        write_geojson(name, generate_standard_grid(spec))
    write_geojson("SPN-convexo", generate_spn_convexo())


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
    """Alinea el codigo derivado de nichos con la nomenclatura oficial de 3 digitos."""
    path = DEPLOY / "sharepoint-inventario.js"
    source = path.read_text(encoding="utf-8")

    old = 'String(Number(codigoRaw)).padStart(2, "0")'
    new = 'String(Number(codigoRaw)).padStart(3, "0")'

    if old not in source:
        raise RuntimeError("No se encontro padStart(2) de nichos en sharepoint-inventario.js")

    source = source.replace(old, new, 1)
    path.write_text(source, encoding="utf-8")


def patch_preview_runtime() -> None:
    """Adapta el preview a las cuatro referencias visuales y a BI_Parque_Inventario."""
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
          image: `${PREVIEW_ROOT}/assets/SPN-convexo.png`,
          geometry: `${PREVIEW_ROOT}/data/SPN-convexo.geojson`,
        },
      },
    },"""

    if old_spn not in source:
        raise RuntimeError("No se encontro la configuracion SPN esperada en nichos-v2-preview.js")
    source = source.replace(old_spn, new_spn, 1)

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
    //   Centro de San Pedro Convexo -> Manzana JP
    let block = row;
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
    // tratamos un valor estatico del GeoJSON como si fuera vigente.
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

    try {
      if (typeof window.renderNichosZonasLayerPublic === 'function') {
        window.renderNichosZonasLayerPublic();
      }
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible limpiar la seleccion de zona.', error);
    }
  }"""

    if old_close not in source:
        raise RuntimeError("No se encontro closePreview esperado en nichos-v2-preview.js")
    source = source.replace(old_close, new_close, 1)

    source = source.replace(
        'Vista de prueba basada en Sabbathycal/Mapa-Panteon V2',
        'Vista de prueba con referencias visuales actualizadas',
    )
    source = source.replace(
        '${getZoneLabel(zoneFeature, zoneId)} · geometría V2 sobre fotografía normalizada',
        '${getZoneLabel(zoneFeature, zoneId)} · rejilla interactiva sobre referencia visual actualizada',
    )

    path.write_text(source, encoding="utf-8")


def inject_preview_assets() -> None:
    index_path = DEPLOY / "index.php"
    source = index_path.read_text(encoding="utf-8")

    source = source.replace(
        '<link rel="stylesheet" href="./portal-integration.css?v=5" />',
        '<link rel="stylesheet" href="./portal-integration.css?v=5" />\n'
        '  <link rel="stylesheet" href="./nichos-v2-preview.css?v=6" />',
        1,
    )

    source = source.replace(
        "</body>",
        '  <script src="./nichos-v2-preview.js?v=6"></script>\n'
        '  <script src="./nichos-v2-map-integration.js?v=6"></script>\n'
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

    for name in ASSETS:
        decode_asset(name)

    generate_geometries()
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
        DEPLOY / "assets/SPN-convexo.png",
        DEPLOY / "data/PLN-concavo.geojson",
        DEPLOY / "data/PLN-convexo.geojson",
        DEPLOY / "data/SPN-concavo.geojson",
        DEPLOY / "data/SPN-convexo.geojson",
    ]

    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Archivo de preview faltante o vacio: {path}")

    counts = {
        "PLN-concavo": 6 * 67,
        "PLN-convexo": 6 * 79,
        "SPN-concavo": 6 * 51,
        "SPN-convexo": (6 * 51) + 54,
    }
    for name, expected in counts.items():
        data = json.loads((DEPLOY / "data" / f"{name}.geojson").read_text(encoding="utf-8"))
        actual = len(data.get("features", []))
        if actual != expected:
            raise RuntimeError(f"Conteo inesperado en {name}: {actual} != {expected}")

    print("Preview Nichos V2 preparado con cuatro referencias visuales locales.")


if __name__ == "__main__":
    main()
