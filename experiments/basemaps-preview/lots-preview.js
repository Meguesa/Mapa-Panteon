(function () {
  'use strict';

  const map = window.JP_BASEMAP_MAP;
  if (!map) {
    console.error('[Lots Preview] No se encontro la instancia del mapa.');
    return;
  }

  const DATA_WIDTH = 11100;
  const DATA_HEIGHT = 9250;
  const PLAN_ASPECT = DATA_WIDTH / DATA_HEIGHT;

  const CALIBRATION = {
    lat: 25.81632700772623,
    lng: -100.15612317763441,
    widthMeters: 516,
    rotationDeg: 5.7
  };

  const VECTOR = {
    offsetEastMeters: 0,
    offsetNorthMeters: 0,
    scale: 1,
    rotationDeg: 0,
    flipHorizontal: false,
    flipVertical: true
  };

  const SECTION_FILES = {
    BRONCE: './lotes/bronce/lotes.geojson',
    ORO: './lotes/oro/lotes.geojson',
    PLATA: './lotes/plata/lotes.geojson',
    PLATINO: './lotes/platino/lotes.geojson',
    SANJUANVIP: './lotes/sanjuanvip/lotes.geojson',
    SANMATEOVIP: './lotes/sanmateovip/lotes.geojson',
    SANPEDROVIP: './lotes/sanpedrovip/lotes.geojson'
  };

  const sectionSelect = document.getElementById('lotSectionSelect');
  const manzanaSelect = document.getElementById('lotManzanaSelect');
  const lotsVisible = document.getElementById('lotsVisible');
  const lotNumbersVisible = document.getElementById('lotNumbersVisible');
  const lotStatus = document.getElementById('lotStatus');
  const lotSelected = document.getElementById('lotSelected');

  let rawSection = null;
  let transformedSection = null;
  let currentSection = '';
  let currentManzana = '';
  let selectedFeatureKey = '';
  let requestId = 0;

  function metersToLng(meters, latitude) {
    return meters / (111320 * Math.cos(latitude * Math.PI / 180));
  }

  function metersToLat(meters) {
    return meters / 110540;
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

  function transformPoint(point) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    const heightMeters = CALIBRATION.widthMeters / PLAN_ASPECT;

    let east = ((x / DATA_WIDTH) - 0.5) * CALIBRATION.widthMeters;
    let north = (0.5 - (y / DATA_HEIGHT)) * heightMeters;

    if (VECTOR.flipHorizontal) east *= -1;
    if (VECTOR.flipVertical) north *= -1;

    let rotated = rotateMeters(east, north, CALIBRATION.rotationDeg);
    east = rotated.east * VECTOR.scale;
    north = rotated.north * VECTOR.scale;

    rotated = rotateMeters(east, north, VECTOR.rotationDeg);
    east = rotated.east + VECTOR.offsetEastMeters;
    north = rotated.north + VECTOR.offsetNorthMeters;

    return [
      CALIBRATION.lng + metersToLng(east, CALIBRATION.lat),
      CALIBRATION.lat + metersToLat(north)
    ];
  }

  function transformCoordinates(coords) {
    if (!Array.isArray(coords)) return coords;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      return transformPoint(coords);
    }
    return coords.map(transformCoordinates);
  }

  function normalizeStatus(value) {
    const s = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (['disponible', 'libre'].includes(s)) return 'disponible';
    if (['separado', 'apartado'].includes(s)) return 'separado';
    if (['vendido'].includes(s)) return 'vendido';
    if (['utilizado', 'ocupado', 'usado'].includes(s)) return 'utilizado';
    if (['suspendido'].includes(s)) return 'suspendido';
    if (['por_construir', 'no_construido', 'no_construida'].includes(s)) return 'por_construir';
    return s || 'sin_inventario';
  }

  function transformFeature(feature, index) {
    const properties = Object.assign({}, feature.properties || {});
    const lote = String(properties.lote || properties.id || index + 1);
    const manzana = String(properties.manzana || properties.manzanaId || '').trim();
    const section = String(properties.seccion || currentSection || '').trim().toUpperCase();
    properties._featureKey = `${section}|${manzana}|${lote}|${index}`;
    properties._estatus = normalizeStatus(properties.estatus);
    properties._loteLabel = lote.replace(/^0+(?=\d)/, '') || lote;
    properties._manzana = manzana;
    properties._seccion = section;

    return {
      type: 'Feature',
      id: index + 1,
      properties: properties,
      geometry: feature.geometry ? {
        type: feature.geometry.type,
        coordinates: transformCoordinates(feature.geometry.coordinates)
      } : null
    };
  }

  function transformCollection(data) {
    const features = Array.isArray(data && data.features) ? data.features : [];
    return {
      type: 'FeatureCollection',
      features: features.filter((f) => f && f.geometry).map(transformFeature)
    };
  }

  function emptyCollection() {
    return { type: 'FeatureCollection', features: [] };
  }

  function setStatus(text) {
    if (lotStatus) lotStatus.textContent = text;
  }

  function colorExpression() {
    return [
      'match', ['get', '_estatus'],
      'disponible', '#2f9e62',
      'separado', '#d69a22',
      'vendido', '#3388d8',
      'utilizado', '#cf3f3f',
      'suspendido', '#7048c8',
      'por_construir', '#7a8798',
      '#9aa5b1'
    ];
  }

  function lotFilter() {
    if (!currentManzana) return null;
    return ['==', ['get', '_manzana'], currentManzana];
  }

  function ensureLayers() {
    if (!map.isStyleLoaded()) return;

    const data = transformedSection || emptyCollection();
    let source = map.getSource('jdjp-lots-preview');
    if (!source) {
      map.addSource('jdjp-lots-preview', { type: 'geojson', data: data });
    } else {
      source.setData(data);
    }

    if (!map.getLayer('jdjp-lots-fill')) {
      map.addLayer({
        id: 'jdjp-lots-fill',
        type: 'fill',
        source: 'jdjp-lots-preview',
        paint: {
          'fill-color': colorExpression(),
          'fill-opacity': 0.58
        }
      });
    }

    if (!map.getLayer('jdjp-lots-line')) {
      map.addLayer({
        id: 'jdjp-lots-line',
        type: 'line',
        source: 'jdjp-lots-preview',
        paint: {
          'line-color': '#172b3f',
          'line-width': 1.3,
          'line-opacity': 0.9
        }
      });
    }

    if (!map.getLayer('jdjp-lots-label')) {
      map.addLayer({
        id: 'jdjp-lots-label',
        type: 'symbol',
        source: 'jdjp-lots-preview',
        minzoom: 16.9,
        layout: {
          'text-field': ['get', '_loteLabel'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 16.9, 8, 19, 12],
          'text-font': ['Open Sans Bold'],
          'text-allow-overlap': false,
          'text-ignore-placement': false
        },
        paint: {
          'text-color': '#102a43',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
          'text-halo-blur': 0.3
        }
      });
    }

    if (!map.getSource('jdjp-lot-selected')) {
      map.addSource('jdjp-lot-selected', { type: 'geojson', data: emptyCollection() });
    }

    if (!map.getLayer('jdjp-lot-selected-line')) {
      map.addLayer({
        id: 'jdjp-lot-selected-line',
        type: 'line',
        source: 'jdjp-lot-selected',
        paint: {
          'line-color': '#111827',
          'line-width': 4,
          'line-opacity': 1
        }
      });
    }

    applyVisibility();
    applyFilter();
    restoreSelected();
  }

  function applyVisibility() {
    const visible = !lotsVisible || lotsVisible.checked;
    ['jdjp-lots-fill', 'jdjp-lots-line'].forEach(function (id) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    });
    if (map.getLayer('jdjp-lots-label')) {
      const showLabels = visible && (!lotNumbersVisible || lotNumbersVisible.checked);
      map.setLayoutProperty('jdjp-lots-label', 'visibility', showLabels ? 'visible' : 'none');
    }
    if (map.getLayer('jdjp-lot-selected-line')) {
      map.setLayoutProperty('jdjp-lot-selected-line', 'visibility', visible ? 'visible' : 'none');
    }
  }

  function applyFilter() {
    const filter = lotFilter();
    ['jdjp-lots-fill', 'jdjp-lots-line', 'jdjp-lots-label'].forEach(function (id) {
      if (map.getLayer(id)) map.setFilter(id, filter);
    });
  }

  function flattenCoordinates(coords, out) {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      out.push(coords);
      return;
    }
    coords.forEach((child) => flattenCoordinates(child, out));
  }

  function featureBounds(features) {
    const points = [];
    features.forEach(function (feature) {
      if (feature && feature.geometry) flattenCoordinates(feature.geometry.coordinates, points);
    });
    if (!points.length) return null;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    points.forEach(function (p) {
      minLng = Math.min(minLng, p[0]);
      maxLng = Math.max(maxLng, p[0]);
      minLat = Math.min(minLat, p[1]);
      maxLat = Math.max(maxLat, p[1]);
    });
    return [[minLng, minLat], [maxLng, maxLat]];
  }

  function fitCurrentManzana() {
    if (!transformedSection || !currentManzana) return;
    const features = transformedSection.features.filter((f) => f.properties._manzana === currentManzana);
    const bounds = featureBounds(features);
    if (!bounds) return;
    map.fitBounds(bounds, {
      padding: { top: 70, bottom: 70, left: 270, right: 380 },
      maxZoom: 18.25,
      duration: 650
    });
  }

  function populateManzanas() {
    if (!manzanaSelect) return;
    const values = transformedSection
      ? Array.from(new Set(transformedSection.features.map((f) => f.properties._manzana).filter(Boolean)))
      : [];
    values.sort(function (a, b) {
      return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
    });

    manzanaSelect.innerHTML = '<option value="">Todas las manzanas</option>' + values
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      .join('');
    manzanaSelect.disabled = !values.length;
    currentManzana = '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function loadSection(section) {
    currentSection = section;
    currentManzana = '';
    selectedFeatureKey = '';
    renderSelected(null);

    if (!section || !SECTION_FILES[section]) {
      rawSection = null;
      transformedSection = null;
      populateManzanas();
      if (map.isStyleLoaded()) ensureLayers();
      setStatus('Selecciona una sección para validar sus lotes.');
      return;
    }

    const thisRequest = ++requestId;
    setStatus(`Cargando lotes de ${section}…`);
    if (sectionSelect) sectionSelect.disabled = true;
    if (manzanaSelect) manzanaSelect.disabled = true;

    try {
      const response = await fetch(SECTION_FILES[section], { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (thisRequest !== requestId) return;
      rawSection = data;
      transformedSection = transformCollection(data);
      populateManzanas();
      ensureLayers();
      setStatus(`${transformedSection.features.length.toLocaleString('es-MX')} lotes cargados en ${section}. Selecciona una manzana.`);
    } catch (error) {
      console.error('[Lots Preview] No fue posible cargar', section, error);
      rawSection = null;
      transformedSection = null;
      populateManzanas();
      ensureLayers();
      setStatus(`Error al cargar lotes de ${section}.`);
    } finally {
      if (sectionSelect) sectionSelect.disabled = false;
      if (manzanaSelect && transformedSection) manzanaSelect.disabled = false;
    }
  }

  function renderSelected(feature) {
    if (!lotSelected) return;
    if (!feature) {
      lotSelected.innerHTML = 'Selecciona un lote sobre el mapa para verificar posición y datos básicos.';
      return;
    }
    const p = feature.properties || {};
    lotSelected.innerHTML = `
      <strong>Lote ${escapeHtml(p._loteLabel || p.lote || p.id || '')}</strong>
      <div class="lots-selected-grid">
        <span>Sección</span><span>${escapeHtml(p._seccion || '')}</span>
        <span>Manzana</span><span>${escapeHtml(p._manzana || '')}</span>
        <span>Estatus GeoJSON</span><span>${escapeHtml(p._estatus || '')}</span>
      </div>`;
  }

  function restoreSelected() {
    const source = map.getSource('jdjp-lot-selected');
    if (!source) return;
    if (!selectedFeatureKey || !transformedSection) {
      source.setData(emptyCollection());
      return;
    }
    const feature = transformedSection.features.find((f) => f.properties._featureKey === selectedFeatureKey);
    source.setData(feature ? { type: 'FeatureCollection', features: [feature] } : emptyCollection());
  }

  function attachMapHandlers() {
    map.on('click', function (event) {
      if (!map.getLayer('jdjp-lots-fill')) return;
      const features = map.queryRenderedFeatures(event.point, { layers: ['jdjp-lots-fill'] });
      if (!features.length) return;
      const clicked = features[0];
      selectedFeatureKey = clicked.properties._featureKey || '';
      renderSelected(clicked);
      restoreSelected();
    });

    map.on('mousemove', function (event) {
      if (!map.getLayer('jdjp-lots-fill')) return;
      const features = map.queryRenderedFeatures(event.point, { layers: ['jdjp-lots-fill'] });
      map.getCanvas().style.cursor = features.length ? 'pointer' : '';
    });

    map.on('mouseleave', 'jdjp-lots-fill', function () {
      map.getCanvas().style.cursor = '';
    });
  }

  if (sectionSelect) {
    sectionSelect.addEventListener('change', function () {
      loadSection(sectionSelect.value);
    });
  }

  if (manzanaSelect) {
    manzanaSelect.addEventListener('change', function () {
      currentManzana = manzanaSelect.value;
      selectedFeatureKey = '';
      renderSelected(null);
      applyFilter();
      restoreSelected();
      if (currentManzana) fitCurrentManzana();
      setStatus(currentManzana ? `Manzana ${currentManzana} seleccionada.` : `${transformedSection ? transformedSection.features.length : 0} lotes visibles.`);
    });
  }

  if (lotsVisible) lotsVisible.addEventListener('change', applyVisibility);
  if (lotNumbersVisible) lotNumbersVisible.addEventListener('change', applyVisibility);

  attachMapHandlers();

  map.on('styledata', function () {
    window.setTimeout(function () {
      try { ensureLayers(); } catch (error) { console.warn('[Lots Preview] restaurar capas', error); }
    }, 0);
  });

  map.on('idle', function () {
    if (transformedSection) {
      try { ensureLayers(); } catch (_) {}
    }
  });

  if (map.loaded()) ensureLayers();
  else map.once('load', ensureLayers);

  console.info('[Lots Preview] Validación geográfica de lotes instalada.');
})();
