from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
TARGET_DIR = ROOT / "deploy"

PORTAL_OVERLAY_HEIGHT = "calc(100vh - var(--portal-map-total-header-height, 144px))"


def require_file(path: Path) -> None:
    if not path.is_file():
        raise RuntimeError(f"No se encontro el archivo requerido: {path}")


def require_dir(path: Path) -> None:
    if not path.is_dir():
        raise RuntimeError(f"No se encontro la carpeta requerida: {path}")


def require_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"No se encontro el bloque esperado para: {label}")
    return text.replace(old, new, 1)


def reset_target() -> None:
    if TARGET_DIR.exists():
        shutil.rmtree(TARGET_DIR)
    TARGET_DIR.mkdir(parents=True, exist_ok=True)


def build_app_js() -> None:
    source = (ROOT / "app.js").read_text(encoding="utf-8")
    source = source.replace(
        "calc(100vh - var(--topbar-h, 52px))",
        PORTAL_OVERLAY_HEIGHT,
    )

    original_loader = '''async function loadJson(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`No se pudo cargar: ${url}`);
  return await r.json();
}'''

    robust_loader = '''async function loadJson(url){
  const fetchJsonText = async (candidateUrl) => {
    const response = await fetch(candidateUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} al cargar ${candidateUrl}`);
    }

    const text = await response.text();
    if (!text || !text.trim()) {
      throw new Error(`Respuesta vacia al cargar ${candidateUrl}`);
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`JSON invalido en ${candidateUrl} (${text.length} bytes): ${error.message}`);
    }
  };

  try {
    return await fetchJsonText(url);
  } catch (localError) {
    const value = String(url || "");
    let repoRelative = "";

    if (value.startsWith("./data/")) {
      repoRelative = value.slice(2);
    } else if (value.startsWith("data/")) {
      repoRelative = value;
    } else {
      const marker = "/data/";
      const markerIndex = value.indexOf(marker);
      if (markerIndex >= 0) {
        repoRelative = value.slice(markerIndex + 1);
      }
    }

    if (!repoRelative) {
      throw localError;
    }

    const fallbackUrl = `https://raw.githubusercontent.com/Meguesa/Mapa-Panteon/main/${repoRelative}`;
    console.warn(`[Mapa] Fallo el archivo local ${value}. Se intentara respaldo GitHub.`, localError);

    try {
      const result = await fetchJsonText(fallbackUrl);
      console.info(`[Mapa] Datos recuperados desde GitHub: ${repoRelative}`);
      return result;
    } catch (fallbackError) {
      throw new Error(
        `No se pudo cargar ${value} localmente ni desde GitHub. Local: ${localError.message}. GitHub: ${fallbackError.message}`
      );
    }
  }
}'''

    if original_loader not in source:
        raise RuntimeError("No se encontro loadJson() esperado en app.js")
    source = source.replace(original_loader, robust_loader, 1)

    (TARGET_DIR / "app.js").write_text(source, encoding="utf-8")


def copy_files() -> None:
    required_files = [
        ROOT / "app.js",
        ROOT / "styles.css",
        ROOT / "index.html",
        ROOT / "sharepoint-inventario.js",
        ROOT / "public-ui-fixes.js",
        ROOT / "portal-integration.css",
        ROOT / "account-menu.css",
        ROOT / "mapa-enhancements.js",
        ROOT / "assets/map/base-public.webp",
        ROOT / "assets/logo.jpg",
    ]
    required_dirs = [
        ROOT / "data",
        ROOT / "assets/nichos",
    ]

    for path in required_files:
        require_file(path)
    for path in required_dirs:
        require_dir(path)

    build_app_js()

    for name in [
        "styles.css",
        "sharepoint-inventario.js",
        "public-ui-fixes.js",
        "portal-integration.css",
        "account-menu.css",
        "mapa-enhancements.js",
    ]:
        shutil.copy2(ROOT / name, TARGET_DIR / name)

    assets_dir = TARGET_DIR / "assets"
    (assets_dir / "map").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "assets/map/base-public.webp", assets_dir / "map/base-public.webp")
    shutil.copy2(ROOT / "assets/logo.jpg", assets_dir / "logo.jpg")
    shutil.copytree(ROOT / "assets/nichos", assets_dir / "nichos")
    shutil.copytree(ROOT / "data", TARGET_DIR / "data")


def build_index() -> None:
    source = (ROOT / "index.html").read_text(encoding="utf-8")

    msal_pattern = re.compile(
        r'\s*<!-- Microsoft Authentication Library -->\s*'
        r'<script src="https://alcdn\.msauth\.net/browser/2\.38\.3/js/msal-browser\.min\.js"></script>\s*'
        r'<!-- Respaldo oficial de MSAL en otra region de Microsoft -->\s*'
        r'<script>.*?</script>\s*',
        re.DOTALL | re.IGNORECASE,
    )

    # El comentario del archivo fuente usa acentos. Manejamos ambas variantes.
    if not msal_pattern.search(source):
        msal_pattern = re.compile(
            r'\s*<!-- Microsoft Authentication Library -->\s*'
            r'<script src="https://alcdn\.msauth\.net/browser/2\.38\.3/js/msal-browser\.min\.js"></script>\s*'
            r'<!-- Respaldo oficial de MSAL en otra regi.n de Microsoft -->\s*'
            r'<script>.*?</script>\s*',
            re.DOTALL | re.IGNORECASE,
        )

    source, replacements = msal_pattern.subn(
        '\n  <!-- Microsoft Authentication Library local -->\n'
        '  <script src="./vendor/msal-browser.min.js"></script>\n\n',
        source,
        count=1,
    )
    if replacements != 1:
        raise RuntimeError("No se encontro el bloque CDN de MSAL del Mapa")

    source = require_replace(
        source,
        "<title>Mapa del Panteón</title>",
        "<title>Mapa del Panteón | Portal Interno JdJP</title>",
        "titulo del Mapa",
    )

    source = require_replace(
        source,
        "</head>",
        '  <link rel="stylesheet" href="./account-menu.css" />\n'
        '  <link rel="stylesheet" href="./portal-integration.css?v=5" />\n'
        "</head>",
        "estilos de integracion",
    )

    header_pattern = re.compile(r"\s*<header>.*?</header>\s*", re.DOTALL)
    source, replacements = header_pattern.subn("\n", source, count=1)
    if replacements != 1:
        raise RuntimeError("No se encontro el encabezado original del Mapa")

    toolbar = '''<body class="mapa-page">
  <nav class="portal-map-toolbar" aria-label="Navegacion del Portal Interno">
    <div class="portal-map-toolbar-inner">
      <div class="portal-map-title-wrap">
        <img class="portal-map-logo" src="./assets/logo.jpg" alt="Jardines de Juan Pablo">
        <div class="portal-map-title">
          <strong>Mapa del Panteón</strong>
          <span>Portal Interno JdJP · Jardines de Juan Pablo</span>
        </div>
      </div>

      <div class="portal-map-context">Consulta de propiedades, ocupación e inventario</div>

      <div class="portal-map-actions">
        <a class="portal-map-back" href="/">Regresar al portal</a>
        <details class="account-menu">
          <summary class="account-trigger" aria-label="Abrir menú de usuario" title="<?= $name ?>">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4 1.79-4 4 1.79 4 4 4Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z"/>
            </svg>
          </summary>
          <div class="account-menu-panel">
            <div class="account-menu-info">
              <strong><?= $name ?></strong>
              <span><?= $email ?></span>
            </div>
            <a class="account-menu-logout" href="/logout.php">Cerrar sesión</a>
          </div>
        </details>
      </div>
    </div>
  </nav>

  <header class="map-controls-header">
    <div class="map-controls-inner">
      <span class="map-controls-label">Buscar propiedad</span>
      <div class="controls">
        <select id="sectionSelect" aria-label="Seleccionar sección">
          <option value="">SECCIÓN...</option>
        </select>
        <select id="manzanaSelect" aria-label="Seleccionar manzana">
          <option value="">MANZANA...</option>
        </select>
        <input id="searchInput" placeholder="Buscar lote (ej. 001)" aria-label="Buscar lote" />
        <button id="searchBtn" type="button">Buscar</button>
        <button id="toggleLotsBtn" type="button">Mostrar lotes</button>
        <button id="backBtn" type="button">Volver</button>
      </div>
    </div>
  </header>

  <script>
    (function () {
      var url = new URL(window.location.href);
      if (url.searchParams.has("edit")) {
        url.searchParams.delete("edit");
        window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
      }
    })();
  </script>'''

    source = require_replace(source, "<body>", toolbar, "inicio del body")
    source = require_replace(source, "<main>", '<main class="layout">', "layout principal")
    source = require_replace(source, '<div id="map"></div>', '<div id="map" class="map"></div>', "contenedor del mapa")
    source = require_replace(source, "<aside>", '<aside class="panel">', "panel lateral")
    source = require_replace(
        source,
        "</body>",
        '  <script src="./mapa-enhancements.js?v=20260822a"></script>\n</body>',
        "mejoras de navegacion y ficha del Mapa",
    )

    php = '''<?php

declare(strict_types=1);

// Unica dependencia compartida con el Portal: autenticacion/sesion.
require_once dirname(__DIR__) . '/includes/bootstrap.php';
portal_require_authentication();

$user = portal_user();
$name = htmlspecialchars((string) ($user['name'] ?? 'Usuario'), ENT_QUOTES, 'UTF-8');
$email = htmlspecialchars((string) ($user['email'] ?? ''), ENT_QUOTES, 'UTF-8');
?>
'''

    (TARGET_DIR / "index.php").write_text(php + source, encoding="utf-8")


def main() -> None:
    reset_target()
    copy_files()
    build_index()
    print("Mapa del Panteon preparado autonomamente para /mapa/")


if __name__ == "__main__":
    main()
