(function () {
  'use strict';

  const CALIBRATION_KEY = 'jp-basemap-calibration-v2';
  const FIXED_WIDTH_METERS = 516;
  const MAX_MAP_ZOOM = 22;
  const LEGACY_SATELLITE_LIMIT = 18.65;
  const PLAN_URL = './base-plan.webp';
  const MAX_PROCESSED_WIDTH = 4096;

  let transparentPlanPromise = null;
  let attachedMap = null;
  let restoredHighZoom = null;

  function forceApprovedWidthInStorage() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(CALIBRATION_KEY) || '{}') || {};
    } catch (_) {
      saved = {};
    }

    saved.widthMeters = FIXED_WIDTH_METERS;
    if (!Number.isFinite(Number(saved.lat))) saved.lat = 25.81632700772623;
    if (!Number.isFinite(Number(saved.lng))) saved.lng = -100.15612317763441;
    if (!Number.isFinite(Number(saved.rotationDeg))) saved.rotationDeg = 5.7;
    if (!Number.isFinite(Number(saved.opacity))) saved.opacity = 0.31;
    if (typeof saved.visible !== 'boolean') saved.visible = true;

    try {
      localStorage.setItem(CALIBRATION_KEY, JSON.stringify(saved));
    } catch (_) {}
  }

  function hideWidthEditor() {
    const widthRange = document.getElementById('widthRange');
    if (widthRange) {
      const row = widthRange.closest('.calibration-control');
      if (row) row.remove();
      else widthRange.remove();
    }

    if (document.getElementById('approvedWidthReadout')) return;
    const coords = document.querySelector('.calibration-coordinates');
    if (!coords || !coords.parentElement) return;

    const row = document.createElement('div');
    row.id = 'approvedWidthReadout';
    row.className = 'preview-info-row approved-width-readout';
    row.innerHTML = '<span>Ancho del plano</span><strong>516 m · aprobado</strong>';
    coords.parentElement.insertBefore(row, coords);
  }

  function removeLegacySatelliteZoomGuard(map) {
    try {
      const listeners = map && map._listeners && map._listeners.zoomend;
      if (!Array.isArray(listeners)) return;

      map._listeners.zoomend = listeners.filter(function (entry) {
        const fn = entry && (entry.listener || entry);
        const source = typeof fn === 'function' ? String(fn) : '';
        return !source.includes('SATELLITE_CLEAR_MAX_ZOOM');
      });
    } catch (error) {
      console.warn('[Basemaps Preview] No se pudo retirar el limite legacy de satelite.', error);
    }
  }

  function allowSatelliteButtonAtHighZoom(map) {
    document.addEventListener('click', function (event) {
      const button = event.target && event.target.closest
        ? event.target.closest('.basemap-option[data-basemap="satellite"]')
        : null;
      if (!button || !map) return;

      const currentZoom = Number(map.getZoom());
      if (!Number.isFinite(currentZoom) || currentZoom <= LEGACY_SATELLITE_LIMIT) return;

      restoredHighZoom = currentZoom;
      try {
        map.jumpTo({ zoom: LEGACY_SATELLITE_LIMIT - 0.05 });
      } catch (_) {}

      window.setTimeout(function () {
        if (!Number.isFinite(restoredHighZoom)) return;
        const target = restoredHighZoom;
        restoredHighZoom = null;
        try { map.jumpTo({ zoom: target }); } catch (_) {}
      }, 700);
    }, true);
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
            const darkness = Math.max(0, Math.min(1, (246 - luminance) / 205));

            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = darkness < 0.035 ? 0 : Math.round(Math.min(1, darkness * 1.9) * 255);
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
      image.src = `${PLAN_URL}?v=lines-1`;
    });

    return transparentPlanPromise;
  }

  async function applyTransparentPlan(map) {
    if (!map || !map.isStyleLoaded || !map.isStyleLoaded()) return;

    const source = map.getSource('jdjp-plan');
    if (!source || typeof source.updateImage !== 'function') return;

    try {
      const transparentUrl = await makeTransparentPlan();
      const coordinates = source.coordinates || source._coordinates;
      const options = { url: transparentUrl };
      if (coordinates) options.coordinates = coordinates;
      source.updateImage(options);
    } catch (error) {
      console.warn('[Basemaps Preview] No se pudo generar el plano de lineas transparentes.', error);
    }
  }

  function scheduleTransparentPlan(map) {
    window.setTimeout(function () { applyTransparentPlan(map); }, 50);
    window.setTimeout(function () { applyTransparentPlan(map); }, 350);
  }

  function attachToMap(map) {
    if (!map || attachedMap === map) return;
    attachedMap = map;

    forceApprovedWidthInStorage();
    hideWidthEditor();

    try { map.setMaxZoom(MAX_MAP_ZOOM); } catch (_) {}
    removeLegacySatelliteZoomGuard(map);
    allowSatelliteButtonAtHighZoom(map);

    map.on('styledata', function () {
      removeLegacySatelliteZoomGuard(map);
      scheduleTransparentPlan(map);
    });
    map.on('idle', function () {
      scheduleTransparentPlan(map);
    });

    scheduleTransparentPlan(map);
    console.info('[Basemaps Preview] Plano fijo a 516 m, lineas transparentes y zoom maximo 22 activos.');
  }

  forceApprovedWidthInStorage();
  hideWidthEditor();

  let attempts = 0;
  const timer = window.setInterval(function () {
    attempts += 1;
    hideWidthEditor();

    const map = window.JP_BASEMAP_MAP;
    if (map) {
      window.clearInterval(timer);
      window.setTimeout(function () { attachToMap(map); }, 0);
      window.setTimeout(function () { removeLegacySatelliteZoomGuard(map); }, 800);
      return;
    }

    if (attempts > 200) window.clearInterval(timer);
  }, 50);
})();
