from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def require(path: Path) -> Path:
    if not path.is_file():
        raise RuntimeError(f"Falta archivo requerido: {path}")
    return path


def copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(require(source), target)


def patch_index(index: Path) -> None:
    text = index.read_text(encoding="utf-8")

    leaflet = '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>'
    if leaflet not in text:
        raise RuntimeError("No se encontro Leaflet en index.php")

    css_tags = """
  <link rel="stylesheet" href="./production-basemap-toggle.css?v=5" />
  <link rel="stylesheet" href="./route-editor.css?v=2" />
  <link rel="stylesheet" href="./route-navigation.css?v=3" />
"""

    js_tags = """
  <script src="./production-basemap-toggle.js?v=5"></script>
  <script src="./route-graph.js?v=2"></script>
  <script src="./route-render.js?v=3"></script>
  <script src="./route-lot-hook.js?v=3"></script>
  <script src="./route-nicho-hook.js?v=3"></script>
  <script src="./route-toolbar.js?v=2"></script>
  <script src="./route-editor.js?v=3"></script>
  <script src="./route-editor-events-fix.js?v=2"></script>
"""

    if "production-basemap-toggle.css" not in text:
        if "</head>" not in text:
            raise RuntimeError("No se encontro </head> en index.php")
        text = text.replace("</head>", css_tags + "</head>", 1)

    if "production-basemap-toggle.js" not in text:
        text = text.replace(leaflet, leaflet + js_tags, 1)

    index.write_text(text, encoding="utf-8")


def validate_routes(data_dir: Path) -> None:
    compact_path = require(data_dir / "rutas-panteon-compact.json")
    compact = json.loads(compact_path.read_text(encoding="utf-8"))
    routes = compact.get("r") or []
    entrance = compact.get("e")
    if len(routes) != 95:
        raise RuntimeError(f"Red vial inesperada: {len(routes)} tramos")
    if entrance != [8512, 2672]:
        raise RuntimeError(f"Entrada inesperada: {entrance}")

    geojson_path = require(data_dir / "rutas-panteon.geojson")
    geojson = json.loads(geojson_path.read_text(encoding="utf-8"))
    if len(geojson.get("features") or []) != 96:
        raise RuntimeError("GeoJSON de rutas no contiene entrada + 95 tramos")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Uso: install-production-features.py <deploy-dir>")

    deploy = Path(sys.argv[1]).resolve()
    index = require(deploy / "index.php")

    extras = [
        "production-basemap-toggle.js",
        "production-basemap-toggle.css",
        "route-editor.js",
        "route-editor-events-fix.js",
        "route-editor.css",
        "route-graph.js",
        "route-render.js",
        "route-lot-hook.js",
        "route-nicho-hook.js",
        "route-toolbar.js",
        "route-navigation.css",
    ]

    for name in extras:
        copy_file(HERE / name, deploy / name)

    copy_file(HERE / "data" / "rutas-panteon-compact.json", deploy / "data" / "rutas-panteon-compact.json")
    copy_file(HERE / "data" / "rutas-panteon.geojson", deploy / "data" / "rutas-panteon.geojson")

    patch_index(index)
    validate_routes(deploy / "data")

    verify = index.read_text(encoding="utf-8")
    required_markers = [
        "production-basemap-toggle.css?v=5",
        "production-basemap-toggle.js?v=5",
        "route-graph.js?v=2",
        "route-render.js?v=3",
        "route-lot-hook.js?v=3",
        "route-nicho-hook.js?v=3",
        "route-toolbar.js?v=2",
        "route-editor.js?v=3",
        "route-editor-events-fix.js?v=2",
        "route-navigation.css?v=3",
    ]
    for marker in required_markers:
        if marker not in verify:
            raise RuntimeError(f"No se pudo instalar en index.php: {marker}")

    print("Mapas base, navegacion y editor de rutas integrados en", deploy)


if __name__ == "__main__":
    main()
