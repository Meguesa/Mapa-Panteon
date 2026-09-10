(function () {
  'use strict';

  const STATUS_META_LOTES = {
    disponible: { label: 'Disponible', color: '#2f855a' },
    separado: { label: 'Separado', color: '#d69e2e' },
    vendido: { label: 'Vendido', color: '#3182ce' },
    utilizado: { label: 'Utilizado', color: '#c53030' },
    suspendido: { label: 'Suspendido', color: '#6b46c1' },
    por_construir: { label: 'Por construir', color: '#718096' },
    sin_inventario: { label: 'Sin inventario', color: '#a0aec0' },
    desconocido: { label: 'Sin estado', color: '#a0aec0' },
  };

  let lastManzanaKey = '';

  function statusMeta(status) {
    const key = typeof normStatus === 'function' ? normStatus(status) : String(status || '').toLowerCase();
    return STATUS_META_LOTES[key] || STATUS_META_LOTES.desconocido;
  }

  function currentManzanaKey() {
    try {
      const sec = currentSeccion || getPropSeccion(currentManzanaFeature) || '';
      const man = getPropManzana(currentManzanaFeature) || '';
      return `${sec}|${man}`;
    } catch {
      return '';
    }
  }

  function layerMatchesCurrentFilter(layer) {
    if (!showAllLots) return false;

    const status = normStatus(getLoteStatus(layer?.feature));
    const active = normStatus(filtroEstatusActual || 'todos');

    if (!active || active === 'todos' || filtroEstatusActual === 'todos') return true;
    return status === active;
  }

  function syncLotInteractivity() {
    if (!lotesLayer || typeof lotesLayer.eachLayer !== 'function') return;

    lotesLayer.eachLayer((layer) => {
      const enabled = layerMatchesCurrentFilter(layer);

      // Leaflet decide si un Path es interactivo cuando crea el SVG. Por eso
      // nunca creamos los lotes con interactive:false; aqui solo controlamos
      // pointer-events segun si el lote esta visible por el filtro actual.
      try {
        layer.options.interactive = enabled;
      } catch {}

      try {
        const element = layer.getElement ? layer.getElement() : layer._path;
        if (element) {
          element.style.pointerEvents = enabled ? 'auto' : 'none';
          element.style.cursor = enabled ? 'pointer' : '';
        }
      } catch {}
    });
  }

  function ensureInitialLotVisibility() {
    const key = currentManzanaKey();
    if (!key || key === '|') return;
    if (lastManzanaKey === key) return;

    lastManzanaKey = key;
    showAllLots = true;
    filtroEstatusActual = 'todos';

    try { updateToggleLotsButton(); } catch {}
    try { applyFiltroEstatusToLotes(); } catch {}
    window.setTimeout(syncLotInteractivity, 0);
  }

  // Misma paleta, opacidad y seleccion visual que Nichos V2.
  styleByStatus = function (status) {
    const meta = statusMeta(status);
    return {
      color: meta.color,
      fillColor: meta.color,
      weight: 1,
      opacity: 1,
      fillOpacity: 0.58,
    };
  };

  // IMPORTANTE: no usar interactive:false aqui. Los lotes se crean ocultos y
  // despues se muestran; Leaflet no vuelve a registrar la interaccion SVG al
  // cambiar solamente el estilo. Ese era el motivo por el que se veian los
  // recuadros pero no respondian al clic.
  lotHiddenStyle = function () {
    return {
      weight: 1,
      opacity: 0,
      fillOpacity: 0,
    };
  };

  lotBaseStyle = function (status) {
    return showAllLots ? styleByStatus(status) : lotHiddenStyle();
  };

  lotPinnedStyle = function (status) {
    const style = styleByStatus(status);
    return {
      ...style,
      color: '#111827',
      weight: 4,
      opacity: 1,
      fillOpacity: 0.78,
    };
  };

  // Conserva la logica original de filtrado, pero sincroniza la capacidad de
  // clic con lo que realmente esta visible en pantalla.
  const originalApplyFiltroEstatusToLotes =
    typeof applyFiltroEstatusToLotes === 'function'
      ? applyFiltroEstatusToLotes
      : null;

  if (originalApplyFiltroEstatusToLotes) {
    applyFiltroEstatusToLotes = function () {
      const result = originalApplyFiltroEstatusToLotes.apply(this, arguments);
      window.requestAnimationFrame(syncLotInteractivity);
      return result;
    };
  }

  function legendHtml() {
    const order = ['disponible', 'separado', 'vendido', 'utilizado', 'suspendido', 'por_construir'];
    return `
      <div class="nv2-legend lot-nv2-legend">
        ${order.map((status) => {
          const meta = STATUS_META_LOTES[status];
          return `<span><i style="background:${meta.color}"></i>${safe(meta.label)}</span>`;
        }).join('')}
      </div>
    `;
  }

  function summaryHtml(counts) {
    const rows = [
      ['Total', counts.total],
      ['Disponible', counts.disponible],
      ['Separado', counts.separado],
      ['Vendido', counts.vendido],
      ['Utilizado', counts.utilizado],
      ['Suspendido', counts.suspendido],
      ['Por construir', counts.por_construir],
    ];

    if (counts.sin_inventario > 0) rows.push(['Sin inventario', counts.sin_inventario]);
    if (counts.desconocido > 0) rows.push(['Sin estado', counts.desconocido]);

    return `
      <dl class="nv2-summary lot-nv2-summary">
        ${rows.map(([label, value]) => `<div><dt>${safe(label)}</dt><dd>${safe(value)}</dd></div>`).join('')}
      </dl>
    `;
  }

  getFiltroEstatusHtml = function () {
    ensureInitialLotVisibility();
    const counts = getLotesStatusCounts();

    const filters = [
      ['todos', 'Todos', counts.total],
      ['disponible', 'Disponible', counts.disponible],
      ['separado', 'Separado', counts.separado],
      ['vendido', 'Vendido', counts.vendido],
      ['utilizado', 'Utilizado', counts.utilizado],
      ['suspendido', 'Suspendido', counts.suspendido],
      ['por_construir', 'Por construir', counts.por_construir],
      ['sin_inventario', 'Sin inventario', counts.sin_inventario],
    ];

    return `
      <div class="lot-nv2-section">
        <h4>Filtrar por estatus</h4>
        <div class="nv2-filter-grid lot-nv2-filters">
          ${filters
            .filter(([id, , count]) => id === 'todos' || count > 0)
            .map(([id, label, count]) => {
              const active = filtroEstatusActual === id && (id !== 'todos' || showAllLots);
              return `
                <button type="button" class="nv2-filter statusFilterBtn ${active ? 'active' : ''}" data-status="${safe(id)}">
                  ${safe(label)} <strong>${safe(count)}</strong>
                </button>
              `;
            }).join('')}
        </div>
      </div>

      <div class="lot-nv2-section">
        <h4>Leyenda</h4>
        ${legendHtml()}
      </div>

      <div class="lot-nv2-section">
        <h4>Resumen</h4>
        ${summaryHtml(counts)}
      </div>
    `;
  };

  bindFiltroEstatusButtons = function () {
    document.querySelectorAll('.statusFilterBtn').forEach((button) => {
      button.onclick = () => {
        const nextStatus = button.getAttribute('data-status') || 'todos';

        if (nextStatus === 'todos') {
          if (filtroEstatusActual === 'todos') {
            showAllLots = !showAllLots;
          } else {
            filtroEstatusActual = 'todos';
            showAllLots = true;
          }
        } else {
          filtroEstatusActual = nextStatus;
          showAllLots = true;
        }

        try { updateToggleLotsButton(); } catch {}
        applyFiltroEstatusToLotes();
        refreshManzanaPanel();
        window.requestAnimationFrame(syncLotInteractivity);
      };
    });
  };

  // Panel seleccionado con el mismo lenguaje visual de Nichos V2.
  showLoteInfo = function (feature) {
    const props = feature?.properties || {};
    const loteVal = String(props.lote || props.id || props.codigo || '').trim();
    const inv = getLoteInventoryItem(feature);
    const status = getLoteStatus(feature);
    const meta = statusMeta(status);
    const sec = currentSeccion || getPropSeccion(currentManzanaFeature) || props.seccion || '';
    const man = getPropManzana(currentManzanaFeature) || props.manzana || props.manzanaId || '';
    const catalogItem = getCatalogoItemForLoteFeature(feature);
    const referencia = inv?.referencia_procap || catalogItem?.referencia_procap || `${sec} - ${String(loteVal).padStart(3, '0')} - ${man}`;
    const construido = inv?.esta_construido === true ? 'Sí' : inv?.esta_construido === false ? 'No' : '-';
    const usosInhum = Number(inv?.usos_inhumaciones ?? inv?.inhumaciones ?? 0);
    const capInhum = Number(inv?.capacidad_inhumaciones ?? inv?.capacidad_inhumacion ?? 4);
    const usosCen = Number(inv?.usos_cenizas ?? 0);
    const capCen = Number(inv?.capacidad_cenizas ?? 4);

    setPanel(`SECCIÓN ${safe(sec)} — MANZANA ${safe(man)}`, `
      <div class="lot-nv2-section lot-nv2-selected-section">
        <h4>Lote seleccionado</h4>
        <div class="nv2-selected-card lot-nv2-selected-card">
          <div class="nv2-selected-code">${safe(loteVal || '-')}</div>
          <dl>
            <div><dt>Sección</dt><dd>${safe(sec || '-')}</dd></div>
            <div><dt>Manzana</dt><dd>${safe(man || '-')}</dd></div>
            <div><dt>Referencia mapa</dt><dd>${safe(referencia || '-')}</dd></div>
            <div><dt>Estatus</dt><dd><span class="nv2-status-pill" style="--pill:${meta.color}">${safe(meta.label)}</span></dd></div>
            <div><dt>Construido</dt><dd>${safe(construido)}</dd></div>
            <div><dt>Referencia ProCaP</dt><dd>${safe(inv?.referencia_procap || catalogItem?.referencia_procap || '-')}</dd></div>
            <div><dt>Inhumaciones</dt><dd>${safe(usosInhum)} / ${safe(capInhum)}</dd></div>
            <div><dt>Cenizas</dt><dd>${safe(usosCen)} / ${safe(capCen)}</dd></div>
            ${inv?.finado ? `<div><dt>Finado</dt><dd>${safe(inv.finado)}</dd></div>` : ''}
          </dl>
        </div>
      </div>
      ${getFiltroEstatusHtml()}
    `);

    bindFiltroEstatusButtons();
    window.requestAnimationFrame(syncLotInteractivity);
  };

  // Oculta el boton global Mostrar/Ocultar lotes: ahora "Todos" cumple esa funcion.
  function hideLegacyToggle() {
    const button = document.getElementById('toggleLotsBtn');
    if (button) button.style.display = 'none';
  }

  hideLegacyToggle();
  window.setTimeout(hideLegacyToggle, 100);
  window.setTimeout(hideLegacyToggle, 500);
  window.setTimeout(syncLotInteractivity, 250);

  console.info('[Mapa] Lotes alineados visual y funcionalmente con Nichos V2; seleccion por clic habilitada.');
})();
