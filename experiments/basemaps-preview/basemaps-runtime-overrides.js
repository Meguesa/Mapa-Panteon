(function () {
  'use strict';

  const FIXED = {
    lat: 25.81632700772623,
    lng: -100.15612317763441,
    widthMeters: 516,
    rotationDeg: 5.7,
    opacity: 0.90
  };
  const DATA_WIDTH = 11100;
  const DATA_HEIGHT = 9250;
  const PLAN_ASPECT = DATA_WIDTH / DATA_HEIGHT;
  const PLAN_URL = './base-plan.webp';
  const SECTIONS_URL = './secciones-top.geojson';
  const MAX_PROCESSED_WIDTH = 4096;
  const MAX_MAP_ZOOM = 22;

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
        attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      }
    },
    layers: [{
      id: 'esri-world-imagery-layer',
      type: 'raster',
      source: 'esri-world-imagery',
      paint: { 'raster-resampling': 'linear' }
    }]
  };

  const BLANK_LIGHT_STYLE = window.JP_BLANK_LIGHT_STYLE || {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }]
  };

  const SECTION_VALUE_MAP = {
    'BRONCE': 'BRONCE',
    'ORO': 'ORO',
    'PLATA': 'PLATA',
    'PLATINO': 'PLATINO',
    'SAN JUAN VIP': 'SANJUANVIP',
    'SAN MATEO VIP': 'SANMATEOVIP',
    'SAN PEDRO VIP': 'SANPEDROVIP'
  };

  let map = null;
  let transparentPlanPromise = null;
  let sectionsRaw = null;
  let transformedSections = null;
  let sectionPopup = null;
  let hoveredSection = '';
  let currentMode = 'light';

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
    const heightMeters = FIXED.widthMeters / PLAN_ASPECT;
    let east = ((x / DATA_WIDTH) - 0.5) * FIXED.widthMeters;
    let north = (0.5 - (y / DATA_HEIGHT)) * heightMeters;

    // Ajuste vectorial aprobado: flip vertical.
    north *= -1;

    const rotated = rotateMeters(east, north, FIXED.rotationDeg);
    return [
      FIXED.lng + metersToLng(rotated.east, FIXED.lat),
      FIXED.lat + metersToLat(rotated.north)
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
      features: (data && Array.isArray(data.features) ? data.features : []).map(function (feature, index) {
        const properties = Object.assign({}, feature.properties || {});
        properties._hoverId = index + 1;
        return {
          type: 'Feature',
          id: index + 1,
          properties,
          geometry: feature.geometry ? {
            type: feature.geometry.type,
            coordinates: transformCoordinates(feature.geometry.coordinates)
          } : null
        };
      })
    };
  }

  function forceFixedCalibration() {
    const key = 'jp-basemap-calibration-v2';
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) {}
    Object.assign(saved, FIXED, { visible: false });
    try { localStorage.setItem(key, JSON.stringify(saved)); } catch (_) {}
  }

  function makeTransparentPlan() {
    if (transparentPlanPromise) return transparentPlanPromise;

    transparentPlanPromise = new Promise(function (resolve, reject) {
      const image = new Image();
      image.decoding = 'async';
      image.onload = function () {
        try {
          const scale = Math.min(1, MAX_PROCESSED_WIDTH / Math.max(1, image.naturalWidth));
          const width = Math.max(1, Math.round(image.naturalWidth * scale));
          const height = Math.max(1, Math.round(image.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Canvas 2D no disponible.');

          context.drawImage(image, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height);
          const data = pixels.data;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const darkness = Math.max(0, Math.min(1, (244 - luminance) / 195));

            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = darkness < 0.045 ? 0 : Math.round(Math.min(1, darkness * 2.05) * 255);
          }

          context.putImageData(pixels, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = function () {
        reject(new Error('No se pudo cargar el plano para generar la version transparente.'));
      };
      image.src = `${PLAN_URL}?v=transparent-final`;
    });

    return transparentPlanPromise;
  }

  async function applyTransparentPlan() {
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource('jdjp-plan');
    const layer = map.getLayer('jdjp-plan-layer');
    if (!source || !layer || typeof source.updateImage !== 'function') return;

    // Nunca mostrar la imagen blanca mientras se procesa.
    try { map.setPaintProperty('jdjp-plan-layer', 'raster-opacity', 0); } catch (_) {}

    try {
      const transparentUrl = await makeTransparentPlan();
      const coordinates = source.coordinates || source._coordinates;
      const options = { url: transparentUrl };
      if (coordinates) options.coordinates = coordinates;
      source.updateImage(options);
      map.setPaintProperty('jdjp-plan-layer', 'raster-opacity', FIXED.opacity);
    } catch (error) {
      console.warn('[Basemaps Preview] No se pudo generar el plano transparente.', error);
    }
  }

  function hideLegacyGeometry() {
    if (!map || !map.isStyleLoaded()) return;
    [
      'jdjp-sections-line',
      'jdjp-manzanas-fill',
      'jdjp-manzanas-line',
      'jdjp-manzanas-centers',
      'park-reference-ring',
      'park-reference-dot'
    ].forEach(function (id) {
      try {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      } catch (_) {}
    });
  }

  function sectionName(feature) {
    const p = feature && feature.properties ? feature.properties : {};
    return String(p.nombre || p.seccion || p.id || 'SECCIÓN').trim();
  }

  function ensureSectionHoverLayers() {
    if (!map || !map.isStyleLoaded() || !transformedSections) return;

    let source = map.getSource('jp-sections-hover-source');
    if (!source) {
      map.addSource('jp-sections-hover-source', { type: 'geojson', data: transformedSections });
    } else {
      source.setData(transformedSections);
    }

    if (!map.getLayer('jp-sections-hit')) {
      map.addLayer({
        id: 'jp-sections-hit',
        type: 'fill',
        source: 'jp-sections-hover-source',
        paint: {
          'fill-color': '#ffffff',
          'fill-opacity': 0.001
        }
      });
    }

    if (!map.getSource('jp-section-active-source')) {
      map.addSource('jp-section-active-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!map.getLayer('jp-section-active-fill')) {
      map.addLayer({
        id: 'jp-section-active-fill',
        type: 'fill',
        source: 'jp-section-active-source',
        paint: {
          'fill-color': '#265585',
          'fill-opacity': 0.12
        }
      });
    }

    if (!map.getLayer('jp-section-active-line')) {
      map.addLayer({
        id: 'jp-section-active-line',
        type: 'line',
        source: 'jp-section-active-source',
        paint: {
          'line-color': '#d39a17',
          'line-width': 3,
          'line-opacity': 1
        }
      });
    }
  }

  function clearSectionHover() {
    hoveredSection = '';
    const source = map && map.getSource('jp-section-active-source');
    if (source) source.setData({ type: 'FeatureCollection', features: [] });
    if (sectionPopup) {
      sectionPopup.remove();
      sectionPopup = null;
    }
    if (map) map.getCanvas().style.cursor = '';
  }

  function setSectionHover(feature, lngLat) {
    if (!feature) return clearSectionHover();
    const name = sectionName(feature);
    hoveredSection = name;

    const source = map.getSource('jp-section-active-source');
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: Object.assign({}, feature.properties || {}),
          geometry: feature.geometry
        }]
      });
    }

    if (!sectionPopup) {
      sectionPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'section-hover-popup'
      });
    }
    sectionPopup.setLngLat(lngLat).setText(name).addTo(map);
    map.getCanvas().style.cursor = 'pointer';
  }

  function selectSection(feature) {
    if (!feature) return;
    const name = sectionName(feature).toUpperCase();
    const value = SECTION_VALUE_MAP[name] || name.replace(/\s+/g, '');
    const select = document.getElementById('lotSectionSelect');
    if (!select) return;

    const valid = Array.from(select.options).some(function (option) { return option.value === value; });
    if (!valid) return;
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function bindSectionInteraction() {
    if (!map) return;

    map.on('mousemove', function (event) {
      if (!map.getLayer('jp-sections-hit')) return;
      const features = map.queryRenderedFeatures(event.point, { layers: ['jp-sections-hit'] });
      if (!features.length) {
        if (hoveredSection) clearSectionHover();
        return;
      }
      setSectionHover(features[0], event.lngLat);
    });

    map.on('click', function (event) {
      if (!map.getLayer('jp-sections-hit')) return;

      // Si el clic fue en un lote, dejar que el flujo de lotes lo procese.
      if (map.getLayer('jdjp-lots-fill')) {
        const lotHits = map.queryRenderedFeatures(event.point, { layers: ['jdjp-lots-fill'] });
        if (lotHits.length) return;
      }

      const features = map.queryRenderedFeatures(event.point, { layers: ['jp-sections-hit'] });
      if (features.length) selectSection(features[0]);
    });

    map.on('mouseout', function () {
      clearSectionHover();
    });
  }

  function setMode(mode) {
    if (!map) return;
    currentMode = mode === 'satellite' ? 'satellite' : 'light';
    document.querySelectorAll('.basemap-option').forEach(function (button) {
      button.classList.toggle('active', button.dataset.basemap === currentMode);
    });

    try {
      localStorage.setItem('jp-basemap-preview', currentMode);
    } catch (_) {}

    map.setStyle(currentMode === 'satellite' ? SATELLITE_STYLE : BLANK_LIGHT_STYLE, { diff: false });
  }

  function bindBasemapButtons() {
    document.addEventListener('click', function (event) {
      const button = event.target && event.target.closest ? event.target.closest('.basemap-option') : null;
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMode(button.dataset.basemap);
    }, true);
  }

  async function loadSections() {
    try {
      const response = await fetch(SECTIONS_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      sectionsRaw = await response.json();
      transformedSections = transformGeoJSON(sectionsRaw);
      ensureSectionHoverLayers();
    } catch (error) {
      console.error('[Basemaps Preview] No se pudieron cargar las secciones para hover.', error);
    }
  }

  function restoreFinalLayers() {
    window.setTimeout(function () {
      hideLegacyGeometry();
      ensureSectionHoverLayers();
      applyTransparentPlan();
    }, 0);
  }

  function attach() {
    map = window.JP_BASEMAP_MAP;
    if (!map) return false;

    forceFixedCalibration();
    try { map.setMaxZoom(MAX_MAP_ZOOM); } catch (_) {}

    bindBasemapButtons();
    bindSectionInteraction();
    loadSections();

    map.on('styledata', restoreFinalLayers);
    map.on('idle', restoreFinalLayers);

    const savedMode = localStorage.getItem('jp-basemap-preview');
    if (savedMode === 'satellite') setMode('satellite');
    else setMode('light');

    console.info('[Basemaps Preview] UI final activa: plano transparente 90%, Light limpio, hover de secciones y zoom 22.');
    return true;
  }

  forceFixedCalibration();
  let attempts = 0;
  const timer = window.setInterval(function () {
    attempts += 1;
    if (attach()) {
      window.clearInterval(timer);
      return;
    }
    if (attempts > 200) window.clearInterval(timer);
  }, 50);
})();
