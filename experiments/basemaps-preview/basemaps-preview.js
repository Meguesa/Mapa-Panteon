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
  const VECTOR_CALIBRATION_KEY = 'jp-basemap-vector-calibration-v3';

  const DEFAULT_CALIBRATION = {
    lat: 25.81632700772623,
    lng: -100.15612317763441,
    widthMeters: 516,
    rotationDeg: 5.7,
    opacity: 0.31,
    visible: true
  };

  const DEFAULT_VECTOR_CALIBRATION = {
    offsetEastMeters: 0,
    offsetNorthMeters: 0,
    scale: 1,
    rotationDeg: 0,
    flipHorizontal: false,
    flipVertical: false
  };

  const styles = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    satellite: {
      version: 8,
      sources: {
        'esri-world-imagery': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          maxzoom: 18,
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
        }
      },
      layers: [{
        id: 'esri-world-imagery-layer',
        type: 'raster',
        source: 'esri-world-imagery',
        paint: { 'raster-resampling': 'linear' }
      }]
    }
  };

  const labels = { light: 'Light', satellite: 'Satélite' };
  const $ = (id) => document.getElementById(id);

  const status = $('mapStatus');
  const modeLabel = $('modeLabel');
  const centerLabel = $('centerLabel');
  const zoomLabel = $('zoomLabel');

  const opacityRange = $('opacityRange');
  const opacityValue = $('opacityValue');
  const rotationRange = $('rotationRange');
  const rotationValue = $('rotationValue');
  const widthRange = $('widthRange');
  const widthValue = $('widthValue');
  const planVisible = $('planVisible');
  const planLatValue = $('planLatValue');
  const planLngValue = $('planLngValue');
  const resetCalibrationBtn = $('resetCalibrationBtn');
  const copyCalibrationBtn = $('copyCalibrationBtn');
  const useMapCenterBtn = $('useMapCenterBtn');

  const sectionsVisible = $('sectionsVisible');
  const manzanasVisible = $('manzanasVisible');
  const vectorFlipHorizontal = $('vectorFlipHorizontal');
  const vectorFlipVertical = $('vectorFlipVertical');
  const vectorStatus = $('vectorStatus');
  const vectorRotationRange = $('vectorRotationRange');
  const vectorRotationValue = $('vectorRotationValue');
  const vectorScaleRange = $('vectorScaleRange');
  const vectorScaleValue = $('vectorScaleValue');
  const resetVectorsBtn = $('resetVectorsBtn');
  const copyVectorsBtn = $('copyVectorsBtn');

  let currentBasemap = 'light';
  let statusTimer = null;
  let calibration = loadCalibration();
  let vectorCalibration = loadVectorCalibration();
  let sectionsRaw = null;
  let manzanasRaw = null;
  let normalizedManzanas = null;
  let manzanaCenters = null;

  function loadCalibration() {
    try {
      const saved = JSON.parse(localStorage.getItem(CALIBRATION_KEY) || 'null');
      if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
        return Object.assign({}, DEFAULT_CALIBRATION, saved);
      }
    } catch (_) {}
    return Object.assign({}, DEFAULT_CALIBRATION);
  }

  function loadVectorCalibration() {
    try {
      const saved = JSON.parse(localStorage.getItem(VECTOR_CALIBRATION_KEY) || 'null');
      if (saved && Number.isFinite(saved.scale) && Number.isFinite(saved.rotationDeg)) {
        return Object.assign({}, DEFAULT_VECTOR_CALIBRATION, saved);
      }
    } catch (_) {}
    return Object.assign({}, DEFAULT_VECTOR_CALIBRATION);
  }

  function saveCalibration() {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(calibration));
  }

  function saveVectorCalibration() {
    localStorage.setItem(VECTOR_CALIBRATION_KEY, JSON.stringify(vectorCalibration));
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
    if (centerLabel) centerLabel.textContent = `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`;
    if (zoomLabel) zoomLabel.textContent = map.getZoom().toFixed(1);
  }

  function metersToLng(meters, latitude) {
    return meters / (111320 * Math.cos(latitude * Math.PI / 180));
  }

  function metersToLat(meters) {
    return meters / 110540;
  }

  function sourcePointToMeters(point) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    const heightMeters = calibration.widthMeters / PLAN_ASPECT;
    return {
      east: ((x / DATA_WIDTH) - 0.5) * calibration.widthMeters,
      north: (0.5 - (y / DATA_HEIGHT)) * heightMeters
    };
  }

  function rotateMeters(east, north, angleDeg) {
    const angle = angleDeg * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      east: east * cos + north * sin,
      north: -east * sin + north * cos
    };
  }

  function metersToLngLat(east, north) {
    return [
      calibration.lng + metersToLng(east, calibration.lat),
      calibration.lat + metersToLat(north)
    ];
  }

  function transformPoint(point, includeVectorAdjustment) {
    const base = sourcePointToMeters(point);

    if (includeVectorAdjustment) {
      if (vectorCalibration.flipHorizontal) base.east *= -1;
      if (vectorCalibration.flipVertical) base.north *= -1;
    }

    const planRotated = rotateMeters(base.east, base.north, calibration.rotationDeg);
    let east = planRotated.east;
    let north = planRotated.north;

    if (includeVectorAdjustment) {
      east *= vectorCalibration.scale;
      north *= vectorCalibration.scale;
      const adjusted = rotateMeters(east, north, vectorCalibration.rotationDeg);
      east = adjusted.east + vectorCalibration.offsetEastMeters;
      north = adjusted.north + vectorCalibration.offsetNorthMeters;
    }

    return metersToLngLat(east, north);
  }

  function planCoordinates() {
    return [
      transformPoint([0, 0], false),
      transformPoint([DATA_WIDTH, 0], false),
      transformPoint([DATA_WIDTH, DATA_HEIGHT], false),
      transformPoint([0, DATA_HEIGHT], false)
    ];
  }

  function transformCoordinates(coords, includeVectorAdjustment) {
    if (!Array.isArray(coords)) return coords;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      return transformPoint(coords, includeVectorAdjustment);
    }
    return coords.map(function (child) {
      return transformCoordinates(child, includeVectorAdjustment);
    });
  }

  function transformGeoJSON(data, includeVectorAdjustment) {
    return {
      type: 'FeatureCollection',
      features: (data && Array.isArray(data.features) ? data.features : []).map(function (feature) {
        return {
          type: 'Feature',
          id: feature.id,
          properties: Object.assign({}, feature.properties || {}),
          geometry: feature.geometry ? {
            type: feature.geometry.type,
            coordinates: transformCoordinates(feature.geometry.coordinates, includeVectorAdjustment)
          } : null
        };
      })
    };
  }

  function circlePointToPolygon(feature, steps) {
    if (!feature || !feature.geometry || feature.geometry.type !== 'Point') return feature;
    const radius = Number(feature.properties && feature.properties.radius);
    if (!Number.isFinite(radius) || radius <= 0) return null;

    const center = feature.geometry.coordinates;
    const cx = Number(center[0]);
    const cy = Number(center[1]);
    const ring = [];
    const total = Math.max(24, Number(steps) || 56);

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
      geometry: { type: 'Polygon', coordinates: [ring] }
    };
  }

  function averageRingPoint(ring) {
    if (!Array.isArray(ring) || !ring.length) return null;
    let x = 0;
    let y = 0;
    let count = 0;
    ring.forEach(function (point) {
      if (Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))) {
        x += Number(point[0]);
        y += Number(point[1]);
        count += 1;
      }
    });
    return count ? [x / count, y / count] : null;
  }

  function normalizeManzanasGeoJSON(data) {
    const features = data && Array.isArray(data.features) ? data.features : [];
    const normalized = [];
    const centers = [];

    features.forEach(function (feature, index) {
      if (!feature || !feature.geometry) return;
      const props = Object.assign({}, feature.properties || {}, { calibrationIndex: index });

      if (feature.geometry.type === 'Point') {
        const converted = circlePointToPolygon({
          type: 'Feature',
          id: feature.id,
          properties: props,
          geometry: feature.geometry
        }, 56);
        if (converted) normalized.push(converted);
        centers.push({
          type: 'Feature',
          properties: props,
          geometry: { type: 'Point', coordinates: feature.geometry.coordinates }
        });
        return;
      }

      if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
        normalized.push({
          type: 'Feature',
          id: feature.id,
          properties: props,
          geometry: feature.geometry
        });

        let ring = null;
        if (feature.geometry.type === 'Polygon') ring = feature.geometry.coordinates && feature.geometry.coordinates[0];
        if (feature.geometry.type === 'MultiPolygon') ring = feature.geometry.coordinates && feature.geometry.coordinates[0] && feature.geometry.coordinates[0][0];
        const center = averageRingPoint(ring);
        if (center) {
          centers.push({
            type: 'Feature',
            properties: props,
            geometry: { type: 'Point', coordinates: center }
          });
        }
      }
    });

    return {
      polygons: { type: 'FeatureCollection', features: normalized },
      centers: { type: 'FeatureCollection', features: centers }
    };
  }

  function syncCalibrationUi() {
    if (opacityRange) opacityRange.value = String(Math.round(calibration.opacity * 100));
    if (opacityValue) opacityValue.textContent = `${Math.round(calibration.opacity * 100)}%`;
    if (rotationRange) rotationRange.value = String(calibration.rotationDeg);
    if (rotationValue) rotationValue.textContent = `${calibration.rotationDeg.toFixed(1)}°`;
    if (widthRange) widthRange.value = String(Math.round(calibration.widthMeters));
    if (widthValue) widthValue.textContent = `${Math.round(calibration.widthMeters)} m`;
    if (planVisible) planVisible.checked = Boolean(calibration.visible);
    if (planLatValue) planLatValue.textContent = calibration.lat.toFixed(6);
    if (planLngValue) planLngValue.textContent = calibration.lng.toFixed(6);
  }

  function syncVectorUi() {
    if (vectorRotationRange) vectorRotationRange.value = String(vectorCalibration.rotationDeg);
    if (vectorRotationValue) vectorRotationValue.textContent = `${vectorCalibration.rotationDeg.toFixed(1)}°`;
    if (vectorScaleRange) vectorScaleRange.value = String(vectorCalibration.scale * 100);
    if (vectorScaleValue) vectorScaleValue.textContent = `${(vectorCalibration.scale * 100).toFixed(1)}%`;
    if (vectorFlipHorizontal) vectorFlipHorizontal.checked = Boolean(vectorCalibration.flipHorizontal);
    if (vectorFlipVertical) vectorFlipVertical.checked = Boolean(vectorCalibration.flipVertical);
    if (sectionsVisible) sectionsVisible.checked = true;
    if (manzanasVisible) manzanasVisible.checked = true;
  }

  function updateVectorStatus() {
    if (!vectorStatus) return;
    if (!sectionsRaw || !normalizedManzanas) {
      vectorStatus.textContent = 'Cargando…';
      return;
    }
    const sectionCount = Array.isArray(sectionsRaw.features) ? sectionsRaw.features.length : 0;
    const manzanaCount = Array.isArray(normalizedManzanas.features) ? normalizedManzanas.features.length : 0;
    vectorStatus.textContent = `${sectionCount} secciones · ${manzanaCount} manzanas`;
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
    } else {
      if (typeof source.setCoordinates === 'function') source.setCoordinates(coordinates);
      if (map.getLayer('jdjp-plan-layer')) {
        map.setPaintProperty('jdjp-plan-layer', 'raster-opacity', calibration.visible ? calibration.opacity : 0);
      }
    }
  }

  function ensureSectionsLayer() {
    if (!map.isStyleLoaded() || !sectionsRaw) return;
    const transformed = transformGeoJSON(sectionsRaw, true);
    const sourceId = 'jdjp-sections';
    const layerId = 'jdjp-sections-line';
    const source = map.getSource(sourceId);
    const visible = !sectionsVisible || sectionsVisible.checked;

    if (!source) {
      map.addSource(sourceId, { type: 'geojson', data: transformed });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'line-color': '#006cff',
          'line-width': 3.2,
          'line-opacity': 0.95
        }
      });
    } else {
      source.setData(transformed);
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }

  function ensureManzanaLayers() {
    if (!map.isStyleLoaded() || !normalizedManzanas || !manzanaCenters) return;

    const polygons = transformGeoJSON(normalizedManzanas, true);
    const centers = transformGeoJSON(manzanaCenters, true);
    const visible = !manzanasVisible || manzanasVisible.checked;

    const polygonSourceId = 'jdjp-manzanas';
    const centerSourceId = 'jdjp-manzana-centers';
    const fillLayerId = 'jdjp-manzanas-fill';
    const lineLayerId = 'jdjp-manzanas-line';
    const centerLayerId = 'jdjp-manzanas-centers';

    let polygonSource = map.getSource(polygonSourceId);
    if (!polygonSource) {
      map.addSource(polygonSourceId, { type: 'geojson', data: polygons });
    } else {
      polygonSource.setData(polygons);
    }

    let centerSource = map.getSource(centerSourceId);
    if (!centerSource) {
      map.addSource(centerSourceId, { type: 'geojson', data: centers });
    } else {
      centerSource.setData(centers);
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: polygonSourceId,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'fill-color': '#ff8a00',
          'fill-opacity': 0.12
        }
      });
    } else {
      map.setLayoutProperty(fillLayerId, 'visibility', visible ? 'visible' : 'none');
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: polygonSourceId,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'line-color': '#ff4d00',
          'line-width': 4.5,
          'line-opacity': 1
        }
      });
    } else {
      map.setLayoutProperty(lineLayerId, 'visibility', visible ? 'visible' : 'none');
    }

    if (!map.getLayer(centerLayerId)) {
      map.addLayer({
        id: centerLayerId,
        type: 'circle',
        source: centerSourceId,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'circle-radius': 3.5,
          'circle-color': '#ff4d00',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1
        }
      });
    } else {
      map.setLayoutProperty(centerLayerId, 'visibility', visible ? 'visible' : 'none');
    }

    try {
      if (map.getLayer(fillLayerId)) map.moveLayer(fillLayerId);
      if (map.getLayer(lineLayerId)) map.moveLayer(lineLayerId);
      if (map.getLayer(centerLayerId)) map.moveLayer(centerLayerId);
    } catch (_) {}
  }

  function addOrUpdateVectorOverlays() {
    ensureSectionsLayer();
    ensureManzanaLayers();
    updateVectorStatus();
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
    document.querySelectorAll('.basemap-option').forEach(function (button) {
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
    if (modeLabel) modeLabel.textContent = labels[key];
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
      else setStatus(message, 5200);
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

  function updateVectorCalibration() {
    saveVectorCalibration();
    syncVectorUi();
    addOrUpdateVectorOverlays();
  }

  function nudgePlan(direction) {
    const step = 5;
    if (direction === 'north') calibration.lat += metersToLat(step);
    if (direction === 'south') calibration.lat -= metersToLat(step);
    if (direction === 'east') calibration.lng += metersToLng(step, calibration.lat);
    if (direction === 'west') calibration.lng -= metersToLng(step, calibration.lat);
    updateCalibration();
  }

  function nudgeVectors(direction) {
    const step = 2;
    if (direction === 'north') vectorCalibration.offsetNorthMeters += step;
    if (direction === 'south') vectorCalibration.offsetNorthMeters -= step;
    if (direction === 'east') vectorCalibration.offsetEastMeters += step;
    if (direction === 'west') vectorCalibration.offsetEastMeters -= step;
    updateVectorCalibration();
  }

  if (opacityRange) opacityRange.addEventListener('input', function () {
    calibration.opacity = Number(opacityRange.value) / 100;
    updateCalibration();
  });
  if (rotationRange) rotationRange.addEventListener('input', function () {
    calibration.rotationDeg = Number(rotationRange.value);
    updateCalibration();
  });
  if (widthRange) widthRange.addEventListener('input', function () {
    calibration.widthMeters = Number(widthRange.value);
    updateCalibration();
  });
  if (planVisible) planVisible.addEventListener('change', function () {
    calibration.visible = planVisible.checked;
    updateCalibration();
  });
  if (sectionsVisible) sectionsVisible.addEventListener('change', addOrUpdateVectorOverlays);
  if (manzanasVisible) manzanasVisible.addEventListener('change', addOrUpdateVectorOverlays);

  if (vectorFlipHorizontal) vectorFlipHorizontal.addEventListener('change', function () {
    vectorCalibration.flipHorizontal = vectorFlipHorizontal.checked;
    updateVectorCalibration();
  });
  if (vectorFlipVertical) vectorFlipVertical.addEventListener('change', function () {
    vectorCalibration.flipVertical = vectorFlipVertical.checked;
    updateVectorCalibration();
  });
  if (vectorRotationRange) vectorRotationRange.addEventListener('input', function () {
    vectorCalibration.rotationDeg = Number(vectorRotationRange.value);
    updateVectorCalibration();
  });
  if (vectorScaleRange) vectorScaleRange.addEventListener('input', function () {
    vectorCalibration.scale = Number(vectorScaleRange.value) / 100;
    updateVectorCalibration();
  });

  document.querySelectorAll('[data-nudge]').forEach(function (button) {
    const direction = button.dataset.nudge;
    if (['north', 'south', 'east', 'west'].includes(direction)) {
      button.addEventListener('click', function () { nudgePlan(direction); });
    }
  });

  document.querySelectorAll('[data-vector-nudge]').forEach(function (button) {
    const direction = button.dataset.vectorNudge;
    button.addEventListener('click', function () { nudgeVectors(direction); });
  });

  if (useMapCenterBtn) useMapCenterBtn.addEventListener('click', function () {
    const center = map.getCenter();
    calibration.lat = center.lat;
    calibration.lng = center.lng;
    updateCalibration();
    setStatus('Centro del plano actualizado con el centro visible del mapa.', 2200);
  });

  if (resetCalibrationBtn) resetCalibrationBtn.addEventListener('click', function () {
    calibration = Object.assign({}, DEFAULT_CALIBRATION);
    updateCalibration();
    setStatus('Se restauraron los valores aprobados del plano.', 1800);
  });

  if (resetVectorsBtn) resetVectorsBtn.addEventListener('click', function () {
    vectorCalibration = Object.assign({}, DEFAULT_VECTOR_CALIBRATION);
    updateVectorCalibration();
    setStatus('Se restableció el ajuste independiente de líneas.', 1800);
  });

  if (copyCalibrationBtn) copyCalibrationBtn.addEventListener('click', async function () {
    const payload = JSON.stringify(calibration, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setStatus('Calibración del plano copiada.', 2200);
    } catch (_) {
      console.info('[Calibration plano]', payload);
      setStatus('La calibración del plano quedó en la consola.', 3200);
    }
  });

  if (copyVectorsBtn) copyVectorsBtn.addEventListener('click', async function () {
    const payload = JSON.stringify(vectorCalibration, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setStatus('Ajuste de líneas copiado.', 2200);
    } catch (_) {
      console.info('[Calibration vectores]', payload);
      setStatus('El ajuste de líneas quedó en la consola.', 3200);
    }
  });

  document.querySelectorAll('.basemap-option').forEach(function (button) {
    button.addEventListener('click', function () { requestBasemap(button.dataset.basemap); });
  });

  syncCalibrationUi();
  syncVectorUi();
  updateVectorStatus();

  Promise.all([
    fetch(SECTIONS_URL, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error(`Secciones HTTP ${response.status}`);
      return response.json();
    }),
    fetch(MANZANAS_URL, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error(`Manzanas HTTP ${response.status}`);
      return response.json();
    })
  ]).then(function (results) {
    sectionsRaw = results[0];
    manzanasRaw = results[1];

    const normalized = normalizeManzanasGeoJSON(manzanasRaw);
    normalizedManzanas = normalized.polygons;
    manzanaCenters = normalized.centers;

    if (manzanasVisible) manzanasVisible.checked = true;
    updateVectorStatus();
    restorePreviewLayers();

    console.info('[Calibration] vectores listos', {
      secciones: sectionsRaw.features ? sectionsRaw.features.length : 0,
      manzanasOriginales: manzanasRaw.features ? manzanasRaw.features.length : 0,
      manzanasRenderizadas: normalizedManzanas.features ? normalizedManzanas.features.length : 0,
      centrosManzana: manzanaCenters.features ? manzanaCenters.features.length : 0
    });
  }).catch(function (error) {
    console.error('[Calibration] No fue posible cargar los GeoJSON.', error);
    if (vectorStatus) vectorStatus.textContent = 'ERROR';
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
  });
})();
