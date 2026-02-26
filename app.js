const BASE_IMAGE_URL = "./assets/map/base.png";

// Archivos “nivel 1”
const SECCIONES_URL = "./data/secciones.geojson";

// Info del lote (panel)
const LOTES_INFO_URL = "./data/lotes.json";
const PAQUETES_URL   = "./data/paquetes.json";

let map;

// Info (panel)
let lotesInfo = {};
let paquetesInfo = {};

// Capas del mapa (lo que se dibuja encima)
let seccionesLayer = null; // nivel 1
let lotesLayer = null;     // nivel 2

// Estado actual
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
   Panel de lote
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
   Cargar / mostrar SECCIONES (nivel 1)
   ========================= */
function clearLotes(){
  if (lotesLayer){ lotesLayer.remove(); lotesLayer = null; }
  currentSection = null;
}

function showOnlySeccionesPanel(){
  setPanel("Secciones", `
    <p>1) Selecciona una <b>sección</b> en la lista de arriba.</p>
    <p>2) Luego podrás buscar o tocar un <b>lote</b>.</p>
  `);
}

async function loadSecciones(){
  const geo = await loadJson(SECCIONES_URL);

  // Llenar el selector
  $sectionSelect.innerHTML = `<option value="">Selecciona sección...</option>`;
  geo.features.forEach(f => {
    const id = f?.properties?.id;
    const nombre = f?.properties?.nombre || id;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = nombre;
    $sectionSelect.appendChild(opt);
  });

  // Dibujar secciones en el mapa
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

  // sincronizar selector (si el click fue en el mapa)
  $sectionSelect.value = props.id || "";

  // zoom a la sección
  const temp = L.geoJSON(feature);
  map.fitBounds(temp.getBounds().pad(0.15));

  // cargar lotes
  loadLotesForCurrentSection().catch(err => {
    setPanel("Error", `<p>No pude cargar lotes de la sección.</p><p style="color:#666;font-size:12px">${safe(err.message)}</p>`);
  });
}

async function loadLotesForCurrentSection(){
  if (!currentSection?.lotesFile){
    setPanel("Sección sin archivo", `<p>Esta sección no tiene “lotesFile”.</p>`);
    return;
  }

  // Oculta secciones (para que no estorben visualmente)
  if (seccionesLayer) seccionesLayer.remove();

  const geo = await loadJson(currentSection.lotesFile);

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

  setPanel(currentSection.nombre, `
    <p>Ya estás dentro de la sección: <b>${safe(currentSection.nombre)}</b>.</p>
    <p>Ahora puedes tocar un lote o buscarlo por ID.</p>
  `);
}

/* =========================
   Volver a SECCIONES (botón)
   ========================= */
async function backToSecciones(){
  clearLotes();

  // volver a dibujar secciones
  await loadSecciones();
  $sectionSelect.value = "";
}

/* =========================
   Búsqueda de lotes
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
      setPanel("Primero sección", `<p>Primero selecciona una <b>sección</b> para poder buscar lotes.</p>`);
      return;
    }

    const layer = findLoteLayerById(id);
    if (!layer){
      setPanel("No encontrado", `<p>No encontré el ID <b>${safe(id)}</b> dentro de ${safe(currentSection.nombre)}.</p>`);
      return;
    }

    map.fitBounds(layer.getBounds().pad(0.25));
    showLote(layer.feature.properties.id);
  };

  $searchBtn.onclick = run;
  $searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

/* =========================
   Inicialización general
   ========================= */
async function main(){
  map = L.map("map", { crs: L.CRS.Simple, minZoom: -3, maxZoom: 4 });

  // Cargar info panel (si no existen, no rompe)
  try { lotesInfo = await loadJson(LOTES_INFO_URL); } catch { lotesInfo = {}; }
  try { paquetesInfo = await loadJson(PAQUETES_URL); } catch { paquetesInfo = {}; }

  // Cargar imagen base
  const img = new Image();
  img.onload = async () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const bounds = [[0,0],[h,w]];

    L.imageOverlay(BASE_IMAGE_URL, bounds).addTo(map);
    map.fitBounds(bounds);

    await loadSecciones(); // arranca en nivel 1
  };

  img.onerror = () => setPanel("Falta base.png", `<p>No encontré <code>${safe(BASE_IMAGE_URL)}</code></p>`);
  img.src = BASE_IMAGE_URL;

  // Eventos UI
  setupSearch();

  $sectionSelect.onchange = async () => {
    const selectedId = $sectionSelect.value;
    if (!selectedId){
      await backToSecciones();
      return;
    }

    // buscar la feature de esa sección en la capa
    // (si la capa ya no está porque estamos viendo lotes, recargamos secciones primero)
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
    }
  };

  $backBtn.onclick = () => backToSecciones();
}

main();