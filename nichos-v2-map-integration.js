(function () {
  'use strict';

  const ENHANCED_FLAG = '__nichosV2HoverEnhanced';

  function isPreviewOpen() {
    return Boolean(document.getElementById('nichosV2Preview')?.classList.contains('is-open'));
  }

  function closePreviewFromBack(event) {
    if (!isPreviewOpen()) return;

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
    if (!button || button.dataset.nichosV2BackBound === '1') return false;

    button.dataset.nichosV2BackBound = '1';
    button.addEventListener('click', closePreviewFromBack, true);
    return true;
  }

  function zoneLabel(feature) {
    const p = feature?.properties || {};
    const id = (p.id || p.zonaId || p.columbarioId || '').toString().trim();
    const name = (p.nombre || p.label || '').toString().trim();
    return name || id || 'Zona de nichos';
  }

  function enhanceLayer(layer) {
    if (!layer || layer[ENHANCED_FLAG]) return;

    const feature = layer.feature;
    const properties = feature?.properties || {};
    const type = String(properties.tipo || 'zona').trim().toLowerCase();
    const zoneId = String(properties.id || properties.zonaId || properties.columbarioId || '').trim().toUpperCase();

    if (!['zona', 'columbario'].includes(type) && !['PLN', 'SPN'].includes(zoneId)) return;

    layer[ENHANCED_FLAG] = true;
    const label = zoneLabel(feature);

    try {
      layer.bindTooltip(label, {
        permanent: false,
        sticky: true,
        direction: 'top',
        opacity: 1,
        className: 'nv2-zone-name-tooltip',
        offset: [0, -6],
      });
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible enlazar tooltip de zona.', error);
    }

    layer.on('mouseover', () => {
      try { layer.openTooltip(); } catch {}
    });

    layer.on('mouseout', () => {
      try { layer.closeTooltip(); } catch {}
    });
  }

  function enhanceCurrentNicheZoneLayer() {
    try {
      if (typeof nichosZonasLayerPublic === 'undefined' || !nichosZonasLayerPublic?.eachLayer) {
        return false;
      }

      nichosZonasLayerPublic.eachLayer(enhanceLayer);
      try { nichosZonasLayerPublic.bringToFront(); } catch {}
      return true;
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible agregar etiquetas hover.', error);
      return false;
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
        window.setTimeout(enhanceCurrentNicheZoneLayer, 100);
        return result;
      };

      return true;
    } catch (error) {
      console.warn('[Nichos V2 Preview] No fue posible instalar hook de zonas.', error);
      return false;
    }
  }

  function install() {
    bindBackButton();
    installLayerHook();
    enhanceCurrentNicheZoneLayer();

    // Solo reintentamos durante el arranque para esperar a que app.js haya
    // creado el boton Volver y la capa de zonas. No usamos setInterval ni
    // MutationObserver permanentes: ambos provocaban trabajo innecesario y el
    // observer anterior podia entrar en un ciclo de mutaciones al abrir Nichos.
    let attempts = 0;
    const retryStartup = () => {
      attempts += 1;
      const backReady = bindBackButton() || Boolean(document.getElementById('backBtn')?.dataset.nichosV2BackBound);
      const hookReady = installLayerHook();
      const layerReady = enhanceCurrentNicheZoneLayer();

      if ((!backReady || !hookReady || !layerReady) && attempts < 20) {
        window.setTimeout(retryStartup, 250);
      }
    };

    window.setTimeout(retryStartup, 100);
    console.info('[Mapa] Integracion Nichos V2 instalada sin polling ni MutationObserver.');
  }

  install();
})();
