/* =========================================================
   CONFIG
   ========================================================= */
const BASE_IMAGE_URL   = "./assets/map/base.png";
const SECCIONES_URL    = "./data/secciones.geojson";
const LOTES_INFO_URL   = "./data/lotes.json";
const PAQUETES_URL     = "./data/paquetes.json";

// Edit modes:
// ?edit=sections  => dibujar secciones
// ?edit=lots      => dibujar lotes dentro de una sección (selecciona sección en el dropdown)
const editMode = new URLSearchParams(location.search).get("edit"); // null | "sections" | "lots"
const isEditSections = editMode === "sections";
const isEditLots     = editMode === "lots";

/* =========================================================
   GLOBAL STATE
   ========================================================= */
let map;

// panel info
let lotesInfo = {};
let paquetesInfo = {};

// layers
let seccionesLayer = null;
let lotesLayer = null;

// pinned (fijado) para tablet/cel o clicks
let pinnedSectionLayer = null;
let pinnedLotLayer = null;

// sección actual
let currentSection = null; // { id, nombre, lotesFile }

// DOM
const $title = document.getElementById("panelTitle");
const $body  = document.getElementById("panelBody");

const $sectionSelect = document.getElementById("sectionSelect");
const $searchInput   = document.getElementById("searchInput");
const $searchBtn     = document.getElementById("searchBtn");
const $backBtn       = document.getElementById("backBtn");

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

// (opcional) útil para móvil
function isTouchDevice(){
  return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
}

/* =========================================================
   STYLES (VISUAL)
   ========================================================= */

// Secciones: ocultas por defecto (en modo normal), visibles en hover/click
function sectionHiddenStyle(){
  if (isEditSections) return { weight: 2, opacity: 1, fillOpacity: 0.08 };
  return { weight: 2, opacity: 0, fillOpacity: 0 };
}
function sectionHoverStyle(){
  return { weight: 2, opacity: 1, fillOpacity: 0.08 };
}
function sectionPinnedStyle(){
  return { weight: 3, opacity: 1, fillOpacity: 0.12 };
}

// Lotes: ocultos por defecto (en modo normal), visibles en hover/click
function styleByStatus(status){
  const s = (status || "").toLowerCase();
  if (s === "disponible") return { weight: 1, opacity: 1, fillOpacity: 0.30 };
  if (s === "ocupado")    return { weight: 1, opacity: 1, fillOpacity: 0.55 };
  if (s === "por construir") return { weight: 1, opacity: 1, dashArray: "4 4", fillOpacity: 0.20 };
  return { weight: 1, opacity: 1, fillOpacity: 0.25 };
}

function lotHiddenStyle(){
  // En modo editar lotes, sí queremos verlos ligeramente (si existieran)
  if (isEditLots) return { weight: 1, opacity: 1, fillOpacity: 0.12 };
  return { weight: 1, opacity: 0, fillOpacity: 0 };
}
function lotVisibleStyle(status){
  return styleByStatus(status);
}
function lotPinnedStyle(status){
  const s = lotVisibleStyle(status);
  return { ...s, weight: 2 };
}

/* =========================================================
   PANEL: LOTE
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

  const paqueteKey = (typeof paqueteKeyRaw === "string")
    ? paqueteKeyRaw.trim()
    : paqueteKeyRaw;

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
  if (btn){
    btn.onclick = () => alert("Aquí irá el login + consulta segura del saldo (fase futura).");
  }
}

/* =========================================================
   NAV: SECCIONES
   ========================================================= */
function clearLotsLayer(){
  if (lotesLayer){ lotesLayer.remove(); lotesLayer = null; }
  pinnedLotLayer = null;
}

function showOnlySeccionesPanel(){
  const extra = (isEditSections || isEditLots)
    ? `<hr/><p><b>Modo edición:</b> ${isEditSections ? "SECCIONES" : "LOTES"}</p>`
    : "";

  setPanel("Secciones", `
    <p>1) Selecciona una <b>sección</b> arriba.</p>
    <p>2) Luego podrás ver o buscar <b>lotes</b>.</p>
    ${extra}
  `);
}

async function loadSecciones(){
  const geo = await loadJson(SECCIONES_URL);

  // dropdown
  $sectionSelect.innerHTML = `<option value="">Selecciona sección...</option>`;
  geo.features.forEach(f => {
    const id = f?.properties?.id;
    const nombre = f?.properties?.nombre || id;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = nombre;
    $sectionSelect.appendChild(opt);
  });

  // layer
  if (seccionesLayer) seccionesLayer.remove();
  pinnedSectionLayer = null;

  seccionesLayer = L.geoJSON(geo, {
    style: () => sectionHiddenStyle(),
    // al editar secciones, NO queremos que la capa se coma el click del mapa
    interactive: !isEditSections,
    onEachFeature: (feature, layer) => {
      const id = feature?.properties?.id;
      const nombre = feature?.properties?.nombre || id;
      layer.bindPopup(`<b>${safe(nombre)}</b>`);

      if (isEditSections) return; // en edit sections, no agregamos hover/click

      // Hover PC
      layer.on("mouseover", () => {
        if (pinnedSectionLayer !== layer) layer.setStyle(sectionHoverStyle());
      });
      layer.on("mouseout", () => {
        if (pinnedSectionLayer !== layer) layer.setStyle(sectionHiddenStyle());
      });

      // Tap/Click = fijar + entrar
      layer.on("click", async () => {
        if (pinnedSectionLayer && pinnedSectionLayer !== layer){
          pinnedSectionLayer.setStyle(sectionHiddenStyle());
        }
        pinnedSectionLayer = layer;
        layer.setStyle(sectionPinnedStyle());

        await selectSection(feature);
      });
    }
  }).addTo(map);

  showOnlySeccionesPanel();
}

async function selectSection(feature){
  const props = feature?.properties || {};
  currentSection = {
    id: props.id,
    nombre: props.nombre || props.id,
    lotesFile: props.lotesFile
  };

  $sectionSelect.value = props.id || "";

  // zoom sección
  const temp = L.geoJSON(feature);
  map.fitBounds(temp.getBounds().pad(0.15));

  // carga lotes
  await loadLotesForCurrentSection();

  // si estamos editando lotes, mostrar editor (y permitir clicks para dibujar)
  if (isEditLots){
    resetEditorDrawing();
    attachMapClickForEditing();
    setupEditorLots();
  }
}

async function loadLotesForCurrentSection(){
  clearLotsLayer();

  if (!currentSection?.lotesFile){
    setPanel("Sección sin archivo", `<p>Esta sección no tiene “lotesFile”.</p>`);
    return;
  }

  // En modo normal, ocultamos la capa de secciones para no estorbar
  if (!isEditSections && seccionesLayer) seccionesLayer.remove();

  // Cargar GeoJSON de lotes (si no existe, no truena: crea vacío)
  let geo;
  try {
    geo = await loadJson(currentSection.lotesFile);
  } catch {
    geo = { type: "FeatureCollection", features: [] };
  }

  lotesLayer = L.geoJSON(geo, {
    // En edit lots, NO queremos que la capa estorbe al dibujar (clicks van al mapa)
    interactive: !isEditLots,
    style: (feature) => {
      if (isEditLots) return lotHiddenStyle();
      return lotHiddenStyle(); // ocultos por defecto
    },
    onEachFeature: (feature, layer) => {
      const id = feature?.properties?.id || "(sin id)";
      const status = feature?.properties?.estatus;

      layer.bindPopup(`<b>${safe(id)}</b>`);

      if (isEditLots) return;

      // Hover PC
      layer.on("mouseover", () => {
        if (pinnedLotLayer !== layer) layer.setStyle(lotVisibleStyle(status));
      });
      layer.on("mouseout", () => {
        if (pinnedLotLayer !== layer) layer.setStyle(lotHiddenStyle());
      });

      // Tap/Click = fijar + panel
      layer.on("click", () => {
        if (pinnedLotLayer && pinnedLotLayer !== layer){
          pinnedLotLayer.setStyle(lotHiddenStyle());
        }
        pinnedLotLayer = layer;
        layer.setStyle(lotPinnedStyle(status));
        showLote(id, feature.properties);
      });
    }
  }).addTo(map);

  const tipEditLots = isEditLots
    ? `<hr/><p><b>Modo edición LOTES:</b> dibuja y luego “Copiar GeoJSON (lotes)”.</p>`
    : "";

  setPanel(currentSection.nombre, `
    <p>Sección: <b>${safe(currentSection.nombre)}</b></p>
    <p>${isEditLots ? "Dibuja lotes y guárdalos." : "Pasa el mouse (PC) o toca (tablet) para ver lotes."}</p>
    ${tipEditLots}
  `);
}

async function backToSecciones(){
  currentSection = null;
  pinnedSectionLayer = null;
  pinnedLotLayer = null;

  clearLotsLayer();

  // recargar secciones
  await loadSecciones();
  $sectionSelect.value = "";
}

/* =========================================================
   SEARCH
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

function setupSearch(){
  const run = () => {
    const id = $searchInput.value.trim();
    if (!id) return;

    if (!currentSection){
      setPanel("Primero sección", `<p>Primero selecciona una <b>sección</b> para buscar lotes.</p>`);
      return;
    }

    const layer = findLoteLayerById(id);
    if (!layer){
      setPanel("No encontrado", `<p>No encontré <b>${safe(id)}</b> dentro de ${safe(currentSection.nombre)}.</p>`);
      return;
    }

    map.fitBounds(layer.getBounds().pad(0.25));

    // fijarlo visible aunque no haya hover
    if (pinnedLotLayer && pinnedLotLayer !== layer){
      pinnedLotLayer.setStyle(lotHiddenStyle());
    }
    pinnedLotLayer = layer;
    const st = layer.feature?.properties?.estatus;
    layer.setStyle(lotPinnedStyle(st));

    showLote(layer.feature.properties.id, layer.feature.properties);
  };

  $searchBtn.onclick = run;
  $searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

/* =========================================================
   EDITOR (CLICK-TO-DRAW)
   ========================================================= */
let editPoints = [];
let editMarkers = [];
let tempLine = null;
let tempPoly = null;

let createdSectionFeatures = [];
let createdLotFeatures = [];

let editClickAttached = false;

function toGeoJSONPolygon(pointsLatLng){
  // Leaflet CRS.Simple: lat=y, lng=x. GeoJSON: [x,y] => [lng,lat]
  const coords = pointsLatLng.map(p => [p.lng, p.lat]);
  if (coords.length) coords.push(coords[0]);
  return { type: "Polygon", coordinates: [coords] };
}

function refreshEditPreview(){
  if (tempLine) map.removeLayer(tempLine);
  if (tempPoly) map.removeLayer(tempPoly);

  if (editPoints.length >= 2){
    tempLine = L.polyline(editPoints, { weight: 2 }).addTo(map);
  }
  if (editPoints.length >= 3){
    tempPoly = L.polygon(editPoints, { weight: 2, fillOpacity: 0.12 }).addTo(map);
  }
}

function resetEditorDrawing(){
  editPoints = [];
  editMarkers.forEach(m => map.removeLayer(m));
  editMarkers = [];
  refreshEditPreview();
  const el = document.getElementById("ptCount");
  if (el) el.textContent = "0";
}

function attachMapClickForEditing(){
  if (editClickAttached) return;
  editClickAttached = true;

  map.on("click", (e) => {
    editPoints.push(e.latlng);

    const m = L.circleMarker(e.latlng, { radius: 5, weight: 1, fillOpacity: 0.9 }).addTo(map);
    editMarkers.push(m);

    refreshEditPreview();
    const el = document.getElementById("ptCount");
    if (el) el.textContent = String(editPoints.length);
  });
}

function editorBaseUI(title, innerHtml){
  setPanel(title, `
    ${innerHtml}
    <p><b>Puntos marcados:</b> <span id="ptCount">${editPoints.length}</span></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button id="e_clear" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar puntos</button>
    </div>
    <p style="font-size:12px;color:#666;margin-top:10px;">
      Tip: haz zoom para dibujar más preciso.
    </p>
  `);

  document.getElementById("e_clear").onclick = () => resetEditorDrawing();
}

function setupEditorSections(){
  editorBaseUI("Modo edición: SECCIONES", `
    <p>Haz clic alrededor de una <b>sección</b> (polígono grande).</p>

    <label><b>ID sección</b></label><br/>
    <input id="e_sid" placeholder="Ej. SEC-002" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

    <label><b>Nombre sección</b></label><br/>
    <input id="e_sname" placeholder="Ej. San Juan VIP 2" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button id="e_save_section" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar sección</button>
      <button id="e_copy_sections" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON (secciones)</button>
    </div>
  `);

  document.getElementById("e_save_section").onclick = () => {
    const id = document.getElementById("e_sid").value.trim();
    const nombre = document.getElementById("e_sname").value.trim();

    if (!id) return alert("Pon un ID de sección (ej. SEC-002).");
    if (editPoints.length < 3) return alert("Necesitas mínimo 3 puntos.");

    const feature = {
      type: "Feature",
      geometry: toGeoJSONPolygon(editPoints),
      properties: {
        id,
        nombre: nombre || id,
        lotesFile: `./data/lotes-${id}.geojson`
      }
    };

    createdSectionFeatures.push(feature);
    resetEditorDrawing();
    alert(`Sección guardada: ${id}.`);
  };

  document.getElementById("e_copy_sections").onclick = async () => {
    const fc = { type: "FeatureCollection", features: createdSectionFeatures };
    const txt = JSON.stringify(fc, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      alert("Copiado. Pégalo en data/secciones.geojson (reemplazando el contenido).");
    } catch {
      setPanel("Copia manual", `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };
}

function setupEditorLots(){
  if (!currentSection){
    editorBaseUI("Modo edición: LOTES", `
      <p><b>Primero selecciona una sección</b> arriba para dibujar lotes.</p>
      <p>Luego vuelve a intentar dibujar en el mapa.</p>
    `);
    return;
  }

  editorBaseUI(`Modo edición: LOTES (${safe(currentSection.nombre)})`, `
    <p>Haz clic alrededor de un <b>lote</b> (polígono chico) dentro de la sección.</p>

    <label><b>ID lote</b></label><br/>
    <input id="e_lid" placeholder="Ej. L-1411" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

    <label><b>Estatus</b></label><br/>
    <select id="e_status" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">
      <option>disponible</option>
      <option>ocupado</option>
      <option>por construir</option>
    </select>

    <label><b>Paquete (opcional)</b></label><br/>
    <input id="e_pkg" placeholder="Ej. PAQ-JARDIN-STD" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button id="e_save_lot" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar lote</button>
      <button id="e_copy_lots" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON (lotes)</button>
    </div>

    <p style="font-size:12px;color:#666;margin-top:10px;">
      Este GeoJSON se pega en: <b>${safe(currentSection.lotesFile)}</b>
    </p>
  `);

  document.getElementById("e_save_lot").onclick = () => {
    const id = document.getElementById("e_lid").value.trim();
    const status = document.getElementById("e_status").value;
    const pkg = document.getElementById("e_pkg").value.trim() || null;

    if (!id) return alert("Pon un ID de lote (ej. L-1411).");
    if (editPoints.length < 3) return alert("Necesitas mínimo 3 puntos.");

    const feature = {
      type: "Feature",
      geometry: toGeoJSONPolygon(editPoints),
      properties: { id, estatus: status, paquete: pkg }
    };

    createdLotFeatures.push(feature);
    resetEditorDrawing();
    alert(`Lote guardado: ${id}.`);
  };

  document.getElementById("e_copy_lots").onclick = async () => {
    const fc = { type: "FeatureCollection", features: createdLotFeatures };
    const txt = JSON.stringify(fc, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      alert(`Copiado. Pégalo en ${currentSection.lotesFile} (reemplazando el contenido).`);
    } catch {
      setPanel("Copia manual", `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };
}

/* =========================================================
   INIT
   ========================================================= */
async function main(){
  // Si algo truena, al menos lo mostramos en el panel
  window.addEventListener("error", (e) => {
    setPanel("Error en la página", `<p>${safe(e.message)}</p>`);
  });

  map = L.map("map", { crs: L.CRS.Simple, minZoom: -3, maxZoom: 4 });

  // cargar catálogos (si fallan, no rompe)
  try { lotesInfo = await loadJson(LOTES_INFO_URL); } catch { lotesInfo = {}; }
  try { paquetesInfo = await loadJson(PAQUETES_URL); } catch { paquetesInfo = {}; }

  // cargar base image
  const img = new Image();
  img.onload = async () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const bounds = [[0,0],[h,w]];

    L.imageOverlay(BASE_IMAGE_URL, bounds).addTo(map);
    map.fitBounds(bounds);

    // iniciar en secciones
    await loadSecciones();

    // si edit secciones: activar editor
    if (isEditSections){
      attachMapClickForEditing();
      setupEditorSections();
    }

    // si edit lots: el editor aparece al seleccionar sección (selectSection)
    if (isEditLots){
      setPanel("Modo edición: LOTES", `
        <p>1) Selecciona una sección arriba.</p>
        <p>2) Dibuja lotes y guárdalos.</p>
      `);
    }
  };

  img.onerror = () => {
    setPanel("No se cargó el mapa base", `
      <p>No pude cargar <code>${safe(BASE_IMAGE_URL)}</code></p>
      <p>Revisa que exista <b>assets/map/base.png</b> en el repo.</p>
    `);
  };

  img.src = BASE_IMAGE_URL;

  // UI events
  setupSearch();

  $sectionSelect.onchange = async () => {
    const selectedId = $sectionSelect.value;

    if (!selectedId){
      await backToSecciones();
      return;
    }

    // si la capa secciones no existe (porque estamos dentro de lotes), recargarla para localizar la feature
    if (!seccionesLayer){
      await loadSecciones();
    }

    let targetFeature = null;
    seccionesLayer.eachLayer(layer => {
      const f = layer?.feature;
      if (f?.properties?.id === selectedId) targetFeature = f;
    });

    if (targetFeature){
      // fijar visualmente la sección (si estamos en modo normal)
      if (!isEditSections){
        if (pinnedSectionLayer && pinnedSectionLayer !== seccionesLayer){
          // no hacemos nada aquí: el pinned real se setea en click del layer
        }
      }
      await selectSection(targetFeature);
    }
  };

  $backBtn.onclick = async () => {
    await backToSecciones();
    if (isEditLots){
      // reset editor state
      createdLotFeatures = [];
      resetEditorDrawing();
      setupEditorLots(); // mostrará “Primero selecciona sección”
    }
  };
}

main();