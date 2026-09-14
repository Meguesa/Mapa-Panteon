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
  <link rel="stylesheet" href="./basemaps-preview.css?v=10" />
  <link rel="stylesheet" href="./lots-preview.css?v=1" />
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
        <p>Validación geográfica de plano, secciones y lotes. No modifica el mapa productivo.</p>
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
      <div class="preview-panel-tag">ETAPA 4</div>
      <h2>Validación con inventario real</h2>
      <p>La geometría validada se cruza ahora con la lista real de propiedades en SharePoint sin modificar el mapa productivo.</p>

      <div class="preview-info-row"><span>Modo</span><strong id="modeLabel">Light</strong></div>
      <div class="preview-info-row"><span>Centro del mapa</span><strong id="centerLabel">25.816327, -100.156123</strong></div>
      <div class="preview-info-row"><span>Zoom</span><strong id="zoomLabel">16.4</strong></div>

      <div class="calibration-section">
        <div class="calibration-heading">
          <strong>Plano JdJP</strong>
          <label class="toggle-row"><input id="planVisible" type="checkbox" checked /><span>Visible</span></label>
        </div>

        <label class="calibration-control"><span>Opacidad <strong id="opacityValue">31%</strong></span><input id="opacityRange" type="range" min="10" max="90" step="1" value="31" /></label>
        <label class="calibration-control"><span>Rotación <strong id="rotationValue">5.7°</strong></span><input id="rotationRange" type="range" min="-45" max="45" step="0.1" value="5.7" /></label>
        <label class="calibration-control"><span>Ancho del plano <strong id="widthValue">516 m</strong></span><input id="widthRange" type="range" min="400" max="900" step="1" value="516" /></label>

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
        <div class="calibration-heading"><strong>Ajuste vectorial aprobado</strong><span class="validation-badge">LISTO</span></div>
        <label class="vector-toggle"><input id="sectionsVisible" type="checkbox" checked /><span><i class="vector-swatch section-swatch"></i>Secciones azules</span></label>
        <input id="manzanasVisible" type="checkbox" checked hidden />
        <input id="vectorFlipHorizontal" type="checkbox" hidden />
        <input id="vectorFlipVertical" type="checkbox" checked hidden />
        <div class="preview-info-row"><span>Flip vertical</span><strong>Sí</strong></div>
        <div class="preview-info-row"><span>Escala / rotación adicional</span><strong>100% / 0°</strong></div>
        <div class="preview-info-row"><span>Vectores cargados</span><strong id="vectorStatus">Cargando…</strong></div>
        <input id="vectorRotationRange" type="range" min="-180" max="180" step="0.1" value="0" hidden />
        <span id="vectorRotationValue" hidden>0.0°</span>
        <input id="vectorScaleRange" type="range" min="70" max="130" step="0.1" value="100" hidden />
        <span id="vectorScaleValue" hidden>100.0%</span>
        <button id="resetVectorsBtn" type="button" hidden></button>
        <button id="copyVectorsBtn" type="button" hidden></button>
      </div>

      <div class="lots-stage">
        <div class="calibration-heading"><strong>Lotes reales</strong><span class="validation-badge">SHAREPOINT</span></div>

        <div id="inventoryLiveStatus" class="lots-selected"><strong>Inventario SharePoint</strong><br>Preparando conexión…</div>

        <label class="lots-field">
          <span>Sección</span>
          <select id="lotSectionSelect">
            <option value="">Selecciona una sección…</option>
            <option value="BRONCE">BRONCE</option>
            <option value="ORO">ORO</option>
            <option value="PLATA">PLATA</option>
            <option value="PLATINO">PLATINO</option>
            <option value="SANJUANVIP">SAN JUAN VIP</option>
            <option value="SANMATEOVIP">SAN MATEO VIP</option>
            <option value="SANPEDROVIP">SAN PEDRO VIP</option>
          </select>
        </label>

        <label class="lots-field">
          <span>Manzana</span>
          <select id="lotManzanaSelect" disabled>
            <option value="">Todas las manzanas</option>
          </select>
        </label>

        <div class="lots-toolbar">
          <label><input id="lotsVisible" type="checkbox" checked /> Mostrar lotes</label>
          <label><input id="lotNumbersVisible" type="checkbox" checked /> Numeración</label>
        </div>

        <div id="lotStatus" class="lots-selected">Selecciona una sección para cargar sus lotes.</div>
        <div id="lotSelected" class="lots-selected">Selecciona un lote sobre el mapa para verificar posición e inventario.</div>

        <div class="lots-legend">
          <span><i class="lot-available"></i>Disponible</span>
          <span><i class="lot-separated"></i>Separado</span>
          <span><i class="lot-sold"></i>Vendido</span>
          <span><i class="lot-used"></i>Utilizado / lleno</span>
          <span><i class="lot-suspended"></i>Suspendido</span>
          <span><i class="lot-build"></i>Por construir</span>
        </div>

        <div class="lots-note">Los colores de esta etapa se obtienen del inventario real de SharePoint cuando existe coincidencia por sección + manzana + lote. Si un lote no encuentra match, conserva temporalmente el estatus del GeoJSON para poder detectar diferencias.</div>
      </div>
    </aside>

    <div id="mapStatus" class="map-status">Cargando mapa…</div>
  </main>

  <script>
    (function () {
      localStorage.setItem('jp-basemap-vector-calibration-v3', JSON.stringify({
        offsetEastMeters: 0,
        offsetNorthMeters: 0,
        scale: 1,
        rotationDeg: 0,
        flipHorizontal: false,
        flipVertical: true
      }));
    })();
  </script>
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
  <script src="./basemaps-preview.js?v=10"></script>
  <script src="./inventory-preview.js?v=1"></script>
  <script src="./lots-preview.js?v=2"></script>
</body>
</html>