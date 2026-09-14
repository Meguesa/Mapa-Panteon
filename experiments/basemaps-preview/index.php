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
  <link rel="stylesheet" href="./basemaps-preview.css?v=5" />
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
        La calibración inicial ya usa los valores aprobados. Ajusta sólo si detectas una diferencia al comparar
        calles, glorietas y construcciones con el fondo geográfico.
      </p>

      <div class="preview-info-row"><span>Modo</span><strong id="modeLabel">Light</strong></div>
      <div class="preview-info-row"><span>Centro del mapa</span><strong id="centerLabel">25.816327, -100.156123</strong></div>
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
          <span>Opacidad <strong id="opacityValue">31%</strong></span>
          <input id="opacityRange" type="range" min="10" max="90" step="1" value="31" />
        </label>

        <label class="calibration-control">
          <span>Rotación <strong id="rotationValue">5.7°</strong></span>
          <input id="rotationRange" type="range" min="-45" max="45" step="0.1" value="5.7" />
        </label>

        <label class="calibration-control">
          <span>Ancho del plano <strong id="widthValue">516 m</strong></span>
          <input id="widthRange" type="range" min="400" max="900" step="1" value="516" />
        </label>

        <div class="calibration-coordinates">
          <div><span>Latitud centro</span><strong id="planLatValue">25.816327</strong></div>
          <div><span>Longitud centro</span><strong id="planLngValue">-100.156123</strong></div>
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
          <button id="resetCalibrationBtn" type="button">Valores aprobados</button>
          <button id="copyCalibrationBtn" type="button" class="primary">Copiar calibración</button>
        </div>
      </div>

      <div class="vector-validation">
        <div class="calibration-heading">
          <strong>Validación vectorial</strong>
          <span class="validation-badge">NUEVO</span>
        </div>
        <label class="vector-toggle">
          <input id="sectionsVisible" type="checkbox" checked />
          <span><i class="vector-swatch section-swatch"></i>Secciones</span>
        </label>
        <label class="vector-toggle">
          <input id="manzanasVisible" type="checkbox" checked />
          <span><i class="vector-swatch manzana-swatch"></i>Manzanas</span>
        </label>
        <p>
          Estas líneas se calculan con la misma transformación del plano. Si coinciden con el satélite,
          la calibración ya puede aplicarse después a los lotes.
        </p>
      </div>

      <div class="calibration-help">
        <strong>Qué revisar ahora</strong>
        <span>Las líneas azules de secciones y las líneas naranjas de manzanas deben mantener la misma posición y ángulo que el plano.</span>
        <span>Compara especialmente glorietas, curvas y extremos de los bloques.</span>
      </div>
    </aside>

    <div id="mapStatus" class="map-status">Cargando mapa…</div>
  </main>

  <script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
  <script src="./basemaps-preview.js?v=5"></script>
</body>
</html>
