from __future__ import annotations

from pathlib import Path
import base64
import json

import build_nichos_v2_preview as build

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"
ENCODED_ASSETS = ROOT / "assets" / "nichos-v2-v11"

ASSET_NAMES = (
    "PLN-concavo",
    "PLN-convexo",
    "SPN-concavo",
    "SPN-convexo",
)

GRID_UPDATES = {
    "PLN-concavo": {
        "height": 213,
        "y_edges": [27.0, 55.0, 82.0, 110.0, 139.0, 165.0, 194.0],
    },
    "PLN-convexo": {
        "height": 183,
        "y_edges": [22.0, 46.0, 70.0, 94.0, 118.0, 142.0, 164.0],
    },
    "SPN-concavo": {
        "height": 273,
        "y_edges": [31.0, 67.0, 103.0, 139.0, 177.0, 212.0, 250.0],
    },
    "SPN-convexo": {
        "height": 236,
        "y_edges": [28.0, 58.0, 88.0, 119.0, 150.0, 181.0, 214.0],
    },
}


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"No se encontro el bloque esperado: {label}")
    return source.replace(old, new, 1)


def decode_assets() -> None:
    destination_dir = DEPLOY / "assets"
    destination_dir.mkdir(parents=True, exist_ok=True)

    for name in ASSET_NAMES:
        parts = sorted(ENCODED_ASSETS.glob(f"{name}.webp.b64.*"))
        if not parts:
            raise RuntimeError(f"No se encontraron partes para {name}.webp")

        encoded = "".join(part.read_text(encoding="ascii").strip() for part in parts)
        payload = base64.b64decode(encoded, validate=True)
        if len(payload) < 12 or payload[:4] != b"RIFF" or payload[8:12] != b"WEBP":
            raise RuntimeError(f"{name}.webp no contiene un WebP valido")

        destination = destination_dir / f"{name}.webp"
        destination.write_bytes(payload)
        if destination.stat().st_size == 0:
            raise RuntimeError(f"Asset vacio: {destination}")


def regenerate_geometry() -> None:
    for name in ("PLN-concavo", "PLN-convexo", "SPN-concavo"):
        spec = dict(build.STANDARD_GRIDS[name])
        spec.update(GRID_UPDATES[name])
        build.write_geojson(name, build.generate_standard_grid(spec))

    spn_convexo = dict(build.SPN_CONVEXO)
    spn_convexo.update(GRID_UPDATES["SPN-convexo"])
    original = build.SPN_CONVEXO
    try:
        build.SPN_CONVEXO = spn_convexo
        build.write_geojson("SPN-convexo", build.generate_spn_convexo())
    finally:
        build.SPN_CONVEXO = original


def patch_runtime() -> None:
    path = DEPLOY / "nichos-v2-preview.js"
    source = path.read_text(encoding="utf-8")

    for name in ASSET_NAMES:
        old = f"/assets/{name}.png"
        new = f"/assets/{name}.webp?v=11"
        if old not in source:
            raise RuntimeError(f"No se encontro la referencia de imagen: {old}")
        source = source.replace(old, new)

    source = replace_once(
        source,
        """    imageLayer: null,\n    nicheLayer: null,\n    zoneFeature: null,""",
        """    imageLayer: null,\n    nicheLayer: null,\n    labelLayer: null,\n    zoneFeature: null,""",
        "estado de labelLayer",
    )
    source = replace_once(
        source,
        """    selectedFeature: null,\n    activeFilter: 'todos',\n    inventory: null,""",
        """    selectedFeature: null,\n    activeFilter: 'todos',\n    nichesVisible: true,\n    inventory: null,""",
        "estado de visibilidad",
    )

    old_filters = """      filtersEl.innerHTML = filters
        .filter(([id, , count]) => id === 'todos' || count > 0)
        .map(([id, label, count]) => `
          <button type=\"button\" class=\"nv2-filter ${state.activeFilter === id ? 'active' : ''}\" data-filter=\"${id}\">
            ${safe(label)} <strong>${count}</strong>
          </button>
        `)
        .join('');

      filtersEl.querySelectorAll('[data-filter]').forEach((button) => {
        button.addEventListener('click', () => {
          state.activeFilter = button.dataset.filter || 'todos';
          state.selectedFeature = null;
          renderSelected();
          renderSummaryAndFilters();
          renderNicheLayer();
        });
      });"""
    new_filters = """      filtersEl.innerHTML = filters
        .filter(([id, , count]) => id === 'todos' || count > 0)
        .map(([id, label, count]) => {
          const active = state.activeFilter === id && (id !== 'todos' || state.nichesVisible);
          const title = id === 'todos'
            ? (state.nichesVisible && state.activeFilter === 'todos'
              ? 'Ocultar todos los recuadros'
              : 'Mostrar todos los recuadros')
            : `Mostrar solamente ${label.toLowerCase()}`;
          return `
            <button type=\"button\" class=\"nv2-filter ${active ? 'active' : ''}\" data-filter=\"${id}\"
                    aria-pressed=\"${active ? 'true' : 'false'}\" title=\"${safe(title)}\">
              ${safe(label)} <strong>${count}</strong>
            </button>
          `;
        })
        .join('');

      filtersEl.querySelectorAll('[data-filter]').forEach((button) => {
        button.addEventListener('click', () => {
          const nextFilter = button.dataset.filter || 'todos';
          if (nextFilter === 'todos') {
            if (state.activeFilter === 'todos') {
              state.nichesVisible = !state.nichesVisible;
            } else {
              state.activeFilter = 'todos';
              state.nichesVisible = true;
            }
          } else {
            state.activeFilter = nextFilter;
            state.nichesVisible = true;
          }
          state.selectedFeature = null;
          renderSelected();
          renderSummaryAndFilters();
          renderNicheLayer();
        });
      });"""
    source = replace_once(source, old_filters, new_filters, "controles de filtro")

    old_collection = """  function filteredCollection() {
    const collection = state.featureCollection;
    if (!collection?.features) return { type: 'FeatureCollection', features: [] };
    if (state.activeFilter === 'todos') {
      return { ...collection, features: [] };
    }

    return {
      ...collection,
      features: collection.features.filter((feature) => getFeatureStatus(feature) === state.activeFilter),
    };
  }"""
    new_collection = """  function filteredCollection() {
    const collection = state.featureCollection;
    if (!collection?.features || !state.nichesVisible) {
      return { type: 'FeatureCollection', features: [] };
    }
    if (state.activeFilter === 'todos') return collection;

    return {
      ...collection,
      features: collection.features.filter((feature) => getFeatureStatus(feature) === state.activeFilter),
    };
  }"""
    source = replace_once(source, old_collection, new_collection, "coleccion filtrada")

    vector_helpers = r'''
  function featureDisplayLabel(feature) {
    const p = feature?.properties ?? {};
    const number = normalizeInventoryCode(p.numero);
    const row = normalizeUpper(p.fila);
    return [number, row].filter(Boolean).join(' ') || String(p.codigo || '');
  }

  function featurePixelBox(feature) {
    const ring = feature?.geometry?.coordinates?.[0];
    const imageHeight = Number(state.imageBounds?.[1]?.[0] || 0);
    if (!Array.isArray(ring) || ring.length < 4 || !imageHeight) return null;

    const xs = ring.map((point) => Number(point?.[0])).filter(Number.isFinite);
    const ys = ring.map((point) => Number(point?.[1])).filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;

    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = imageHeight - Math.max(...ys);
    const bottom = imageHeight - Math.min(...ys);
    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
    };
  }

  function clearLabelLayer() {
    if (!state.labelLayer) return;
    state.labelLayer.remove();
    state.labelLayer = null;
  }

  function renderVectorLabels(collection) {
    clearLabelLayer();
    if (!state.map || !state.imageBounds || !state.nichesVisible) return;

    const features = collection?.features ?? [];
    if (!features.length) return;

    const imageHeight = Number(state.imageBounds[1][0]);
    const imageWidth = Number(state.imageBounds[1][1]);
    if (!imageWidth || !imageHeight) return;

    if (!state.map.getPane('nv2LabelsPane')) {
      const pane = state.map.createPane('nv2LabelsPane');
      pane.style.zIndex = '450';
      pane.style.pointerEvents = 'none';
    }

    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', `0 0 ${imageWidth} ${imageHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'nv2-vector-labels');
    svg.setAttribute('aria-hidden', 'true');

    for (const feature of features) {
      const box = featurePixelBox(feature);
      const label = featureDisplayLabel(feature);
      if (!box || !label) continue;

      const widthLimit = (box.width * 0.9) / (Math.max(label.length, 2) * 0.56);
      const heightLimit = box.height * 0.39;
      const fontSize = Math.max(5.4, Math.min(11.5, widthLimit, heightLimit));
      const text = document.createElementNS(namespace, 'text');
      text.setAttribute('x', box.centerX.toFixed(3));
      text.setAttribute('y', box.centerY.toFixed(3));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('class', 'nv2-niche-label');
      text.setAttribute('style', `font-size:${fontSize.toFixed(3)}px;stroke-width:${Math.max(1.5, fontSize * 0.24).toFixed(3)}px`);
      text.textContent = label;
      svg.appendChild(text);
    }

    const options = { pane: 'nv2LabelsPane', interactive: false, opacity: 1 };
    if (typeof L.svgOverlay === 'function') {
      state.labelLayer = L.svgOverlay(svg, state.imageBounds, options).addTo(state.map);
    } else {
      const markup = new XMLSerializer().serializeToString(svg);
      const source = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markup)}`;
      state.labelLayer = L.imageOverlay(source, state.imageBounds, options).addTo(state.map);
    }
  }
'''
    source = replace_once(
        source,
        "\n  function filteredCollection() {",
        f"\n{vector_helpers}\n  function filteredCollection() {{",
        "etiquetas vectoriales",
    )

    source = replace_once(
        source,
        """    state.nicheLayer = L.geoJSON(filteredCollection(), {""",
        """    const visibleCollection = filteredCollection();
    state.nicheLayer = L.geoJSON(visibleCollection, {""",
        "coleccion visible del layer",
    )
    source = replace_once(
        source,
        """    }).addTo(state.map);
  }

  function loadImageDimensions(source) {""",
        """    }).addTo(state.map);
    renderVectorLabels(visibleCollection);
  }

  function loadImageDimensions(source) {""",
        "render de etiquetas vectoriales",
    )

    source = replace_once(
        source,
        """        state.activeFilter = 'todos';
        state.selectedFeature = null;""",
        """        state.activeFilter = 'todos';
        state.nichesVisible = true;
        state.selectedFeature = null;""",
        "visibilidad al cambiar de cara",
    )
    source = replace_once(
        source,
        """      state.featureCollection = geometry;
      state.selectedFeature = null;
      state.activeFilter = 'todos';""",
        """      state.featureCollection = geometry;
      state.selectedFeature = null;
      state.activeFilter = 'todos';
      state.nichesVisible = true;""",
        "visibilidad al cargar una cara",
    )
    source = replace_once(
        source,
        """    state.activeFilter = 'todos';
    state.selectedFeature = null;""",
        """    state.activeFilter = 'todos';
    state.nichesVisible = true;
    state.selectedFeature = null;""",
        "visibilidad al abrir el preview",
    )

    source = replace_once(
        source,
        """      if (state.nicheLayer) {
        state.nicheLayer.remove();
        state.nicheLayer = null;
      }

      const bounds = [""",
        """      if (state.nicheLayer) {
        state.nicheLayer.remove();
        state.nicheLayer = null;
      }
      clearLabelLayer();

      const bounds = [""",
        "limpieza de etiquetas al cambiar imagen",
    )

    path.write_text(source, encoding="utf-8")


def patch_styles() -> None:
    path = DEPLOY / "nichos-v2-preview.css"
    source = path.read_text(encoding="utf-8")
    marker = "/* Etiquetas vectoriales de nichos: permanecen nitidas al hacer zoom. */"
    if marker not in source:
        source += f"""

{marker}
.nv2-vector-labels {{
  overflow: visible;
  pointer-events: none;
}}

.nv2-niche-label {{
  fill: #374151;
  stroke: rgba(255, 255, 255, 0.98);
  paint-order: stroke fill;
  stroke-linecap: round;
  stroke-linejoin: round;
  font-family: \"Segoe UI\", Arial, sans-serif;
  font-weight: 700;
  letter-spacing: 0;
  text-rendering: geometricPrecision;
  shape-rendering: geometricPrecision;
  pointer-events: none;
  user-select: none;
}}
"""
    path.write_text(source, encoding="utf-8")


def bump_asset_version() -> None:
    path = DEPLOY / "index.php"
    source = path.read_text(encoding="utf-8")
    replacements = {
        "nichos-v2-preview.css?v=10": "nichos-v2-preview.css?v=11",
        "nichos-v2-preview.js?v=10": "nichos-v2-preview.js?v=11",
        "nichos-v2-map-integration.js?v=10": "nichos-v2-map-integration.js?v=11",
    }
    for old, new in replacements.items():
        if old not in source:
            raise RuntimeError(f"No se encontro la version de asset: {old}")
        source = source.replace(old, new, 1)
    path.write_text(source, encoding="utf-8")


def validate_output() -> None:
    for name in ASSET_NAMES:
        path = DEPLOY / "assets" / f"{name}.webp"
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Asset faltante: {path}")

    expected = {
        "PLN-concavo": 402,
        "PLN-convexo": 474,
        "SPN-concavo": 306,
        "SPN-convexo": 360,
    }
    for name, count in expected.items():
        data = json.loads((DEPLOY / "data" / f"{name}.geojson").read_text(encoding="utf-8"))
        actual = len(data.get("features", []))
        if actual != count:
            raise RuntimeError(f"Conteo inesperado en {name}: {actual} != {count}")

    runtime = (DEPLOY / "nichos-v2-preview.js").read_text(encoding="utf-8")
    required_runtime_markers = (
        "nichesVisible: true",
        "state.nichesVisible = !state.nichesVisible",
        "function renderVectorLabels",
        "nv2LabelsPane",
        "SPN-convexo.webp",
    )
    for marker in required_runtime_markers:
        if marker not in runtime:
            raise RuntimeError(f"Marcador faltante en runtime: {marker}")


def main() -> None:
    decode_assets()
    regenerate_geometry()
    patch_runtime()
    patch_styles()
    bump_asset_version()
    validate_output()
    print("Nichos V2 v11 preparado: imagenes actualizadas, Todos con alternancia y etiquetas SVG.")


if __name__ == "__main__":
    main()
