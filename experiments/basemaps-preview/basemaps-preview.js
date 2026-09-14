(function () {
  'use strict';

  const CENTER = [-100.15610, 25.81662];
  const START_ZOOM = 16.4;

  const styles = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    standard: 'https://tiles.openfreemap.org/styles/liberty',
    satellite: {
      version: 8,
      sources: {
        esri: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          // En esta zona Esri devuelve mosaicos grises "Map data not yet available"
          // a partir del siguiente nivel nativo. Limitamos la fuente a z18 y
          // dejamos que MapLibre amplie ese ultimo mosaico disponible cuando el
          // usuario siga acercando el mapa. Asi conservamos el zoom sin pedir
          // tiles inexistentes a Esri.
          maxzoom: 18,
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
        }
      },
      layers: [
        {
          id: 'esri-satellite',
          type: 'raster',
          source: 'esri',
          paint: {
            'raster-resampling': 'linear'
          }
        }
      ]
    }
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

  function setStatus(text, hideLater) {
    if (!status) return;
    status.textContent = text;
    status.classList.remove('hidden');
    if (hideLater) {
      window.setTimeout(() => status.classList.add('hidden'), 700);
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

  function applyBasemap(key) {
    if (!styles[key]) return;
    setStatus(`Cargando ${labels[key]}…`, false);
    map.setStyle(styles[key], { diff: false });
    modeLabel.textContent = labels[key];
    localStorage.setItem('jp-basemap-preview', key);

    document.querySelectorAll('.basemap-option').forEach((button) => {
      button.classList.toggle('active', button.dataset.basemap === key);
    });

    map.once('styledata', function () {
      try { markParkReference(); } catch (_) {}
    });
    map.once('idle', function () {
      setStatus(`${labels[key]} listo`, true);
    });
  }

  document.querySelectorAll('.basemap-option').forEach((button) => {
    button.addEventListener('click', function () {
      applyBasemap(button.dataset.basemap);
    });
  });

  map.on('load', function () {
    markParkReference();
    updateLocationReadout();
    const saved = localStorage.getItem('jp-basemap-preview');
    if (saved && saved !== 'light' && styles[saved]) {
      applyBasemap(saved);
    } else {
      setStatus('Light listo', true);
    }
  });

  map.on('moveend', updateLocationReadout);
  map.on('zoomend', updateLocationReadout);
  map.on('error', function (event) {
    console.error('[Basemaps Preview]', event && event.error ? event.error : event);
    setStatus('No se pudo cargar una parte del mapa. Revisa la consola.', false);
  });
})();
