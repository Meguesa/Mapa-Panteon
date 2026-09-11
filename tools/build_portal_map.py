from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
TARGET_DIR = ROOT / "deploy"
SRC_JS = ROOT / "src" / "js"
SRC_CSS = ROOT / "src" / "css"

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

    // inventario-base.json esta interceptado por sharepoint-inventario.js.
    // Si SharePoint falla no debemos sustituirlo silenciosamente por una copia
    // local/GitHub potencialmente desactualizada.
    if (repoRelative === "data/inventario-base.json") {
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


def patch_sharepoint_inventory_for_direct_load() -> None:
    """Hace de SharePoint la fuente primaria y bloqueante del inventario.

    El mapa ya no pinta primero inventario-base.json para sustituirlo despues.
    La solicitud a inventario-base.json espera a Microsoft Graph y devuelve esos
    datos. Si Graph falla se responde con error, evitando mostrar informacion
    local desactualizada como si fuera vigente.
    """
    path = TARGET_DIR / "sharepoint-inventario.js"
    source = path.read_text(encoding="utf-8")

    source = require_replace(
        source,
        '    source: "fallback-json",',
        '    source: "sharepoint-pending",',
        "estado inicial del inventario SharePoint",
    )

    source = require_replace(
        source,
        '    console.info(`[Mapa] Inventario actualizado desde SharePoint en segundo plano: ${inventory.items.length} registros.`);',
        '    console.info(`[Mapa] Inventario cargado directamente desde SharePoint: ${inventory.items.length} registros.`);',
        "mensaje de inventario SharePoint",
    )

    old_refresh = '''  function startInventoryRefresh() {
    if (liveInventory) return Promise.resolve(liveInventory);
    if (inventoryPromise) return inventoryPromise;

    window.JP_INVENTORY_RUNTIME.refreshing = true;

    inventoryPromise = loadInventoryFromSharePoint()
      .then(publishLiveInventory)
      .catch(function (error) {
        inventoryPromise = null;
        window.JP_INVENTORY_RUNTIME.refreshing = false;
        window.JP_INVENTORY_RUNTIME.error = error && error.message ? error.message : String(error || "");
        console.warn("[Mapa] SharePoint no estuvo disponible en segundo plano; se conserva el respaldo local.", error);
        return null;
      });

    return inventoryPromise;
  }'''

    direct_refresh = '''  function startInventoryRefresh() {
    if (liveInventory) return Promise.resolve(liveInventory);
    if (inventoryPromise) return inventoryPromise;

    window.JP_INVENTORY_RUNTIME.refreshing = true;
    window.JP_INVENTORY_RUNTIME.source = "sharepoint-loading";
    delete window.JP_INVENTORY_RUNTIME.error;

    inventoryPromise = loadInventoryFromSharePoint()
      .then(publishLiveInventory)
      .catch(function (error) {
        inventoryPromise = null;
        window.JP_INVENTORY_RUNTIME.refreshing = false;
        window.JP_INVENTORY_RUNTIME.source = "sharepoint-error";
        window.JP_INVENTORY_RUNTIME.error = error && error.message ? error.message : String(error || "");
        console.error("[Mapa] No fue posible cargar el inventario directamente desde SharePoint.", error);
        throw error;
      });

    return inventoryPromise;
  }'''

    source = require_replace(
        source,
        old_refresh,
        direct_refresh,
        "carga directa de inventario SharePoint",
    )

    old_fetch = '''  /*
   * Rendimiento:
   * El mapa ya no espera las ~14 paginas de Microsoft Graph antes de dibujarse.
   * Para la primera solicitud de inventario devolvemos inmediatamente el JSON
   * local publicado en /data y, en paralelo, actualizamos desde SharePoint.
   * Cuando termina la sincronizacion se emite jp-inventory-updated para que las
   * capas visibles adopten los valores actuales sin recargar la pagina.
   */
  window.fetch = async function (input, init) {
    if (!isInventoryRequest(input)) return originalFetch(input, init);

    if (liveInventory) {
      return inventoryResponse(liveInventory);
    }

    startInventoryRefresh();

    try {
      const fallback = await originalFetch(input, {
        ...(init || {}),
        cache: "no-cache"
      });
      if (fallback.ok) {
        window.JP_INVENTORY_RUNTIME.source = "fallback-json";
        return fallback;
      }
    } catch (error) {
      console.warn("[Mapa] No fue posible leer el respaldo local de inventario.", error);
    }

    const inventory = await startInventoryRefresh();
    if (inventory) return inventoryResponse(inventory);

    return new Response(JSON.stringify({ source: "unavailable", items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  };'''

    direct_fetch = '''  /*
   * SharePoint es la fuente de verdad del inventario en produccion.
   * La primera solicitud de inventario espera a Microsoft Graph antes de
   * continuar con el mapa; ya no se pinta un JSON local para reemplazarlo
   * posteriormente. Esto evita estados parciales o desfasados en lotes/nichos.
   */
  window.fetch = async function (input, init) {
    if (!isInventoryRequest(input)) return originalFetch(input, init);

    if (liveInventory) {
      return inventoryResponse(liveInventory);
    }

    try {
      const inventory = await startInventoryRefresh();
      return inventoryResponse(inventory);
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "Error desconocido");
      return new Response(JSON.stringify({
        source: "sharepoint-error",
        items: [],
        error: message
      }), {
        status: 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }
  };'''

    source = require_replace(
        source,
        old_fetch,
        direct_fetch,
        "intercepcion directa del inventario SharePoint",
    )

    path.write_text(source, encoding="utf-8")


def copy_files() -> None:
    required_files = [
        ROOT / "app.js",
        ROOT / "styles.css",
        ROOT / "index.html",
        SRC_JS / "sharepoint-inventario.js",
        SRC_JS / "public-ui-fixes.js",
        SRC_JS / "section-visual-references.js",
        SRC_CSS / "portal-integration.css",
        SRC_CSS / "account-menu.css",
        SRC_JS / "mapa-enhancements.js",
        SRC_JS / "lotes-nv2-match.js",
        ROOT / "assets/map/base-public.webp",
        ROOT / "assets/logo.jpg",
        ROOT / "assets/americano-01.webp",
        ROOT / "assets/americano-02.webp",
        ROOT / "assets/americano-03.webp",
        ROOT / "assets/americano-04.webp",
        ROOT / "assets/vip-01.webp",
        ROOT / "assets/vip-02.webp",
        ROOT / "assets/vip-03.webp",
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

    flat_sources = {
        SRC_JS / "sharepoint-inventario.js": "sharepoint-inventario.js",
        SRC_JS / "public-ui-fixes.js": "public-ui-fixes.js",
        SRC_JS / "section-visual-references.js": "section-visual-references.js",
        SRC_CSS / "portal-integration.css": "portal-integration.css",
        SRC_CSS / "account-menu.css": "account-menu.css",
        SRC_JS / "mapa-enhancements.js": "mapa-enhancements.js",
        SRC_JS / "lotes-nv2-match.js": "lotes-nv2-match.js",
    }
    shutil.copy2(ROOT / "styles.css", TARGET_DIR / "styles.css")
    for source_path, target_name in flat_sources.items():
        shutil.copy2(source_path, TARGET_DIR / target_name)

    patch_sharepoint_inventory_for_direct_load()

    assets_dir = TARGET_DIR / "assets"
    (assets_dir / "map").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "assets/map/base-public.webp", assets_dir / "map/base-public.webp")
    shutil.copy2(ROOT / "assets/logo.jpg", assets_dir / "logo.jpg")
    for name in [
        "americano-01.webp",
        "americano-02.webp",
        "americano-03.webp",
        "americano-04.webp",
        "vip-01.webp",
        "vip-02.webp",
        "vip-03.webp",
    ]:
        shutil.copy2(ROOT / "assets" / name, assets_dir / name)
    shutil.copytree(ROOT / "assets/nichos", assets_dir / "nichos")
    shutil.copytree(ROOT / "data", TARGET_DIR / "data")


def build_index() -> None:
    source = (ROOT / "index.html").read_text(encoding="utf-8")

    # La fuente del repositorio vive en src/, pero el paquete de cPanel mantiene
    # nombres planos para no cambiar URLs productivas ya publicadas.
    for source_ref, deploy_ref in {
        "./src/js/sharepoint-inventario.js": "./sharepoint-inventario.js",
        "./src/js/public-ui-fixes.js": "./public-ui-fixes.js",
        "./src/js/section-visual-references.js": "./section-visual-references.js",
    }.items():
        source = source.replace(source_ref, deploy_ref)

    # Forzar al navegador a descargar la version que espera SharePoint antes de
    # pintar el inventario, evitando reutilizar el JS anterior de segundo plano.
    source = re.sub(
        r'sharepoint-inventario\.js\?v=[^"\']+',
        'sharepoint-inventario.js?v=20260910b',
        source,
        count=1,
    )

    msal_pattern = re.compile(
        r'\s*<!-- Microsoft Authentication Library -->\s*'
        r'<script src="https://alcdn\.msauth\.net/browser/2\.38\.3/js/msal-browser\.min\.js"></script>\s*'
        r'<!-- Respaldo oficial de MSAL en otra region de Microsoft -->\s*'
        r'<script>.*?</script>\s*',
        re.DOTALL | re.IGNORECASE,
    )

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
              <circle cx="12" cy="8" r="4" fill="currentColor" />
              <path fill="currentColor" d="M4 21v-1c0-3.4 3.6-6 8-6s8 2.6 8 6v1H4z" />
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

    original_app_onload = '''      s.onload = function () {
        var fixes = document.createElement("script");
        fixes.src = "./public-ui-fixes.js?v=" + encodeURIComponent(window.APP_VERSION);
        document.body.appendChild(fixes);
      };'''

    patched_app_onload = '''      s.onload = function () {
        var fixes = document.createElement("script");
        fixes.src = "./public-ui-fixes.js?v=" + encodeURIComponent(window.APP_VERSION);
        document.body.appendChild(fixes);

        var lotesMatch = document.createElement("script");
        lotesMatch.src = "./lotes-nv2-match.js?v=1&bust=" + encodeURIComponent(window.APP_VERSION);
        lotesMatch.onload = function () {
          console.info("[Mapa] Formato Nichos V2 aplicado a lotes.");
        };
        lotesMatch.onerror = function () {
          console.error("[Mapa] No fue posible cargar lotes-nv2-match.js");
        };
        document.body.appendChild(lotesMatch);
      };'''

    source = require_replace(
        source,
        original_app_onload,
        patched_app_onload,
        "carga de formato de lotes despues de app.js",
    )

    source = require_replace(
        source,
        "</body>",
        '  <script src="./mapa-enhancements.js?v=20260822a"></script>\n</body>',
        "mejoras de navegacion y ficha del Mapa",
    )

    php = '''<?php

declare(strict_types=1);

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
