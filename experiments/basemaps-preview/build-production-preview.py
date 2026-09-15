from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT.parent / "source-main"
OUT = ROOT.parent / "deploy-basemaps-preview"
PREVIEW = ROOT / "experiments" / "basemaps-preview"


def require(path: Path) -> Path:
    if not path.exists():
        raise RuntimeError(f"Falta archivo requerido: {path}")
    return path


def build_route_editor_geojson() -> None:
    compact_path = require(PREVIEW / "data" / "rutas-panteon-compact.json")
    compact = json.loads(compact_path.read_text(encoding="utf-8"))
    access_names = {"a": "ambos", "p": "peatonal", "v": "vehicular"}

    entrance = compact.get("e")
    routes = compact.get("r") or []
    if not isinstance(entrance, list) or len(entrance) < 2:
        raise RuntimeError("La red compacta no contiene una entrada valida")

    features = [{
        "type": "Feature",
        "properties": {
            "tipo": "entrada",
            "id": "entrada-principal",
            "nombre": "Entrada principal",
        },
        "geometry": {"type": "Point", "coordinates": entrance},
    }]

    for index, item in enumerate(routes, start=1):
        access_code = item[0] if item else "p"
        coordinates = item[1] if len(item) > 1 else []
        route_id = f"via-{index:03d}"
        features.append({
            "type": "Feature",
            "properties": {
                "tipo": "vialidad",
                "id": route_id,
                "nombre": route_id,
                "acceso": access_names.get(access_code, "peatonal"),
                "sentido": "ambos",
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })

    full = {
        "type": "FeatureCollection",
        "name": "rutas-panteon",
        "properties": {
            "schema": "jp-routing-v1",
            "coordinateSystem": "CRS.Simple",
            "description": "Red interna de vialidades del Panteon Jardines de Juan Pablo",
        },
        "features": features,
    }
    (OUT / "data" / "rutas-panteon.geojson").write_text(
        json.dumps(full, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def copy_code() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    (OUT / "vendor").mkdir(parents=True)
    (OUT / "data").mkdir(parents=True)

    deploy = MAIN / "deploy"
    for name in ["index.php", "inventory.php"]:
        shutil.copy2(require(deploy / name), OUT / name)
    for path in deploy.glob("*.js"):
        shutil.copy2(path, OUT / path.name)
    for path in deploy.glob("*.css"):
        shutil.copy2(path, OUT / path.name)
    shutil.copy2(require(deploy / "vendor" / "msal-browser.min.js"), OUT / "vendor" / "msal-browser.min.js")

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
        shutil.copy2(require(PREVIEW / name), OUT / name)

    shutil.copy2(
        require(PREVIEW / "data" / "rutas-panteon-compact.json"),
        OUT / "data" / "rutas-panteon-compact.json",
    )
    build_route_editor_geojson()


def patch_index() -> None:
    path = OUT / "index.php"
    text = path.read_text(encoding="utf-8")
    text = text.replace(
        "require_once dirname(__DIR__) . '/includes/bootstrap.php';",
        "require_once dirname(__DIR__, 2) . '/includes/bootstrap.php';",
        1,
    )
    text = text.replace("./assets/", "/mapa/assets/")
    text = text.replace("./vendor/msal-browser.min.js", "/mapa/vendor/msal-browser.min.js")

    leaflet = '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>'
    addon = """<script src=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.js\"></script>
  <link rel=\"stylesheet\" href=\"./production-basemap-toggle.css?v=4\" />
  <link rel=\"stylesheet\" href=\"./route-editor.css?v=1\" />
  <link rel=\"stylesheet\" href=\"./route-navigation.css?v=2\" />
  <script src=\"./production-basemap-toggle.js?v=4\"></script>
  <script src=\"./route-graph.js?v=1\"></script>
  <script src=\"./route-render.js?v=2\"></script>
  <script src=\"./route-lot-hook.js?v=2\"></script>
  <script src=\"./route-nicho-hook.js?v=2\"></script>
  <script src=\"./route-toolbar.js?v=1\"></script>
  <script src=\"./route-editor.js?v=2\"></script>
  <script src=\"./route-editor-events-fix.js?v=1\"></script>"""
    if leaflet not in text:
        raise RuntimeError("No se encontro Leaflet en index.php")
    text = text.replace(leaflet, addon, 1)
    path.write_text(text, encoding="utf-8")


def patch_inventory() -> None:
    path = OUT / "inventory.php"
    text = path.read_text(encoding="utf-8")
    text = text.replace(
        "require_once dirname(__DIR__) . '/includes/bootstrap.php';",
        "require_once dirname(__DIR__, 2) . '/includes/bootstrap.php';",
        1,
    )
    text = text.replace(
        "require_once dirname(__DIR__) . '/includes/portal-sharepoint.php';",
        "require_once dirname(__DIR__, 2) . '/includes/portal-sharepoint.php';",
        1,
    )
    path.write_text(text, encoding="utf-8")


def patch_javascript_paths() -> None:
    preview_local = {
        "production-basemap-toggle.js",
        "route-editor.js",
        "route-editor-events-fix.js",
        "route-graph.js",
        "route-render.js",
        "route-lot-hook.js",
        "route-nicho-hook.js",
        "route-toolbar.js",
    }
    for path in OUT.glob("*.js"):
        if path.name in preview_local:
            continue
        text = path.read_text(encoding="utf-8")
        text = text.replace("./data/", "/mapa/data/")
        text = text.replace("./assets/", "/mapa/assets/")
        path.write_text(text, encoding="utf-8")


def validate() -> None:
    required = [
        OUT / "index.php",
        OUT / "inventory.php",
        OUT / "app.js",
        OUT / "lotes-nv2-match.js",
        OUT / "nichos-v2-preview.js",
        OUT / "production-basemap-toggle.js",
        OUT / "production-basemap-toggle.css",
        OUT / "route-editor.js",
        OUT / "route-editor-events-fix.js",
        OUT / "route-editor.css",
        OUT / "route-graph.js",
        OUT / "route-render.js",
        OUT / "route-lot-hook.js",
        OUT / "route-nicho-hook.js",
        OUT / "route-toolbar.js",
        OUT / "route-navigation.css",
        OUT / "data" / "rutas-panteon.geojson",
        OUT / "data" / "rutas-panteon-compact.json",
    ]
    for item in required:
        require(item)
        if item.stat().st_size == 0:
            raise RuntimeError(f"Archivo vacio: {item}")

    index = (OUT / "index.php").read_text(encoding="utf-8")
    app = (OUT / "app.js").read_text(encoding="utf-8")
    toggle = (OUT / "production-basemap-toggle.js").read_text(encoding="utf-8")
    editor = (OUT / "route-editor.js").read_text(encoding="utf-8")
    event_fix = (OUT / "route-editor-events-fix.js").read_text(encoding="utf-8")
    graph = (OUT / "route-graph.js").read_text(encoding="utf-8")
    render = (OUT / "route-render.js").read_text(encoding="utf-8")
    toolbar = (OUT / "route-toolbar.js").read_text(encoding="utf-8")
    lot_hook = (OUT / "route-lot-hook.js").read_text(encoding="utf-8")
    checks = [
        ("production-basemap-toggle.js?v=4", index),
        ("route-graph.js?v=1", index),
        ("route-render.js?v=2", index),
        ("route-lot-hook.js?v=2", index),
        ("route-nicho-hook.js?v=2", index),
        ("route-toolbar.js?v=1", index),
        ("route-navigation.css?v=2", index),
        ("route-editor.js?v=2", index),
        ("route-editor-events-fix.js?v=1", index),
        ("route-editor.css?v=1", index),
        ("/mapa/assets/", index),
        ("/mapa/data/", app),
        ("JP_LEAFLET_MAP", toggle),
        ("satellite-base.webp", toggle),
        ("base-lines.webp", toggle),
        ("PLAN_LINES_OPACITY = 0.90", toggle),
        ("route-editor", editor),
        ("disableClickPropagation", event_fix),
        ("JP_ROUTE_GRAPH", graph),
        ("JP_ROUTE_UI", render),
        ("entranceCoord||r?.network?.entrance", render),
        ("routeBtn", toolbar),
        ("jp:route-destination", toolbar),
        ("jp:route-destination", lot_hook),
    ]
    for needle, haystack in checks:
        if needle not in haystack:
            raise RuntimeError(f"Validacion faltante: {needle}")

    compact = json.loads((OUT / "data" / "rutas-panteon-compact.json").read_text(encoding="utf-8"))
    if len(compact.get("r") or []) != 95:
        raise RuntimeError(f"Red vial inesperada: {len(compact.get('r') or [])} tramos")
    if compact.get("e") != [8512, 2672]:
        raise RuntimeError("Entrada principal inesperada en la red vial")

    full = json.loads((OUT / "data" / "rutas-panteon.geojson").read_text(encoding="utf-8"))
    if len(full.get("features") or []) != 96:
        raise RuntimeError("GeoJSON de editor no contiene entrada + 95 tramos")


if __name__ == "__main__":
    copy_code()
    patch_index()
    patch_inventory()
    patch_javascript_paths()
    validate()
    print(f"Preview productivo preparado en {OUT}")
