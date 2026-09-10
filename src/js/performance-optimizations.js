(function () {
  'use strict';

  const INSTALL_FLAG = '__jpPerformanceOptimizationsInstalled';
  const LOADER_ID = 'jp-performance-loader';
  let loaderTimer = null;
  let loaderDepth = 0;

  function ensureLoader() {
    let el = document.getElementById(LOADER_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = LOADER_ID;
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="jp-performance-loader-card"><span class="jp-performance-spinner"></span><span class="jp-performance-loader-text">Cargando…</span></div>';
    document.body.appendChild(el);

    const style = document.createElement('style');
    style.textContent = `
      #${LOADER_ID} {
        position: fixed;
        inset: 0;
        z-index: 12000;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.28);
        pointer-events: none;
      }
      #${LOADER_ID}.is-visible { display: flex; }
      .jp-performance-loader-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 11px 16px;
        border-radius: 12px;
        background: rgba(255,255,255,.96);
        color: #111827;
        box-shadow: 0 10px 32px rgba(0,0,0,.16);
        border: 1px solid rgba(17,24,39,.10);
        font-weight: 700;
        font-size: 14px;
      }
      .jp-performance-spinner {
        width: 18px;
        height: 18px;
        border: 2px solid #d1d5db;
        border-top-color: #265585;
        border-radius: 50%;
        animation: jp-performance-spin .7s linear infinite;
      }
      @keyframes jp-performance-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
    return el;
  }

  function beginLoading(message) {
    loaderDepth += 1;
    const el = ensureLoader();
    const text = el.querySelector('.jp-performance-loader-text');
    if (text && message) text.textContent = message;

    if (!loaderTimer) {
      loaderTimer = window.setTimeout(function () {
        loaderTimer = null;
        if (loaderDepth > 0) el.classList.add('is-visible');
      }, 450);
    }
  }

  function endLoading() {
    loaderDepth = Math.max(0, loaderDepth - 1);
    if (loaderDepth > 0) return;
    if (loaderTimer) {
      window.clearTimeout(loaderTimer);
      loaderTimer = null;
    }
    const el = document.getElementById(LOADER_ID);
    if (el) el.classList.remove('is-visible');
  }

  function installFastAnimations() {
    if (!window.L || !L.Map || L.Map.prototype.__jpFastAnimations) return;
    L.Map.prototype.__jpFastAnimations = true;

    const originalFlyToBounds = L.Map.prototype.flyToBounds;
    L.Map.prototype.flyToBounds = function (bounds, options) {
      const opts = { ...(options || {}) };
      if (opts.animate !== false) {
        opts.animate = true;
        opts.duration = Math.min(Number(opts.duration || 0.18), 0.22);
      }
      return originalFlyToBounds.call(this, bounds, opts);
    };

    const originalFlyTo = L.Map.prototype.flyTo;
    L.Map.prototype.flyTo = function (latlng, zoom, options) {
      const opts = { ...(options || {}) };
      if (opts.animate !== false) {
        opts.animate = true;
        opts.duration = Math.min(Number(opts.duration || 0.18), 0.22);
      }
      return originalFlyTo.call(this, latlng, zoom, opts);
    };
  }

  function applyLiveInventory(inventory) {
    if (!inventory || !Array.isArray(inventory.items)) return;
    try {
      if (typeof buildInventarioIndex === 'function') {
        inventarioBase = buildInventarioIndex(inventory);
      }
      if (typeof lotesLayer !== 'undefined' && lotesLayer) {
        try { applyFiltroEstatusToLotes(); } catch (_) {}
        try { refreshManzanaPanel(); } catch (_) {}
      }
    } catch (error) {
      console.warn('[Mapa] No fue posible refrescar la capa visible con inventario SharePoint.', error);
    }
  }

  window.addEventListener('jp-inventory-updated', function (event) {
    applyLiveInventory(event?.detail?.inventory);
  });

  function installOperationLoaders() {
    if (window[INSTALL_FLAG]) return true;

    let ready = false;
    try {
      ready = typeof loadLotesForCurrentManzana === 'function' && typeof map !== 'undefined' && !!map;
    } catch (_) {}
    if (!ready) return false;

    window[INSTALL_FLAG] = true;
    installFastAnimations();

    const originalLoadLots = loadLotesForCurrentManzana;
    loadLotesForCurrentManzana = async function () {
      beginLoading('Cargando manzana…');
      try {
        return await originalLoadLots.apply(this, arguments);
      } finally {
        endLoading();
      }
    };

    // Si SharePoint termino antes de que este modulo se instalara, aplicar ya
    // el inventario vivo para no esperar a un siguiente evento.
    try {
      const inventory = window.JP_INVENTORY_RUNTIME?.inventory;
      if (inventory) applyLiveInventory(inventory);
    } catch (_) {}

    console.info('[Mapa] Optimizaciones de rendimiento instaladas.');
    return true;
  }

  ensureLoader();
  installFastAnimations();

  if (!installOperationLoaders()) {
    let attempts = 0;
    const timer = window.setInterval(function () {
      attempts += 1;
      if (installOperationLoaders() || attempts >= 300) {
        window.clearInterval(timer);
      }
    }, 50);
  }
})();
