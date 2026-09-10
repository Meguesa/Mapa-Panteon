from __future__ import annotations

from pathlib import Path

import apply_nichos_v2_v11 as v11
import build_nichos_v2_preview as builder

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"
CACHE_VERSION = "14"


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"No se encontro el bloque esperado: {label}")
    return source.replace(old, new, 1)


def transform_anchors(anchors: dict[int, float], scale: float = 1.0, offset: float = 0.0,
                      keep_first: bool = False, post_first_offset: float | None = None) -> dict[int, float]:
    out: dict[int, float] = {}
    first_key = min(anchors)
    for key, value in anchors.items():
        if keep_first and key == first_key:
            out[key] = float(value)
            continue
        if post_first_offset is not None and key != first_key:
            out[key] = round(float(value) + post_first_offset, 6)
            continue
        out[key] = round(float(value) * scale + offset, 6)
    return out


def regenerate_geometry_for_new_images() -> None:
    """Regenera la cuadricula usando las imagenes nuevas y microajustes medidos
    contra los centros de los marcadores circulares visibles en cada fotografia.
    """
    updates = {
        "PLN-concavo": {
            "height": 213,
            "y_edges": [27.0, 55.0, 82.0, 110.0, 139.0, 165.0, 194.0],
            # En la imagen nueva los separadores reales quedan ~1.5 px logicos
            # a la derecha de la geometria anterior.
            "x_transform": (1.0, 1.5),
        },
        "PLN-convexo": {
            "height": 183,
            "y_edges": [22.0, 46.0, 70.0, 94.0, 118.0, 142.0, 164.0],
            # Desplazamiento horizontal uniforme observado en la vista ampliada.
            "x_transform": (1.0, 3.6),
        },
        "SPN-concavo": {
            "height": 273,
            "y_edges": [31.0, 67.0, 103.0, 139.0, 177.0, 212.0, 250.0],
            # Aqui el desfase no era solo traslacion: se acumulaba ligeramente
            # de izquierda a derecha, por eso se corrige escala y origen.
            "x_transform": (1.0167, -8.15),
        },
    }

    for name, values in updates.items():
        spec = builder.STANDARD_GRIDS[name]
        spec["height"] = values["height"]
        spec["y_edges"] = values["y_edges"]
        scale, offset = values["x_transform"]
        spec["x_anchors"] = transform_anchors(spec["x_anchors"], scale=scale, offset=offset)
        builder.write_geojson(name, builder.generate_standard_grid(spec))

    builder.SPN_CONVEXO["height"] = 236
    builder.SPN_CONVEXO["y_edges"] = [28.0, 58.0, 88.0, 119.0, 150.0, 181.0, 214.0]
    # El primer separador ya coincide; los siguientes estaban ~2.3 px logicos
    # a la derecha respecto a los marcadores de la fotografia.
    builder.SPN_CONVEXO["x_anchors"] = transform_anchors(
        builder.SPN_CONVEXO["x_anchors"], keep_first=True, post_first_offset=-2.3
    )
    builder.write_geojson("SPN-convexo", builder.generate_spn_convexo())


def apply_v11_functionality_without_external_assets() -> None:
    v11.ASSET_NAMES = ()
    v11.patch_runtime()
    v11.patch_styles()
    v11.bump_asset_version()


def patch_normalized_image_bounds_and_initial_fit(runtime: str) -> str:
    old_bounds = """      const bounds = [
        [0, 0],
        [dimensions.height, dimensions.width],
      ];
      state.imageBounds = bounds;

      state.imageLayer = L.imageOverlay(config.image, bounds).addTo(state.map);
      state.map.setMaxBounds(bounds);
      state.map.fitBounds(bounds, { animate: false, padding: [20, 20] });"""

    new_bounds = """      const normalizedWidth = 2048;
      const normalizedHeight = dimensions.height * (normalizedWidth / dimensions.width);
      const bounds = [
        [0, 0],
        [normalizedHeight, normalizedWidth],
      ];
      state.imageBounds = bounds;

      state.imageLayer = L.imageOverlay(config.image, bounds).addTo(state.map);
      state.map.setMaxBounds(bounds, { padding: [0.08, 0.08] });
      fitWholeImage(false);"""

    runtime = replace_required(runtime, old_bounds, new_bounds, "bounds normalizados de imagen")

    old_recenter = """  function recenter() {
    if (!state.map) return;

    if (state.selectedFeature && state.nicheLayer) {"""

    new_recenter = """  function fitWholeImage(animate = false) {
    if (!state.map || !state.imageBounds) return;

    const applyFit = () => {
      if (!state.map || !state.imageBounds) return;
      state.map.invalidateSize(false);
      state.map.fitBounds(state.imageBounds, {
        animate,
        padding: [12, 12],
      });
    };

    requestAnimationFrame(() => requestAnimationFrame(applyFit));
    window.setTimeout(applyFit, 120);
  }

  function recenter() {
    if (!state.map) return;

    if (state.selectedFeature && state.nicheLayer) {"""

    runtime = replace_required(runtime, old_recenter, new_recenter, "funcion fitWholeImage")

    old_final_fit = """    if (state.imageBounds) {
      state.map.fitBounds(state.imageBounds, { animate: true, padding: [20, 20] });
    }"""
    new_final_fit = """    if (state.imageBounds) {
      fitWholeImage(true);
    }"""
    runtime = replace_required(runtime, old_final_fit, new_final_fit, "recentrado de imagen completa")

    return runtime


def add_label_backing_and_bump_cache() -> None:
    runtime_path = DEPLOY / "nichos-v2-preview.js"
    runtime = runtime_path.read_text(encoding="utf-8")

    old = """      const text = document.createElementNS(namespace, 'text');
      text.setAttribute('x', box.centerX.toFixed(3));"""
    new = """      const labelBoxWidth = Math.min(
        box.width * 0.94,
        Math.max(fontSize * 2.3, fontSize * (label.length * 0.62 + 1.35)),
      );
      const labelBoxHeight = Math.min(box.height * 0.78, fontSize * 1.55);
      const backing = document.createElementNS(namespace, 'rect');
      backing.setAttribute('x', (box.centerX - labelBoxWidth / 2).toFixed(3));
      backing.setAttribute('y', (box.centerY - labelBoxHeight / 2).toFixed(3));
      backing.setAttribute('width', labelBoxWidth.toFixed(3));
      backing.setAttribute('height', labelBoxHeight.toFixed(3));
      backing.setAttribute('rx', Math.max(1.2, fontSize * 0.22).toFixed(3));
      backing.setAttribute('class', 'nv2-niche-label-bg');
      svg.appendChild(backing);

      const text = document.createElementNS(namespace, 'text');
      text.setAttribute('x', box.centerX.toFixed(3));"""

    if "nv2-niche-label-bg" not in runtime:
        runtime = replace_required(runtime, old, new, "fondo de etiqueta SVG")

    runtime = patch_normalized_image_bounds_and_initial_fit(runtime)

    for name in ("PLN-concavo", "PLN-convexo", "SPN-concavo", "SPN-convexo"):
        runtime = runtime.replace(
            f"/assets/{name}.png`",
            f"/assets/{name}.png?v={CACHE_VERSION}`",
        )

    runtime_path.write_text(runtime, encoding="utf-8")

    css_path = DEPLOY / "nichos-v2-preview.css"
    css = css_path.read_text(encoding="utf-8")
    if ".nv2-niche-label-bg" not in css:
        css += """

.nv2-niche-label-bg {
  fill: rgba(255, 255, 255, 0.86);
  stroke: rgba(255, 255, 255, 0.98);
  stroke-width: 0.7px;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}
"""
    css_path.write_text(css, encoding="utf-8")

    index_path = DEPLOY / "index.php"
    index = index_path.read_text(encoding="utf-8")
    for asset in (
        "nichos-v2-preview.css",
        "nichos-v2-preview.js",
        "nichos-v2-map-integration.js",
    ):
        for old_version in ("11", "12", "13"):
            index = index.replace(f"{asset}?v={old_version}", f"{asset}?v={CACHE_VERSION}")
    index_path.write_text(index, encoding="utf-8")


def validate() -> None:
    runtime = (DEPLOY / "nichos-v2-preview.js").read_text(encoding="utf-8")
    required = (
        "nichesVisible: true",
        "state.nichesVisible = !state.nichesVisible",
        "function renderVectorLabels",
        "nv2LabelsPane",
        "nv2-niche-label-bg",
        f"SPN-convexo.png?v={CACHE_VERSION}",
        "const normalizedWidth = 2048",
        "function fitWholeImage",
    )
    for marker in required:
        if marker not in runtime:
            raise RuntimeError(f"Marcador faltante en runtime: {marker}")

    for name in ("PLN-concavo", "PLN-convexo", "SPN-concavo", "SPN-convexo"):
        image = DEPLOY / "assets" / f"{name}.png"
        if not image.is_file() or image.stat().st_size == 0:
            raise RuntimeError(f"Imagen PNG faltante: {image}")


def main() -> None:
    regenerate_geometry_for_new_images()
    apply_v11_functionality_without_external_assets()
    add_label_backing_and_bump_cache()
    validate()
    print("Nichos V2 v14 preparado: microajustes horizontales aplicados a las cuatro vistas.")


if __name__ == "__main__":
    main()
