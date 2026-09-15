(function () {
  'use strict';

  const SATELLITE_IMAGE = './satellite-base.webp';
  const PLAN_LINES_IMAGE = './base-lines.webp';
  const PLAN_LINES_OPACITY = 0.90;
  const SATELLITE_EXTENT_FACTOR = 2.20;

  let leafletMap = null;
  let baseOverlay = null;
  let satelliteOverlay = null;
  let linesOverlay = null;
  let switcher = null;
  let currentMode = 'light';

  function installLeafletCapture() {
    if (!window.L || window.L.__jpBasemapCaptureInstalled) return;
    const originalMap = window.L.map;
    window.L.map = function () {
      const instance = originalMap.apply(this, arguments);
      window.JP_LEAFLET_MAP = instance;
      return instance;
    };
    Object.assign(window.L.map, originalMap);
    window.L.__jpBasemapCaptureInstalled = true;
  }

  // Se carga antes de app.js para capturar exactamente la instancia Leaflet
  // que usa el mapa productivo. No reconstruimos secciones, manzanas, lotes ni nichos.
  installLeafletCapture();

  function findBaseOverlay() {
    if (!leafletMap) return null;
    let candidate = null;
    leafletMap.eachLayer(function (layer) {
      if (candidate || !layer) return;
      const url = String(layer._url || '');
      if (url.includes('base-public.webp') || url.includes('/assets/map/base-public.webp')) {
        candidate = layer;
      }
    });
    return candidate;
  }

  function ensurePreviewPanes() {
    if (!leafletMap) return;

    // El satelite y las lineas SIEMPRE quedan debajo de overlayPane, donde
    // Leaflet dibuja secciones, manzanas y lotes. Esto garantiza que los
    // colores/estatus del mapa productivo sigan visibles en modo Satelite.
    if (!leafletMap.getPane('jpSatellitePane')) {
      const pane = leafletMap.createPane('jpSatellitePane');
      pane.style.zIndex = '90';
      pane.style.pointerEvents = 'none';
    }
    if (!leafletMap.getPane('jpPlanLinesPane')) {
      const pane = leafletMap.createPane('jpPlanLinesPane');
      pane.style.zIndex = '110';
      pane.style.pointerEvents = 'none';
    }

    const overlayPane = leafletMap.getPane('overlayPane');
    if (overlayPane) overlayPane.style.zIndex = '450';
    const markerPane = leafletMap.getPane('markerPane');
    if (markerPane) markerPane.style.zIndex = '600';
    const tooltipPane = leafletMap.getPane('tooltipPane');
    if (tooltipPane) tooltipPane.style.zIndex = '650';
    const popupPane = leafletMap.getPane('popupPane');
    if (popupPane) popupPane.style.zIndex = '700';
  }

  function expandedBounds(bounds, factor) {
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const centerX = (west + east) / 2;
    const centerY = (south + north) / 2;
    const halfWidth = Math.abs(east - west) * factor / 2;
    const halfHeight = Math.abs(north - south) * factor / 2;
    return L.latLngBounds(
      [centerY - halfHeight, centerX - halfWidth],
      [centerY + halfHeight, centerX + halfWidth]
    );
  }

  function ensureSatelliteLayers() {
    if (!leafletMap || !baseOverlay) return false;
    ensurePreviewPanes();

    const planBounds = baseOverlay.getBounds();
    const satelliteBounds = expandedBounds(planBounds, SATELLITE_EXTENT_FACTOR);

    if (!satelliteOverlay) {
      satelliteOverlay = L.imageOverlay(SATELLITE_IMAGE, satelliteBounds, {
        pane: 'jpSatellitePane',
        opacity: 0,
        interactive: false,
        crossOrigin: false
      }).addTo(leafletMap);
    }

    if (!linesOverlay) {
      linesOverlay = L.imageOverlay(PLAN_LINES_IMAGE, planBounds, {
        pane: 'jpPlanLinesPane',
        opacity: 0,
        interactive: false,
        crossOrigin: false
      }).addTo(leafletMap);
    }

    return true;
  }

  function setBaseOpacity(value) {
    if (!baseOverlay) return;
    try { baseOverlay.setOpacity(value); } catch {}
    const element = typeof baseOverlay.getElement === 'function' ? baseOverlay.getElement() : null;
    if (element) {
      element.style.opacity = String(value);
      element.style.mixBlendMode = 'normal';
      element.style.filter = 'none';
      element.style.pointerEvents = 'none';
    }
  }

  function raiseOperationalLayers() {
    if (!leafletMap) return;

    const excluded = new Set([baseOverlay, satelliteOverlay, linesOverlay]);
    const seen = new Set();

    function raise(layer) {
      if (!layer || excluded.has(layer) || seen.has(layer)) return;
      seen.add(layer);

      // Primero recorremos grupos GeoJSON/FeatureGroup. Luego subimos cada Path
      // individual (seccion/manzana/lote) sobre las imagenes base.
      if (typeof layer.eachLayer === 'function' && !(layer instanceof L.Path)) {
        try { layer.eachLayer(raise); } catch {}
      }
      if (layer instanceof L.Path && typeof layer.bringToFront === 'function') {
        try { layer.bringToFront(); } catch {}
      }
    }

    try { leafletMap.eachLayer(raise); } catch {}
  }

  function updateButtons() {
    if (!switcher) return;
    switcher.querySelectorAll('button[data-jp-basemap]').forEach(function (button) {
      const active = button.dataset.jpBasemap === currentMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setMode(mode) {
    currentMode = mode === 'satellite' ? 'satellite' : 'light';

    if (currentMode === 'satellite') {
      if (!ensureSatelliteLayers()) return;

      // El mapa productivo NO cambia. Solamente sustituimos la imagen base por:
      //   1) un raster satelital mas grande que el predio, y
      //   2) las lineas negras transparentes del plano sobre el cementerio.
      setBaseOpacity(0);
      satelliteOverlay.setOpacity(1);
      linesOverlay.setOpacity(PLAN_LINES_OPACITY);
      ensurePreviewPanes();
      window.requestAnimationFrame(raiseOperationalLayers);
      window.setTimeout(raiseOperationalLayers, 120);
    } else {
      // Light vuelve exactamente al mapa de main.
      setBaseOpacity(1);
      if (satelliteOverlay) satelliteOverlay.setOpacity(0);
      if (linesOverlay) linesOverlay.setOpacity(0);
      window.requestAnimationFrame(raiseOperationalLayers);
    }

    updateButtons();
  }

  function createUi() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return false;

    switcher = document.createElement('div');
    switcher.className = 'jp-basemap-preview-switcher';
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Vista del mapa');
    switcher.innerHTML = [
      '<button type="button" data-jp-basemap="light" class="is-active" aria-pressed="true">Light</button>',
      '<button type="button" data-jp-basemap="satellite" aria-pressed="false">Satélite</button>'
    ].join('');
    mapEl.appendChild(switcher);

    switcher.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-jp-basemap]');
      if (!button) return;
      setMode(button.dataset.jpBasemap);
    });
    return true;
  }

  function attachLayerOrdering() {
    if (!leafletMap) return;
    leafletMap.on('layeradd', function () {
      if (currentMode !== 'satellite') return;
      window.requestAnimationFrame(raiseOperationalLayers);
    });
  }

  function boot() {
    installLeafletCapture();
    let attempts = 0;
    const timer = window.setInterval(function () {
      attempts += 1;
      leafletMap = window.JP_LEAFLET_MAP || leafletMap;
      if (!leafletMap || !document.getElementById('map')) {
        if (attempts > 400) window.clearInterval(timer);
        return;
      }

      baseOverlay = findBaseOverlay();
      if (!baseOverlay) return;

      window.clearInterval(timer);
      createUi();
      ensureSatelliteLayers();
      attachLayerOrdering();
      setMode('light');
      console.info('[Mapa Preview] Light = main. Satelite = raster extendido + lineas transparentes; capas y colores operativos permanecen arriba.');
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
