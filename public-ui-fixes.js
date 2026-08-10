(function () {
  'use strict';

  const STYLE_ID = 'jp-public-ui-fixes-style';
  const INSTALL_FLAG = '__jpPublicUiFixesInstalled';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Header publico: apenas mayor que su contenido, no de extremo a extremo. */
      @media (min-width: 901px) {
        body.public-map > header {
          width: max-content !important;
          max-width: calc(100vw - 16px) !important;
          padding-left: 14px !important;
          padding-right: 14px !important;
          justify-content: flex-start !important;
        }

        body.public-map > header .title {
          margin-right: 8px !important;
        }

        body.public-map > header .controls {
          margin-left: 0 !important;
          width: auto !important;
          max-width: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeSectionName(value) {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  }

  function vipSectionCode(section) {
    const sec = normalizeSectionName(section);
    const known = {
      'SAN JUAN VIP': 'SJV',
      'SAN MATEO VIP': 'SMV',
      'SAN PEDRO VIP': 'SPV'
    };

    if (known[sec]) return known[sec];
    if (!sec.endsWith(' VIP')) return null;

    const base = sec.replace(/\s+VIP$/, '').trim();
    const initials = base
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part.charAt(0))
      .join('');

    return initials ? `${initials}V` : null;
  }

  function correctedVipCatalogItem(item, feature) {
    if (!item) return item;

    let section = item.seccion || '';
    let manzana = item.manzana || '';
    let lote = item.codigo || '';

    try {
      const p = feature && feature.properties ? feature.properties : {};
      section = section || p.seccion || currentSeccion || getPropSeccion(currentManzanaFeature);
      manzana = manzana || p.manzana || p.manzanaId || getPropManzana(currentManzanaFeature);
      lote = lote || p.lote || p.codigo || p.id || '';
    } catch (_) {}

    const code = vipSectionCode(section);
    if (!code || !lote || !manzana) return item;

    return {
      ...item,
      referencia_procap: `${code} - ${String(lote).trim()} - ${String(manzana).trim()}`
    };
  }

  function featureBounds(feature) {
    if (!feature || typeof L === 'undefined') return null;

    try {
      if (typeof isCircleFeature === 'function' && isCircleFeature(feature)) {
        const xy = feature.geometry && feature.geometry.coordinates;
        const radius = Number(feature.properties && feature.properties.radius || 0);
        if (!xy || xy.length < 2) return null;
        return L.latLngBounds(
          [Number(xy[1]) - radius, Number(xy[0]) - radius],
          [Number(xy[1]) + radius, Number(xy[0]) + radius]
        );
      }
    } catch (_) {}

    try {
      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();
      return bounds && bounds.isValid() ? bounds : null;
    } catch (_) {
      return null;
    }
  }

  function fullMapBounds() {
    try {
      const width = Number(DATA_COORD_WIDTH) * Number(COORD_SCALE_X || 1);
      const height = Number(DATA_COORD_HEIGHT) * Number(COORD_SCALE_Y || 1);
      if (width > 0 && height > 0) {
        return L.latLngBounds([0, 0], [height, width]);
      }
    } catch (_) {}
    return null;
  }

  let pendingFocusTimer = null;

  function focusBoundsAfterLayout(bounds, options) {
    if (!bounds || typeof map === 'undefined' || !map) return;

    const opts = options || {};
    const kind = opts.kind || 'normal';
    const duration = Number(opts.duration || 0.5);
    const prepared = kind === 'lot'
      ? bounds.pad(0.50)
      : (kind === 'section' || kind === 'manzana')
        ? bounds.pad(0.04)
        : bounds;

    clearTimeout(pendingFocusTimer);
    pendingFocusTimer = window.setTimeout(function () {
      try { map.invalidateSize(true); } catch (_) {}

      window.requestAnimationFrame(function () {
        try {
          if (typeof IS_MOBILE !== 'undefined' && IS_MOBILE) {
            map.fitBounds(prepared);
          } else {
            map.flyToBounds(prepared, {
              animate: true,
              duration,
              easeLinearity: 0.2
            });
          }
        } catch (_) {
          try { map.fitBounds(prepared); } catch (_) {}
        }
      });
    }, 95);
  }

  function focusSection() {
    try {
      const bounds = featureBounds(currentSeccionFeature);
      if (bounds) focusBoundsAfterLayout(bounds, { kind: 'section', duration: 0.55 });
    } catch (_) {}
  }

  function focusManzana() {
    try {
      const bounds = featureBounds(currentManzanaFeature);
      if (bounds) focusBoundsAfterLayout(bounds, { kind: 'manzana', duration: 0.5 });
    } catch (_) {}
  }

  function focusFullMap() {
    const bounds = fullMapBounds();
    if (bounds) focusBoundsAfterLayout(bounds, { kind: 'full', duration: 0.55 });
  }

  function install() {
    if (window[INSTALL_FLAG]) return true;

    let ready = false;
    try {
      ready = (
        typeof map !== 'undefined' && !!map &&
        typeof flyToBoundsSmooth === 'function' &&
        typeof centerOnLayerNoZoom === 'function' &&
        typeof showPublicLevelSecciones === 'function' &&
        typeof showPublicLevelManzanas === 'function' &&
        typeof getCatalogoItemForLoteFeature === 'function'
      );
    } catch (_) {
      ready = false;
    }

    if (!ready) return false;
    window[INSTALL_FLAG] = true;

    /* Referencia ProcaP VIP: SECCION_ABREV - LOTE - MANZANA. */
    const originalGetCatalogItem = getCatalogoItemForLoteFeature;
    getCatalogoItemForLoteFeature = function (feature) {
      const item = originalGetCatalogItem(feature);
      return correctedVipCatalogItem(item, feature);
    };

    if (typeof showFichaPropiedad === 'function') {
      const originalShowFicha = showFichaPropiedad;
      showFichaPropiedad = function (catalogItem, feature) {
        return originalShowFicha(correctedVipCatalogItem(catalogItem, feature), feature);
      };
    }

    /*
      Zoom jerarquico:
      - SECCION: encuadra toda la seccion despues del reflow del panel.
      - MANZANA: encuadra toda la manzana.
      - LOTE: ocupa aprox. 50% de la vista (bounds.pad(0.50)).
    */
    const originalFlyToBoundsSmooth = flyToBoundsSmooth;
    flyToBoundsSmooth = function (bounds, durationSeconds, maxZoom) {
      try {
        if (typeof IS_EDIT !== 'undefined' && !IS_EDIT) {
          const duration = Number(durationSeconds || 0);

          if (duration <= 0.50 && typeof lotesLayer !== 'undefined' && lotesLayer && currentManzanaFeature) {
            let lotBounds = null;
            try {
              if (pinnedLotLayer && pinnedLotLayer.getBounds) {
                lotBounds = pinnedLotLayer.getBounds();
              }
            } catch (_) {}

            if (!lotBounds && bounds) {
              // El app actual ya manda pad(0.30/0.35); este ajuste lo lleva a ~50% de pantalla.
              try { lotBounds = bounds.pad(0.10); } catch (_) { lotBounds = bounds; }
              focusBoundsAfterLayout(lotBounds, { kind: 'full', duration: 0.4 });
              return;
            }

            if (lotBounds) {
              focusBoundsAfterLayout(lotBounds, { kind: 'lot', duration: 0.4 });
              return;
            }
          }

          if (currentManzanaFeature) {
            const manzanaBounds = featureBounds(currentManzanaFeature);
            if (manzanaBounds) {
              focusBoundsAfterLayout(manzanaBounds, { kind: 'manzana', duration: 0.5 });
              return;
            }
          }

          if (currentSeccionFeature) {
            const sectionBounds = featureBounds(currentSeccionFeature);
            if (sectionBounds) {
              focusBoundsAfterLayout(sectionBounds, { kind: 'section', duration: 0.55 });
              return;
            }
          }
        }
      } catch (_) {}

      return originalFlyToBoundsSmooth(bounds, durationSeconds, maxZoom);
    };

    const originalCenterOnLayerNoZoom = centerOnLayerNoZoom;
    centerOnLayerNoZoom = function (layer, paddingPx) {
      try {
        if (
          typeof IS_EDIT !== 'undefined' && !IS_EDIT &&
          typeof lotesLayer !== 'undefined' && lotesLayer &&
          currentManzanaFeature && layer
        ) {
          let bounds = null;
          if (layer.getBounds) bounds = layer.getBounds();
          else if (layer.feature) bounds = featureBounds(layer.feature);

          if (bounds) {
            focusBoundsAfterLayout(bounds, { kind: 'lot', duration: 0.4 });
            return;
          }
        }
      } catch (_) {}

      return originalCenterOnLayerNoZoom(layer, paddingPx);
    };

    /* Dropdown de seccion: conserva el mismo encuadre que un click sobre el mapa. */
    const sectionSelect = document.getElementById('sectionSelect');
    if (sectionSelect) {
      sectionSelect.addEventListener('change', function () {
        window.setTimeout(function () {
          try {
            const sec = (sectionSelect.value || '').trim();
            if (!sec) {
              focusFullMap();
              return;
            }

            const feature = (seccionesTopScaled && seccionesTopScaled.features || []).find(function (f) {
              return getPropSeccion(f) === sec;
            });

            if (feature) {
              currentSeccion = sec;
              currentSeccionFeature = feature;
              focusSection();
            }
          } catch (_) {}
        }, 30);
      });
    }

    /* Volver respeta la jerarquia real, no la mera existencia de lotesLayer. */
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function (event) {
        try {
          if (typeof IS_EDIT !== 'undefined' && IS_EDIT) return;
        } catch (_) {}

        event.preventDefault();
        event.stopImmediatePropagation();

        try {
          if (typeof nichosUI !== 'undefined' && nichosUI && nichosUI.open) {
            nichosClose();
            showPublicLevelSecciones();
            try { renderNichosZonasLayerPublic(); bringNichosZonasToFront(); } catch (_) {}
            focusFullMap();
            return;
          }
        } catch (_) {}

        /* LOTE -> MANZANA */
        try {
          if (pinnedLotLayer && currentManzanaFeature) {
            try {
              const status = getLoteStatus(pinnedLotLayer.feature);
              pinnedLotLayer.setStyle(lotBaseStyle(status));
            } catch (_) {}
            pinnedLotLayer = null;
            try { refreshManzanaPanel(); } catch (_) {}
            focusManzana();
            return;
          }
        } catch (_) {}

        /* MANZANA -> SECCION */
        try {
          if (currentManzanaFeature) {
            clearLotesLayer();
            pinnedLotLayer = null;
            currentManzanaFeature = null;
            showAllLots = false;
            try { updateToggleLotsButton(); } catch (_) {}

            if (currentSeccion) {
              showPublicLevelManzanas(currentSeccion);
              focusSection();
            } else {
              showPublicLevelSecciones();
              focusFullMap();
            }
            return;
          }
        } catch (_) {}

        /* SECCION -> MAPA COMPLETO */
        try {
          if (currentSeccion || manzanasLayer) {
            showPublicLevelSecciones();
            try { renderNichosZonasLayerPublic(); bringNichosZonasToFront(); } catch (_) {}
            focusFullMap();
            return;
          }
        } catch (_) {}

        try { showPublicLevelSecciones(); } catch (_) {}
        focusFullMap();
      }, true);
    }

    console.info('[Mapa Panteon] Ajustes publicos instalados: header compacto, VIP ProcaP y zoom jerarquico.');
    return true;
  }

  injectStyles();

  if (!install()) {
    let attempts = 0;
    const timer = window.setInterval(function () {
      attempts += 1;
      if (install() || attempts >= 240) {
        window.clearInterval(timer);
      }
    }, 50);
  }
})();
