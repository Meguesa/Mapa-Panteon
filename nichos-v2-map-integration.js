(function () {
  'use strict';

  const ENHANCED_FLAG = '__nichosV2HoverEnhanced';

  function isPreviewOpen() {
    return Boolean(document.getElementById('nichosV2Preview')?.classList.contains('is-open'));
  }

  function closePreviewFromBack(event) {
    if (!isPreviewOpen()) return;

    // El boton Volver del mapa conserva su comportamiento normal cuando no
    // estamos dentro de Nichos V2. Mientras el preview esta abierto, Volver
    // significa exclusivamente regresar al mapa que estaba debajo.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    try {
      window.NICHOS_V2_PREVIEW?.close?.();
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible cerrar desde Volver.', error);
    }
  }

  function bindBackButton() {
    const button = document.getElementById('backBtn');
    if (!button || button.dataset.nichosV2BackBound === '1') return;

    button.dataset.nichosV2BackBound = '1';
    // Capture=true permite interceptar el click antes del listener normal de
    // app.js y evita que cambie de nivel mientras se esta cerrando Nichos V2.
    button.addEventListener('click', closePreviewFromBack, true);
  }

  function zoneLabel(feature) {
    const p = feature?.properties || {};
    const id = (p.id || p.zonaId || p.columbarioId || '').toString().trim();
    const name = (p.nombre || p.label || '').toString().trim();
    return name || id || 'Zona de nichos';
  }

  function enhanceCurrentNicheZoneLayer() {
    try {
      if (typeof nichosZonasLayerPublic === 'undefined' || !nichosZonasLayerPublic?.eachLayer) return;

      nichosZonasLayerPublic.eachLayer((layer) => {
        if (!layer || layer[ENHANCED_FLAG]) return;
        layer[ENHANCED_FLAG] = true;

        const label = zoneLabel(layer.feature);

        layer.on('mouseover', () => {
          try {
            if (typeof showHoverNameTooltip === 'function') {
              showHoverNameTooltip(layer, label, 'nicho');
            } else if (layer.bindTooltip) {
              layer.bindTooltip(label, {
                permanent: false,
                direction: 'top',
                className: 'hover-name-tooltip nicho',
                opacity: 0.96,
              }).openTooltip();
            }
          } catch {}
        });

        layer.on('mouseout', () => {
          try {
            if (typeof clearHoverNameTooltip === 'function') clearHoverNameTooltip();
            else layer.closeTooltip?.();
          } catch {}
        });
      });
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible agregar etiquetas hover.', error);
    }
  }

  function installLayerHook() {
    try {
      if (typeof renderNichosZonasLayerPublic !== 'function') return false;
      if (window.__nichosV2RenderHookInstalled) return true;

      window.__nichosV2RenderHookInstalled = true;
      const originalRender = renderNichosZonasLayerPublic;

      renderNichosZonasLayerPublic = function () {
        const result = originalRender.apply(this, arguments);
        window.setTimeout(enhanceCurrentNicheZoneLayer, 0);
        return result;
      };

      // La capa normalmente ya existe cuando este archivo se carga.
      enhanceCurrentNicheZoneLayer();
      return true;
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible instalar hook de zonas.', error);
      return false;
    }
  }

  function install() {
    bindBackButton();
    installLayerHook();

    // Reintenta por unos segundos porque app.js carga de forma dinamica.
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      bindBackButton();
      const layerHookReady = installLayerHook();
      enhanceCurrentNicheZoneLayer();

      if (layerHookReady && Date.now() - startedAt > 1500) {
        window.clearInterval(timer);
      } else if (Date.now() - startedAt > 15000) {
        window.clearInterval(timer);
      }
    }, 250);

    console.info('[Mapa] Integracion de Nichos V2: Volver + hover de zonas instalada.');
  }

  install();
})();
