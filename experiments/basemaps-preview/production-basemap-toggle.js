(function () {
  'use strict';

  const CALIBRATION = {
    lat: 25.81632700772623,
    lng: -100.15612317763441,
    widthMeters: 516,
    rotationDeg: 5.7
  };

  const PLAN_ASPECT = 11100 / 9250;
  const EARTH_RADIUS = 6378137;
  const SATELLITE_STYLE = {
    version: 8,
    sources: {
      'esri-world-imagery': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      }
    },
    layers: [{
      id: 'esri-world-imagery-layer',
      type: 'raster',
      source: 'esri-world-imagery',
      paint: {
        'raster-resampling': 'linear',
        'raster-opacity': 1
      }
    }]
  };

  let leafletMap = null;
  let satelliteMap = null;
  let satelliteHost = null;
  let switcher = null;
  let baseOverlay = null;
  let currentMode = 'light';
  let syncing = false;

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

  // Este archivo se carga inmediatamente despues de Leaflet y ANTES de app.js.
  // Capturamos L.map ahora para reutilizar exactamente la misma instancia del
  // mapa productivo, en vez de reconstruir sus funciones en MapLibre.
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

  function imageDimensions() {
    if (!baseOverlay) return null;
    const bounds = typeof baseOverlay.getBounds === 'function' ? baseOverlay.getBounds() : baseOverlay._bounds;
    if (!bounds) return null;
    const width = Math.abs(bounds.getEast() - bounds.getWest());
    const height = Math.abs(bounds.getNorth() - bounds.getSouth());
    if (!(width > 0 && height > 0)) return null;
    return { width, height };
  }

  function rotateMeters(east, north, angleDeg) {
    const a = angleDeg * Math.PI / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return {
      east: east * cos + north * sin,
      north: -east * sin + north * cos
    };
  }

  function imagePointToGeo(x, y) {
    const dims = imageDimensions();
    if (!dims) return null;

    const heightMeters = CALIBRATION.widthMeters / PLAN_ASPECT;
    const east0 = ((x / dims.width) - 0.5) * CALIBRATION.widthMeters;
    const north0 = (0.5 - (y / dims.height)) * heightMeters;
    const rotated = rotateMeters(east0, north0, CALIBRATION.rotationDeg);

    return {
      lng: CALIBRATION.lng + rotated.east / (111320 * Math.cos(CALIBRATION.lat * Math.PI / 180)),
      lat: CALIBRATION.lat + rotated.north / 110540
    };
  }

  function haversineMeters(a, b) {
    const rad = Math.PI / 180;
    const lat1 = a.lat * rad;
    const lat2 = b.lat * rad;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function computeSatelliteCamera() {
    if (!leafletMap) return null;
    const centerPx = leafletMap.getSize().divideBy(2);
    const centerSimple = leafletMap.containerPointToLatLng(centerPx);
    const rightSimple = leafletMap.containerPointToLatLng(centerPx.add([100, 0]));
    const center = imagePointToGeo(centerSimple.lng, centerSimple.lat);
    const right = imagePointToGeo(rightSimple.lng, rightSimple.lat);
    if (!center || !right) return null;

    const metersPerPixel = haversineMeters(center, right) / 100;
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;

    const latitudeCos = Math.max(0.1, Math.cos(center.lat * Math.PI / 180));
    const zoom = Math.log2((latitudeCos * 2 * Math.PI * EARTH_RADIUS) / (256 * metersPerPixel));
    return {
      center: [center.lng, center.lat],
      zoom: Math.max(0, Math.min(22, zoom)),
      bearing: CALIBRATION.rotationDeg,
      pitch: 0
    };
  }

  function syncSatellite() {
    if (currentMode !== 'satellite' || !satelliteMap || !satelliteMap.loaded() || syncing) return;
    const camera = computeSatelliteCamera();
    if (!camera) return;
    syncing = true;
    try {
      satelliteMap.jumpTo(camera);
    } finally {
      syncing = false;
    }
  }

  function setOverlayVisualMode(mode) {
    baseOverlay = baseOverlay || findBaseOverlay();
    const element = baseOverlay && typeof baseOverlay.getElement === 'function' ? baseOverlay.getElement() : null;
    if (!element) return;

    if (mode === 'satellite') {
      element.style.opacity = '0.90';
      element.style.mixBlendMode = 'multiply';
      element.style.filter = 'contrast(1.15)';
    } else {
      element.style.opacity = '1';
      element.style.mixBlendMode = 'normal';
      element.style.filter = 'none';
    }
  }

  function ensureSatelliteMap() {
    if (satelliteMap || !satelliteHost || !window.maplibregl) return;
    satelliteMap = new maplibregl.Map({
      container: satelliteHost,
      style: SATELLITE_STYLE,
      center: [CALIBRATION.lng, CALIBRATION.lat],
      zoom: 16,
      bearing: CALIBRATION.rotationDeg,
      pitch: 0,
      minZoom: 12,
      maxZoom: 22,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0
    });
    satelliteMap.on('load', syncSatellite);
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
      ensureSatelliteMap();
      satelliteHost.style.display = 'block';
      document.getElementById('map')?.classList.add('jp-satellite-mode');
      setOverlayVisualMode('satellite');
      window.requestAnimationFrame(syncSatellite);
      window.setTimeout(syncSatellite, 120);
    } else {
      if (satelliteHost) satelliteHost.style.display = 'none';
      document.getElementById('map')?.classList.remove('jp-satellite-mode');
      setOverlayVisualMode('light');
    }
    updateButtons();
  }

  function createUi() {
    const mapEl = document.getElementById('map');
    if (!mapEl || !mapEl.parentElement) return false;
    const parent = mapEl.parentElement;
    const computed = window.getComputedStyle(parent);
    if (computed.position === 'static') parent.style.position = 'relative';

    satelliteHost = document.createElement('div');
    satelliteHost.className = 'jp-satellite-underlay';
    satelliteHost.setAttribute('aria-hidden', 'true');
    parent.insertBefore(satelliteHost, mapEl);

    mapEl.style.position = 'relative';
    mapEl.style.zIndex = '1';

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

  function attachLeafletEvents() {
    if (!leafletMap) return;
    ['move', 'zoom', 'resize'].forEach(function (eventName) {
      leafletMap.on(eventName, function () {
        if (currentMode === 'satellite') window.requestAnimationFrame(syncSatellite);
      });
    });
    leafletMap.on('layeradd', function () {
      if (!baseOverlay) {
        baseOverlay = findBaseOverlay();
        if (baseOverlay) setOverlayVisualMode(currentMode);
      }
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
      attachLeafletEvents();
      setMode('light');
      console.info('[Mapa Preview] Mapa productivo activo. Light inicial; Satelite cambia solamente la vista base.');
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
