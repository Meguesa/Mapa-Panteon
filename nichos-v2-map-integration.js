(function () {
  'use strict';

  const ENHANCED_FLAG = '__nichosV2HoverEnhanced';
  let lastLayerRef = null;

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
    if (!button || button.dataset.nichosV2BackBound === '1') return;

    button.dataset.nichosV2BackBound = '1';
    button.addEventListener('click', closePreviewFromBack, true);
  }

  function ensurePanelControls() {
    const modal = document.getElementById('nichosV2Preview');
    if (!modal) return;

    const firstSection = modal.querySelector('.nv2-panel .nv2-panel-section:first-child');
    if (!firstSection) return;

    if (!firstSection.querySelector('.nv2-panel-close')) {
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'nv2-panel-close';
      closeButton.textContent = 'Cerrar';
      closeButton.addEventListener('click', () => window.NICHOS_V2_PREVIEW?.close?.());
      firstSection.appendChild(closeButton);
    }

    const filterSection = modal.querySelector('#nv2Filters')?.closest('.nv2-panel-section');
    if (filterSection && !filterSection.querySelector('.nv2-panel-current-filter')) {
      const current = document.createElement('p');
      current.className = 'nv2-panel-current-filter';
      current.innerHTML = 'Filtro actual: <b>todos</b>';
      filterSection.appendChild(current);
    }

    const activeFilter = modal.querySelector('#nv2Filters .nv2-filter.active');
    const currentFilter = filterSection?.querySelector('.nv2-panel-current-filter b');
    if (currentFilter) {
      const raw = activeFilter?.dataset?.filter || 'todos';
      currentFilter.textContent = raw;
    }
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

      if (lastLayerRef !== nichosZonasLayerPublic) {
        lastLayerRef = nichosZonasLayerPublic;
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
        window.setTimeout(enhanceCurrentNicheZoneLayer, 400);
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
    ensurePanelControls();

    window.setInterval(() => {
      bindBackButton();
      installLayerHook();
      enhanceCurrentNicheZoneLayer();
      ensurePanelControls();
    }, 500);

    console.info('[Mapa] Integración Nichos V2: panel, Volver y hover persistente instalados.');
  }

  install();
})();
