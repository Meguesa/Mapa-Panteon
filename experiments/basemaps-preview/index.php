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
  <title>Calibración de Mapas Base | Mapa del Panteón</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" />
  <link rel="stylesheet" href="./basemaps-preview.css?v=4" />
</head>
<body>
  <header class="preview-header">
    <div class="preview-brand">
      <div>
        <div class="preview-eyebrow">Portal Interno JdJP · Jardines de Juan Pablo</div>
        <div class="preview-title-row">
          <h1>Mapa del Panteón</h1>
          <span class="preview-badge">CALIBRACIÓN</span>
        </div>
        <p>Preview independiente para alinear el plano JdJP con coordenadas geográficas.</p>
      </div>
    </div>

    <div class="preview-actions">
      <span class="preview-user"><?= $name ?></span>
      <a href="/mapa/" class="preview-back">Regresar al mapa actual</a>
    </div>
  </header>

  <main class="preview-main">
    <div id="map" aria-label="Mapa geográfico de calibración"></div>

    <section class="basemap-switcher" aria-label="Cambiar mapa base">
      <div class="basemap-switcher-title">Visualización</div>
      <button type="button" class="basemap-option active" data-basemap="light">
        <span class="basemap-thumb thumb-light"></span>
        <span><strong>Light</strong><small>OpenFreeMap Positron</small></span>
      </button>
      <button type="button" class="basemap-option" data-basemap="satellite">
        <span class="basemap-thumb thumb-satellite"></span>
        <span><strong>Satélite</strong><small>Esri World Imagery</small></span>
      </button>
    </section>

    <aside class="preview-panel calibration-panel">
      <div class="preview-panel-tag">ETAPA 2</div>
      <h2>Calibración del plano</h2>
      <p>
        El plano original tiene una orientación distinta al norte geográfico. Ajusta su
        <strong>posición, tamaño y rotación</strong> hasta hacer coincidir calles, glorietas y construcciones.
      </p>

      <div class="preview-info-row"><span>Modo</span><strong id="modeLabel">Light</strong></div>
      <div class="preview-info-row"><span>Centro del mapa</span><strong id="centerLabel">25.816618, -100.156099</strong></div>
      <div class="preview-info-row"><span>Zoom</span><strong id="zoomLabel">16.4</strong></div>

      <div class="calibration-section">
        <div class="calibration-heading">
          <strong>Plano JdJP</strong>
          <label class="toggle-row">
            <input id="planVisible" type="checkbox" checked />
            <span>Visible</span>
          </label>
        </div>

        <label class="calibration-control">
          <span>Opacidad <strong id="opacityValue">42%</strong></span>
          <input id="opacityRange" type="range" min="10" max="90" step="1" value="42" />
        </label>

        <label class="calibration-control">
          <span>Rotación <strong id="rotationValue">0.0°</strong></span>
          <input id="rotationRange" type="range" min="-45" max="45" step="0.1" value="0" />
        </label>

        <label class="calibration-control">
          <span>Ancho del plano <strong id="widthValue">850 m</strong></span>
          <input id="widthRange" type="range" min="450" max="1250" step="1" value="850" />
        </label>

        <div class="calibration-coordinates">
          <div><span>Latitud centro</span><strong id="planLatValue">25.816620</strong></div>
          <div><span>Longitud centro</span><strong id="planLngValue">-100.156100</strong></div>
        </div>

        <div class="nudge-label">Mover plano <span>(5 m por clic)</span></div>
        <div class="nudge-grid" aria-label="Mover plano">
          <button type="button" data-nudge="north" title="Mover al norte">↑</button>
          <button type="button" data-nudge="west" title="Mover al oeste">←</button>
          <button type="button" data-nudge="center" id="useMapCenterBtn" title="Usar centro actual del mapa">◎</button>
          <button type="button" data-nudge="east" title="Mover al este">→</button>
          <button type="button" data-nudge="south" title="Mover al sur">↓</button>
        </div>

        <div class="calibration-actions">
          <button id="resetCalibrationBtn" type="button">Restablecer</button>
          <button id="copyCalibrationBtn" type="button" class="primary">Copiar calibración</button>
        </div>
      </div>

      <div class="calibration-help">
        <strong>Orden recomendado</strong>
        <span>1. Satélite · 2. Opacidad ~40% · 3. Rotación · 4. Tamaño · 5. Posición.</span>
        <span>Usa como referencias las glorietas, curvas de calles y el edificio de la entrada.</span>
      </div>
    </aside>

    <div id="mapStatus" class="map-status">Cargando mapa…</div>
  </main>

  <script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
  <script src="./basemaps-preview.js?v=4"></script>
</body>
</html>
