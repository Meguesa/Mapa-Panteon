from __future__ import annotations

from pathlib import Path

import apply_nichos_v2_v11 as v11

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"No se encontro el bloque esperado: {label}")
    return source.replace(old, new, 1)


def apply_v11_functionality_without_external_assets() -> None:
    # Las fotografias ya son generadas por build_nichos_v2_preview.py desde
    # assets/nichos-v2-src. Dejamos vacia la lista para que el parche V11
    # aplique filtros y etiquetas SVG sin buscar los WebP base64 inexistentes.
    v11.ASSET_NAMES = ()
    v11.patch_runtime()
    v11.patch_styles()
    v11.bump_asset_version()


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

    # Cache bust para las imagenes PNG existentes y los recursos del preview.
    for name in ("PLN-concavo", "PLN-convexo", "SPN-concavo", "SPN-convexo"):
        runtime = runtime.replace(
            f"/assets/{name}.png`",
            f"/assets/{name}.png?v=12`",
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
    for old_version, new_version in (
        ("nichos-v2-preview.css?v=11", "nichos-v2-preview.css?v=12"),
        ("nichos-v2-preview.js?v=11", "nichos-v2-preview.js?v=12"),
        ("nichos-v2-map-integration.js?v=11", "nichos-v2-map-integration.js?v=12"),
    ):
        index = replace_required(index, old_version, new_version, old_version)
    index_path.write_text(index, encoding="utf-8")


def validate() -> None:
    runtime = (DEPLOY / "nichos-v2-preview.js").read_text(encoding="utf-8")
    required = (
        "nichesVisible: true",
        "state.nichesVisible = !state.nichesVisible",
        "function renderVectorLabels",
        "nv2LabelsPane",
        "nv2-niche-label-bg",
        "SPN-convexo.png?v=12",
    )
    for marker in required:
        if marker not in runtime:
            raise RuntimeError(f"Marcador faltante en runtime: {marker}")

    for name in ("PLN-concavo", "PLN-convexo", "SPN-concavo", "SPN-convexo"):
        image = DEPLOY / "assets" / f"{name}.png"
        if not image.is_file() or image.stat().st_size == 0:
            raise RuntimeError(f"Imagen PNG faltante: {image}")


def main() -> None:
    apply_v11_functionality_without_external_assets()
    add_label_backing_and_bump_cache()
    validate()
    print("Nichos V2 v12 preparado con PNG locales, alternancia Todos y etiquetas SVG.")


if __name__ == "__main__":
    main()
