(function () {
  'use strict';

  const currentUrl = new URL(window.location.href);
  const editParam = currentUrl.searchParams.get('edit');
  const routeEditorParam = currentUrl.searchParams.get('route-editor');
  const ACTIVE = editParam === 'rutas' || routeEditorParam === '1';

  if (!ACTIVE) return;

  // Evitar que app.js interprete ?edit=rutas como un modo de edición nativo.
  // Conservamos la experiencia solicitada, pero reescribimos la URL antes de
  // que app.js lea location.search.
  if (editParam === 'rutas') {
    currentUrl.searchParams.delete('edit');
    currentUrl.searchParams.set('route-editor', '1');
    window.history.replaceState({}, '', currentUrl.pathname + '?' + currentUrl.searchParams.toString() + currentUrl.hash);
  }

  const DATA_URL = './data/rutas-panteon.geojson';
  const STORAGE_KEY = 'jp-route-editor-draft-v1';
  const SNAP_PIXELS = 16;
  const ROUTE_PANE = 'jpRouteEditorPane';

  let map = null;
  let routesCollection = emptyCollection();
  let baseCollection = emptyCollection();
  let committedGroup = null;
  let vertexGroup = null;
  let draftGroup = null;
  let panel = null;
  let mode = 'idle'; // idle | entrance | draw
  let draftCoords = [];
  let selectedRouteId = null;
  let showNodes = true;

  function emptyCollection() {
    return {
      type: 'FeatureCollection',
      name: 'rutas-panteon',
      properties: {
        schema: 'jp-routing-v1',
        coordinateSystem: 'CRS.Simple',
        description: 'Red interna de vialidades del Panteón Jardines de Juan Pablo'
      },
      features: []
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeCollection(raw) {
    const normalized = emptyCollection();
    const features = Array.isArray(raw?.features) ? raw.features : [];
    let routeCounter = 1;

    for (const feature of features) {
      if (!feature || feature.type !== 'Feature' || !feature.geometry) continue;
      const type = String(feature.properties?.tipo || '').toLowerCase();

      if (feature.geometry.type === 'Point' && type === 'entrada') {
        const c = feature.geometry.coordinates;
        if (!Array.isArray(c) || c.length < 2) continue;
        normalized.features = normalized.features.filter((item) => item.properties?.tipo !== 'entrada');
        normalized.features.push({
          type: 'Feature',
          properties: {
            tipo: 'entrada',
            id: String(feature.properties?.id || 'entrada-principal'),
            nombre: String(feature.properties?.nombre || 'Entrada principal')
          },
          geometry: {
            type: 'Point',
            coordinates: [Number(c[0]), Number(c[1])]
          }
        });
        continue;
      }

      if (feature.geometry.type === 'LineString' && type === 'vialidad') {
        const coords = (feature.geometry.coordinates || [])
          .filter((c) => Array.isArray(c) && c.length >= 2)
          .map((c) => [Number(c[0]), Number(c[1])])
          .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
        if (coords.length < 2) continue;

        const id = String(feature.properties?.id || `via-${String(routeCounter).padStart(3, '0')}`);
        routeCounter += 1;
        normalized.features.push({
          type: 'Feature',
          properties: {
            tipo: 'vialidad',
            id,
            nombre: String(feature.properties?.nombre || id),
            acceso: normalizeAccess(feature.properties?.acceso || 'vehicular'),
            sentido: String(feature.properties?.sentido || 'ambos')
          },
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        });
      }
    }

    normalized.properties = {
      ...normalized.properties,
      ...(raw?.properties || {}),
      schema: 'jp-routing-v1',
      coordinateSystem: 'CRS.Simple'
    };
    return normalized;
  }

  function normalizeAccess(value) {
    const v = String(value || '').toLowerCase();
    if (v === 'peatonal') return 'peatonal';
    if (v === 'ambos') return 'ambos';
    return 'vehicular';
  }

  function pointToCoord(latlng) {
    return [roundCoord(latlng.lng), roundCoord(latlng.lat)];
  }

  function coordToLatLng(coord) {
    return L.latLng(Number(coord[1]), Number(coord[0]));
  }

  function roundCoord(value) {
    return Math.round(Number(value) * 1000) / 1000;
  }

  function coordKey(coord) {
    return `${Number(coord[0]).toFixed(3)}|${Number(coord[1]).toFixed(3)}`;
  }

  function getRoutes() {
    return routesCollection.features.filter((feature) => feature.properties?.tipo === 'vialidad');
  }

  function getEntrance() {
    return routesCollection.features.find((feature) => feature.properties?.tipo === 'entrada') || null;
  }

  function getRouteById(id) {
    return getRoutes().find((feature) => feature.properties?.id === id) || null;
  }

  function nextRouteId() {
    let max = 0;
    for (const route of getRoutes()) {
      const match = String(route.properties?.id || '').match(/(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `via-${String(max + 1).padStart(3, '0')}`;
  }

  function allRouteVertices() {
    const result = [];
    for (const route of getRoutes()) {
      for (const coord of route.geometry.coordinates || []) {
        result.push({ coord, routeId: route.properties?.id || '' });
      }
    }
    return result;
  }

  function nearestExistingVertex(latlng, maxPixels = SNAP_PIXELS) {
    if (!map) return null;
    const target = map.latLngToContainerPoint(latlng);
    let best = null;
    let bestDistance = Infinity;

    for (const item of allRouteVertices()) {
      const point = map.latLngToContainerPoint(coordToLatLng(item.coord));
      const distance = target.distanceTo(point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = item;
      }
    }

    return best && bestDistance <= maxPixels ? { ...best, distance: bestDistance } : null;
  }

  function nearestPointOnRoute(route, latlng) {
    if (!map || !route?.geometry?.coordinates?.length) return null;
    const coords = route.geometry.coordinates;
    const target = map.latLngToContainerPoint(latlng);
    let best = null;

    for (let i = 0; i < coords.length - 1; i += 1) {
      const aCoord = coords[i];
      const bCoord = coords[i + 1];
      const a = map.latLngToContainerPoint(coordToLatLng(aCoord));
      const b = map.latLngToContainerPoint(coordToLatLng(bCoord));
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length2 = dx * dx + dy * dy;
      const tRaw = length2 > 0 ? ((target.x - a.x) * dx + (target.y - a.y) * dy) / length2 : 0;
      const t = Math.max(0, Math.min(1, tRaw));
      const projected = L.point(a.x + dx * t, a.y + dy * t);
      const distance = target.distanceTo(projected);

      if (!best || distance < best.distance) {
        best = { index: i, t, distance, aCoord, bCoord };
      }
    }

    return best;
  }

  function insertJunctionIntoRoute(route, latlng) {
    const nearest = nearestPointOnRoute(route, latlng);
    if (!nearest) return pointToCoord(latlng);

    if (nearest.t <= 0.03) return [...nearest.aCoord];
    if (nearest.t >= 0.97) return [...nearest.bCoord];

    const x = nearest.aCoord[0] + (nearest.bCoord[0] - nearest.aCoord[0]) * nearest.t;
    const y = nearest.aCoord[1] + (nearest.bCoord[1] - nearest.aCoord[1]) * nearest.t;
    const coord = [roundCoord(x), roundCoord(y)];

    const before = route.geometry.coordinates[nearest.index];
    const after = route.geometry.coordinates[nearest.index + 1];
    if (coordKey(before) !== coordKey(coord) && coordKey(after) !== coordKey(coord)) {
      route.geometry.coordinates.splice(nearest.index + 1, 0, coord);
      saveDraft();
    }
    return coord;
  }

  function snappedCoord(latlng) {
    const snapped = nearestExistingVertex(latlng);
    return snapped ? [...snapped.coord] : pointToCoord(latlng);
  }

  function routeStyle(feature, selected = false) {
    const access = normalizeAccess(feature?.properties?.acceso);
    let color = '#2563eb';
    if (access === 'peatonal') color = '#15803d';
    if (access === 'ambos') color = '#7c3aed';
    if (selected) color = '#f97316';
    return {
      color,
      weight: selected ? 7 : 5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    };
  }

  function ensurePane() {
    if (!map.getPane(ROUTE_PANE)) {
      const pane = map.createPane(ROUTE_PANE);
      pane.style.zIndex = '850';
      pane.style.pointerEvents = 'auto';
      pane.classList.add('jp-route-editor-pane');
    }
  }

  function clearLayerGroup(group) {
    try { group?.clearLayers(); } catch {}
  }

  function renderCommitted() {
    if (!map) return;
    ensurePane();
    clearLayerGroup(committedGroup);
    clearLayerGroup(vertexGroup);

    const entrance = getEntrance();
    if (entrance) {
      const marker = L.circleMarker(coordToLatLng(entrance.geometry.coordinates), {
        pane: ROUTE_PANE,
        radius: 9,
        color: '#14532d',
        weight: 3,
        fillColor: '#22c55e',
        fillOpacity: 1,
        interactive: false
      }).bindTooltip('Entrada principal', { permanent: false, direction: 'top' });
      marker.addTo(committedGroup);
    }

    for (const route of getRoutes()) {
      const selected = route.properties?.id === selectedRouteId;
      const polyline = L.polyline(
        route.geometry.coordinates.map(coordToLatLng),
        { ...routeStyle(route, selected), pane: ROUTE_PANE, interactive: true }
      );

      polyline.on('click', (event) => {
        if (mode === 'draw') {
          try { L.DomEvent.stopPropagation(event); } catch {}
          const coord = insertJunctionIntoRoute(route, event.latlng);
          addDraftCoord(coord);
          renderCommitted();
          renderDraft();
          return;
        }
        try { L.DomEvent.stopPropagation(event); } catch {}
        selectedRouteId = route.properties?.id || null;
        renderCommitted();
        updatePanel();
      });

      polyline.bindTooltip(`${route.properties?.id || 'Vialidad'} · ${labelAccess(route.properties?.acceso)}`, {
        sticky: true,
        direction: 'top'
      });
      polyline.addTo(committedGroup);

      if (showNodes) {
        for (const coord of route.geometry.coordinates) {
          L.circleMarker(coordToLatLng(coord), {
            pane: ROUTE_PANE,
            radius: 4,
            color: '#ffffff',
            weight: 2,
            fillColor: selected ? '#f97316' : '#173650',
            fillOpacity: 1,
            interactive: false,
            className: 'jp-route-editor-vertex'
          }).addTo(vertexGroup);
        }
      }
    }
  }

  function renderDraft() {
    clearLayerGroup(draftGroup);
    if (!draftCoords.length) return;

    if (draftCoords.length >= 2) {
      L.polyline(draftCoords.map(coordToLatLng), {
        pane: ROUTE_PANE,
        color: '#f59e0b',
        weight: 6,
        opacity: 0.95,
        dashArray: '10 7',
        interactive: false
      }).addTo(draftGroup);
    }

    draftCoords.forEach((coord, index) => {
      L.circleMarker(coordToLatLng(coord), {
        pane: ROUTE_PANE,
        radius: index === draftCoords.length - 1 ? 6 : 5,
        color: '#92400e',
        weight: 2,
        fillColor: '#fbbf24',
        fillOpacity: 1,
        interactive: false
      }).addTo(draftGroup);
    });
  }

  function labelAccess(value) {
    const access = normalizeAccess(value);
    if (access === 'peatonal') return 'Peatonal';
    if (access === 'ambos') return 'Vehicular + peatonal';
    return 'Vehicular';
  }

  function setEntrance(coord) {
    routesCollection.features = routesCollection.features.filter((feature) => feature.properties?.tipo !== 'entrada');
    routesCollection.features.unshift({
      type: 'Feature',
      properties: {
        tipo: 'entrada',
        id: 'entrada-principal',
        nombre: 'Entrada principal'
      },
      geometry: {
        type: 'Point',
        coordinates: coord
      }
    });
    saveDraft();
    renderCommitted();
  }

  function addDraftCoord(coord) {
    const last = draftCoords[draftCoords.length - 1];
    if (last && coordKey(last) === coordKey(coord)) return;
    draftCoords.push([roundCoord(coord[0]), roundCoord(coord[1])]);
    renderDraft();
    updatePanel();
  }

  function finishDraft() {
    if (draftCoords.length < 2) {
      notify('Agrega al menos dos puntos para crear una vialidad.');
      return;
    }

    const access = document.getElementById('jpRouteAccess')?.value || 'vehicular';
    const id = nextRouteId();
    routesCollection.features.push({
      type: 'Feature',
      properties: {
        tipo: 'vialidad',
        id,
        nombre: id,
        acceso: normalizeAccess(access),
        sentido: 'ambos'
      },
      geometry: {
        type: 'LineString',
        coordinates: draftCoords.map((coord) => [...coord])
      }
    });

    draftCoords = [];
    selectedRouteId = id;
    saveDraft();
    renderCommitted();
    renderDraft();
    updatePanel();
    notify(`Tramo ${id} guardado en el borrador local.`);
  }

  function cancelDraft() {
    draftCoords = [];
    renderDraft();
    updatePanel();
  }

  function deleteSelectedRoute() {
    if (!selectedRouteId) return;
    const route = getRouteById(selectedRouteId);
    if (!route) return;
    if (!window.confirm(`¿Eliminar ${selectedRouteId}?`)) return;
    routesCollection.features = routesCollection.features.filter((feature) => feature !== route);
    selectedRouteId = null;
    saveDraft();
    renderCommitted();
    updatePanel();
  }

  function saveDraft() {
    routesCollection.properties = {
      ...(routesCollection.properties || {}),
      schema: 'jp-routing-v1',
      coordinateSystem: 'CRS.Simple',
      updatedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(routesCollection));
    } catch (error) {
      console.warn('[Rutas] No se pudo guardar borrador local:', error);
    }
  }

  function exportCollection() {
    const data = normalizeCollection(routesCollection);
    data.properties = {
      ...(data.properties || {}),
      schema: 'jp-routing-v1',
      coordinateSystem: 'CRS.Simple',
      exportedAt: new Date().toISOString()
    };
    return data;
  }

  function downloadGeoJson() {
    const data = exportCollection();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'rutas-panteon.geojson';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    notify('GeoJSON descargado. Puedes enviarme ese archivo para integrarlo al repositorio.');
  }

  async function copyGeoJson() {
    const text = JSON.stringify(exportCollection(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      notify('GeoJSON copiado al portapapeles.');
    } catch {
      notify('No fue posible copiar automáticamente. Usa Descargar GeoJSON.');
    }
  }

  async function importGeoJson(file) {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      routesCollection = normalizeCollection(raw);
      draftCoords = [];
      selectedRouteId = null;
      saveDraft();
      renderCommitted();
      renderDraft();
      updatePanel();
      notify('Archivo de rutas cargado correctamente.');
    } catch (error) {
      console.error('[Rutas] Archivo inválido:', error);
      notify('No pude leer ese GeoJSON.');
    }
  }

  function resetToBase() {
    if (!window.confirm('¿Descartar el borrador local y volver al archivo base del repositorio?')) return;
    localStorage.removeItem(STORAGE_KEY);
    routesCollection = clone(baseCollection);
    draftCoords = [];
    selectedRouteId = null;
    renderCommitted();
    renderDraft();
    updatePanel();
    notify('Borrador local descartado.');
  }

  function clearAll() {
    if (!window.confirm('¿Borrar la entrada y todos los tramos del borrador?')) return;
    routesCollection = emptyCollection();
    draftCoords = [];
    selectedRouteId = null;
    saveDraft();
    renderCommitted();
    renderDraft();
    updatePanel();
  }

  function notify(message) {
    if (typeof window.toast === 'function') {
      try { window.toast(message, 2400); return; } catch {}
    }
    console.info('[Rutas]', message);
  }

  function graphStats() {
    const routes = getRoutes();
    const adjacency = new Map();
    const uniqueNodes = new Map();

    function ensureNode(coord) {
      const key = coordKey(coord);
      if (!adjacency.has(key)) adjacency.set(key, new Set());
      if (!uniqueNodes.has(key)) uniqueNodes.set(key, coord);
      return key;
    }

    for (const route of routes) {
      const coords = route.geometry.coordinates || [];
      for (let i = 0; i < coords.length; i += 1) {
        ensureNode(coords[i]);
        if (i === 0) continue;
        const a = ensureNode(coords[i - 1]);
        const b = ensureNode(coords[i]);
        adjacency.get(a).add(b);
        adjacency.get(b).add(a);
      }
    }

    let components = 0;
    const visited = new Set();
    for (const key of adjacency.keys()) {
      if (visited.has(key)) continue;
      components += 1;
      const stack = [key];
      while (stack.length) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        for (const next of adjacency.get(current) || []) {
          if (!visited.has(next)) stack.push(next);
        }
      }
    }

    return {
      routes: routes.length,
      nodes: uniqueNodes.size,
      components,
      entrance: Boolean(getEntrance())
    };
  }

  function currentStatusText() {
    if (mode === 'entrance') return 'Haz clic sobre el punto exacto de la entrada principal.';
    if (mode === 'draw') {
      if (!draftCoords.length) return 'Haz clic sobre el centro de la vialidad para iniciar el tramo.';
      return `Dibujando tramo · ${draftCoords.length} punto${draftCoords.length === 1 ? '' : 's'}. Continúa haciendo clic sobre la vialidad.`;
    }
    return 'Editor en pausa. Elige Marcar entrada o Nueva vialidad.';
  }

  function updatePanel() {
    if (!panel) return;
    const status = panel.querySelector('#jpRouteStatus');
    if (status) {
      status.textContent = currentStatusText();
      status.classList.toggle('is-drawing', mode === 'draw');
      status.classList.toggle('is-entrance', mode === 'entrance');
    }

    const stats = graphStats();
    setText('jpRouteCount', stats.routes);
    setText('jpNodeCount', stats.nodes);
    setText('jpComponentCount', stats.components);
    setText('jpEntranceCount', stats.entrance ? 'Sí' : 'No');

    const selected = panel.querySelector('#jpRouteSelected');
    if (selected) {
      const route = selectedRouteId ? getRouteById(selectedRouteId) : null;
      selected.textContent = route
        ? `${route.properties.id} · ${labelAccess(route.properties.acceso)} · ${route.geometry.coordinates.length} puntos`
        : 'Ningún tramo seleccionado';
    }

    const finish = panel.querySelector('#jpFinishRoute');
    if (finish) finish.disabled = draftCoords.length < 2;
    const undo = panel.querySelector('#jpUndoPoint');
    if (undo) undo.disabled = draftCoords.length === 0;
    const cancel = panel.querySelector('#jpCancelRoute');
    if (cancel) cancel.disabled = draftCoords.length === 0;
    const del = panel.querySelector('#jpDeleteRoute');
    if (del) del.disabled = !selectedRouteId;

    const warning = panel.querySelector('#jpRouteWarning');
    if (warning) {
      const messages = [];
      if (!stats.entrance) messages.push('Falta marcar la entrada principal.');
      if (stats.routes > 0 && stats.components > 1) messages.push(`La red tiene ${stats.components} componentes desconectados. Conecta los tramos en los cruces.`);
      warning.textContent = messages.join(' ');
      warning.classList.toggle('is-visible', messages.length > 0);
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function setMode(nextMode) {
    mode = nextMode;
    updatePanel();
  }

  function createPanel() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    panel = document.createElement('section');
    panel.className = 'jp-route-editor-panel';
    panel.innerHTML = `
      <div class="jp-route-editor-header">
        <div>
          <h2>Editor de rutas</h2>
          <p>Dibuja la red vial que usará “Cómo llegar”.</p>
        </div>
        <span class="jp-route-editor-badge">BORRADOR</span>
      </div>

      <div class="jp-route-editor-section">
        <h3>1. Punto de inicio</h3>
        <div class="jp-route-editor-grid">
          <button type="button" id="jpMarkEntrance" class="jp-route-primary jp-route-full">Marcar / mover entrada</button>
        </div>
      </div>

      <div class="jp-route-editor-section">
        <h3>2. Vialidades</h3>
        <select id="jpRouteAccess" aria-label="Tipo de tramo">
          <option value="vehicular">Vehicular</option>
          <option value="peatonal">Peatonal</option>
          <option value="ambos">Vehicular + peatonal</option>
        </select>
        <div class="jp-route-editor-grid" style="margin-top:7px">
          <button type="button" id="jpStartRoute" class="jp-route-primary">Nueva vialidad</button>
          <button type="button" id="jpPauseRoute">Pausar</button>
          <button type="button" id="jpFinishRoute">Finalizar tramo</button>
          <button type="button" id="jpUndoPoint">Deshacer punto</button>
          <button type="button" id="jpCancelRoute" class="jp-route-full">Cancelar trazado actual</button>
        </div>
        <label class="jp-route-check"><input type="checkbox" id="jpShowNodes" checked /> Mostrar nodos de conexión</label>
        <div id="jpRouteStatus" class="jp-route-editor-status"></div>
      </div>

      <div class="jp-route-editor-section">
        <h3>3. Tramo seleccionado</h3>
        <div id="jpRouteSelected" class="jp-route-selected">Ningún tramo seleccionado</div>
        <div class="jp-route-editor-grid" style="margin-top:7px">
          <button type="button" id="jpDeleteRoute" class="jp-route-danger jp-route-full">Eliminar tramo seleccionado</button>
        </div>
      </div>

      <div class="jp-route-editor-section">
        <h3>Estado de la red</h3>
        <div class="jp-route-stats">
          <div class="jp-route-stat"><strong id="jpRouteCount">0</strong><span>Tramos</span></div>
          <div class="jp-route-stat"><strong id="jpNodeCount">0</strong><span>Nodos</span></div>
          <div class="jp-route-stat"><strong id="jpComponentCount">0</strong><span>Componentes</span></div>
          <div class="jp-route-stat"><strong id="jpEntranceCount">No</strong><span>Entrada</span></div>
        </div>
        <div id="jpRouteWarning" class="jp-route-warning"></div>
      </div>

      <div class="jp-route-editor-section">
        <h3>Guardar / cargar</h3>
        <div class="jp-route-editor-grid">
          <button type="button" id="jpDownloadRoutes" class="jp-route-primary">Descargar GeoJSON</button>
          <button type="button" id="jpCopyRoutes">Copiar JSON</button>
          <label class="jp-route-file-label" for="jpImportRoutes">Cargar GeoJSON</label>
          <button type="button" id="jpResetRoutes">Restablecer base</button>
          <button type="button" id="jpClearRoutes" class="jp-route-danger">Borrar todo</button>
          <button type="button" id="jpExitRouteEditor">Salir del editor</button>
        </div>
        <input type="file" id="jpImportRoutes" class="jp-route-file-input" accept=".json,.geojson,application/json,application/geo+json" />
      </div>

      <div class="jp-route-editor-section">
        <h3>Cómo dibujar</h3>
        <ol class="jp-route-help">
          <li>Marca primero la entrada principal.</li>
          <li>Elige Nueva vialidad y haz clic sobre el centro del camino.</li>
          <li>En cada cruce, haz clic exactamente sobre el nodo de otra ruta: el editor hará “snap”.</li>
          <li>Si haces clic sobre un tramo existente mientras dibujas, se crea un nodo de intersección.</li>
          <li>Finaliza cada tramo en un cruce o punto lógico. La red ideal debe mostrar 1 componente.</li>
          <li>Descarga <strong>rutas-panteon.geojson</strong> al terminar y envíamelo para integrarlo.</li>
        </ol>
      </div>
    `;
    mapEl.appendChild(panel);

    panel.querySelector('#jpMarkEntrance').addEventListener('click', () => setMode('entrance'));
    panel.querySelector('#jpStartRoute').addEventListener('click', () => setMode('draw'));
    panel.querySelector('#jpPauseRoute').addEventListener('click', () => setMode('idle'));
    panel.querySelector('#jpFinishRoute').addEventListener('click', finishDraft);
    panel.querySelector('#jpUndoPoint').addEventListener('click', () => {
      draftCoords.pop();
      renderDraft();
      updatePanel();
    });
    panel.querySelector('#jpCancelRoute').addEventListener('click', cancelDraft);
    panel.querySelector('#jpDeleteRoute').addEventListener('click', deleteSelectedRoute);
    panel.querySelector('#jpDownloadRoutes').addEventListener('click', downloadGeoJson);
    panel.querySelector('#jpCopyRoutes').addEventListener('click', copyGeoJson);
    panel.querySelector('#jpResetRoutes').addEventListener('click', resetToBase);
    panel.querySelector('#jpClearRoutes').addEventListener('click', clearAll);
    panel.querySelector('#jpShowNodes').addEventListener('change', (event) => {
      showNodes = Boolean(event.target.checked);
      renderCommitted();
    });
    panel.querySelector('#jpImportRoutes').addEventListener('change', (event) => {
      importGeoJson(event.target.files?.[0]);
      event.target.value = '';
    });
    panel.querySelector('#jpExitRouteEditor').addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('route-editor');
      url.searchParams.delete('edit');
      window.location.href = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '') + url.hash;
    });

    updatePanel();
  }

  function handleMapClick(event) {
    if (mode === 'entrance') {
      const coord = snappedCoord(event.latlng);
      setEntrance(coord);
      setMode('idle');
      notify('Entrada principal guardada en el borrador local.');
      return;
    }

    if (mode === 'draw') {
      addDraftCoord(snappedCoord(event.latlng));
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      if (draftCoords.length) cancelDraft();
      setMode('idle');
      return;
    }
    if (event.key === 'Enter' && mode === 'draw' && draftCoords.length >= 2) {
      event.preventDefault();
      finishDraft();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && draftCoords.length) {
      event.preventDefault();
      draftCoords.pop();
      renderDraft();
      updatePanel();
    }
  }

  async function loadInitialData() {
    let fileData = emptyCollection();
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (response.ok) fileData = normalizeCollection(await response.json());
    } catch (error) {
      console.warn('[Rutas] No se pudo cargar archivo base:', error);
    }
    baseCollection = clone(fileData);

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      routesCollection = stored ? normalizeCollection(JSON.parse(stored)) : clone(fileData);
    } catch (error) {
      console.warn('[Rutas] Borrador local inválido, usando archivo base:', error);
      routesCollection = clone(fileData);
    }
  }

  async function bootEditor() {
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      map = window.JP_LEAFLET_MAP || map;
      if (!map || !window.L || !document.getElementById('map')) {
        if (attempts > 500) {
          window.clearInterval(timer);
          console.error('[Rutas] No se encontró la instancia Leaflet del mapa.');
        }
        return;
      }

      window.clearInterval(timer);
      ensurePane();
      committedGroup = L.layerGroup().addTo(map);
      vertexGroup = L.layerGroup().addTo(map);
      draftGroup = L.layerGroup().addTo(map);
      document.getElementById('map').classList.add('jp-route-editor-active');

      await loadInitialData();
      createPanel();
      renderCommitted();
      renderDraft();
      updatePanel();

      map.on('click', handleMapClick);
      document.addEventListener('keydown', handleKeydown);
      console.info('[Rutas] Editor de vialidades activo. Borrador persistente en localStorage.');
    }, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootEditor, { once: true });
  } else {
    bootEditor();
  }
})();
