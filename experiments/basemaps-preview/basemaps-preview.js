(function () {
  'use strict';

  const CENTER = [-100.15610, 25.81662];
  const START_ZOOM = 16.4;
  const SATELLITE_CLEAR_MAX_ZOOM = 18.0;

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
      layers: [
        {
          id: `${id}-layer`,
          type: 'raster',
          source: id,
          paint: {
            'raster-resampling': 'linear'
          }
        }
      ]
    };
  }

  const styles = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    standard: 'https://tiles.openfreemap.org/styles/liberty',
    satellite: rasterStyle(
      'esri-world-imagery',
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      18,
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    )
  };

  const labels = {
    light: 'Light',
    standard: 'OpenStreetMap',
    satellite: 'Satélite'
  };

  const status = document.getElementById('mapStatus');
  const modeLabel = document.getElementById('modeLabel');
  const centerLabel = document.getElementById('centerLabel');
  const zoomLabel = document.getElementById('zoomLabel');

  let currentBasemap = 'light';
  let statusTimer = null;

  function setStatus(text, hideAfterMs) {
    if (!status) return;
    if (statusTimer) {
      window.clearTimeout(statusTimer);
      statusTimer = null;
    }

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

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

  function updateLocationReadout() {
    const center = map.getCenter();
    centerLabel.textContent = `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`;
    zoomLabel.textContent = map.getZoom().toFixed(1);
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
      paint: {
        'circle-radius': 4,
        'circle-color': '#d39a17'
      }
    });
  }

  function setActiveButton(key) {
    document.querySelectorAll('.basemap-option').forEach((button) => {
      button.classList.toggle('active', button.dataset.basemap === key);
    });
  }

  function satelliteResolutionMessage() {
    return 'El satélite llegó a su nivel máximo de detalle. Se cambió automáticamente a Light para mantener una vista nítida.';
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

    map.once('styledata', function () {
      try { markParkReference(); } catch (_) {}
    });

    map.once('idle', function () {
      if (config.notice) {
        setStatus(config.notice, 5200);
      } else {
        setStatus(`${labels[key]} listo`, 700);
      }
    });
  }

  function requestBasemap(key) {
    if (key === 'satellite' && map.getZoom() > SATELLITE_CLEAR_MAX_ZOOM) {
      const message = satelliteResolutionMessage();
      if (currentBasemap !== 'light') {
        applyBasemap('light', { notice: message });
      } else {
        setActiveButton('light');
        modeLabel.textContent = labels.light;
        localStorage.setItem('jp-basemap-preview', 'light');
        setStatus(message, 5200);
      }
      return;
    }

    applyBasemap(key);
  }

  document.querySelectorAll('.basemap-option').forEach((button) => {
    button.addEventListener('click', function () {
      requestBasemap(button.dataset.basemap);
    });
  });

  map.on('load', function () {
    markParkReference();
    updateLocationReadout();

    const saved = localStorage.getItem('jp-basemap-preview');
    if (saved && saved !== 'light' && styles[saved]) {
      requestBasemap(saved);
    } else {
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
