<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/includes/bootstrap.php';
portal_require_authentication();

$user = portal_user();
$name = htmlspecialchars((string) ($user['name'] ?? 'Usuario'), ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Validación geográfica | Mapa del Panteón</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" />
  <link rel="stylesheet" href="./basemaps-preview.css?v=11" />
  <link rel="stylesheet" href="./lots-preview.css?v=3" />
</head>
<body>
  <header class="preview-header">
    <div class="preview-brand">
      <div>
        <div class="preview-eyebrow">Portal Interno JdJP · Jardines de Juan Pablo</div>
        <div class="preview-title-row">
          <h1>Mapa del Panteón</h1>
          <span class="preview-badge">PREVIEW</span>
        </div>
        <p>Validación geográfica del mapa final. No modifica el mapa productivo.</p>
      </div>
    </div>

    <div class="preview-actions">
      <span class="preview-user"><?= $name ?></span>
      <a href="/mapa/" class="preview-back">Regresar al mapa actual</a>
    </div>
  </header>

  <main class="preview-main">
    <div id="map" aria-label="Mapa geográfico de validación"></div>

    <section class="basemap-switcher" aria-label="Cambiar mapa base">
      <button type="button" class="basemap-option active" data-basemap="light">
        <span class="basemap-thumb thumb-light"></span>
        <span><strong>Light</strong><small>Plano JdJP</small></span>
      </button>
      <button type="button" class="basemap-option" data-basemap="satellite">
        <span class="basemap-thumb thumb-satellite"></span>
        <span><strong>Satélite</strong><small>Esri World Imagery</small></span>
      </button>
    </section>

    <div id="mapStatus" class="map-status hidden" aria-live="polite"></div>
  </main>

  <script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
  <script>
    (function () {
      const OriginalMap = maplibregl.Map;
      maplibregl.Map = class JPPreviewMap extends OriginalMap {
        constructor(options) {
          super(options);
          window.JP_BASEMAP_MAP = this;
        }
      };
    })();
  </script>
  <script src="./basemaps-preview.js?v=11"></script>
  <script src="./inventory-preview.js?v=2"></script>
  <script src="./lots-preview.js?v=3"></script>
</body>
</html>
