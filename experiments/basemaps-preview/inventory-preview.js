(function () {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  const inventoryStatus = document.getElementById('inventoryLiveStatus');
  const lotSelected = document.getElementById('lotSelected');

  const state = {
    loaded: false,
    source: 'sharepoint',
    updatedAt: '',
    count: 0,
    lots: 0,
    error: '',
    index: new Map()
  };

  window.JP_SHAREPOINT_INVENTORY = state;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function norm(value) {
    return text(value).toUpperCase();
  }

  function normSection(value) {
    const section = norm(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const aliases = {
      SAB: 'PLATINO',
      SJV: 'SAN JUAN VIP',
      SMV: 'SAN MATEO VIP',
      SPV: 'SAN PEDRO VIP',
      SANJUANVIP: 'SAN JUAN VIP',
      SANMATEOVIP: 'SAN MATEO VIP',
      SANPEDROVIP: 'SAN PEDRO VIP'
    };

    return aliases[section] || section;
  }

  function normCode(value) {
    const code = norm(value);
    if (/^\d+$/.test(code)) return String(Number(code));
    return code;
  }

  function inventoryKey(section, manzana, code) {
    return [normSection(section), norm(manzana), normCode(code)].join('|');
  }

  function normalizeStatus(value) {
    const status = text(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s-]+/g, '_');

    if (['disponible', 'libre'].includes(status)) return 'disponible';
    if (['separado', 'separada', 'apartado', 'apartada'].includes(status)) return 'separado';
    if (['vendido', 'vendida'].includes(status)) return 'vendido';
    if (['utilizado', 'utilizada', 'ocupado', 'ocupada', 'usado', 'usada'].includes(status)) return 'utilizado';
    if (['suspendido', 'suspendida'].includes(status)) return 'suspendido';
    if (['por_construir', 'no_construido', 'no_construida'].includes(status)) return 'por_construir';
    return status;
  }

  function isFalseLike(value) {
    const v = text(value).toLowerCase();
    return ['false', '0', 'no', 'n', 'pendiente', 'por construir', 'por_construir'].includes(v);
  }

  function capacityIsFull(value) {
    const v = text(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return ['lleno', 'llena', 'completo', 'completa', 'sin capacidad', 'sin_capacidad', 'agotado', 'agotada'].includes(v);
  }

  function deriveVisualStatus(fields) {
    if (isFalseLike(fields.Esta_Construida)) return 'por_construir';

    const usage = normalizeStatus(fields.Estatus_Uso);
    if (usage === 'utilizado') return 'utilizado';

    if (capacityIsFull(fields.Estatus_Capacidad)) return 'utilizado';

    const sale = normalizeStatus(fields.Estatus_Venta);
    if (['disponible', 'separado', 'vendido', 'suspendido', 'por_construir'].includes(sale)) {
      return sale;
    }

    return usage || 'sin_inventario';
  }

  function parseReference(value) {
    const raw = text(value).toUpperCase();
    const match = raw.match(/^(.+?)\s*-\s*([A-Z0-9]+)\s*-\s*([A-Z0-9]+)$/);
    if (!match) return null;
    return {
      section: match[1],
      code: match[2],
      manzana: match[3]
    };
  }

  function itemUpdatedAt(fields) {
    return text(
      fields.Fecha_Actualizacion ||
      fields.Ultima_Actualizacion_Venta ||
      fields.Ultima_Actualizacion_Ocupacion ||
      fields.Fecha_Venta ||
      fields.Fecha_Uso
    );
  }

  function normalizeGraphItem(graphItem) {
    const fields = graphItem && graphItem.fields ? graphItem.fields : {};
    const type = norm(fields.Tipo_Propiedad || fields.Categoria);
    if (type && !type.includes('LOTE')) return null;

    let section = fields.Seccion;
    let manzana = fields.Manzana;
    let code = fields.Codigo;

    if (!section || !manzana || !code) {
      const parsed = parseReference(fields.Referencia_ProcaP || fields.Clave_Busqueda_Principal || fields.Title);
      if (parsed) {
        section = section || parsed.section;
        code = code || parsed.code;
        manzana = manzana || parsed.manzana;
      }
    }

    section = normSection(section);
    manzana = norm(manzana);
    code = normCode(code);

    if (!section || !manzana || !code) return null;

    return {
      key: inventoryKey(section, manzana, code),
      section,
      manzana,
      code,
      status: deriveVisualStatus(fields),
      updatedAt: itemUpdatedAt(fields),
      fields
    };
  }

  function preferItem(existing, incoming) {
    if (!existing) return incoming;
    const a = Date.parse(existing.updatedAt || '') || 0;
    const b = Date.parse(incoming.updatedAt || '') || 0;
    return b >= a ? incoming : existing;
  }

  function setInventoryStatus(message, isError) {
    if (!inventoryStatus) return;
    inventoryStatus.innerHTML = message;
    inventoryStatus.style.borderColor = isError ? '#efb1b1' : '';
  }

  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(value) {
    const raw = text(value);
    if (!raw) return '—';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    try {
      return new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    } catch (_) {
      return raw;
    }
  }

  async function loadInventory() {
    setInventoryStatus('<strong>Inventario SharePoint</strong><br>Conectando con la lista de propiedades…', false);

    try {
      const response = await originalFetch('../inventory.php?ts=' + Date.now(), {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) throw new Error('HTTP ' + response.status);

      const payload = await response.json();
      const items = Array.isArray(payload.graphItems) ? payload.graphItems : [];
      const index = new Map();
      let lotCount = 0;

      items.forEach(function (graphItem) {
        const normalized = normalizeGraphItem(graphItem);
        if (!normalized) return;
        lotCount += 1;
        index.set(normalized.key, preferItem(index.get(normalized.key), normalized));
      });

      state.loaded = true;
      state.source = payload.source || 'sharepoint';
      state.updatedAt = payload.updatedAt || '';
      state.count = items.length;
      state.lots = index.size;
      state.index = index;
      state.error = '';

      setInventoryStatus(
        '<strong>Inventario SharePoint conectado</strong><br>' +
        escapeHtml(index.size.toLocaleString('es-MX')) + ' lotes indexados · consulta ' +
        escapeHtml(formatDate(state.updatedAt)),
        false
      );

      decorateSelectedPanel();
      window.dispatchEvent(new CustomEvent('jp:sharepoint-inventory-ready', {
        detail: { lots: index.size, updatedAt: state.updatedAt }
      }));
    } catch (error) {
      state.loaded = false;
      state.error = error && error.message ? error.message : String(error);
      console.error('[Inventory Preview] No fue posible cargar SharePoint.', error);
      setInventoryStatus(
        '<strong>Inventario SharePoint no disponible</strong><br>Se conservarán temporalmente los estatus del GeoJSON para esta prueba.',
        true
      );
    }

    return state;
  }

  function isLotGeoJsonRequest(input) {
    const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    return /(?:^|\/)lotes\/(?:bronce|oro|plata|platino|sanjuanvip|sanmateovip|sanpedrovip)\/lotes\.geojson(?:\?|$)/i.test(url);
  }

  function mergeInventoryIntoGeoJson(data) {
    if (!data || !Array.isArray(data.features) || !state.loaded) return data;

    data.features.forEach(function (feature) {
      if (!feature) return;
      const props = feature.properties || (feature.properties = {});
      const section = props.seccion;
      const manzana = props.manzana || props.manzanaId;
      const code = props.lote || props.codigo || props.id;
      const key = inventoryKey(section, manzana, code);
      const item = state.index.get(key);

      if (!item) {
        props._inventorySource = 'geojson-fallback';
        props._inventoryMatched = false;
        return;
      }

      const fields = item.fields || {};
      props.estatus = item.status;
      props._inventorySource = 'sharepoint';
      props._inventoryMatched = true;
      props._spKey = key;
      props._spVenta = text(fields.Estatus_Venta);
      props._spUso = text(fields.Estatus_Uso);
      props._spOcupacion = text(fields.Estatus_Ocupacion);
      props._spCapacidad = text(fields.Estatus_Capacidad);
      props._spConstruida = text(fields.Esta_Construida);
      props._spReferencia = text(fields.Referencia_ProcaP || fields.Clave_Busqueda_Principal);
      props._spActualizacion = item.updatedAt;
      props._spCapInhumaciones = text(fields.Capacidad_Inhumaciones);
      props._spUsoInhumacion = text(fields.Uso_Inhumacion);
      props._spCapCenizas = text(fields.Capacidad_Cenizas);
      props._spUsosCenizas = text(fields.Usos_Cenizas);
    });

    return data;
  }

  const inventoryPromise = loadInventory();

  window.fetch = async function patchedFetch(input, init) {
    if (!isLotGeoJsonRequest(input)) {
      return originalFetch(input, init);
    }

    const results = await Promise.all([
      originalFetch(input, init),
      inventoryPromise
    ]);

    const response = results[0];
    if (!response.ok) return response;

    try {
      const data = await response.json();
      mergeInventoryIntoGeoJson(data);
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.warn('[Inventory Preview] No fue posible cruzar el GeoJSON.', error);
      return response;
    }
  };

  function readSelectedIdentity() {
    if (!lotSelected) return null;
    const title = lotSelected.querySelector('strong');
    const grid = lotSelected.querySelector('.lots-selected-grid');
    if (!title || !grid) return null;

    const lotMatch = title.textContent.match(/Lote\s+(.+)/i);
    if (!lotMatch) return null;

    const spans = Array.from(grid.querySelectorAll('span'));
    const values = {};
    for (let i = 0; i + 1 < spans.length; i += 2) {
      values[text(spans[i].textContent)] = text(spans[i + 1].textContent);
    }

    return {
      code: lotMatch[1],
      section: values['Sección'] || '',
      manzana: values['Manzana'] || ''
    };
  }

  function displayValue(value) {
    return escapeHtml(text(value) || '—');
  }

  function decorateSelectedPanel() {
    if (!lotSelected || !state.loaded) return;
    if (!lotSelected.textContent.includes('Estatus GeoJSON')) return;

    const identity = readSelectedIdentity();
    if (!identity) return;

    const key = inventoryKey(identity.section, identity.manzana, identity.code);
    const item = state.index.get(key);

    if (!item) {
      lotSelected.innerHTML = lotSelected.innerHTML.replace('Estatus GeoJSON', 'Estatus GeoJSON (sin match SP)');
      return;
    }

    const f = item.fields || {};
    const useInh = text(f.Uso_Inhumacion);
    const capInh = text(f.Capacidad_Inhumaciones);
    const useAsh = text(f.Usos_Cenizas);
    const capAsh = text(f.Capacidad_Cenizas);

    lotSelected.innerHTML = `
      <strong>Lote ${escapeHtml(identity.code)}</strong>
      <div class="lots-selected-grid">
        <span>Sección</span><span>${escapeHtml(item.section)}</span>
        <span>Manzana</span><span>${escapeHtml(item.manzana)}</span>
        <span>Estatus visual</span><span>${displayValue(item.status)}</span>
        <span>Venta</span><span>${displayValue(f.Estatus_Venta)}</span>
        <span>Uso</span><span>${displayValue(f.Estatus_Uso)}</span>
        <span>Ocupación</span><span>${displayValue(f.Estatus_Ocupacion)}</span>
        <span>Capacidad</span><span>${displayValue(f.Estatus_Capacidad)}</span>
        <span>Inhumaciones</span><span>${displayValue(useInh)} / ${displayValue(capInh)}</span>
        <span>Cenizas</span><span>${displayValue(useAsh)} / ${displayValue(capAsh)}</span>
        <span>Referencia ProCaP</span><span>${displayValue(f.Referencia_ProcaP || f.Clave_Busqueda_Principal)}</span>
        <span>Actualización</span><span>${displayValue(formatDate(item.updatedAt))}</span>
      </div>`;
  }

  if (lotSelected && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(function () {
      window.requestAnimationFrame(decorateSelectedPanel);
    });
    observer.observe(lotSelected, { childList: true, subtree: true, characterData: true });
  }

  console.info('[Inventory Preview] Integración SharePoint preparada.');
})();
