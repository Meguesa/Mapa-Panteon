(function () {
  'use strict';

  const STYLE_ID = 'jp-public-ui-fixes-style';
  const INSTALL_FLAG = '__jpPublicUiFixesInstalled';
  const LOT_ZOOM_SCALE = 1.5; // 50% mas grande que el encuadre de la manzana.

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Header publico: titulo a la izquierda y controles cargados a la derecha. */
      body.public-map > header {
        width: 100% !important;
        max-width: none !important;
        box-sizing: border-box !important;
      }

      @media (min-width: 901px) {
        body.public-map > header {
          flex-wrap: nowrap !important;
          justify-content: flex-start !important;
        }

        body.public-map > header .title {
          margin-right: 16px !important;
          white-space: nowrap !important;
          flex: 0 0 auto !important;
        }

        body.public-map > header .controls {
          margin-left: auto !important;
          width: auto !important;
          max-width: none !important;
          min-width: 0 !important;
          flex: 0 1 auto !important;
          justify-content: flex-end !important;
          flex-wrap: nowrap !important;
        }
      }

      .jp-status-legend {
        margin-top: 12px;
        padding: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #fff;
      }

      .jp-status-legend-title {
        margin: 0 0 8px 0;
        font-size: 12px;
        font-weight: 800;
      }

      .jp-status-legend-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px 10px;
      }

      .jp-status-legend-item {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 12px;
      }

      .jp-status-legend-swatch {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        border: 1px solid rgba(17, 24, 39, 0.45);
        flex: 0 0 14px;
      }

      @media (max-width: 520px) {
        .jp-status-legend-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setPublicTitle() {
    try {
      const title = document.querySelector('body.public-map > header .title');
      if (title) title.textContent = 'Mapa del Panteón Jardines de Juan Pablo';
      document.title = 'Mapa del Panteón Jardines de Juan Pablo';
    } catch (_) {}
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
      'SAN PEDRO VIP': 'SPV',
      'SJV': 'SJV',
      'SMV': 'SMV',
      'SPV': 'SPV'
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

  function getFeatureIdentity(feature, item) {
    const p = feature && feature.properties ? feature.properties : {};
    let section = '';
    let manzana = '';
    let lote = '';

    try {
      section = currentSeccion || p.seccion || (item && item.seccion) || getPropSeccion(currentManzanaFeature) || '';
      manzana = p.manzana || p.manzanaId || getPropManzana(currentManzanaFeature) || (item && item.manzana) || '';
      lote = p.lote || p.id || p.codigo || (item && item.codigo) || '';
    } catch (_) {
      section = p.seccion || (item && item.seccion) || '';
      manzana = p.manzana || p.manzanaId || (item && item.manzana) || '';
      lote = p.lote || p.id || p.codigo || (item && item.codigo) || '';
    }

    return {
      section: String(section || '').trim(),
      manzana: String(manzana || '').trim(),
      lote: String(lote || '').trim()
    };
  }

  function inventoryCatalogItem(feature) {
    let inv = null;
    try {
      if (typeof getLoteInventoryItem === 'function') {
        inv = getLoteInventoryItem(feature);
      }
    } catch (_) {}

    if (!inv) return null;

    const identity = getFeatureIdentity(feature, inv);
    const section = identity.section || inv.seccion || '';
    const manzana = identity.manzana || inv.manzana || '';
    const lote = identity.lote || inv.codigo || '';

    let id = inv.clave_propiedad || inv.id || '';
    try {
      if (!id && typeof makeCatalogLoteId === 'function') {
        id = makeCatalogLoteId(section, manzana, lote);
      }
    } catch (_) {}
    if (!id) id = `LOTE-${section}-${manzana}-${lote}`;

    let status = inv.estatus || '';
    try {
      if (!status && typeof getLoteStatus === 'function') status = getLoteStatus(feature);
    } catch (_) {}

    return {
      ...inv,
      id,
      displayName: inv.displayName || `${section} - ${lote} - ${manzana}`,
      tipo: inv.tipo || 'lote',
      seccion: section,
      manzana,
      codigo: lote,
      estatus: status,
      observaciones: inv.observaciones || ''
    };
  }

  function correctedVipCatalogItem(item, feature) {
    if (!item) return item;

    const identity = getFeatureIdentity(feature, item);
    const section = identity.section || item.seccion || '';
    const manzana = identity.manzana || item.manzana || '';
    const lote = identity.lote || item.codigo || '';
    const code = vipSectionCode(section);

    if (!code || !lote || !manzana) return item;

    const vipName = `${code} - ${lote} - ${manzana}`;

    return {
      ...item,
      seccion: section,
      manzana,
      codigo: lote,
      displayName: vipName,
      referencia_procap: vipName
    };
  }

  function applyVipManzanaNames(features) {
    for (const feature of (features || [])) {
      const p = feature && feature.properties ? feature.properties : null;
      if (!p) continue;

      const section = p.seccion || '';
      const manzana = p.manzana || p.manzanaId || '';
      const code = vipSectionCode(section);

      if (!code || !manzana) continue;
      p.nombre = `${code} - ${String(manzana).trim()}`;
    }
  }

  function appendInventoryDetailsToFicha(item) {
    if (!item) return;

    const backBtn = document.getElementById('backToLoteInfoBtn');
    if (!backBtn || !backBtn.parentElement) return;
    if (document.getElementById('jpInventoryFichaDetails')) return;

    const rows = [];
    const capInh = Number(item.capacidad_inhumaciones);
    const useInh = Number(item.uso_inhumacion);
    const capCen = Number(item.capacidad_cenizas);
    const useCen = Number(item.usos_cenizas);

    if (Number.isFinite(capInh) && capInh > 0) {
      rows.push(`<p style="margin:2px 0;"><b>Inhumaciones:</b> ${Number.isFinite(useInh) ? useInh : 0} / ${capInh}</p>`);
    }
    if (Number.isFinite(capCen) && capCen > 0) {
      rows.push(`<p style="margin:2px 0;"><b>Cenizas:</b> ${Number.isFinite(useCen) ? useCen : 0} / ${capCen}</p>`);
    }
    if (item.finado) {
      rows.push(`<p style="margin:2px 0;"><b>Finado:</b> ${safe(item.finado)}</p>`);
    }
    if (item.fecha_actualizacion) {
      rows.push(`<p style="margin:2px 0;"><b>Actualizacion:</b> ${safe(item.fecha_actualizacion)}</p>`);
    }
    if (item.fuente_ultima_actualizacion) {
      rows.push(`<p style="margin:2px 0;"><b>Fuente:</b> ${safe(item.fuente_ultima_actualizacion)}</p>`);
    }

    if (!rows.length) return;

    const details = document.createElement('div');
    details.id = 'jpInventoryFichaDetails';
    details.innerHTML = `
      <hr/>
      <h4 style="margin:4px 0;">Informacion actualizada</h4>
      ${rows.join('')}
    `;
    backBtn.parentElement.insertBefore(details, backBtn);
  }

  function statusLegendHtml() {
    const statuses = [
      ['disponible', 'Disponible'],
      ['separado', 'Separado'],
      ['vendido', 'Vendido'],
      ['utilizado', 'Utilizado'],
      ['suspendido', 'Suspendido'],
      ['por_construir', 'Por construir'],
      ['sin_inventario', 'Sin inventario']
    ];

    const items = statuses.map(function (entry) {
      const status = entry[0];
      const label = entry[1];
      let style = {};
      try { style = styleByStatus(status) || {}; } catch (_) {}
      const fill = style.fillColor || style.color || '#9ca3af';
      const border = style.color || fill;
      const dash = style.dashArray ? 'border-style:dashed;' : '';

      return `
        <div class="jp-status-legend-item">
          <span class="jp-status-legend-swatch" style="background:${safe(fill)};border-color:${safe(border)};${dash}"></span>
          <span>${safe(label)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="jp-status-legend">
        <div class="jp-status-legend-title">Colores de disponibilidad</div>
        <div class="jp-status-legend-grid">${items}</div>
      </div>
    `;
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
    const prepared = (kind === 'section' || kind === 'manzana')
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

  function focusLotFiftyPercent(lotBounds, duration) {
    if (!lotBounds || typeof map === 'undefined' || !map) return;

    clearTimeout(pendingFocusTimer);
    pendingFocusTimer = window.setTimeout(function () {
      try { map.invalidateSize(true); } catch (_) {}

      window.requestAnimationFrame(function () {
        try {
          const manzanaBounds = featureBounds(currentManzanaFeature);
          let parentZoom = null;

          if (manzanaBounds && typeof map.getBoundsZoom === 'function') {
            parentZoom = map.getBoundsZoom(manzanaBounds.pad(0.04), false);
          }

          if (!Number.isFinite(parentZoom)) parentZoom = Number(map.getZoom());
          if (!Number.isFinite(parentZoom)) return;

          const zoomDelta = Math.log(LOT_ZOOM_SCALE) / Math.log(2);
          const maxZoom = Number(map.getMaxZoom());
          const targetZoom = Number.isFinite(maxZoom)
            ? Math.min(maxZoom, parentZoom + zoomDelta)
            : parentZoom + zoomDelta;
          const center = lotBounds.getCenter();
          const previousSnap = map.options.zoomSnap;

          map.options.zoomSnap = 0;
          try {
            map.flyTo(center, targetZoom, {
              animate: true,
              duration: Number(duration || 0.4),
              easeLinearity: 0.2
            });
          } finally {
            map.options.zoomSnap = previousSnap;
          }
        } catch (_) {
          try {
            map.panTo(lotBounds.getCenter(), { animate: true });
          } catch (_) {}
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
    setPublicTitle();

    /* Etiquetas de manzana VIP: SAN JUAN VIP - A -> SJV - A. */
    if (typeof renderManzanasLayer === 'function') {
      const originalRenderManzanasLayer = renderManzanasLayer;
      renderManzanasLayer = function (filteredFeatures, opts) {
        try { applyVipManzanaNames(filteredFeatures); } catch (_) {}
        return originalRenderManzanasLayer(filteredFeatures, opts);
      };
    }

    /*
      La ficha usa primero el catalogo. Si no existe, se construye con el
      inventario que ya alimenta el estatus del lote (SharePoint en portal).
    */
    const originalGetCatalogItem = getCatalogoItemForLoteFeature;
    getCatalogoItemForLoteFeature = function (feature) {
      const item = originalGetCatalogItem(feature) || inventoryCatalogItem(feature);
      return correctedVipCatalogItem(item, feature);
    };

    if (typeof showFichaPropiedad === 'function') {
      const originalShowFicha = showFichaPropiedad;
      showFichaPropiedad = function (catalogItem, feature) {
        const item = correctedVipCatalogItem(catalogItem || inventoryCatalogItem(feature), feature);
        const result = originalShowFicha(item, feature);
        try { appendInventoryDetailsToFicha(item); } catch (_) {}
        return result;
      };
    }

    /* Al entrar a una manzana, los lotes se muestran coloreados desde el inicio. */
    if (typeof loadLotesForCurrentManzana === 'function') {
      const originalLoadLotesForCurrentManzana = loadLotesForCurrentManzana;
      loadLotesForCurrentManzana = async function () {
        try { showAllLots = true; } catch (_) {}
        const result = await originalLoadLotesForCurrentManzana.apply(this, arguments);
        try {
          showAllLots = true;
          updateToggleLotsButton();
          applyFiltroEstatusToLotes();
          refreshManzanaPanel();
        } catch (_) {}
        return result;
      };
    }

    /* Leyenda de colores usando exactamente la paleta del mapa. */
    if (typeof getFiltroEstatusHtml === 'function') {
      const originalGetFiltroEstatusHtml = getFiltroEstatusHtml;
      getFiltroEstatusHtml = function () {
        return originalGetFiltroEstatusHtml.apply(this, arguments) + statusLegendHtml();
      };
    }

    /*
      Zoom jerarquico:
      - SECCION: encuadra toda la seccion despues del reflow del panel.
      - MANZANA: encuadra toda la manzana.
      - LOTE: aumenta la escala solo 50% respecto al encuadre de la manzana.
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

            if (!lotBounds && bounds) lotBounds = bounds;

            if (lotBounds) {
              focusLotFiftyPercent(lotBounds, 0.4);
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
            focusLotFiftyPercent(bounds, 0.4);
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

    console.info('[Mapa Panteon] Ajustes publicos instalados: header alineado, VIP abreviado, lotes visibles, leyenda, ficha y zoom jerarquico.');
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
