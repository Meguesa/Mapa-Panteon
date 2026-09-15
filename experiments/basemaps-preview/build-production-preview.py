from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT.parent / "source-main"
OUT = ROOT.parent / "deploy-basemaps-preview"
PREVIEW = ROOT / "experiments" / "basemaps-preview"


def require(path: Path) -> Path:
    if not path.exists():
        raise RuntimeError(f"Falta archivo requerido: {path}")
    return path


def copy_code() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    (OUT / "vendor").mkdir(parents=True)

    deploy = MAIN / "deploy"
    for name in ["index.php", "inventory.php"]:
        shutil.copy2(require(deploy / name), OUT / name)
    for path in deploy.glob("*.js"):
        shutil.copy2(path, OUT / path.name)
    for path in deploy.glob("*.css"):
        shutil.copy2(path, OUT / path.name)
    shutil.copy2(require(deploy / "vendor" / "msal-browser.min.js"), OUT / "vendor" / "msal-browser.min.js")
    shutil.copy2(require(PREVIEW / "production-basemap-toggle.js"), OUT / "production-basemap-toggle.js")
    shutil.copy2(require(PREVIEW / "production-basemap-toggle.css"), OUT / "production-basemap-toggle.css")


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
  <link rel=\"stylesheet\" href=\"https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css\" />
  <link rel=\"stylesheet\" href=\"./production-basemap-toggle.css?v=2\" />
  <script src=\"https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js\"></script>
  <script src=\"./production-basemap-toggle.js?v=2\"></script>"""
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
    for path in OUT.glob("*.js"):
        if path.name == "production-basemap-toggle.js":
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
    ]
    for path in required:
        require(path)
        if path.stat().st_size == 0:
            raise RuntimeError(f"Archivo vacio: {path}")

    index = (OUT / "index.php").read_text(encoding="utf-8")
    app = (OUT / "app.js").read_text(encoding="utf-8")
    toggle = (OUT / "production-basemap-toggle.js").read_text(encoding="utf-8")
    checks = [
        ("production-basemap-toggle.js?v=2", index),
        ("/mapa/assets/", index),
        ("/mapa/data/", app),
        ("JP_LEAFLET_MAP", toggle),
        ("mixBlendMode = 'multiply'", toggle),
        ("Satélite", toggle),
    ]
    for needle, haystack in checks:
        if needle not in haystack:
            raise RuntimeError(f"Validacion faltante: {needle}")


if __name__ == "__main__":
    copy_code()
    patch_index()
    patch_inventory()
    patch_javascript_paths()
    validate()
    print(f"Preview productivo preparado en {OUT}")
