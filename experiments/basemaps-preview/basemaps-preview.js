(function () {
  'use strict';

  const CENTER = [-100.15610, 25.81662];
  const START_ZOOM = 16.4;
  const SATELLITE_CLEAR_MAX_ZOOM = 18.45;
  const PLAN_ASPECT = 11100 / 9250;
  const PLAN_IMAGE_URL = './base-plan.webp';
  const CALIBRATION_KEY = 'jp-basemap-calibration-v1';

  function rasterStyle(id, url, maxzoom, attribution) {
    return {
      version: 8,
      sources: {
        [id]: {
          type: 'raster',
          tiles: [url],
          tileSize: 256,
          maxzoom: maxzoom,
          attribution: attribution
        }
      },
      layers: [{
        id: `${id}-layer`,
        type: 'raster',
        source: id,
        paint: { 'raster-resampling': 'linear' }
      }]
    };
  }

  const styles = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    satellite: rasterStyle(
      'esri-world-imagery',
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      18,
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    )
  };

  const labels = { light: 'Light', satellite: 'Satélite' };

  const DEFAULT_CALIBRATION = {
    lat: 25.81662,
    lng: -100.15610,
    widthMeters: 850,
    rotationDeg: 0,
    opacity: 0.42,
    visible: true
  };

  const status = document.getElementById('mapStatus');
  const modeLabel = document.getElementById('modeLabel');
  const centerLabel = document.getElementById('centerLabel');
  const zoomLabel = document.getElementById('zoomLabel');

  const opacityRange = document.getElementById('opacityRange');
  const opacityValue = document.getElementById('opacityValue');
  const rotationRange = document.getElementById('rotationRange');
  const rotationValue = document.getElementById('rotationValue');
  const widthRange = document.getElementById('widthRange');
  const widthValue = document.getElementById('widthValue');
  const planVisible = document.getElementById('planVisible');
  const planLatValue = document.getElementById('planLatValue');
  const planLngValue = document.getElementById('planLngValue');
  const resetCalibrationBtn = document.getElementById('resetCalibrationBtn');
  const copyCalibrationBtn = document.getElementById('copyCalibrationBtn');
  const useMapCenterBtn = document.getElementById('useMapCenterBtn');

  let currentBasemap = 'light';
  let statusTimer = null;
  let calibration = loadCalibration();

  function loadCalibration() {
    try {
      const saved = JSON.parse(localStorage.getItem(CALIBRATION_KEY) || 'null');
      if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
        return Object.assign({}, DEFAULT_CALIBRATION, saved);
      }
    } catch (_) {}
    return Object.assign({}, DEFAULT_CALIBRATION);
  }

  function saveCalibration() {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(calibration));
  }

  function setStatus(text, hideAfterMs) {
    if (!status) return;
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = null;
    status.textContent = text;
    status.classList.remove('hidden');
    if (hideAfterMs && hideAfterMs > 0) {
      statusTimer = window.setTimeout(function () {
        status.classList.add('hidden');
        statusTimer = null;
      }, hideAfterMs);
    }
  }

  const map = new maplibregl.Map({
    container: 'map',
    style: styles.light,
    center: CENTER,
    zoom: START_ZOOM,
    minZoom: 14,
    maxZoom: 20,
    attributionControl: true
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

  function updateLocationReadout() {
    const center = map.getCenter();
    centerLabel.textContent = `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`;
    zoomLabel.textContent = map.getZoom().toFixed(1);
  }

  function metersToLng(meters, latitude) {
    return meters / (111320 * Math.cos(latitude * Math.PI / 180));
  }

  function metersToLat(meters) {
    return meters / 110540;
  }

  function planCoordinates() {
    const width = calibration.widthMeters;
    const height = width / PLAN_ASPECT;
    const halfW = width / 2;
    const halfH = height / 2;
    const angle = calibration.rotationDeg * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const corners = [
      [-halfW, halfH],
      [halfW, halfH],
      [halfW, -halfH],
      [-halfW, -halfH]
    ];

    return corners.map(function (corner) {
      const x = corner[0];
      const y = corner[1];
      const east = x * cos + y * sin;
      const north = -x * sin + y * cos;
      return [
        calibration.lng + metersToLng(east, calibration.lat),
        calibration.lat + metersToLat(north)
      ];
    });
  }

  function syncCalibrationUi() {
    opacityRange.value = String(Math.round(calibration.opacity * 100));
    opacityValue.textContent = `${Math.round(calibration.opacity * 100)}%`;
    rotationRange.value = String(calibration.rotationDeg);
    rotationValue.textContent = `${calibration.rotationDeg.toFixed(1)}°`;
    widthRange.value = String(Math.round(calibration.widthMeters));
    widthValue.textContent = `${Math.round(calibration.widthMeters)} m`;
    planVisible.checked = Boolean(calibration.visible);
    planLatValue.textContent = calibration.lat.toFixed(6);
    planLngValue.textContent = calibration.lng.toFixed(6);
  }

  function addOrUpdatePlanOverlay() {
    if (!map.isStyleLoaded()) return;

    const coordinates = planCoordinates();
    const source = map.getSource('jdjp-plan');

    if (!source) {
      map.addSource('jdjp-plan', {
        type: 'image',
        url: PLAN_IMAGE_URL,
        coordinates: coordinates
      });
      map.addLayer({
        id: 'jdjp-plan-layer',
        type: 'raster',
        source: 'jdjp-plan',
        paint: {
          'raster-opacity': calibration.visible ? calibration.opacity : 0,
          'raster-resampling': 'linear'
        }
      });
      return;
    }

    if (typeof source.setCoordinates === 'function') source.setCoordinates(coordinates);
    if (map.getLayer('jdjp-plan-layer')) {
      map.setPaintProperty('jdjp-plan-layer', 'raster-opacity', calibration.visible ? calibration.opacity : 0);
    }
  }

  function markParkReference() {
    if (map.getSource('park-reference')) return;
    map.addSource('park-reference', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: CENTER },
          properties: { title: 'Jardines de Juan Pablo' }
        }]
      }
    });

    map.addLayer({
      id: 'park-reference-ring',
      type: 'circle',
      source: 'park-reference',
      paint: {
        'circle-radius': 10,
        'circle-color': '#ffffff',
        'circle-opacity': 0.92,
        'circle-stroke-width': 4,
        'circle-stroke-color': '#7a2d00'
      }
    });

    map.addLayer({
      id: 'park-reference-dot',
      type: 'circle',
      source: 'park-reference',
      paint: { 'circle-radius': 4, 'circle-color': '#d39a17' }
    });
  }

  function restorePreviewLayers() {
    try { addOrUpdatePlanOverlay(); } catch (error) { console.warn('[Calibration] plano', error); }
    try { markParkReference(); } catch (_) {}
  }

  function setActiveButton(key) {
    document.querySelectorAll('.basemap-option').forEach((button) => {
      button.classList.toggle('active', button.dataset.basemap === key);
    });
  }

  function satelliteResolutionMessage() {
    return 'El satélite llegó a su nivel útil de detalle. Se cambió automáticamente a Light para mantener una vista nítida.';
  }

  function applyBasemap(key, options) {
    const config = options || {};
    if (!styles[key]) return;

    currentBasemap = key;
    setStatus(`Cargando ${labels[key]}…`, 0);
    map.setStyle(styles[key], { diff: false });
    modeLabel.textContent = labels[key];
    localStorage.setItem('jp-basemap-preview', key);
    setActiveButton(key);

    map.once('styledata', restorePreviewLayers);
    map.once('idle', function () {
      restorePreviewLayers();
      if (config.notice) setStatus(config.notice, 5200);
      else setStatus(`${labels[key]} listo`, 700);
    });
  }

  function requestBasemap(key) {
    if (key === 'satellite' && map.getZoom() > SATELLITE_CLEAR_MAX_ZOOM) {
      const message = satelliteResolutionMessage();
      if (currentBasemap !== 'light') applyBasemap('light', { notice: message });
      else {
        setActiveButton('light');
        modeLabel.textContent = labels.light;
        localStorage.setItem('jp-basemap-preview', 'light');
        setStatus(message, 5200);
      }
      return;
    }
    applyBasemap(key);
  }

  function updateCalibration() {
    saveCalibration();
    syncCalibrationUi();
    addOrUpdatePlanOverlay();
  }

  function nudge(direction) {
    const step = 5;
    if (direction === 'north') calibration.lat += metersToLat(step);
    if (direction === 'south') calibration.lat -= metersToLat(step);
    if (direction === 'east') calibration.lng += metersToLng(step, calibration.lat);
    if (direction === 'west') calibration.lng -= metersToLng(step, calibration.lat);
    updateCalibration();
  }

  opacityRange.addEventListener('input', function () {
    calibration.opacity = Number(opacityRange.value) / 100;
    updateCalibration();
  });

  rotationRange.addEventListener('input', function () {
    calibration.rotationDeg = Number(rotationRange.value);
    updateCalibration();
  });

  widthRange.addEventListener('input', function () {
    calibration.widthMeters = Number(widthRange.value);
    updateCalibration();
  });

  planVisible.addEventListener('change', function () {
    calibration.visible = planVisible.checked;
    updateCalibration();
  });

  document.querySelectorAll('[data-nudge]').forEach(function (button) {
    const direction = button.dataset.nudge;
    if (['north', 'south', 'east', 'west'].includes(direction)) {
      button.addEventListener('click', function () { nudge(direction); });
    }
  });

  useMapCenterBtn.addEventListener('click', function () {
    const center = map.getCenter();
    calibration.lat = center.lat;
    calibration.lng = center.lng;
    updateCalibration();
    setStatus('Centro del plano actualizado con el centro visible del mapa.', 2200);
  });

  resetCalibrationBtn.addEventListener('click', function () {
    calibration = Object.assign({}, DEFAULT_CALIBRATION);
    updateCalibration();
    setStatus('Calibración restablecida.', 1800);
  });

  copyCalibrationBtn.addEventListener('click', async function () {
    const payload = JSON.stringify(calibration, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setStatus('Calibración copiada al portapapeles.', 2400);
    } catch (_) {
      console.info('[Calibration]', payload);
      setStatus('No se pudo copiar automáticamente. La calibración quedó en la consola.', 4200);
    }
  });

  document.querySelectorAll('.basemap-option').forEach((button) => {
    button.addEventListener('click', function () { requestBasemap(button.dataset.basemap); });
  });

  syncCalibrationUi();

  map.on('load', function () {
    updateLocationReadout();
    restorePreviewLayers();

    const saved = localStorage.getItem('jp-basemap-preview');
    if (saved && saved !== 'light' && styles[saved]) requestBasemap(saved);
    else {
      currentBasemap = 'light';
      setActiveButton('light');
      setStatus('Light listo', 700);
    }
  });

  map.on('moveend', updateLocationReadout);
  map.on('zoomend', function () {
    updateLocationReadout();
    if (currentBasemap === 'satellite' && map.getZoom() > SATELLITE_CLEAR_MAX_ZOOM) {
      applyBasemap('light', { notice: satelliteResolutionMessage() });
    }
  });

  map.on('error', function (event) {
    console.error('[Basemaps Preview]', event && event.error ? event.error : event);
    setStatus('No se pudo cargar una parte del mapa. Revisa la consola.', 0);
  });
})();
