const BASE_IMAGE_URL = "./assets/map/base.png";

// Archivos nivel 1
const SECCIONES_URL = "./data/secciones.geojson";

// Info panel
const LOTES_INFO_URL = "./data/lotes.json";
const PAQUETES_URL   = "./data/paquetes.json";

// Edit modes
// ?edit=sections   => dibujar secciones
// ?edit=lots       => dibujar lotes dentro de una sección (requiere elegir sección)
const editMode = new URLSearchParams(location.search).get("edit"); // null | "sections" | "lots"
const isEditSections = editMode === "sections";
const isEditLots     = editMode === "lots";

let map;

// Info panel
let lotesInfo = {};
let paquetesInfo = {};

// Layers
let seccionesLayer = null;
let lotesLayer = null;

// State
let currentSection = null; // { id, nombre, lotesFile }

const $title = document.getElementById("panelTitle");
const $body  = document.getElementById("panelBody");

const $sectionSelect = document.getElementById("sectionSelect");
const $searchInput   = document.getElementById("searchInput");
const $searchBtn     = document.getElementById("searchBtn");
const $backBtn       = document.getElementById("backBtn");

function setPanel(title, html){
  $title.textContent = title;
  $body.innerHTML = html;
}
function safe(v){ return (v === null || v === undefined) ? "" : String(v); }

function styleSection(){
  return { weight: 2, opacity: 1, fillOpacity: 0.08 };
}
function styleByStatus(status){
  const s = (status || "").toLowerCase();
  if (s === "disponible") return { weight: 1, opacity: 1, fillOpacity: 0.30 };
  if (s === "ocupado")    return { weight: 1, opacity: 1, fillOpacity: 0.55 };
  if (s === "por construir") return { weight: 1, opacity: 1, dashArray: "4 4", fillOpacity: 0.20 };
  return { weight: 1, opacity: 1, fillOpacity: 0.25 };
}

async function loadJson(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`No se pudo cargar: ${url}`);
  return await r.json();
}

/* =========================
   Panel lote
   ========================= */
function showLote(id){
  const info = lotesInfo[id] || {};
  const status = info.estatus || "desconocido";

  let html = `
    <p><b>ID:</b> ${safe(id)}</p>
    <p><b>Estatus:</b> ${safe(status)}</p>
  `;

  if (status.toLowerCase() === "disponible"){
    html += `<h3>Paquetes</h3>`;
    const paqueteKey = info.paquete || null;
    if (paqueteKey && paquetesInfo[paqueteKey]){
      const p = paquetesInfo[paqueteKey];
      html += `<p><b>${safe(p.nombre)}</b></p>`;
      html += `<ul>${(p.items||[]).map(it => `<li>${safe(it)}</li>`).join("")}</ul>`;
    } else {
      html += `<p>No hay paquete asignado todavía.</p>`;
    }
  }

  if (status.toLowerCase() === "ocupado"){
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

/* =========================
   Secciones (nivel 1)
   ========================= */
function clearLotes(){
  if (lotesLayer){ lotesLayer.remove(); lotesLayer = null; }
  currentSection = null;
}

function showOnlySeccionesPanel(){
  const extra = (isEditSections || isEditLots) ? `
    <hr/>
    <p><b>Modo edición:</b> ${isEditSections ? "SECCIONES" : "LOTES"}</p>
  ` : "";

  setPanel("Secciones", `
    <p>1) Selecciona una <b>sección</b> en la lista de arriba.</p>
    <p>2) Luego podrás buscar o tocar un <b>lote</b>.</p>
    ${extra}
  `);
}

async function loadSecciones(){
  const geo = await loadJson(SECCIONES_URL);

  // llenar selector
  $sectionSelect.innerHTML = `<option value="">Selecciona sección...</option>`;
  geo.features.forEach(f => {
    const id = f?.properties?.id;
    const nombre = f?.properties?.nombre || id;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = nombre;
    $sectionSelect.appendChild(opt);
  });

  // dibujar secciones
  if (seccionesLayer) seccionesLayer.remove();
  seccionesLayer = L.geoJSON(geo, {
    style: styleSection,
    onEachFeature: (feature, layer) => {
      const id = feature?.properties?.id;
      const nombre = feature?.properties?.nombre || id;
      layer.bindPopup(`<b>${safe(nombre)}</b>`);
      layer.on("click", () => selectSection(feature));
    }
  }).addTo(map);

  showOnlySeccionesPanel();
}

function selectSection(feature){
  const props = feature?.properties || {};
  currentSection = {
    id: props.id,
    nombre: props.nombre || props.id,
    lotesFile: props.lotesFile
  };

  $sectionSelect.value = props.id || "";

  // zoom a sección
  const temp = L.geoJSON(feature);
  map.fitBounds(temp.getBounds().pad(0.15));

  // cargar lotes
  loadLotesForCurrentSection().catch(err => {
    setPanel("Error", `<p>No pude cargar lotes.</p><p style="color:#666;font-size:12px">${safe(err.message)}</p>`);
  });
}

async function loadLotesForCurrentSection(){
  if (!currentSection?.lotesFile){
    setPanel("Sección sin archivo", `<p>Esta sección no tiene “lotesFile”.</p>`);
    return;
  }

  // ocultar secciones solo si NO estamos editando secciones
  // (si editas secciones, conviene verlas siempre)
  if (!isEditSections){
    if (seccionesLayer) seccionesLayer.remove();
  }

  let geo;
  try {
    geo = await loadJson(currentSection.lotesFile);
  } catch {
    // si aún no existe el archivo de lotes, creamos una colección vacía en memoria
    geo = { type: "FeatureCollection", features: [] };
  }

  if (lotesLayer) lotesLayer.remove();
  lotesLayer = L.geoJSON(geo, {
    style: (feature) => {
      const id = feature?.properties?.id;
      const status = feature?.properties?.estatus || lotesInfo[id]?.estatus;
      return styleByStatus(status);
    },
    onEachFeature: (feature, layer) => {
      const id = feature?.properties?.id || "(sin id)";
      layer.bindPopup(`<b>${safe(id)}</b>`);
      layer.on("click", () => showLote(id));
    }
  }).addTo(map);

  const tipEditLots = isEditLots ? `
    <hr/>
    <p><b>Modo edición LOTES:</b> usa el panel para dibujar lotes en esta sección y luego “Copiar GeoJSON”.</p>
  ` : "";

  setPanel(currentSection.nombre, `
    <p>Sección: <b>${safe(currentSection.nombre)}</b>.</p>
    <p>Toca un lote o búscalo por ID.</p>
    ${tipEditLots}
  `);
}

async function backToSecciones(){
  clearLotes();
  await loadSecciones();
  $sectionSelect.value = "";
}

/* =========================
   Búsqueda
   ========================= */
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
    showLote(layer.feature.properties.id);
  };

  $searchBtn.onclick = run;
  $searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

/* =========================
   Editor (dibujar con clicks)
   ========================= */
let editPoints = [];
let tempLine = null;
let tempPoly = null;

let createdSectionFeatures = []; // para modo secciones
let createdLotFeatures = [];     // para modo lotes (de una sección)

function toGeoJSONPolygon(pointsLatLng){
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

function attachMapClickForEditing(){
  map.on("click", (e) => {
    editPoints.push(e.latlng);
    refreshEditPreview();
    const el = document.getElementById("ptCount");
    if (el) el.textContent = String(editPoints.length);
  });
}

function editorBaseUI(title, bodyHtml){
  setPanel(title, `
    ${bodyHtml}
    <p><b>Puntos marcados:</b> <span id="ptCount">${editPoints.length}</span></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button id="e_clear" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar puntos</button>
    </div>
    <p style="font-size:12px;color:#666;margin-top:10px;">
      Tip: haz zoom para dibujar más preciso.
    </p>
  `);

  document.getElementById("e_clear").onclick = () => {
    editPoints = [];
    refreshEditPreview();
    const el = document.getElementById("ptCount");
    if (el) el.textContent = "0";
  };
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

    editPoints = [];
    refreshEditPreview();
    document.getElementById("ptCount").textContent = "0";

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
    setPanel("Primero sección", `
      <p>Para dibujar <b>lotes</b>, primero selecciona una sección arriba.</p>
      <p>Luego recarga la página con <b>?edit=lots</b> si hace falta.</p>
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

    editPoints = [];
    refreshEditPreview();
    document.getElementById("ptCount").textContent = "0";

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

/* =========================
   Init
   ========================= */
async function main(){
  map = L.map("map", { crs: L.CRS.Simple, minZoom: -3, maxZoom: 4 });

  // cargar info panel (no rompe si faltan)
  try { lotesInfo = await loadJson(LOTES_INFO_URL); } catch { lotesInfo = {}; }
  try { paquetesInfo = await loadJson(PAQUETES_URL); } catch { paquetesInfo = {}; }

  // base image
  const img = new Image();
  img.onload = async () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const bounds = [[0,0],[h,w]];

    L.imageOverlay(BASE_IMAGE_URL, bounds).addTo(map);
    map.fitBounds(bounds);

    await loadSecciones();

    // Si el usuario abre en modo editar lotes y ya selecciona una sección, puede cargar lotes al seleccionar
    // Los editores se montan después del click/selección de sección (si es edit=lots)

    if (isEditSections){
      attachMapClickForEditing();
      setupEditorSections();
    }
  };

  img.onerror = () => setPanel("Falta base.png", `<p>No encontré <code>${safe(BASE_IMAGE_URL)}</code></p>`);
  img.src = BASE_IMAGE_URL;

  // UI events
  setupSearch();

  $sectionSelect.onchange = async () => {
    const selectedId = $sectionSelect.value;

    if (!selectedId){
      await backToSecciones();
      return;
    }

    // Asegurar que seccionesLayer exista
    if (!seccionesLayer){
      await loadSecciones();
    }

    let targetFeature = null;
    seccionesLayer.eachLayer(layer => {
      const f = layer?.feature;
      if (f?.properties?.id === selectedId) targetFeature = f;
    });

    if (targetFeature){
      selectSection(targetFeature);

      // Si estamos en modo editar lotes, activamos el editor después de entrar a sección
      if (isEditLots){
        attachMapClickForEditing();
        setupEditorLots();
      }
    }
  };

  $backBtn.onclick = async () => {
    await backToSecciones();
    // Si estabas editando lotes, vuelve a pedir sección
    if (isEditLots){
      editPoints = [];
      refreshEditPreview();
      createdLotFeatures = [];
      setupEditorLots(); // mostrará “Primero sección”
    }
  };
}

main();