from pathlib import Path
import html
import json
import shutil

import build_portal_map

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"

STANDARD_GRIDS = {
    "PLN-concavo": {
        "title": "BUEN PASTOR NICHOS CONCAVO",
        "zone": "PLN", "side": "concavo", "width": 2048, "height": 201,
        "x0": 14.0, "x1": 2034.0, "y0": 22.0, "y1": 192.0,
        "rows": ["A", "B", "C", "D", "E", "F"], "columns": 67,
        "photo": {"x": 650, "y": 22, "w": 750, "h": 170, "colors": ["#86b7d9", "#f6c36f", "#7fb88a"]},
    },
    "PLN-convexo": {
        "title": "BUEN PASTOR NICHOS CONVEXO",
        "zone": "PLN", "side": "convexo", "width": 2048, "height": 176,
        "x0": 12.0, "x1": 2034.0, "y0": 20.0, "y1": 164.0,
        "rows": ["AX", "BX", "CX", "DX", "EX", "FX"], "columns": 79,
        "photo": {"x": 710, "y": 20, "w": 650, "h": 144, "colors": ["#6fa8dc", "#f0b35f", "#c8907f"]},
    },
    "SPN-concavo": {
        "title": "SAN PEDRO NICHOS CONCAVO",
        "zone": "SPN", "side": "concavo", "width": 2048, "height": 251,
        "x0": 31.0, "x1": 2009.0, "y0": 23.0, "y1": 237.0,
        "rows": ["A", "B", "C", "D", "E", "F"], "columns": 51,
        "photo": {"x": 925, "y": 23, "w": 220, "h": 214, "colors": ["#d9e2ef", "#f2c3aa", "#f7df8a"]},
    },
}

SPN_CONVEXO = {
    "title": "SAN PEDRO NICHOS CONVEXO",
    "zone": "SPN", "side": "convexo", "width": 2048, "height": 219,
    "x0": 22.0, "x1": 2034.0, "y0": 20.0, "y1": 207.0,
    "rows": ["AX", "BX", "CX", "DX", "EX", "FX"],
    # 25 columnas normales + 9 columnas JP + 26 columnas normales.
    "visual_columns": 60,
    "photo": {"x": 860, "y": 20, "w": 300, "h": 187, "colors": ["#b8c6d9", "#f0d37a", "#75a978"]},
}


def svg_escape(value: object) -> str:
    return html.escape(str(value), quote=True)


def write_svg_reference(name: str, spec: dict) -> None:
    width = spec["width"]
    height = spec["height"]
    x0 = spec["x0"]
    x1 = spec["x1"]
    y0 = spec["y0"]
    y1 = spec["y1"]
    rows = spec["rows"]
    row_count = len(rows)
    col_count = spec.get("columns", spec.get("visual_columns"))
    cell_w = (x1 - x0) / col_count
    cell_h = (y1 - y0) / row_count

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#ffffff"/>',
        '<style>text{font-family:Arial,Helvetica,sans-serif} .n{font-size:11px;fill:#111} .axis{font-size:7px;fill:#666} .title{font-family:Georgia,serif;font-size:12px;font-weight:700}</style>',
        f'<text class="title" x="{width / 2:.1f}" y="12" text-anchor="middle">{svg_escape(spec["title"])}</text>',
    ]

    photo = spec.get("photo") or {}
    if photo:
        pid = name.replace('-', '_')
        colors = photo.get("colors", ["#dbeafe", "#fde68a", "#bbf7d0"])
        parts.extend([
            f'<defs><linearGradient id="g_{pid}" x1="0" y1="0" x2="1" y2="1">',
            f'<stop offset="0%" stop-color="{colors[0]}" stop-opacity="0.70"/>',
            f'<stop offset="48%" stop-color="{colors[1]}" stop-opacity="0.68"/>',
            f'<stop offset="100%" stop-color="{colors[2]}" stop-opacity="0.62"/>',
            '</linearGradient></defs>',
            f'<rect x="{photo["x"]}" y="{photo["y"]}" width="{photo["w"]}" height="{photo["h"]}" fill="url(#g_{pid})" opacity="0.76"/>',
            f'<ellipse cx="{photo["x"] + photo["w"] * 0.42:.1f}" cy="{photo["y"] + photo["h"] * 0.43:.1f}" rx="{photo["w"] * 0.17:.1f}" ry="{photo["h"] * 0.34:.1f}" fill="#f3c0a2" opacity="0.50"/>',
            f'<ellipse cx="{photo["x"] + photo["w"] * 0.62:.1f}" cy="{photo["y"] + photo["h"] * 0.50:.1f}" rx="{photo["w"] * 0.20:.1f}" ry="{photo["h"] * 0.38:.1f}" fill="#f6d58d" opacity="0.42"/>',
        ])

    # Vertical grid lines.
    for c in range(col_count + 1):
        x = x0 + c * cell_w
        stroke = '#111' if c in {0, col_count} or c % 6 == 0 else '#555'
        sw = 0.9 if c in {0, col_count} or c % 6 == 0 else 0.45
        parts.append(f'<line x1="{x:.3f}" y1="{y0:.3f}" x2="{x:.3f}" y2="{y1:.3f}" stroke="{stroke}" stroke-width="{sw}"/>')
        if c < col_count:
            parts.append(f'<text class="axis" x="{x + cell_w / 2:.3f}" y="{height - 3}" text-anchor="middle">{c + 1}</text>')

    # Horizontal grid lines.
    for r in range(row_count + 1):
        y = y0 + r * cell_h
        parts.append(f'<line x1="{x0:.3f}" y1="{y:.3f}" x2="{x1:.3f}" y2="{y:.3f}" stroke="#444" stroke-width="0.45"/>')

    # Labels.
    for r, row in enumerate(rows):
        cy = y0 + r * cell_h + cell_h / 2 + 4
        parts.append(f'<text class="axis" x="4" y="{cy:.3f}" text-anchor="middle">{svg_escape(row)}</text>')
        for c in range(col_count):
            number = c + 1
            label_row = row
            if name == "SPN-convexo":
                if c < 25:
                    number = c + 1
                    label_row = row
                elif c < 34:
                    number = r * 9 + (c - 25) + 1
                    label_row = "JP"
                else:
                    number = 26 + (c - 34)
                    label_row = row
            label = f"{number} {label_row}" if len(label_row) == 1 else f"{number}{label_row}"
            parts.append(f'<text class="n" x="{x0 + c * cell_w + cell_w / 2:.3f}" y="{cy:.3f}" text-anchor="middle">{svg_escape(label)}</text>')

    parts.append('</svg>')

    destination = DEPLOY / "assets" / f"{name}.svg"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(parts), encoding="utf-8")


def polygon_from_pixels(height: float, left: float, right: float, top: float, bottom: float):
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
        "geometry": {"type": "Polygon", "coordinates": polygon_from_pixels(height, left, right, top, bottom)},
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
            features.append(make_feature(spec["zone"], spec["side"], row, c + 1, r, c, spec["height"], left, right, top, bottom))
    return {"type": "FeatureCollection", "features": features}


def generate_spn_convexo():
    spec = SPN_CONVEXO
    cell_w = (spec["x1"] - spec["x0"]) / spec["visual_columns"]
    cell_h = (spec["y1"] - spec["y0"]) / len(spec["rows"])
    features = []
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


def write_geojson(name: str, data: dict) -> None:
    destination = DEPLOY / "data" / f"{name}.geojson"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def generate_assets_and_geometries() -> None:
    for name, spec in STANDARD_GRIDS.items():
        write_svg_reference(name, spec)
        write_geojson(name, generate_standard_grid(spec))
    write_svg_reference("SPN-convexo", SPN_CONVEXO)
    write_geojson("SPN-convexo", generate_spn_convexo())


def patch_app_hover() -> None:
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


def patch_sharepoint_niche_codes() -> None:
    path = DEPLOY / "sharepoint-inventario.js"
    source = path.read_text(encoding="utf-8")
    old = 'String(Number(codigoRaw)).padStart(2, "0")'
    new = 'String(Number(codigoRaw)).padStart(3, "0")'
    if old not in source:
        raise RuntimeError("No se encontro padStart(2) de nichos en sharepoint-inventario.js")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def patch_preview_runtime() -> None:
    path = DEPLOY / "nichos-v2-preview.js"
    source = path.read_text(encoding="utf-8")
    source = source.replace('/assets/PLN-concavo.png', '/assets/PLN-concavo.svg')
    source = source.replace('/assets/PLN-convexo.png', '/assets/PLN-convexo.svg')
    source = source.replace('/assets/SPN-concavo.png', '/assets/SPN-concavo.svg')

    old_spn = """    SPN: {
      label: 'SAN PEDRO NICHOS',
      sides: {
        concavo: {
          label: 'Cóncavo',
          image: `${PREVIEW_ROOT}/assets/SPN-concavo.svg`,
          geometry: `${PREVIEW_ROOT}/data/SPN-concavo.geojson`,
        },
      },
    },"""
    new_spn = """    SPN: {
      label: 'SAN PEDRO NICHOS',
      sides: {
        concavo: {
          label: 'Cóncavo',
          image: `${PREVIEW_ROOT}/assets/SPN-concavo.svg`,
          geometry: `${PREVIEW_ROOT}/data/SPN-concavo.geojson`,
        },
        convexo: {
          label: 'Convexo',
          image: `${PREVIEW_ROOT}/assets/SPN-convexo.svg`,
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
      if (typeof window.renderNichosZonasLayerPublic === 'function') window.renderNichosZonasLayerPublic();
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible limpiar la seleccion de zona.', error);
    }
  }"""
    if old_close not in source:
        raise RuntimeError("No se encontro closePreview esperado en nichos-v2-preview.js")
    source = source.replace(old_close, new_close, 1)
    source = source.replace('Vista de prueba basada en Sabbathycal/Mapa-Panteon V2', 'Vista de prueba con referencias visuales actualizadas')
    source = source.replace('${getZoneLabel(zoneFeature, zoneId)} · geometría V2 sobre fotografía normalizada', '${getZoneLabel(zoneFeature, zoneId)} · rejilla interactiva sobre referencia visual actualizada')
    path.write_text(source, encoding="utf-8")


def inject_preview_assets() -> None:
    index_path = DEPLOY / "index.php"
    source = index_path.read_text(encoding="utf-8")
    source = source.replace('<link rel="stylesheet" href="./portal-integration.css?v=5" />', '<link rel="stylesheet" href="./portal-integration.css?v=5" />\n  <link rel="stylesheet" href="./nichos-v2-preview.css?v=7" />', 1)
    source = source.replace("</body>", '  <script src="./nichos-v2-preview.js?v=7"></script>\n  <script src="./nichos-v2-map-integration.js?v=7"></script>\n</body>', 1)
    source = source.replace("require_once dirname(__DIR__) . '/includes/bootstrap.php';", "require_once dirname(__DIR__, 2) . '/includes/bootstrap.php';", 1)
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
    generate_assets_and_geometries()
    inject_preview_assets()

    required = [
        DEPLOY / "index.php", DEPLOY / "app.js", DEPLOY / "nichos-v2-preview.js",
        DEPLOY / "nichos-v2-preview.css", DEPLOY / "nichos-v2-map-integration.js", DEPLOY / "sharepoint-inventario.js",
        DEPLOY / "assets/PLN-concavo.svg", DEPLOY / "assets/PLN-convexo.svg",
        DEPLOY / "assets/SPN-concavo.svg", DEPLOY / "assets/SPN-convexo.svg",
        DEPLOY / "data/PLN-concavo.geojson", DEPLOY / "data/PLN-convexo.geojson",
        DEPLOY / "data/SPN-concavo.geojson", DEPLOY / "data/SPN-convexo.geojson",
    ]
    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Archivo de preview faltante o vacio: {path}")

    counts = {"PLN-concavo": 402, "PLN-convexo": 474, "SPN-concavo": 306, "SPN-convexo": 360}
    for name, expected in counts.items():
        data = json.loads((DEPLOY / "data" / f"{name}.geojson").read_text(encoding="utf-8"))
        actual = len(data.get("features", []))
        if actual != expected:
            raise RuntimeError(f"Conteo inesperado en {name}: {actual} != {expected}")
    print("Preview Nichos V2 preparado con cuatro referencias visuales locales.")


if __name__ == "__main__":
    main()
