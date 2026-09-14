(function () {
  'use strict';

  const CENTER = [-100.15612317763441, 25.81632700772623];
  const START_ZOOM = 16.4;
  const SATELLITE_CLEAR_MAX_ZOOM = 18.65;
  const DATA_WIDTH = 11100;
  const DATA_HEIGHT = 9250;
  const PLAN_ASPECT = DATA_WIDTH / DATA_HEIGHT;
  const PLAN_IMAGE_URL = './base-plan.webp';
  const SECTIONS_URL = './secciones-top.geojson';
  const MANZANAS_URL = './secciones.geojson';
  const CALIBRATION_KEY = 'jp-basemap-calibration-v2';

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
    lat: 25.81632700772623,
    lng: -100.15612317763441,
    widthMeters: 516,
    rotationDeg: 5.7,
    opacity: 0.31,
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
  const sectionsVisible = document.getElementById('sectionsVisible');
  const manzanasVisible = document.getElementById('manzanasVisible');

  let currentBasemap = 'light';
  let statusTimer = null;
  let calibration = loadCalibration();
  let sectionsRaw = null;
  let manzanasRaw = null;

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

  function transformPoint(point) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    const heightMeters = calibration.widthMeters / PLAN_ASPECT;
    const east0 = ((x / DATA_WIDTH) - 0.5) * calibration.widthMeters;
    const north0 = (0.5 - (y / DATA_HEIGHT)) * heightMeters;
    const angle = calibration.rotationDeg * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const east = east0 * cos + north0 * sin;
    const north = -east0 * sin + north0 * cos;
    return [
      calibration.lng + metersToLng(east, calibration.lat),
      calibration.lat + metersToLat(north)
    ];
  }

  function planCoordinates() {
    return [
      transformPoint([0, 0]),
      transformPoint([DATA_WIDTH, 0]),
      transformPoint([DATA_WIDTH, DATA_HEIGHT]),
      transformPoint([0, DATA_HEIGHT])
    ];
  }

  function transformCoordinates(coords) {
    if (!Array.isArray(coords)) return coords;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      return transformPoint(coords);
    }
    return coords.map(transformCoordinates);
  }

  function transformGeoJSON(data) {
    return {
      type: 'FeatureCollection',
      features: (data && Array.isArray(data.features) ? data.features : []).map(function (feature) {
        return {
          type: 'Feature',
          id: feature.id,
          properties: Object.assign({}, feature.properties || {}),
          geometry: feature.geometry ? {
            type: feature.geometry.type,
            coordinates: transformCoordinates(feature.geometry.coordinates)
          } : null
        };
      })
    };
  }

  function circlePointToPolygon(feature, steps) {
    if (!feature || !feature.geometry || feature.geometry.type !== 'Point') return feature;
    const radius = Number(feature.properties && feature.properties.radius);
    if (!Number.isFinite(radius) || radius <= 0) return feature;

    const center = feature.geometry.coordinates;
    const cx = Number(center[0]);
    const cy = Number(center[1]);
    const ring = [];
    const total = Math.max(24, Number(steps) || 48);

    for (let i = 0; i <= total; i += 1) {
      const angle = (Math.PI * 2 * i) / total;
      ring.push([
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius
      ]);
    }

    return {
      type: 'Feature',
      id: feature.id,
      properties: Object.assign({}, feature.properties || {}, { sourceGeometry: 'point-radius' }),
      geometry: {
        type: 'Polygon',
        coordinates: [ring]
      }
    };
  }

  function normalizeManzanasGeoJSON(data) {
    const features = data && Array.isArray(data.features) ? data.features : [];
    const normalized = [];
    let convertedCircles = 0;
    let polygons = 0;
    let skippedPoints = 0;

    features.forEach(function (feature) {
      if (!feature || !feature.geometry) return;

      if (feature.geometry.type === 'Point') {
        const converted = circlePointToPolygon(feature, 56);
        if (converted.geometry && converted.geometry.type === 'Polygon') {
          normalized.push(converted);
          convertedCircles += 1;
        } else {
          skippedPoints += 1;
        }
        return;
      }

      if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
        normalized.push(feature);
        polygons += 1;
      }
    });

    console.info('[Calibration] manzanas normalizadas', {
      totalOriginal: features.length,
      totalAreas: normalized.length,
      circulosConvertidos: convertedCircles,
      poligonos: polygons,
      puntosSinArea: skippedPoints
    });

    return {
      type: 'FeatureCollection',
      features: normalized
    };
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

  function ensureVectorLayer(sourceId, layerId, data, color, width, visible) {
    if (!map.isStyleLoaded() || !data) return;
    const transformed = transformGeoJSON(data);
    const source = map.getSource(sourceId);
    if (!source) {
      map.addSource(sourceId, { type: 'geojson', data: transformed });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'line-color': color,
          'line-width': width,
          'line-opacity': 0.95
        }
      });
    } else {
      source.setData(transformed);
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }

  function ensureManzanaLayers(data, visible) {
    if (!map.isStyleLoaded() || !data) return;

    const normalized = normalizeManzanasGeoJSON(data);
    const transformed = transformGeoJSON(normalized);
    const sourceId = 'jdjp-manzanas';
    const fillLayerId = 'jdjp-manzanas-fill';
    const lineLayerId = 'jdjp-manzanas-line';
    const source = map.getSource(sourceId);

    if (!source) {
      map.addSource(sourceId, { type: 'geojson', data: transformed });

      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'fill-color': '#f59e0b',
          'fill-opacity': 0.10
        }
      });

      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'line-color': '#ff7a00',
          'line-width': 3.2,
          'line-opacity': 1
        }
      });
    } else {
      source.setData(transformed);
      if (map.getLayer(fillLayerId)) {
        map.setLayoutProperty(fillLayerId, 'visibility', visible ? 'visible' : 'none');
      }
      if (map.getLayer(lineLayerId)) {
        map.setLayoutProperty(lineLayerId, 'visibility', visible ? 'visible' : 'none');
      }
    }

    try {
      if (map.getLayer(fillLayerId)) map.moveLayer(fillLayerId);
      if (map.getLayer(lineLayerId)) map.moveLayer(lineLayerId);
    } catch (_) {}
  }

  function addOrUpdateVectorOverlays() {
    ensureVectorLayer('jdjp-sections', 'jdjp-sections-line', sectionsRaw, '#0b6ecf', 2.5, sectionsVisible.checked);
    ensureManzanaLayers(manzanasRaw, manzanasVisible.checked);
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
    try { addOrUpdateVectorOverlays(); } catch (error) { console.warn('[Calibration] vectores', error); }
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
    addOrUpdateVectorOverlays();
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
  sectionsVisible.addEventListener('change', addOrUpdateVectorOverlays);
  manzanasVisible.addEventListener('change', addOrUpdateVectorOverlays);

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
    setStatus('Se restauraron los valores aprobados.', 1800);
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

  Promise.all([
    fetch(SECTIONS_URL, { cache: 'no-store' }).then((r) => r.json()),
    fetch(MANZANAS_URL, { cache: 'no-store' }).then((r) => r.json())
  ]).then(function (results) {
    sectionsRaw = results[0];
    manzanasRaw = results[1];
    restorePreviewLayers();
    console.info('[Calibration] vectores cargados', {
      secciones: sectionsRaw.features ? sectionsRaw.features.length : 0,
      manzanas: manzanasRaw.features ? manzanasRaw.features.length : 0
    });
  }).catch(function (error) {
    console.error('[Calibration] No fue posible cargar los GeoJSON de validación.', error);
    setStatus('No fue posible cargar secciones/manzanas para validar la calibración.', 5200);
  });

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
