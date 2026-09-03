(function () {
  'use strict';

  const PREVIEW_ROOT = '/mapa/preview-nichos-v2';
  const INVENTORY_URL = './data/inventario-base.json';

  const ZONES = {
    PLN: {
      label: 'BUEN PASTOR NICHOS',
      sides: {
        concavo: {
          label: 'Cóncavo',
          image: `${PREVIEW_ROOT}/assets/PLN-concavo.png`,
          geometry: `${PREVIEW_ROOT}/data/PLN-concavo.geojson`,
        },
        convexo: {
          label: 'Convexo',
          image: `${PREVIEW_ROOT}/assets/PLN-convexo.png`,
          geometry: `${PREVIEW_ROOT}/data/PLN-convexo.geojson`,
        },
      },
    },
    SPN: {
      label: 'SAN PEDRO NICHOS',
      sides: {
        concavo: {
          label: 'Cóncavo',
          image: `${PREVIEW_ROOT}/assets/SPN-concavo.png`,
          geometry: `${PREVIEW_ROOT}/data/SPN-concavo.geojson`,
        },
      },
    },
  };

  const STATUS_META = {
    disponible: { label: 'Disponible', css: '--nv2-status-available' },
    separado: { label: 'Separado', css: '--nv2-status-reserved' },
    vendido: { label: 'Vendido', css: '--nv2-status-sold' },
    utilizado: { label: 'Utilizado', css: '--nv2-status-used' },
    suspendido: { label: 'Suspendido', css: '--nv2-status-suspended' },
    por_construir: { label: 'Por construir', css: '--nv2-status-unbuilt' },
    desconocido: { label: 'Sin estado', css: '--nv2-status-unknown' },
  };

  const state = {
    modal: null,
    map: null,
    imageLayer: null,
    nicheLayer: null,
    zoneFeature: null,
    zoneId: null,
    side: null,
    featureCollection: null,
    selectedFeature: null,
    activeFilter: 'todos',
    inventory: null,
    inventoryIndex: new Map(),
    inventoryPromise: null,
    imageBounds: null,
    bodyOverflow: '',
    loadToken: 0,
  };

  function stripDiacritics(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeUpper(value) {
    return stripDiacritics(value).trim().toUpperCase();
  }

  function normalizeLower(value) {
    return stripDiacritics(value).trim().toLowerCase();
  }

  function normalizeSide(value) {
    const side = normalizeLower(value);
    if (side.includes('concav')) return 'concavo';
    if (side.includes('convex')) return 'convexo';
    return side;
  }

  function normalizeStatus(value) {
    const status = normalizeLower(value).replace(/\s+/g, '_');

    if (['disponible', 'libre'].includes(status)) return 'disponible';
    if (['separado', 'separada', 'apartado', 'apartada'].includes(status)) return 'separado';
    if (['vendido', 'vendida'].includes(status)) return 'vendido';
    if (['utilizado', 'utilizada', 'ocupado', 'ocupada', 'usado', 'usada', 'parcialmente_utilizado', 'parcialmente_utilizada'].includes(status)) return 'utilizado';
    if (['suspendido', 'suspendida'].includes(status)) return 'suspendido';
    if (['por_construir', 'no_construida', 'no_construido'].includes(status)) return 'por_construir';

    return status || 'desconocido';
  }

  function safe(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getZoneId(zoneFeature) {
    const properties = zoneFeature?.properties ?? zoneFeature ?? {};
    return normalizeUpper(properties.id || properties.zonaId || properties.columbarioId);
  }

  function getZoneLabel(zoneFeature, zoneId) {
    const properties = zoneFeature?.properties ?? zoneFeature ?? {};
    return properties.nombre || ZONES[zoneId]?.label || zoneId;
  }

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function statusColor(status) {
    const meta = STATUS_META[status] || STATUS_META.desconocido;
    const fallbacks = {
      disponible: '#2e8b57',
      separado: '#d69e2e',
      vendido: '#3182ce',
      utilizado: '#c53030',
      suspendido: '#6b46c1',
      por_construir: '#718096',
      desconocido: '#a0aec0',
    };
    return cssVar(meta.css, fallbacks[status] || fallbacks.desconocido);
  }

  function geometryIdentity(properties) {
    const p = properties ?? {};
    const zone = normalizeUpper(p.zonaId || state.zoneId);
    const side = normalizeSide(p.cara || state.side);

    let row = normalizeUpper(p.fila);
    let number = String(p.numero ?? '').trim();

    if ((!row || !number) && p.codigo) {
      const match = normalizeUpper(p.codigo).match(/^([A-Z]+)0*(\d+)$/);
      if (match) {
        row = row || match[1];
        number = number || String(Number(match[2]));
      }
    }

    if (!zone || !side || !row || !number) {
      return { zone, side, row, number, inventoryCode: '' };
    }

    const normalizedNumber = /^\d+$/.test(number)
      ? String(Number(number)).padStart(2, '0')
      : normalizeUpper(number);

    return {
      zone,
      side,
      row,
      number,
      inventoryCode: `${zone}-${normalizedNumber}-${row}`,
    };
  }

  function inventoryKey(zone, side, code) {
    return [normalizeUpper(zone), normalizeSide(side), normalizeUpper(code)].join('|');
  }

  function rebuildInventoryIndex() {
    state.inventoryIndex.clear();

    const items = Array.isArray(state.inventory?.items) ? state.inventory.items : [];
    for (const item of items) {
      if (normalizeLower(item?.tipo) !== 'nicho') continue;
      const key = inventoryKey(item.zonaId || item.seccion, item.cara, item.codigo);
      if (key !== '||') state.inventoryIndex.set(key, item);
    }
  }

  async function loadInventory() {
    if (state.inventory) return state.inventory;
    if (state.inventoryPromise) return state.inventoryPromise;

    state.inventoryPromise = fetch(INVENTORY_URL, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((inventory) => {
        state.inventory = inventory;
        rebuildInventoryIndex();
        return inventory;
      })
      .catch((error) => {
        console.warn('[Nichos V2 Preview] No fue posible cargar inventario:', error);
        state.inventory = { items: [] };
        rebuildInventoryIndex();
        return state.inventory;
      })
      .finally(() => {
        state.inventoryPromise = null;
      });

    return state.inventoryPromise;
  }

  function getInventoryRecord(feature) {
    const identity = geometryIdentity(feature?.properties);
    if (!identity.inventoryCode) return null;

    const direct = state.inventoryIndex.get(
      inventoryKey(identity.zone, identity.side, identity.inventoryCode),
    );
    if (direct) return direct;

    const p = feature?.properties ?? {};
    const reference = normalizeUpper(p.referencia_procap);
    if (!reference) return null;

    const items = Array.isArray(state.inventory?.items) ? state.inventory.items : [];
    return items.find((item) => normalizeUpper(item?.referencia_procap) === reference) || null;
  }

  function getFeatureStatus(feature) {
    const inventory = getInventoryRecord(feature);
    if (inventory?.estatus) return normalizeStatus(inventory.estatus);

    const p = feature?.properties ?? {};
    const occupancy = normalizeStatus(p.estatus_ocupacion);
    if (occupancy === 'utilizado') return 'utilizado';

    return normalizeStatus(p.estatus_venta || p.estatus || 'desconocido');
  }

  function ensureModal() {
    if (state.modal) return state.modal;

    const modal = document.createElement('div');
    modal.id = 'nichosV2Preview';
    modal.className = 'nv2-backdrop';
    modal.innerHTML = `
      <section class="nv2-shell" role="dialog" aria-modal="true" aria-labelledby="nv2Title">
        <header class="nv2-header">
          <div>
            <div class="nv2-title-row">
              <h2 id="nv2Title">Nichos</h2>
              <span class="nv2-badge">PREVIEW V2</span>
            </div>
            <p id="nv2Subtitle">Vista de prueba basada en Sabbathycal/Mapa-Panteon V2</p>
          </div>
          <button id="nv2Close" type="button" class="nv2-close">Cerrar</button>
        </header>

        <div class="nv2-body">
          <div class="nv2-map-pane">
            <div id="nv2Map" class="nv2-map"></div>
            <button id="nv2Recenter" type="button" class="nv2-recenter" title="Centrar vista">◎</button>
            <div id="nv2Loading" class="nv2-loading" hidden>
              <div class="nv2-loading-card">Cargando nichos…</div>
            </div>
          </div>

          <aside class="nv2-panel">
            <section class="nv2-panel-section">
              <div class="nv2-eyebrow">Zona de nichos</div>
              <h3 id="nv2ZoneName">—</h3>
              <div id="nv2InventorySource" class="nv2-source"></div>
            </section>

            <section class="nv2-panel-section">
              <h4>Caras disponibles</h4>
              <div id="nv2Sides" class="nv2-chip-grid"></div>
            </section>

            <section class="nv2-panel-section">
              <h4>Filtrar por estatus</h4>
              <div id="nv2Filters" class="nv2-filter-grid"></div>
            </section>

            <section class="nv2-panel-section">
              <h4>Leyenda</h4>
              <div id="nv2Legend" class="nv2-legend"></div>
            </section>

            <section class="nv2-panel-section">
              <h4>Resumen</h4>
              <dl id="nv2Summary" class="nv2-summary"></dl>
            </section>

            <section class="nv2-panel-section nv2-selected-section">
              <h4>Nicho seleccionado</h4>
              <div id="nv2Selected" class="nv2-selected-empty">Selecciona un nicho en el mapa.</div>
            </section>
          </aside>
        </div>
      </section>
    `;

    document.body.appendChild(modal);
    state.modal = modal;

    modal.querySelector('#nv2Close').addEventListener('click', closePreview);
    modal.querySelector('#nv2Recenter').addEventListener('click', recenter);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closePreview();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.modal?.classList.contains('is-open')) {
        closePreview();
      }
    });

    renderLegend();
    return modal;
  }

  function showLoading(show, message) {
    const loading = state.modal?.querySelector('#nv2Loading');
    if (!loading) return;
    loading.hidden = !show;
    const card = loading.querySelector('.nv2-loading-card');
    if (card && message) card.textContent = message;
  }

  function renderLegend() {
    const container = state.modal?.querySelector('#nv2Legend');
    if (!container) return;

    const order = ['disponible', 'separado', 'vendido', 'utilizado', 'suspendido', 'por_construir'];
    container.innerHTML = order
      .map((status) => {
        const meta = STATUS_META[status];
        return `<span><i style="background:${statusColor(status)}"></i>${safe(meta.label)}</span>`;
      })
      .join('');
  }

  function buildSummary() {
    const summary = {
      total: 0,
      disponible: 0,
      separado: 0,
      vendido: 0,
      utilizado: 0,
      suspendido: 0,
      por_construir: 0,
      desconocido: 0,
      construidos: 0,
      porConstruir: 0,
    };

    const features = state.featureCollection?.features ?? [];
    summary.total = features.length;

    for (const feature of features) {
      const status = getFeatureStatus(feature);
      summary[status] = (summary[status] || 0) + 1;

      const inventory = getInventoryRecord(feature);
      if (inventory?.esta_construido === true) summary.construidos += 1;
      if (inventory?.esta_construido === false) summary.porConstruir += 1;
    }

    return summary;
  }

  function renderSummaryAndFilters() {
    const summary = buildSummary();
    const summaryEl = state.modal?.querySelector('#nv2Summary');
    const filtersEl = state.modal?.querySelector('#nv2Filters');

    if (summaryEl) {
      const rows = [
        ['Total', summary.total],
        ['Disponible', summary.disponible],
        ['Separado', summary.separado],
        ['Vendido', summary.vendido],
        ['Utilizado', summary.utilizado],
        ['Suspendido', summary.suspendido],
        ['Por construir', summary.por_construir],
        ['Construidos', summary.construidos],
      ];
      if (summary.desconocido > 0) rows.push(['Sin estado', summary.desconocido]);

      summaryEl.innerHTML = rows
        .map(([label, value]) => `<div><dt>${safe(label)}</dt><dd>${value}</dd></div>`)
        .join('');
    }

    if (filtersEl) {
      const filters = [
        ['todos', 'Todos', summary.total],
        ['disponible', 'Disponible', summary.disponible],
        ['separado', 'Separado', summary.separado],
        ['vendido', 'Vendido', summary.vendido],
        ['utilizado', 'Utilizado', summary.utilizado],
        ['suspendido', 'Suspendido', summary.suspendido],
        ['por_construir', 'Por construir', summary.por_construir],
      ];

      filtersEl.innerHTML = filters
        .filter(([id, , count]) => id === 'todos' || count > 0)
        .map(([id, label, count]) => `
          <button type="button" class="nv2-filter ${state.activeFilter === id ? 'active' : ''}" data-filter="${id}">
            ${safe(label)} <strong>${count}</strong>
          </button>
        `)
        .join('');

      filtersEl.querySelectorAll('[data-filter]').forEach((button) => {
        button.addEventListener('click', () => {
          state.activeFilter = button.dataset.filter || 'todos';
          state.selectedFeature = null;
          renderSelected();
          renderSummaryAndFilters();
          renderNicheLayer();
        });
      });
    }
  }

  function renderSides() {
    const container = state.modal?.querySelector('#nv2Sides');
    if (!container) return;

    const sides = ZONES[state.zoneId]?.sides ?? {};
    container.innerHTML = Object.entries(sides)
      .map(([id, config]) => `
        <button type="button" class="nv2-side ${state.side === id ? 'active' : ''}" data-side="${id}">
          ${safe(config.label)}
        </button>
      `)
      .join('');

    container.querySelectorAll('[data-side]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextSide = button.dataset.side;
        if (!nextSide || nextSide === state.side) return;
        state.side = nextSide;
        state.activeFilter = 'todos';
        state.selectedFeature = null;
        renderSelected();
        renderSides();
        loadCurrentSide();
      });
    });
  }

  function renderSelected() {
    const container = state.modal?.querySelector('#nv2Selected');
    if (!container) return;

    const feature = state.selectedFeature;
    if (!feature) {
      container.className = 'nv2-selected-empty';
      container.innerHTML = 'Selecciona un nicho en el mapa.';
      return;
    }

    const p = feature.properties ?? {};
    const identity = geometryIdentity(p);
    const inventory = getInventoryRecord(feature);
    const status = getFeatureStatus(feature);
    const meta = STATUS_META[status] || STATUS_META.desconocido;

    container.className = 'nv2-selected-card';
    container.innerHTML = `
      <div class="nv2-selected-code">${safe(p.codigo || `${identity.row}${identity.number}` || identity.inventoryCode)}</div>
      <dl>
        <div><dt>Zona</dt><dd>${safe(identity.zone || state.zoneId)}</dd></div>
        <div><dt>Cara</dt><dd>${safe(ZONES[state.zoneId]?.sides?.[identity.side]?.label || identity.side)}</dd></div>
        <div><dt>Referencia mapa</dt><dd>${safe(identity.inventoryCode || '-')}</dd></div>
        <div><dt>Estado</dt><dd><span class="nv2-status-pill" style="--pill:${statusColor(status)}">${safe(meta.label)}</span></dd></div>
        <div><dt>Construido</dt><dd>${inventory?.esta_construido === true ? 'Sí' : inventory?.esta_construido === false ? 'No' : '-'}</dd></div>
        <div><dt>Referencia ProCaP</dt><dd>${safe(inventory?.referencia_procap || p.referencia_procap || '-')}</dd></div>
        <div><dt>Uso de cenizas</dt><dd>${inventory ? `${Number(inventory.usos_cenizas || 0)} / ${Number(inventory.capacidad_cenizas || 0)}` : '-'}</dd></div>
      </dl>
    `;
  }

  function featureStyle(feature) {
    const status = getFeatureStatus(feature);
    const selectedId = state.selectedFeature?.properties?.id || state.selectedFeature?.properties?.codigo;
    const featureId = feature?.properties?.id || feature?.properties?.codigo;
    const selected = selectedId && String(selectedId) === String(featureId);
    const color = statusColor(status);

    return {
      color: selected ? '#111827' : color,
      fillColor: color,
      weight: selected ? 4 : 1,
      opacity: 1,
      fillOpacity: selected ? 0.78 : 0.58,
    };
  }

  function filteredCollection() {
    const collection = state.featureCollection;
    if (!collection?.features) return { type: 'FeatureCollection', features: [] };
    if (state.activeFilter === 'todos') return collection;

    return {
      ...collection,
      features: collection.features.filter((feature) => getFeatureStatus(feature) === state.activeFilter),
    };
  }

  function renderNicheLayer() {
    if (!state.map || !state.featureCollection) return;

    if (state.nicheLayer) {
      state.nicheLayer.remove();
      state.nicheLayer = null;
    }

    state.nicheLayer = L.geoJSON(filteredCollection(), {
      style: featureStyle,
      onEachFeature(feature, layer) {
        const identity = geometryIdentity(feature.properties);
        const status = getFeatureStatus(feature);
        const label = feature?.properties?.codigo || `${identity.row}${identity.number}` || identity.inventoryCode;

        layer.bindTooltip(`${label} · ${STATUS_META[status]?.label || 'Sin estado'}`, {
          direction: 'top',
          opacity: 0.95,
        });

        layer.on('mouseover', () => {
          layer.setStyle({ weight: 2, fillOpacity: 0.36 });
          layer.bringToFront();
        });

        layer.on('mouseout', () => {
          layer.setStyle(featureStyle(feature));
        });

        layer.on('click', () => {
          state.selectedFeature = feature;
          renderSelected();
          renderNicheLayer();
          const bounds = layer.getBounds?.();
          if (bounds?.isValid()) {
            state.map.fitBounds(bounds, {
              animate: true,
              duration: 0.35,
              padding: [100, 100],
              maxZoom: 2,
            });
          }
        });
      },
    }).addTo(state.map);
  }

  function loadImageDimensions(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`No fue posible cargar ${source}`));
      image.src = source;
    });
  }

  async function fetchGeometry(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} al cargar ${url}`);
    return response.json();
  }

  async function loadCurrentSide() {
    const config = ZONES[state.zoneId]?.sides?.[state.side];
    if (!config || !state.map) return;

    const token = ++state.loadToken;
    showLoading(true, 'Cargando nichos…');

    try {
      const [dimensions, geometry] = await Promise.all([
        loadImageDimensions(config.image),
        fetchGeometry(config.geometry),
        loadInventory(),
      ]);

      if (token !== state.loadToken) return;

      state.featureCollection = geometry;
      state.selectedFeature = null;
      state.activeFilter = 'todos';

      if (state.imageLayer) {
        state.imageLayer.remove();
        state.imageLayer = null;
      }
      if (state.nicheLayer) {
        state.nicheLayer.remove();
        state.nicheLayer = null;
      }

      const bounds = [
        [0, 0],
        [dimensions.height, dimensions.width],
      ];
      state.imageBounds = bounds;

      state.imageLayer = L.imageOverlay(config.image, bounds).addTo(state.map);
      state.map.setMaxBounds(bounds);
      state.map.fitBounds(bounds, { animate: false, padding: [20, 20] });

      renderSummaryAndFilters();
      renderSelected();
      renderNicheLayer();

      const source = window.JP_INVENTORY_RUNTIME?.source || state.inventory?.source || 'respaldo';
      const sourceEl = state.modal?.querySelector('#nv2InventorySource');
      if (sourceEl) {
        sourceEl.textContent = source === 'sharepoint'
          ? 'Inventario: SharePoint'
          : `Inventario: ${source}`;
      }

      window.setTimeout(() => state.map?.invalidateSize(true), 50);
    } catch (error) {
      console.error('[Nichos V2 Preview] Error al cargar vista:', error);
      showLoading(true, `No fue posible cargar la vista: ${error.message}`);
      return;
    }

    showLoading(false);
  }

  function recenter() {
    if (!state.map) return;

    if (state.selectedFeature && state.nicheLayer) {
      let selectedLayer = null;
      const selectedId = state.selectedFeature?.properties?.id || state.selectedFeature?.properties?.codigo;
      state.nicheLayer.eachLayer((layer) => {
        const featureId = layer.feature?.properties?.id || layer.feature?.properties?.codigo;
        if (String(featureId) === String(selectedId)) selectedLayer = layer;
      });
      const selectedBounds = selectedLayer?.getBounds?.();
      if (selectedBounds?.isValid()) {
        state.map.fitBounds(selectedBounds, { padding: [100, 100], maxZoom: 2 });
        return;
      }
    }

    if (state.imageBounds) {
      state.map.fitBounds(state.imageBounds, { animate: true, padding: [20, 20] });
    }
  }

  async function openPreview(zoneFeature) {
    const zoneId = getZoneId(zoneFeature);
    if (!ZONES[zoneId]) {
      console.warn(`[Nichos V2 Preview] La zona ${zoneId || '(sin id)'} no está incluida en este preview.`);
      if (typeof window.__nichosOpenLegacy === 'function') {
        return window.__nichosOpenLegacy(zoneFeature);
      }
      return;
    }

    ensureModal();

    state.zoneFeature = zoneFeature;
    state.zoneId = zoneId;
    state.side = Object.keys(ZONES[zoneId].sides)[0] || 'concavo';
    state.activeFilter = 'todos';
    state.selectedFeature = null;

    state.modal.querySelector('#nv2ZoneName').textContent = getZoneLabel(zoneFeature, zoneId);
    state.modal.querySelector('#nv2Subtitle').textContent =
      `${getZoneLabel(zoneFeature, zoneId)} · geometría V2 sobre fotografía normalizada`;

    renderSides();
    renderSelected();

    state.bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    state.modal.classList.add('is-open');

    const legacyModal = document.getElementById('nichosModal');
    if (legacyModal) legacyModal.style.display = 'none';
    const olderModal = document.getElementById('nichoModal');
    if (olderModal) olderModal.style.display = 'none';

    if (!state.map) {
      state.map = L.map('nv2Map', {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 3,
        zoomSnap: 0.25,
        attributionControl: false,
        preferCanvas: true,
      });
    }

    window.setTimeout(() => state.map?.invalidateSize(true), 25);
    await loadCurrentSide();
  }

  function closePreview() {
    if (!state.modal) return;
    state.modal.classList.remove('is-open');
    document.body.style.overflow = state.bodyOverflow;
    state.selectedFeature = null;
    state.zoneFeature = null;
  }

  function installOverride() {
    if (typeof window.nichosOpen !== 'function') return false;

    if (!window.__nichosOpenLegacy) {
      window.__nichosOpenLegacy = window.nichosOpen;
    }

    window.nichosOpen = openPreview;
    window.NICHOS_V2_PREVIEW = {
      open: openPreview,
      close: closePreview,
      recenter,
      state,
    };

    console.info('[Mapa] Preview Nichos V2 instalado. Producción no fue reemplazada.');
    return true;
  }

  if (!installOverride()) {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (installOverride() || Date.now() - startedAt > 15000) {
        window.clearInterval(timer);
      }
    }, 100);
  }
})();
