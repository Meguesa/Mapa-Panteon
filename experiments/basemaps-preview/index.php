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
  <link rel="stylesheet" href="./basemaps-preview.css?v=12" />
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

    <div id="sectionHoverLabel" class="section-hover-label" hidden></div>
    <div id="mapStatus" class="map-status hidden" aria-live="polite"></div>

    <!-- Controles de compatibilidad: mantienen la lógica de lotes activa sin mostrar UI lateral. -->
    <div class="runtime-controls" aria-hidden="true">
      <select id="lotSectionSelect">
        <option value=""></option>
        <option value="BRONCE">BRONCE</option>
        <option value="ORO">ORO</option>
        <option value="PLATA">PLATA</option>
        <option value="PLATINO">PLATINO</option>
        <option value="SANJUANVIP">SAN JUAN VIP</option>
        <option value="SANMATEOVIP">SAN MATEO VIP</option>
        <option value="SANPEDROVIP">SAN PEDRO VIP</option>
      </select>
      <select id="lotManzanaSelect"><option value=""></option></select>
      <input id="lotsVisible" type="checkbox" checked />
      <input id="lotNumbersVisible" type="checkbox" checked />
      <div id="lotStatus"></div>
      <div id="lotSelected"></div>
      <div id="inventoryLiveStatus"></div>
    </div>
  </main>

  <script>
    (function () {
      const key = 'jp-basemap-calibration-v2';
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) {}
      Object.assign(saved, {
        lat: 25.81632700772623,
        lng: -100.15612317763441,
        widthMeters: 516,
        rotationDeg: 5.7,
        opacity: 0.9,
        visible: false
      });
      try { localStorage.setItem(key, JSON.stringify(saved)); } catch (_) {}
    })();
  </script>

  <script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
  <script>
    (function () {
      const OriginalMap = maplibregl.Map;
      const blankLightStyle = {
        version: 8,
        sources: {},
        layers: [{
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#ffffff' }
        }]
      };
      maplibregl.Map = class JPPreviewMap extends OriginalMap {
        constructor(options) {
          const next = Object.assign({}, options, { style: blankLightStyle, maxZoom: 22 });
          super(next);
          window.JP_BASEMAP_MAP = this;
          window.JP_BLANK_LIGHT_STYLE = blankLightStyle;
        }
      };
    })();
  </script>
  <script src="./basemaps-preview.js?v=11"></script>
  <script src="./basemaps-runtime-overrides.js?v=2"></script>
  <script src="./inventory-preview.js?v=2"></script>
  <script src="./lots-preview.js?v=3"></script>
</body>
</html>
