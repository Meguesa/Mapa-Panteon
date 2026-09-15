(function () {
  'use strict';

  const SATELLITE_IMAGE = './satellite-base.webp';
  const PLAN_LINES_IMAGE = './base-lines.webp';
  const PLAN_LINES_OPACITY = 0.90;

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
  // que usa el mapa productivo. No reconstruimos secciones, lotes ni nichos.
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
    if (!leafletMap.getPane('jpSatellitePane')) {
      const pane = leafletMap.createPane('jpSatellitePane');
      pane.style.zIndex = '180';
      pane.style.pointerEvents = 'none';
    }
    if (!leafletMap.getPane('jpPlanLinesPane')) {
      const pane = leafletMap.createPane('jpPlanLinesPane');
      pane.style.zIndex = '190';
      pane.style.pointerEvents = 'none';
    }
  }

  function ensureSatelliteLayers() {
    if (!leafletMap || !baseOverlay) return false;
    ensurePreviewPanes();
    const bounds = baseOverlay.getBounds();

    if (!satelliteOverlay) {
      satelliteOverlay = L.imageOverlay(SATELLITE_IMAGE, bounds, {
        pane: 'jpSatellitePane',
        opacity: 0,
        interactive: false,
        crossOrigin: false
      }).addTo(leafletMap);
    }

    if (!linesOverlay) {
      linesOverlay = L.imageOverlay(PLAN_LINES_IMAGE, bounds, {
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
    }
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
      // Ambas imagenes usan EXACTAMENTE los bounds de base-public.webp.
      // Por eso siguen pixel a pixel el mismo pan/zoom de Leaflet y no hay
      // sincronizacion entre dos motores de mapas.
      setBaseOpacity(0);
      satelliteOverlay.setOpacity(1);
      linesOverlay.setOpacity(PLAN_LINES_OPACITY);
    } else {
      // Light es exactamente el mapa de main, sin ningun mapa externo debajo.
      setBaseOpacity(1);
      if (satelliteOverlay) satelliteOverlay.setOpacity(0);
      if (linesOverlay) linesOverlay.setOpacity(0);
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
      setMode('light');
      console.info('[Mapa Preview] Light usa main sin cambios; Satelite usa raster precalibrado + lineas transparentes en el mismo CRS Leaflet.');
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
