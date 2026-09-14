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
  <title>Preview de Mapas Base | Mapa del Panteón</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" />
  <link rel="stylesheet" href="./basemaps-preview.css?v=1" />
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
        <p>Prueba independiente de mapas base geográficos. No modifica el mapa productivo.</p>
      </div>
    </div>

    <div class="preview-actions">
      <span class="preview-user"><?= $name ?></span>
      <a href="/mapa/" class="preview-back">Regresar al mapa actual</a>
    </div>
  </header>

  <main class="preview-main">
    <div id="map" aria-label="Mapa geográfico de prueba"></div>

    <section class="basemap-switcher" aria-label="Cambiar mapa base">
      <div class="basemap-switcher-title">Visualización</div>
      <button type="button" class="basemap-option active" data-basemap="light">
        <span class="basemap-thumb thumb-light"></span>
        <span><strong>Light</strong><small>OpenFreeMap Positron</small></span>
      </button>
      <button type="button" class="basemap-option" data-basemap="standard">
        <span class="basemap-thumb thumb-standard"></span>
        <span><strong>OpenStreetMap</strong><small>Standard</small></span>
      </button>
      <button type="button" class="basemap-option" data-basemap="satellite">
        <span class="basemap-thumb thumb-satellite"></span>
        <span><strong>Satélite</strong><small>Esri World Imagery</small></span>
      </button>
    </section>

    <aside class="preview-panel">
      <div class="preview-panel-tag">ETAPA 1</div>
      <h2>Validación de fondos</h2>
      <p>Compara claridad, cobertura y resolución sobre el parque. En esta etapa todavía no se superpone el plano JdJP.</p>
      <div class="preview-info-row"><span>Modo</span><strong id="modeLabel">Light</strong></div>
      <div class="preview-info-row"><span>Centro</span><strong id="centerLabel">25.816618, -100.156099</strong></div>
      <div class="preview-info-row"><span>Zoom</span><strong id="zoomLabel">16.4</strong></div>
      <div class="preview-next">
        <strong>Siguiente etapa</strong>
        <span>Calibrar puntos del plano actual contra estas coordenadas GPS y superponer el linework.</span>
      </div>
    </aside>

    <div id="mapStatus" class="map-status">Cargando mapa…</div>
  </main>

  <script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
  <script src="./basemaps-preview.js?v=1"></script>
</body>
</html>
