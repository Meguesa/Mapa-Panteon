(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const active = params.get('route-editor') === '1' || params.get('edit') === 'rutas';
  if (!active) return;

  function installGuard(panel) {
    if (!panel || panel.dataset.jpRouteEventGuard === '1') return;
    panel.dataset.jpRouteEventGuard = '1';

    // El panel vive dentro de #map. Sin este bloqueo, los clicks de botones,
    // selects y controles burbujean hasta Leaflet y se interpretan como clicks
    // sobre el mapa, creando accidentalmente la entrada o un punto de ruta.
    if (window.L?.DomEvent) {
      try { L.DomEvent.disableClickPropagation(panel); } catch {}
      try { L.DomEvent.disableScrollPropagation(panel); } catch {}
    }

    // Bubble phase: primero se ejecuta el listener del botón/control y luego
    // detenemos la propagación antes de que llegue al contenedor de Leaflet.
    const stop = function (event) {
      event.stopPropagation();
    };

    [
      'click',
      'dblclick',
      'contextmenu',
      'mousedown',
      'mouseup',
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
      'wheel'
    ].forEach(function (type) {
      panel.addEventListener(type, stop, false);
    });

    console.info('[Rutas] Propagación de controles bloqueada; los clicks del panel ya no generan puntos.');
  }

  let attempts = 0;
  const timer = window.setInterval(function () {
    attempts += 1;
    const panel = document.querySelector('.jp-route-editor-panel');
    if (panel) {
      window.clearInterval(timer);
      installGuard(panel);
      return;
    }

    if (attempts > 300) {
      window.clearInterval(timer);
      console.warn('[Rutas] No se encontró el panel para instalar el bloqueo de eventos.');
    }
  }, 50);
})();
