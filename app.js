/* =========================================================
   CONFIG
   ========================================================= */
const BASE_IMAGE_PUBLIC_URL = "./assets/map/base-public.webp"; // NUEVO: ligero para público
const BASE_IMAGE_EDIT_URL   = "./assets/map/base.png";         // tu 600dpi para editar

const SECCIONES_URL    = "./data/secciones.geojson";
const LOTES_INFO_URL   = "./data/lotes.json";
const PAQUETES_URL     = "./data/paquetes.json";

// Edit modes:
// ?edit=sections  => editar/crear secciones
// ?edit=lots      => editar/crear lotes (requiere elegir sección arriba)
const editMode = new URLSearchParams(location.search).get("edit"); // null | "sections" | "lots"
const isEditSections = editMode === "sections";
const isEditLots     = editMode === "lots";

// Base image según modo (público vs edición)
const BASE_IMAGE_URL = (isEditSections || isEditLots) ? BASE_IMAGE_EDIT_URL : BASE_IMAGE_PUBLIC_URL;

// Detectar “móvil/Tablet” (puntero grueso)
const IS_MOBILE = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

/* =========================================================
   GLOBAL STATE
   ========================================================= */
let map;

// catálogos panel
let lotesInfo = {};
let paquetesInfo = {};

// GeoJSON en memoria (para copiar actualizado)
let seccionesGeo = null;      // FeatureCollection
let lotesGeo = null;          // FeatureCollection de la sección seleccionada (en edit lots / normal)

// layers
let seccionesLayer = null;
let lotesLayer = null;

// pinned (modo normal)
let pinnedSectionLayer = null;
let pinnedLotLayer = null;

// sección actual (modo normal / edit lots)
let currentSection = null; // { id, nombre, lotesFile }

// toggle lotes (modo normal)
let showAllLots = false;

// DOM
const $title = document.getElementById("panelTitle");
const $body  = document.getElementById("panelBody");
const $sectionSelect  = document.getElementById("sectionSelect");
const $searchInput    = document.getElementById("searchInput");
const $searchBtn      = document.getElementById("searchBtn");
const $backBtn        = document.getElementById("backBtn");
const $toggleLotsBtn  = document.getElementById("toggleLotsBtn");

/* =========================================================
   HELPERS
   ========================================================= */
function setPanel(title, html){
  $title.textContent = title;
  $body.innerHTML = html;
}
function safe(v){ return (v === null || v === undefined) ? "" : String(v); }

async function loadJson(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`No se pudo cargar: ${url}`);
  return await r.json();
}

function deepCopy(obj){ return JSON.parse(JSON.stringify(obj)); }

/* CRS.Simple: lat=y, lng=x; GeoJSON: [x,y]=[lng,lat] */
function latLngToXY(latlng){ return [latlng.lng, latlng.lat]; }
function xyToLatLng(xy){ return L.latLng(xy[1], xy[0]); }

function isSameLatLng(a,b){
  return a && b && Math.abs(a.lat-b.lat) < 1e-9 && Math.abs(a.lng-b.lng) < 1e-9;
}

/* =========================================================
   ANIMACIONES (PASO 2) - con protección móvil
   ========================================================= */
function flyToBoundsSmooth(bounds, durationSeconds){
  // En móvil, esto suele causar crashes con imágenes grandes: usar fitBounds directo
  if (IS_MOBILE) {
    map.fitBounds(bounds);
    return;
  }

  try {
    if (map.flyToBounds){
      map.flyToBounds(bounds, {
        animate: true,
        duration: durationSeconds,
        easeLinearity: 0.2
      });
    } else {
      map.fitBounds(bounds, { animate: true });
    }
  } catch {
    map.fitBounds(bounds);
  }
}

function pulseLayer(layer, baseStyle, pulseAdd){
  const ms = pulseAdd?.ms ?? 220;
  const weightAdd = pulseAdd?.weightAdd ?? 2;
  const fillAdd = pulseAdd?.fillAdd ?? 0.12;

  const pulseStyle = {
    ...baseStyle,
    weight: (baseStyle.weight ?? 1) + weightAdd,
    fillOpacity: Math.min(0.85, (baseStyle.fillOpacity ?? 0) + fillAdd)
  };

  layer.setStyle(pulseStyle);
  setTimeout(() => {
    try { layer.setStyle(baseStyle); } catch {}
  }, ms);
}

/* =========================================================
   STYLES (NORMAL)
   ========================================================= */
function sectionHiddenStyle(){
  return { weight: 2, opacity: 0, fillOpacity: 0 };
}
function sectionHoverStyle(){
  return { weight: 2, opacity: 1, fillOpacity: 0.08 };
}
function sectionPinnedStyle(){
  return { weight: 3, opacity: 1, fillOpacity: 0.12 };
}

function styleByStatus(status){
  const s = (status || "").toLowerCase();
  if (s === "disponible") return { weight: 1, opacity: 1, fillOpacity: 0.30 };
  if (s === "ocupado")    return { weight: 1, opacity: 1, fillOpacity: 0.55 };
  if (s === "por construir") return { weight: 1, opacity: 1, dashArray: "4 4", fillOpacity: 0.20 };
  return { weight: 1, opacity: 1, fillOpacity: 0.25 };
}

function lotHiddenStyle(){
  return { weight: 1, opacity: 0, fillOpacity: 0 };
}
function lotVisibleStyle(status){
  return styleByStatus(status);
}
function lotPinnedStyle(status){
  const s = lotVisibleStyle(status);
  return { ...s, weight: 2 };
}
function lotBaseStyle(status){
  return showAllLots ? lotVisibleStyle(status) : lotHiddenStyle();
}

function updateToggleLotsButton(){
  if (!$toggleLotsBtn) return;
  const enabled = !!currentSection && !isEditSections && !isEditLots;
  $toggleLotsBtn.disabled = !enabled;
  $toggleLotsBtn.textContent = showAllLots ? "Ocultar lotes" : "Mostrar lotes";
}

function applyLotsVisibility(){
  if (!lotesLayer) return;
  lotesLayer.eachLayer(layer => {
    const st = layer.feature?.properties?.estatus;
    if (pinnedLotLayer === layer) layer.setStyle(lotPinnedStyle(st));
    else layer.setStyle(lotBaseStyle(st));
  });
}

/* =========================================================
   PANEL: LOTE (NORMAL)
   ========================================================= */
function showLote(id, propsFromMap){
  const status =
    (propsFromMap?.estatus) ||
    (lotesInfo[id]?.estatus) ||
    "desconocido";

  const paqueteKeyRaw =
    (propsFromMap?.paquete ??
     propsFromMap?.package ??
     lotesInfo[id]?.paquete ??
     lotesInfo[id]?.package ??
     null);

  const paqueteKey = (typeof paqueteKeyRaw === "string") ? paqueteKeyRaw.trim() : paqueteKeyRaw;

  let html = `
    <p><b>ID:</b> ${safe(id)}</p>
    <p><b>Estatus:</b> ${safe(status)}</p>
  `;

  if (String(status).toLowerCase() === "disponible"){
    html += `<h3>Paquetes</h3>`;
    if (!paqueteKey){
      html += `<p><i>Sin paquete asignado.</i></p>`;
    } else if (!paquetesInfo[paqueteKey]) {
      html += `<p><b>Paquete:</b> ${safe(paqueteKey)} (no está definido en <code>data/paquetes.json</code>)</p>`;
    } else {
      const p = paquetesInfo[paqueteKey];
      html += `<p><b>${safe(p.nombre)}</b></p>`;
      html += `<ul>${(p.items||[]).map(it => `<li>${safe(it)}</li>`).join("")}</ul>`;
    }
  }

  if (String(status).toLowerCase() === "ocupado"){
    html += `
      <button id="moreBtn" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">
        Más información
      </button>
      <p style="font-size:12px;color:#666;">
        Nota: el saldo se conectará después con login (para que no sea público).
      </p>
    `;
  }

  setPanel(`Lote ${id}`, html);
  const btn = document.getElementById("moreBtn");
  if (btn) btn.onclick = () => alert("Aquí irá el login + consulta segura del saldo (fase futura).");
}

/* =========================================================
   BULK LIST (PASO 4): cargar listas pegadas (Excel/Sheets)
   ========================================================= */
const bulk = {
  sections: { items: [], idx: 0, enabled: false },
  lots:     { items: [], idx: 0, enabled: false }
};

function detectDelimiter(line){
  if (line.includes("\t")) return "\t";
  if (line.includes(",")) return ",";
  if (line.includes(";")) return ";";
  if (line.includes("|")) return "|";
  return null;
}

function splitFields(line){
  const d = detectDelimiter(line);
  if (d) return line.split(d).map(s => s.trim());
  return line.split(/\s{2,}/).map(s => s.trim());
}

function parseSectionList(text){
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length);

  const items = [];
  for (const line of lines){
    const cols = splitFields(line).filter(Boolean);
    if (!cols.length) continue;
    if (cols[0].toLowerCase() === "id") continue;

    const id = (cols[0] || "").trim();
    if (!id) continue;

    const nombre = (cols[1] || id).trim();
    items.push({ id, nombre });
  }
  return items;
}

function parseLotList(text){
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length);

  const items = [];
  for (const line of lines){
    const cols = splitFields(line).filter(c => c !== undefined && c !== null);
    if (!cols.length) continue;
    if ((cols[0] || "").toLowerCase() === "id") continue;

    const id = (cols[0] || "").trim();
    if (!id) continue;

    const estatus = (cols[1] || "disponible").trim() || "disponible";
    const paquete = (cols[2] || "").trim() || null;

    items.push({ id, estatus, paquete });
  }
  return items;
}

function bulkStatusHTML(kind){
  const b = bulk[kind];
  const total = b.items.length;
  const left = Math.max(0, total - b.idx);
  const next = b.items[b.idx];

  const nextTxt = next
    ? (kind === "sections"
        ? `${next.id} — ${next.nombre}`
        : `${next.id} — ${next.estatus}${next.paquete ? ` — ${next.paquete}` : ""}`)
    : "(sin siguiente)";

  return `
    <div style="padding:8px;border:1px solid #eee;border-radius:10px;background:#fafafa;margin-top:10px;">
      <div><b>Lista cargada:</b> ${total} | <b>Restantes:</b> ${left}</div>
      <div><b>Usar lista al crear:</b> ${b.enabled ? "Sí" : "No"}</div>
      <div style="font-size:12px;color:#666;"><b>Siguiente:</b> ${safe(nextTxt)}</div>
    </div>
  `;
}

function bulkFillCreateFields(kind){
  const b = bulk[kind];
  if (!b.enabled) return;
  const next = b.items[b.idx];
  if (!next) return;

  const idEl = document.getElementById("newId");
  if (!idEl) return;

  if (kind === "sections"){
    const nameEl = document.getElementById("newName");
    idEl.value = next.id;
    if (nameEl) nameEl.value = next.nombre || next.id;
  } else {
    const stEl = document.getElementById("newStatus");
    const pkEl = document.getElementById("newPkg");
    idEl.value = next.id;
    if (stEl) stEl.value = next.estatus || "disponible";
    if (pkEl) pkEl.value = next.paquete || "";
  }

  const nextEl = document.getElementById("bulkNext");
  if (nextEl){
    nextEl.innerHTML = bulkStatusHTML(kind);
  }
}

function bulkConsume(kind){
  const b = bulk[kind];
  if (!b.enabled) return;
  if (b.idx < b.items.length) b.idx += 1;
}

/* =========================================================
   EDITOR (SECTIONS/LOTS): DRAW + EDIT VERTICES
   ========================================================= */
const editor = {
  mode: "edit",                // "edit" | "create"
  drawPoints: [],
  drawMarkers: [],
  drawLine: null,
  drawPoly: null,
  drawHandlerAttached: false,
  drawClickHandler: null,

  selectedLayer: null,
  selectedFeature: null,
  originalGeometry: null,
  vertexMarkers: [],
  vertexIcon: L.divIcon({
    className: "",
    html: `<div style="width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #111;"></div>`,
    iconSize: [14,14],
    iconAnchor: [7,7]
  })
};

function clearDraw(){
  editor.drawPoints = [];
  editor.drawMarkers.forEach(m => map.removeLayer(m));
  editor.drawMarkers = [];
  if (editor.drawLine) map.removeLayer(editor.drawLine);
  if (editor.drawPoly) map.removeLayer(editor.drawPoly);
  editor.drawLine = null;
  editor.drawPoly = null;

  const el = document.getElementById("ptCount");
  if (el) el.textContent = "0";
}

function refreshDrawPreview(){
  if (editor.drawLine) map.removeLayer(editor.drawLine);
  if (editor.drawPoly) map.removeLayer(editor.drawPoly);
  editor.drawLine = null;
  editor.drawPoly = null;

  if (editor.drawPoints.length >= 2){
    editor.drawLine = L.polyline(editor.drawPoints, { weight: 2 }).addTo(map);
  }
  if (editor.drawPoints.length >= 3){
    editor.drawPoly = L.polygon(editor.drawPoints, { weight: 2, fillOpacity: 0.12 }).addTo(map);
  }
}

function attachDrawHandler(){
  if (editor.drawHandlerAttached) return;
  editor.drawHandlerAttached = true;

  editor.drawClickHandler = (e) => {
    if (editor.mode !== "create") return;

    editor.drawPoints.push(e.latlng);
    const mk = L.marker(e.latlng, { icon: editor.vertexIcon }).addTo(map);
    editor.drawMarkers.push(mk);
    refreshDrawPreview();

    const el = document.getElementById("ptCount");
    if (el) el.textContent = String(editor.drawPoints.length);
  };

  map.on("click", editor.drawClickHandler);
}

function clearVertexMarkers(){
  editor.vertexMarkers.forEach(m => map.removeLayer(m));
  editor.vertexMarkers = [];
}

function stopEditingSelected(){
  editor.selectedLayer = null;
  editor.selectedFeature = null;
  editor.originalGeometry = null;
  clearVertexMarkers();
}

function getRingLatLngsFromPolygonLayer(layer){
  const latlngs = layer.getLatLngs();
  const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;

  if (ring.length >= 2 && isSameLatLng(ring[0], ring[ring.length-1])) {
    return ring.slice(0, ring.length-1);
  }
  return ring;
}

function ringToGeoJsonCoords(ringLatLng){
  const coords = ringLatLng.map(latLngToXY);
  if (coords.length) coords.push(coords[0]);
  return [coords];
}

function applyVertexMarkersToFeature(){
  if (!editor.selectedLayer || !editor.selectedFeature) return;

  const ring = editor.vertexMarkers.map(m => m.getLatLng());
  editor.selectedLayer.setLatLngs([ring]);
  editor.selectedFeature.geometry.coordinates = ringToGeoJsonCoords(ring);
}

function startEditingLayer(layer){
  if (editor.mode !== "edit") return;

  stopEditingSelected();
  clearDraw();

  editor.selectedLayer = layer;
  editor.selectedFeature = layer.feature;
  editor.originalGeometry = deepCopy(layer.feature.geometry);

  const ring = getRingLatLngsFromPolygonLayer(layer);

  editor.vertexMarkers = ring.map((p) => {
    const mk = L.marker(p, { draggable: true, icon: editor.vertexIcon }).addTo(map);

    mk.on("drag", () => {
      const newRing = editor.vertexMarkers.map(m => m.getLatLng());
      editor.selectedLayer.setLatLngs([newRing]);
    });

    mk.on("dragend", () => applyVertexMarkersToFeature());

    return mk;
  });

  const id = layer.feature?.properties?.id || "(sin id)";
  const kind = isEditSections ? "Sección" : "Lote";
  const dest = isEditSections ? "data/secciones.geojson" : (currentSection?.lotesFile || "(elige sección)");

  setPanel(`Editar ${kind}: ${id}`, `
    <p>Arrastra los puntos (bolitas) para ajustar la forma.</p>
    <p style="font-size:12px;color:#666;">Destino: <b>${safe(dest)}</b></p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button id="btnSaveEdit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar cambios</button>
      <button id="btnCancelEdit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Cancelar</button>
      <button id="btnCopyGeo" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON actualizado</button>
    </div>

    <hr/>
    <p><button id="btnBackEditor" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Volver al menú de edición</button></p>
  `);

  document.getElementById("btnSaveEdit").onclick = () => {
    applyVertexMarkersToFeature();
    alert("Cambios guardados en memoria. Ahora copia el GeoJSON y pégalo en el archivo.");
  };

  document.getElementById("btnCancelEdit").onclick = () => {
    if (editor.selectedFeature && editor.originalGeometry){
      editor.selectedFeature.geometry = deepCopy(editor.originalGeometry);

      const coords = editor.selectedFeature.geometry.coordinates?.[0] || [];
      let ringLatLng = coords.map(xyToLatLng);
      if (ringLatLng.length >= 2 && isSameLatLng(ringLatLng[0], ringLatLng[ringLatLng.length-1])) ringLatLng.pop();

      editor.selectedLayer.setLatLngs([ringLatLng]);
    }
    stopEditingSelected();
    alert("Edición cancelada.");
  };

  document.getElementById("btnCopyGeo").onclick = async () => {
    const txt = JSON.stringify(isEditSections ? seccionesGeo : lotesGeo, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      alert("Copiado. Pégalo en el archivo correspondiente (reemplazando el contenido).");
    } catch {
      setPanel("Copia manual", `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };

  document.getElementById("btnBackEditor").onclick = () => {
    stopEditingSelected();
    if (isEditSections) renderEditSectionsPanel();
    else renderEditLotsPanel();
  };
}

/* =========================================================
   EDIT PANELS (SECTIONS / LOTS) + BULK
   ========================================================= */
function renderBulkLoader(kind){
  const dest = (kind === "sections")
    ? "data/secciones.geojson"
    : (currentSection?.lotesFile || "(elige sección arriba)");

  const hint = (kind === "sections")
    ? `Ejemplo:\nSEC-001,San Juan VIP 2\nSEC-002,San Andrés B`
    : `Ejemplo:\nL-1001,disponible,PAQ-JARDIN-STD\nL-1002,ocupado,\nL-1003,disponible,PAQ-JARDIN-STD`;

  const enabledText = bulk[kind].enabled ? "Sí" : "No";

  return `
    <p><b>Cargar lista (pegar desde Excel/Sheets):</b></p>
    <textarea id="bulkText" rows="8" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;">${safe(hint)}</textarea>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button id="bulkLoadBtn" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Cargar</button>
      <button id="bulkClearBtn" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar</button>
      <button id="bulkToggleBtn" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">
        Usar lista al crear: ${enabledText}
      </button>
      <button id="bulkSkipBtn" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Saltar 1</button>
    </div>

    <div id="bulkNext" style="margin-top:10px;">
      ${bulkStatusHTML(kind)}
    </div>

    <p style="font-size:12px;color:#666;margin-top:10px;">
      Destino: <b>${safe(dest)}</b>
    </p>
  `;
}

function renderEditSectionsPanel(){
  editor.mode = "edit";
  stopEditingSelected();
  clearDraw();

  setPanel("Edición: SECCIONES", `
    <p>Elige una opción:</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button id="btnModeEdit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Editar existente</button>
      <button id="btnModeCreate" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Crear nueva</button>
      <button id="btnBulk" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Cargar lista</button>
      <button id="btnCopy" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      <button id="btnExit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Salir</button>
    </div>

    <hr/>
    <div id="editBody"></div>

    ${bulkStatusHTML("sections")}

    <p style="font-size:12px;color:#666;margin-top:10px;">
      Destino: <b>data/secciones.geojson</b>
    </p>
  `);

  const $editBody = document.getElementById("editBody");

  document.getElementById("btnModeEdit").onclick = () => {
    editor.mode = "edit";
    clearDraw();
    $editBody.innerHTML = `<p><b>Editar:</b> haz clic en una sección para mover sus puntos.</p>`;
    rerenderSeccionesLayer_Edit();
  };

  document.getElementById("btnModeCreate").onclick = () => {
    editor.mode = "create";
    stopEditingSelected();
    clearDraw();

    $editBody.innerHTML = `
      <p><b>Crear:</b> haz clic para poner puntos.</p>
      <p><b>Puntos:</b> <span id="ptCount">0</span></p>

      <label><b>ID sección</b></label><br/>
      <input id="newId" placeholder="Ej. SEC-010" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Nombre sección</b></label><br/>
      <input id="newName" placeholder="Ej. San Juan VIP 2" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button id="btnSaveNew" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar nueva</button>
        <button id="btnClearDraw" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar puntos</button>
      </div>

      <div id="bulkNext" style="margin-top:10px;">
        ${bulkStatusHTML("sections")}
      </div>
    `;

    document.getElementById("btnClearDraw").onclick = () => clearDraw();
    bulkFillCreateFields("sections");

    document.getElementById("btnSaveNew").onclick = () => {
      if (editor.drawPoints.length < 3) return alert("Necesitas mínimo 3 puntos.");

      const id = document.getElementById("newId").value.trim();
      if (!id) return alert("Falta el ID.");
      const nombre = document.getElementById("newName").value.trim();

      const ring = editor.drawPoints.slice();
      const feature = {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: ringToGeoJsonCoords(ring) },
        properties: { id, nombre: nombre || id, lotesFile: `./data/lotes-${id}.geojson` }
      };

      seccionesGeo.features.push(feature);
      rerenderSeccionesLayer_Edit();
      clearDraw();

      bulkConsume("sections");
      bulkFillCreateFields("sections");

      alert("Sección creada en memoria. Copia el GeoJSON y pégalo en data/secciones.geojson");
    };

    rerenderSeccionesLayer_Edit();
  };

  document.getElementById("btnBulk").onclick = () => {
    editor.mode = "edit";
    stopEditingSelected();
    clearDraw();

    $editBody.innerHTML = renderBulkLoader("sections");

    document.getElementById("bulkLoadBtn").onclick = () => {
      const txt = document.getElementById("bulkText").value;
      bulk.sections.items = parseSectionList(txt);
      bulk.sections.idx = 0;
      alert(`Lista cargada: ${bulk.sections.items.length} secciones`);
      renderEditSectionsPanel();
    };

    document.getElementById("bulkClearBtn").onclick = () => {
      bulk.sections.items = [];
      bulk.sections.idx = 0;
      bulk.sections.enabled = false;
      alert("Lista borrada.");
      renderEditSectionsPanel();
    };

    document.getElementById("bulkToggleBtn").onclick = () => {
      bulk.sections.enabled = !bulk.sections.enabled;
      renderEditSectionsPanel();
    };

    document.getElementById("bulkSkipBtn").onclick = () => {
      if (bulk.sections.idx < bulk.sections.items.length) bulk.sections.idx += 1;
      renderEditSectionsPanel();
    };

    rerenderSeccionesLayer_Edit();
  };

  document.getElementById("btnCopy").onclick = async () => {
    const txt = JSON.stringify(seccionesGeo, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      alert("Copiado. Pégalo en data/secciones.geojson (reemplazando el contenido).");
    } catch {
      setPanel("Copia manual", `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };

  document.getElementById("btnExit").onclick = () => location.href = "./";
  document.getElementById("btnModeEdit").click();
}

function renderEditLotsPanel(){
  editor.mode = "edit";
  stopEditingSelected();
  clearDraw();

  const dest = currentSection?.lotesFile || "(elige sección arriba)";

  setPanel("Edición: LOTES", `
    <p>1) Selecciona una sección arriba.</p>
    <p>2) Elige una opción:</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button id="btnModeEdit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Editar existente</button>
      <button id="btnModeCreate" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Crear nuevo</button>
      <button id="btnBulk" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Cargar lista</button>
      <button id="btnCopy" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      <button id="btnExit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Salir</button>
    </div>

    <hr/>
    <div id="editBody"></div>

    ${bulkStatusHTML("lots")}

    <p style="font-size:12px;color:#666;margin-top:10px;">
      Destino: <b>${safe(dest)}</b>
    </p>
  `);

  const $editBody = document.getElementById("editBody");

  document.getElementById("btnModeEdit").onclick = () => {
    editor.mode = "edit";
    clearDraw();
    $editBody.innerHTML = `<p><b>Editar:</b> haz clic en un lote para mover sus puntos.</p>`;
    rerenderLotesLayer_Edit();
  };

  document.getElementById("btnModeCreate").onclick = () => {
    if (!currentSection) return alert("Primero selecciona una sección arriba.");

    editor.mode = "create";
    stopEditingSelected();
    clearDraw();

    $editBody.innerHTML = `
      <p><b>Crear:</b> haz clic para poner puntos.</p>
      <p><b>Puntos:</b> <span id="ptCount">0</span></p>

      <label><b>ID lote</b></label><br/>
      <input id="newId" placeholder="Ej. L-1411" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Estatus</b></label><br/>
      <select id="newStatus" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">
        <option>disponible</option>
        <option>ocupado</option>
        <option>por construir</option>
      </select>

      <label><b>Paquete (opcional)</b></label><br/>
      <input id="newPkg" placeholder="Ej. PAQ-JARDIN-STD" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button id="btnSaveNew" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar nuevo</button>
        <button id="btnClearDraw" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar puntos</button>
      </div>

      <div id="bulkNext" style="margin-top:10px;">
        ${bulkStatusHTML("lots")}
      </div>
    `;

    document.getElementById("btnClearDraw").onclick = () => clearDraw();
    bulkFillCreateFields("lots");

    document.getElementById("btnSaveNew").onclick = () => {
      if (editor.drawPoints.length < 3) return alert("Necesitas mínimo 3 puntos.");

      const id = document.getElementById("newId").value.trim();
      if (!id) return alert("Falta el ID.");

      const status = document.getElementById("newStatus").value;
      const pkg = (document.getElementById("newPkg").value || "").trim() || null;

      const ring = editor.drawPoints.slice();
      const feature = {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: ringToGeoJsonCoords(ring) },
        properties: { id, estatus: status, paquete: pkg }
      };

      lotesGeo.features.push(feature);
      rerenderLotesLayer_Edit();
      clearDraw();

      bulkConsume("lots");
      bulkFillCreateFields("lots");

      alert(`Lote creado en memoria. Copia el GeoJSON y pégalo en ${currentSection.lotesFile}`);
    };

    rerenderLotesLayer_Edit();
  };

  document.getElementById("btnBulk").onclick = () => {
    editor.mode = "edit";
    stopEditingSelected();
    clearDraw();

    $editBody.innerHTML = renderBulkLoader("lots");

    document.getElementById("bulkLoadBtn").onclick = () => {
      const txt = document.getElementById("bulkText").value;
      bulk.lots.items = parseLotList(txt);
      bulk.lots.idx = 0;
      alert(`Lista cargada: ${bulk.lots.items.length} lotes`);
      renderEditLotsPanel();
    };

    document.getElementById("bulkClearBtn").onclick = () => {
      bulk.lots.items = [];
      bulk.lots.idx = 0;
      bulk.lots.enabled = false;
      alert("Lista borrada.");
      renderEditLotsPanel();
    };

    document.getElementById("bulkToggleBtn").onclick = () => {
      bulk.lots.enabled = !bulk.lots.enabled;
      renderEditLotsPanel();
    };

    document.getElementById("bulkSkipBtn").onclick = () => {
      if (bulk.lots.idx < bulk.lots.items.length) bulk.lots.idx += 1;
      renderEditLotsPanel();
    };

    rerenderLotesLayer_Edit();
  };

  document.getElementById("btnCopy").onclick = async () => {
    if (!lotesGeo) return alert("Primero selecciona una sección arriba.");
    const txt = JSON.stringify(lotesGeo, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      alert(`Copiado. Pégalo en ${currentSection?.lotesFile || "tu archivo de lotes"} (reemplazando el contenido).`);
    } catch {
      setPanel("Copia manual", `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };

  document.getElementById("btnExit").onclick = () => location.href = "./";
  document.getElementById("btnModeEdit").click();
}

/* =========================================================
   EDIT RENDER: SECCIONES / LOTES
   ========================================================= */
function rerenderSeccionesLayer_Edit(){
  if (seccionesLayer) seccionesLayer.remove();
  stopEditingSelected();

  seccionesLayer = L.geoJSON(seccionesGeo, {
    style: { weight: 2, opacity: 1, fillOpacity: 0.06 },
    interactive: (editor.mode === "edit"),
    onEachFeature: (feature, layer) => {
      const nombre = feature?.properties?.nombre || feature?.properties?.id;
      layer.bindPopup(`<b>${safe(nombre)}</b>`);
      layer.on("click", () => startEditingLayer(layer));
    }
  }).addTo(map);
}

function rerenderLotesLayer_Edit(){
  if (lotesLayer) lotesLayer.remove();
  stopEditingSelected();

  if (!lotesGeo) return;

  lotesLayer = L.geoJSON(lotesGeo, {
    style: (feature) => {
      const st = feature?.properties?.estatus;
      const s = styleByStatus(st);
      return { ...s, fillOpacity: 0.10 };
    },
    interactive: (editor.mode === "edit"),
    onEachFeature: (feature, layer) => {
      const id = feature?.properties?.id;
      layer.bindPopup(`<b>${safe(id)}</b>`);
      layer.on("click", () => startEditingLayer(layer));
    }
  }).addTo(map);
}

/* =========================================================
   NORMAL MODE: SECCIONES → LOTES
   ========================================================= */
function clearLotsLayer_Normal(){
  if (lotesLayer){ lotesLayer.remove(); lotesLayer = null; }
  pinnedLotLayer = null;
}

async function loadSecciones_Normal(){
  seccionesGeo = await loadJson(SECCIONES_URL);

  $sectionSelect.innerHTML = `<option value="">Selecciona sección...</option>`;
  seccionesGeo.features.forEach(f => {
    const id = f?.properties?.id;
    const nombre = f?.properties?.nombre || id;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = nombre;
    $sectionSelect.appendChild(opt);
  });

  if (seccionesLayer) seccionesLayer.remove();
  pinnedSectionLayer = null;

  seccionesLayer = L.geoJSON(seccionesGeo, {
    style: () => sectionHiddenStyle(),
    interactive: true,
    onEachFeature: (feature, layer) => {
      const nombre = feature?.properties?.nombre || feature?.properties?.id;
      layer.bindPopup(`<b>${safe(nombre)}</b>`);

      layer.on("mouseover", () => {
        if (pinnedSectionLayer !== layer) layer.setStyle(sectionHoverStyle());
      });
      layer.on("mouseout", () => {
        if (pinnedSectionLayer !== layer) layer.setStyle(sectionHiddenStyle());
      });

      layer.on("click", async () => {
        if (pinnedSectionLayer && pinnedSectionLayer !== layer){
          pinnedSectionLayer.setStyle(sectionHiddenStyle());
        }
        pinnedSectionLayer = layer;

        const base = sectionPinnedStyle();
        layer.setStyle(base);
        pulseLayer(layer, base, { weightAdd: 2, fillAdd: 0.10, ms: 220 });

        await selectSection_Normal(feature);
      });
    }
  }).addTo(map);

  showAllLots = false;
  updateToggleLotsButton();
  setPanel("Secciones", `<p>Selecciona una sección para ver lotes.</p>`);
}

async function selectSection_Normal(feature){
  const props = feature?.properties || {};
  currentSection = { id: props.id, nombre: props.nombre || props.id, lotesFile: props.lotesFile };
  $sectionSelect.value = props.id || "";

  const temp = L.geoJSON(feature);
  flyToBoundsSmooth(temp.getBounds().pad(0.15), 0.75);

  await loadLotes_Normal();
}

async function loadLotes_Normal(){
  clearLotsLayer_Normal();

  if (!currentSection?.lotesFile){
    setPanel("Sección sin archivo", `<p>Esta sección no tiene “lotesFile”.</p>`);
    return;
  }

  if (seccionesLayer) seccionesLayer.remove();

  try {
    lotesGeo = await loadJson(currentSection.lotesFile);
  } catch {
    lotesGeo = { type: "FeatureCollection", features: [] };
  }

  lotesLayer = L.geoJSON(lotesGeo, {
    interactive: true,
    style: (feature) => lotBaseStyle(feature?.properties?.estatus),
    onEachFeature: (feature, layer) => {
      const id = feature?.properties?.id || "(sin id)";
      const st = feature?.properties?.estatus;

      layer.on("mouseover", () => {
        if (pinnedLotLayer !== layer) layer.setStyle(lotVisibleStyle(st));
      });
      layer.on("mouseout", () => {
        if (pinnedLotLayer !== layer) layer.setStyle(lotBaseStyle(st));
      });

      layer.on("click", () => {
        if (pinnedLotLayer && pinnedLotLayer !== layer){
          const prevStatus = pinnedLotLayer.feature?.properties?.estatus;
          pinnedLotLayer.setStyle(lotBaseStyle(prevStatus));
        }
        pinnedLotLayer = layer;

        const base = lotPinnedStyle(st);
        layer.setStyle(base);
        pulseLayer(layer, base, { weightAdd: 2, fillAdd: 0.10, ms: 200 });

        flyToBoundsSmooth(layer.getBounds().pad(0.35), 0.45);

        showLote(id, feature.properties);
      });
    }
  }).addTo(map);

  updateToggleLotsButton();
  applyLotsVisibility();

  setPanel(currentSection.nombre, `<p>Hover (PC) o tap (móvil) para ver lotes. O usa “Mostrar lotes”.</p>`);
}

async function backToSecciones_Normal(){
  currentSection = null;
  pinnedSectionLayer = null;
  pinnedLotLayer = null;
  showAllLots = false;

  clearLotsLayer_Normal();
  await loadSecciones_Normal();
  $sectionSelect.value = "";
  updateToggleLotsButton();
}

/* =========================================================
   SEARCH (NORMAL)
   ========================================================= */
function findLoteLayerById(id){
  let found = null;
  if (!lotesLayer) return null;
  lotesLayer.eachLayer(layer => {
    const fid = layer?.feature?.properties?.id;
    if (fid && fid.toLowerCase() === id.toLowerCase()) found = layer;
  });
  return found;
}

function setupSearch_Normal(){
  const run = () => {
    const id = $searchInput.value.trim();
    if (!id) return;

    if (!currentSection){
      setPanel("Primero sección", `<p>Primero selecciona una sección para buscar lotes.</p>`);
      return;
    }

    const layer = findLoteLayerById(id);
    if (!layer){
      setPanel("No encontrado", `<p>No encontré <b>${safe(id)}</b> dentro de ${safe(currentSection.nombre)}.</p>`);
      return;
    }

    flyToBoundsSmooth(layer.getBounds().pad(0.35), 0.45);

    if (pinnedLotLayer && pinnedLotLayer !== layer){
      const prevStatus = pinnedLotLayer.feature?.properties?.estatus;
      pinnedLotLayer.setStyle(lotBaseStyle(prevStatus));
    }

    pinnedLotLayer = layer;
    const st = layer.feature?.properties?.estatus;

    const base = lotPinnedStyle(st);
    layer.setStyle(base);
    pulseLayer(layer, base, { weightAdd: 2, fillAdd: 0.10, ms: 200 });

    showLote(layer.feature.properties.id, layer.feature.properties);
  };

  $searchBtn.onclick = run;
  $searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

/* =========================================================
   INIT
   ========================================================= */
async function main(){
  window.addEventListener("error", (e) => {
    setPanel("Error en la página", `<p>${safe(e.message)}</p>`);
  });

  // PERF: preferCanvas mejora mucho cuando hay muchos polígonos
  map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -3,
    maxZoom: (isEditSections || isEditLots) ? 6 : 4, // público más limitado = más fluido
    zoomAnimation: !IS_MOBILE,       // móvil: menos animación
    fadeAnimation: false,
    markerZoomAnimation: !IS_MOBILE,
    preferCanvas: true               // clave para fluidez con muchos lotes
  });

  try { lotesInfo = await loadJson(LOTES_INFO_URL); } catch { lotesInfo = {}; }
  try { paquetesInfo = await loadJson(PAQUETES_URL); } catch { paquetesInfo = {}; }

  const img = new Image();
  img.onload = async () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const bounds = [[0,0],[h,w]];

    // Overlay base (público ligero / edición pesado)
    L.imageOverlay(BASE_IMAGE_URL, bounds).addTo(map);
    map.fitBounds(bounds);

    attachDrawHandler();

    // EDIT: SECCIONES
    if (isEditSections){
      if ($toggleLotsBtn) $toggleLotsBtn.disabled = true;
      if ($searchBtn) $searchBtn.disabled = true;

      seccionesGeo = await loadJson(SECCIONES_URL);
      rerenderSeccionesLayer_Edit();
      renderEditSectionsPanel();
      return;
    }

    // EDIT: LOTES
    if (isEditLots){
      if ($toggleLotsBtn) $toggleLotsBtn.disabled = true;
      if ($searchBtn) $searchBtn.disabled = true;

      seccionesGeo = await loadJson(SECCIONES_URL);
      $sectionSelect.innerHTML = `<option value="">Selecciona sección...</option>`;
      seccionesGeo.features.forEach(f => {
        const id = f?.properties?.id;
        const nombre = f?.properties?.nombre || id;
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = nombre;
        $sectionSelect.appendChild(opt);
      });

      setPanel("Edición: LOTES", `<p>Selecciona una sección arriba.</p>`);

      $sectionSelect.onchange = async () => {
        const sid = $sectionSelect.value;
        if (!sid){
          currentSection = null;
          if (lotesLayer) lotesLayer.remove();
          lotesLayer = null;
          lotesGeo = null;
          renderEditLotsPanel();
          return;
        }

        const f = seccionesGeo.features.find(x => x?.properties?.id === sid);
        currentSection = {
          id: f?.properties?.id,
          nombre: f?.properties?.nombre || f?.properties?.id,
          lotesFile: f?.properties?.lotesFile
        };

        try {
          lotesGeo = await loadJson(currentSection.lotesFile);
        } catch {
          lotesGeo = { type: "FeatureCollection", features: [] };
        }

        rerenderLotesLayer_Edit();
        renderEditLotsPanel();

        if (f){
          const temp = L.geoJSON(f);
          flyToBoundsSmooth(temp.getBounds().pad(0.15), 0.65);
        }
      };

      renderEditLotsPanel();
      return;
    }

    // NORMAL
    await loadSecciones_Normal();
    setupSearch_Normal();

    $sectionSelect.onchange = async () => {
      const sid = $sectionSelect.value;
      if (!sid){
        await backToSecciones_Normal();
        return;
      }
      const f = seccionesGeo.features.find(x => x?.properties?.id === sid);
      if (f) await selectSection_Normal(f);
    };

    $backBtn.onclick = async () => backToSecciones_Normal();

    if ($toggleLotsBtn){
      $toggleLotsBtn.onclick = () => {
        showAllLots = !showAllLots;
        applyLotsVisibility();
        updateToggleLotsButton();
      };
    }

    updateToggleLotsButton();
  };

  img.onerror = () => {
    setPanel("No se cargó el mapa base", `<p>No pude cargar <code>${safe(BASE_IMAGE_URL)}</code></p>`);
  };

  img.src = BASE_IMAGE_URL;
}

main();