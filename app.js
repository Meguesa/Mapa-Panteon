/* =========================================================
   CONFIG
   ========================================================= */
const BASE_IMAGE_PUBLIC_URL = "./assets/map/base-public.webp"; // ligero (público)
const BASE_IMAGE_EDIT_URL   = "./assets/map/base.png";         // alta res (edición)

// Tus GeoJSON están guardados en coordenadas del mapa base.png (referencia histórica)
const DATA_COORD_WIDTH  = 11100;
const DATA_COORD_HEIGHT = 9250;

// Archivos de datos
const SECCIONES_TOP_URL = "./data/secciones-top.geojson"; // editor ?edit=secciones + PUBLICO secciones
const MANZANAS_URL      = "./data/secciones.geojson";     // MANZANAS
const NICHOS_ZONAS_URL  = "./data/nichos-zonas.geojson";  // COLUMBARIOS (ZONAS)
const NICHOS_OVERLAY_URL = "./data/nichos-overlay.geojson"; // NICHOS por columbario/cara (rectángulos)

// Catálogos
const LOTES_INFO_URL    = "./data/lotes.json";
const PAQUETES_URL      = "./data/paquetes.json";

const INVENTARIO_BASE_URL = "./data/inventario-base.json";
const INVENTARIO_OVERRIDES_URL = "./data/inventario-overrides.json";
const CATALOGO_PROPIEDADES_URL = "./data/catalogo-propiedades.json";

// Edit modes:
// ?edit=secciones  => EDITOR SECCIONES
// ?edit=manzanas   => EDITOR MANZANAS
// ?edit=lotes      => EDITOR LOTES
const editMode = new URLSearchParams(location.search).get("edit"); // null | "secciones" | "manzanas" | "lotes" | "nichos" | "nichos-overlay"
const isEditSecciones = editMode === "secciones";
const isEditManzanas  = editMode === "manzanas";
const isEditLotes     = editMode === "lotes";
const isEditNichos    = editMode === "nichos";
// aceptar ambas variantes por si tecleas ?edit=nichos-overlays
const isEditNichosOverlay = (editMode === "nichos-overlay" || editMode === "nichos-overlays");
const IS_EDIT = !!editMode;

// UI layout: pantalla completa en nichos-overlay
if (isEditNichosOverlay) {
  try { document.body.classList.add('fullMap'); } catch {}
}

const BASE_IMAGE_URL = (isEditSecciones || isEditManzanas || isEditLotes || isEditNichos || isEditNichosOverlay)
  ? BASE_IMAGE_EDIT_URL
  : BASE_IMAGE_PUBLIC_URL;

// Detectar móvil/tablet
const IS_MOBILE = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

/* =========================================================
   UX: NOTIFICACIONES (sin pop-ups)
   - En index.html idealmente defines window.toast(msg)
   - Aquí usamos notify() en lugar de alert()
   - confirm() se mantiene para borrados/acciones críticas
   ========================================================= */
function notify(msg, ms = 1800){
  try {
    if (typeof window.toast === "function") return window.toast(msg, ms);
  } catch {}
  try { console.log("[INFO]", msg); } catch {}
}

/* =========================================================
   GLOBAL STATE
   ========================================================= */
let map;

let lotesInfo = {};
let paquetesInfo = {};

let inventarioBase = {};
let inventarioOverrides = {};

let catalogoPropiedades = [];
let catalogoById = {};
let catalogoSearch = [];
let filtroEstatusActual = "todos";

// RAW (coords base.png)
let seccionesTopRaw = null;   // SECCIONES
let manzanasRaw = null;       // MANZANAS

// Scaled a base actual (público)
let seccionesTopScaled = null; // SECCIONES escaladas
let manzanasScaled = null;     // MANZANAS escaladas
let lotesScaled = null;        // LOTES escalados

let seccionesLayer = null;         // editor secciones
let seccionesLayerPublic = null;   // PUBLICO secciones
let manzanasLayer = null;          // público + editor manzanas
let lotesLayer = null;             // público + editor lotes

// NICHOS (público + editor)
let nichosZonasRaw = null;
let nichosZonasScaled = null;
let nichosOverlayRaw = null; // FeatureCollection rects
let nichosZonasLayerPublic = null;
let pinnedNichoZonaLayer = null;


let currentSeccion = null;
let currentSeccionFeature = null;
let currentManzanaFeature = null;
let currentLotesRaw = null;
let currentLotesSeccion = null;      // editor LOTES: seccion cargada en memoria
let currentLotesSourceUrl = null;    // editor LOTES: fuente cargada

let showAllLots = false;
let hoverNameTooltip = null;

// escala data->imagen cargada (para público)
let COORD_SCALE_X = 1;
let COORD_SCALE_Y = 1;

// DOM
const $title = document.getElementById("panelTitle");
const $body  = document.getElementById("panelBody");

const $seccionSelect  = document.getElementById("sectionSelect");
const $manzanaSelect  = document.getElementById("manzanaSelect");

const $loteInput      = document.getElementById("searchInput");
const $searchBtn      = document.getElementById("searchBtn");
const $backBtn        = document.getElementById("backBtn");
const $toggleLotsBtn  = document.getElementById("toggleLotsBtn");

const $sidePanel =
  $title?.closest("aside, .sidebar, .side-panel, .right-panel, .panel, #sidePanel, #infoPanel, #panel, .info-panel") ||
  document.getElementById("sidePanel") ||
  document.getElementById("infoPanel") ||
  document.getElementById("panel");

if ($sidePanel) {
  $sidePanel.classList.add("jp-side-panel");
}

document.body.classList.toggle("public-map", !IS_EDIT);
document.body.classList.toggle("edit-map", IS_EDIT);

function forceInitialPublicMapResize() {
  if (IS_EDIT) return;

  applyPublicLayoutMode(false);

  const runResize = () => {
    try {
      if (map) map.invalidateSize(true);
    } catch {}
  };

  requestAnimationFrame(runResize);
  setTimeout(runResize, 120);
  setTimeout(runResize, 300);
  setTimeout(runResize, 600);
}

/* =========================================================
   HELPERS
   ========================================================= */
function setPanel(title, html){
  $title.textContent = title;
  $body.innerHTML = html;
}

function refreshMapSizeSoon(){
  window.setTimeout(() => {
    try {
      if (map) map.invalidateSize(true);
    } catch {}
  }, 80);
}

function applyPublicLayoutMode(isPanelOpen){
  if (IS_EDIT) return;

  const layout = document.querySelector(".layout");
  const mapEl = document.getElementById("map");

  if (isPanelOpen) {
    document.body.classList.add("has-section-selected");

    if (layout) {
      layout.style.display = "grid";
      layout.style.gridTemplateColumns = "minmax(0, 1fr) 420px";
      layout.style.gridTemplateRows = "1fr";
      layout.style.height = "calc(100vh - var(--topbar-h, 52px))";
      layout.style.overflow = "hidden";
    }

    if ($sidePanel) {
      $sidePanel.style.display = "block";
      $sidePanel.style.width = "420px";
      $sidePanel.style.minWidth = "420px";
      $sidePanel.style.maxWidth = "420px";
      $sidePanel.style.boxSizing = "border-box";
      $sidePanel.style.padding = "18px";
      $sidePanel.style.borderLeft = "1px solid #eadcc6";
      $sidePanel.style.overflowY = "auto";
      $sidePanel.style.overflowX = "hidden";
    }

    if ($body) {
      $body.style.width = "100%";
      $body.style.maxWidth = "100%";
      $body.style.boxSizing = "border-box";
      $body.style.overflowX = "hidden";
    }

    if (mapEl) {
      mapEl.style.width = "100%";
      mapEl.style.height = "100%";
    }
  } else {
    document.body.classList.remove("has-section-selected");

    if (layout) {
      layout.style.display = "grid";
      layout.style.gridTemplateColumns = "minmax(0, 1fr)";
      layout.style.gridTemplateRows = "1fr";
      layout.style.height = "calc(100vh - var(--topbar-h, 52px))";
      layout.style.overflow = "hidden";
    }

    if ($sidePanel) {
      $sidePanel.style.display = "none";
      $sidePanel.style.width = "0";
      $sidePanel.style.minWidth = "0";
      $sidePanel.style.maxWidth = "0";
      $sidePanel.style.padding = "0";
      $sidePanel.style.borderLeft = "0";
      $sidePanel.style.overflow = "hidden";
    }

    if (mapEl) {
      mapEl.style.width = "100%";
      mapEl.style.height = "100%";
    }
  }

  refreshMapSizeSoon();

  setTimeout(() => {
    try {
      if (map) map.invalidateSize(true);
    } catch {}
  }, 200);
}

function openPublicSidePanel(){
  applyPublicLayoutMode(true);
}

function closePublicSidePanel(){
  applyPublicLayoutMode(false);
}

function closeModal(){
  const existing = document.getElementById("propertyModalOverlay");
  if (existing) existing.remove();
}

function showModal(title, html){
  closeModal();

  const overlay = document.createElement("div");
  overlay.id = "propertyModalOverlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.45)";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "20px";

  overlay.innerHTML = `
    <div
      id="propertyModalBox"
      style="
        width:min(720px, 95vw);
        max-height:85vh;
        overflow:auto;
        background:#fff8e8;
        border-radius:14px;
        box-shadow:0 20px 60px rgba(0,0,0,0.35);
        border:1px solid #d1d5db;
      "
    >
      <div
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding:16px 18px;
          border-bottom:1px solid #d1d5db;
          background:#fff3d5;
          position:sticky;
          top:0;
          z-index:1;
        "
      >
        <h2 style="margin:0;font-size:20px;">${safe(title)}</h2>
        <button
          id="propertyModalClose"
          style="
            border:1px solid #d1d5db;
            background:white;
            border-radius:8px;
            padding:6px 10px;
            cursor:pointer;
            font-weight:700;
          "
        >
          Cerrar
        </button>
      </div>

      <div style="padding:18px;">
        ${html}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("propertyModalClose");
  if (closeBtn) closeBtn.onclick = closeModal;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
  }
});

function safe(v){ return (v === null || v === undefined) ? "" : String(v); }

function clamp(v, a, b){
  const x = Number(v);
  if (!isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

async function loadJson(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`No se pudo cargar: ${url}`);
  return await r.json();
}

function normSeccionInv(v){
  const s = (v ?? "").toString().trim().toUpperCase();

  const aliases = {
    "SJV": "SAN JUAN VIP",
    "SMV": "SAN MATEO VIP",
    "SPV": "SAN PEDRO VIP"
  };

  return aliases[s] || s;
}

function normInv(v){
  return (v ?? "").toString().trim().toUpperCase();
}

const SECCIONES_OCULTAS_DROPDOWN = new Set([
  "ESTACIONAMIENTO",
  "CAPILLA AGUA FRÍA",
  "OFICINAS PANTEÓN",
  "ENTRADA",
  "SALIDA",
  "IGLESIA",
  "AFECTACION",
  "COMA",
  "M.",
  "P B",
  "A APODACA",
  "A CARRETERA ZUAZUA-NUEVO LAREDO"
]);

function isSeccionVisibleEnDropdown(seccion) {
  const s = (seccion ?? "").toString().trim().toUpperCase();

  if (!s) return false;

  return !SECCIONES_OCULTAS_DROPDOWN.has(s);
}

function normStatus(v){
  const s = (v ?? "").toString().trim().toLowerCase();

  if (["disponible", "libre"].includes(s)) return "disponible";
  if (["separado", "separada", "apartado", "apartada"].includes(s)) return "separado";
  if (["suspendido", "suspendida"].includes(s)) return "suspendido";
  if (["vendido", "vendida"].includes(s)) return "vendido";
  if (["utilizado", "utilizada", "ocupado", "ocupada", "usado", "usada"].includes(s)) return "utilizado";
  if (["por construir", "por_construir", "no construida", "no construidas"].includes(s)) return "por_construir";

  return s || "desconocido";
}

function normCodigoLote(v){
  const s = normInv(v);

  if (/^\d+$/.test(s)) {
    return String(Number(s));
  }

  return s;
}

function keyLote(seccion, manzana, lote){
  return `LOTE|${normSeccionInv(seccion)}|${normInv(manzana)}|${normCodigoLote(lote)}`;
}

function keyNicho(zonaId, cara, codigo){
  return `NICHO|${normInv(zonaId)}|${normInv(cara)}|${normInv(codigo)}`;
}

function buildInventarioIndex(raw){
  const index = {};

  for (const item of raw?.items || []){
    const tipo = (item.tipo || "").toString().trim().toLowerCase();

    if (tipo === "lote"){
      const k = keyLote(item.seccion, item.manzana, item.codigo);
      index[k] = item;
    }

    if (tipo === "nicho"){
      const k = keyNicho(item.zonaId || item.columbario, item.cara, item.codigo);
      index[k] = item;
    }
  }

  return index;
}

function normalizeCatalogSearchText(value){
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizeSearchWords(value){
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function removeLeadingZerosFromSearchWords(value){
  return normalizeSearchWords(value)
    .split(" ")
    .map(part => {
      if (/^\d+$/.test(part)) {
        return String(Number(part));
      }

      return part;
    })
    .join(" ");
}

function compactSearchValue(value){
  return normalizeSearchWords(value).replace(/\s+/g, "");
}

function buildCatalogSearchVariants(item){
  const values = [
    item.id,
    item.displayName,
    item.tipo,
    item.seccion,
    item.manzana,
    item.zonaId,
    item.cara,
    item.codigo,
    item.estatus,
    item.referencia_procap,
    item.observaciones,
    item.searchText
  ];

  if (item.tipo === "lote"){
    const codigoSinCeros = removeLeadingZerosFromSearchWords(item.codigo);

    values.push(`${item.seccion} ${item.codigo} ${item.manzana}`);
    values.push(`${item.seccion}-${item.codigo}-${item.manzana}`);
    values.push(`${item.seccion}${item.codigo}${item.manzana}`);

    values.push(`${item.seccion} ${codigoSinCeros} ${item.manzana}`);
    values.push(`${item.seccion}-${codigoSinCeros}-${item.manzana}`);
    values.push(`${item.seccion}${codigoSinCeros}${item.manzana}`);

    values.push(`${item.seccion} ${item.manzana} ${item.codigo}`);
    values.push(`${item.seccion}-${item.manzana}-${item.codigo}`);
    values.push(`${item.seccion}${item.manzana}${item.codigo}`);

    values.push(`${item.seccion} ${item.manzana} ${codigoSinCeros}`);
    values.push(`${item.seccion}-${item.manzana}-${codigoSinCeros}`);
    values.push(`${item.seccion}${item.manzana}${codigoSinCeros}`);
  }

  const raw = values.filter(Boolean).join(" ");

  const words = normalizeSearchWords(raw);
  const wordsNoZeros = removeLeadingZerosFromSearchWords(raw);

  return {
    words,
    wordsNoZeros,
    compact: compactSearchValue(words),
    compactNoZeros: compactSearchValue(wordsNoZeros)
  };
}

function buildCatalogoPropiedades(raw){
  const items = Array.isArray(raw?.items) ? raw.items : [];

  catalogoPropiedades = items;
  catalogoById = {};
  catalogoSearch = [];

  for (const item of items){
    if (!item || !item.id) continue;

    const id = item.id.toString().trim();

    catalogoById[id] = item;

const variants = buildCatalogSearchVariants(item);

    catalogoSearch.push({
      id,
      tipo: item.tipo || "",
      seccion: item.seccion || "",
      manzana: item.manzana || "",
      codigo: item.codigo || "",
      estatus: item.estatus || "",
      referencia_procap: item.referencia_procap || "",
      displayName: item.displayName || "",
      searchText: normalizeCatalogSearchText(item.searchText || ""),
      searchWords: variants.words,
      searchWordsNoZeros: variants.wordsNoZeros,
      searchCompact: variants.compact,
      searchCompactNoZeros: variants.compactNoZeros
    });
  }
}

function findCatalogoById(id){
  const key = (id ?? "").toString().trim();

  if (!key) return null;

  return catalogoById[key] || null;
}

function slugCatalogValue(value){
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function makeCatalogLoteId(seccion, manzana, codigo){
  const sec = slugCatalogValue(seccion);
  const man = slugCatalogValue(manzana) || "SIN-MANZANA";
  const cod = slugCatalogValue(normalizeCodigoBusqueda(codigo));

  if (!sec || !cod) return "";

  return `LOTE-${sec}-${man}-${cod}`;
}

function getCatalogoItemForLoteFeature(feature){
  const p = feature?.properties || {};

  const seccion = p.seccion || currentSeccion || getPropSeccion(currentManzanaFeature);
  const manzana = p.manzana || p.manzanaId || getPropManzana(currentManzanaFeature);
  const lote = p.lote || p.id || p.codigo;

  const catalogId = makeCatalogLoteId(seccion, manzana, lote);

  if (!catalogId) return null;

  return findCatalogoById(catalogId);
}

function searchCatalogoPropiedades(query, limit = 20){
  const qWords = normalizeSearchWords(query);
  const qWordsNoZeros = removeLeadingZerosFromSearchWords(query);
  const qCompact = compactSearchValue(qWords);
  const qCompactNoZeros = compactSearchValue(qWordsNoZeros);

  if (!qWords && !qCompact) return [];

  return catalogoSearch
    .filter(item => {
      return (
        item.searchWords?.includes(qWords) ||
        item.searchWordsNoZeros?.includes(qWordsNoZeros) ||
        item.searchCompact?.includes(qCompact) ||
        item.searchCompactNoZeros?.includes(qCompactNoZeros)
      );
    })
    .slice(0, limit);
}

function normalizeLooseSearch(value){
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeCodigoBusqueda(value){
  const raw = (value ?? "").toString().trim().toUpperCase();

  if (!raw) return "";

  if (/^\d+$/.test(raw)) {
    return raw.padStart(3, "0");
  }

  return raw;
}

function findBestCatalogoMatch(query){
  const q = normalizeLooseSearch(query);

  if (!q) return null;

  const directResults = searchCatalogoPropiedades(q, 10);

  if (directResults.length === 1) {
    return catalogoById[directResults[0].id] || null;
  }

  if (directResults.length > 1) {
    const exact = directResults.find(r => {
      return normalizeLooseSearch(r.id) === q ||
             normalizeLooseSearch(r.referencia_procap) === q ||
             normalizeLooseSearch(r.displayName) === q;
    });

    if (exact) {
      return catalogoById[exact.id] || null;
    }

    return null;
  }

  return null;
}

function renderCatalogoSearchResults(results, originalQuery){
  if (!results.length){
    setPanel("Sin resultados", `
      <p>No encontré propiedades relacionadas con:</p>
      <p><b>${safe(originalQuery)}</b></p>
      <p style="margin:2px 0;font-size:12px;color:#6b7280;">
        Puedes intentar con una referencia como <b>PLATINO - 011 - B</b>,
        o con sección, manzana y lote.
      </p>
    `);
    return;
  }

  const html = `
    <p>Encontré varias coincidencias para:</p>
    <p><b>${safe(originalQuery)}</b></p>

    <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
      ${results.slice(0, 15).map(r => `
        <button
          class="catalogResultBtn"
          data-id="${safe(r.id)}"
          style="text-align:left;padding:10px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer;"
        >
          <b>${safe(r.displayName || r.id)}</b><br/>
          <span style="font-size:12px;color:#6b7280;">
            ${safe(r.estatus)} · ${safe(r.referencia_procap || r.id)}
          </span>
        </button>
      `).join("")}
    </div>
  `;

  setPanel("Resultados de búsqueda", html);

  document.querySelectorAll(".catalogResultBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const item = findCatalogoById(id);

      if (item) {
        await openCatalogoItem(item);
      }
    };
  });
}

async function openCatalogoItem(item){
  if (!item){
    setPanel("No encontrada", `<p>No se encontró la propiedad seleccionada.</p>`);
    return;
  }

  if (item.tipo !== "lote"){
    setPanel("Propiedad encontrada", `
      <p><b>${safe(item.displayName || item.id)}</b></p>
      <p><b>Tipo:</b> ${safe(item.tipo)}</p>
      <p><b>Estatus:</b> ${safe(item.estatus)}</p>
      <p><b>Referencia ProcaP:</b> ${safe(item.referencia_procap)}</p>
      <p style="margin:2px 0;font-size:12px;color:#6b7280;">
        La navegación automática para nichos la agregaremos en un paso posterior.
      </p>
    `);
    return;
  }

  const sec = item.seccion;
  const man = item.manzana;
  const lote = item.codigo;

  if (!sec || !man || !lote){
    setPanel("Datos incompletos", `
      <p>La propiedad existe en el catálogo, pero no tiene sección, manzana o lote completo.</p>
      <p><b>ID:</b> ${safe(item.id)}</p>
      <p><b>Referencia:</b> ${safe(item.referencia_procap)}</p>
    `);
    return;
  }

  $seccionSelect.value = sec;

  await ensureManzanaSelected(sec, man);

  $manzanaSelect.value = man;
  $loteInput.value = lote;

  const layer = findLotLayerByInput(lote);

  if (!layer){
    setPanel("Propiedad en catálogo", `
      <p>Encontré la propiedad en el catálogo, pero todavía no encontré su dibujo en el GeoJSON.</p>
      <p><b>${safe(item.displayName || item.id)}</b></p>
      <p><b>Estatus:</b> ${safe(item.estatus)}</p>
      <p><b>Referencia ProCaP:</b> ${safe(item.referencia_procap)}</p>
      <p style="margin:2px 0;font-size:12px;color:#6b7280;">
        Esto normalmente significa que el lote existe en Excel/Inventario, pero el polígono del mapa no tiene el mismo lote, sección o manzana.
      </p>
    `);
    return;
  }

  if (isCircleFeature(currentManzanaFeature)) {
    centerOnLayerNoZoom(layer, 120);
  } else {
    flyToBoundsSmooth(layer.getBounds().pad(0.35), 0.45);
  }

  const st = getLoteStatus(layer.feature);
  const base = lotPinnedStyle(st);

  layer.setStyle(base);
  pulseLayer(layer, base, { ms: 200 });

  showLoteInfo(layer.feature);
}

function getLoteInventoryItem(feature){
  const p = feature?.properties || {};

  const seccion = p.seccion || currentSeccion || getPropSeccion(currentManzanaFeature);
  const manzana = p.manzana || p.manzanaId || getPropManzana(currentManzanaFeature);
  const lote = p.lote || p.id || p.codigo;

  const k = keyLote(seccion, manzana, lote);

  return inventarioOverrides[k] || inventarioBase[k] || null;
}

function getLoteStatus(feature){
  const inv = getLoteInventoryItem(feature);

  if (!inv) return "sin_inventario";

  return normStatus(inv.estatus || "desconocido");
}

function shouldShowLoteByFiltro(feature){
  if (filtroEstatusActual === "todos") return true;

  const status = normStatus(getLoteStatus(feature));

  return status === filtroEstatusActual;
}

function applyFiltroEstatusToLotes(){
  if (!lotesLayer) return;

  lotesLayer.eachLayer(layer => {
    const visible = shouldShowLoteByFiltro(layer.feature);

    if (visible){
      const st = getLoteStatus(layer.feature);

      if (pinnedLotLayer === layer) {
        layer.setStyle(lotPinnedStyle(st));
      } else {
        layer.setStyle(lotBaseStyle(st));
      }

      if (layer.getElement) {
        const el = layer.getElement();
        if (el) el.style.display = "";
      }
    } else {
      if (layer.getElement) {
        const el = layer.getElement();
        if (el) el.style.display = "none";
      } else {
        layer.setStyle({
          opacity: 0,
          fillOpacity: 0,
          interactive: false
        });
      }
    }
  });
}

function getLotesStatusCounts(){
  const counts = {
    total: 0,
    disponible: 0,
    separado: 0,
    vendido: 0,
    utilizado: 0,
    suspendido: 0,
    por_construir: 0,
    desconocido: 0,
    sin_inventario: 0
  };

  if (!lotesLayer) return counts;

  lotesLayer.eachLayer(layer => {
    const status = normStatus(getLoteStatus(layer.feature));

    counts.total += 1;

    if (counts[status] === undefined) {
      counts.desconocido += 1;
    } else {
      counts[status] += 1;
    }
  });

  return counts;
}

function getFiltroEstatusHtml(){
  const counts = getLotesStatusCounts();
  
  const btnBase = `
    padding:6px 10px;
    border-radius:8px;
    border:1px solid #d1d5db;
    background:white;
    cursor:pointer;
    font-size:12px;
    box-sizing:border-box;
    max-width:100%;
  `;

  const btnActive = `
    padding:6px 10px;
    border-radius:8px;
    border:1px solid #111827;
    background:#111827;
    color:white;
    cursor:pointer;
    font-size:12px;
    box-sizing:border-box;
    max-width:100%;
  `;

  function btn(label, status){
    const active = filtroEstatusActual === status;
    return `
      <button
        class="statusFilterBtn"
        data-status="${safe(status)}"
        style="${active ? btnActive : btnBase}"
      >
        ${safe(label)}
      </button>
    `;
  }

  return `
    <hr/>
    <h4 style="margin:8px 0 6px 0;">Visualización de lotes</h4>

    <button
      id="panelToggleLotsBtn"
      style="
        display:block;
        width:100%;
        max-width:100%;
        box-sizing:border-box;
        margin:0 0 10px 0;
        padding:8px 10px;
        border-radius:8px;
        border:1px solid #111827;
        background:${showAllLots ? "#111827" : "white"};
        color:${showAllLots ? "white" : "#111827"};
        cursor:pointer;
        font-weight:700;
      "
    >
      ${showAllLots ? "Ocultar lotes" : "Mostrar lotes"}
    </button>

    <h4 style="margin:8px 0 6px 0;">Filtrar lotes por estatus</h4>

    <div style="
      display:flex;
      flex-wrap:wrap;
      gap:6px;
      margin-bottom:8px;
      width:100%;
      max-width:100%;
      box-sizing:border-box;
      overflow:visible;
    ">
      ${btn(`Todos (${counts.total})`, "todos")}
      ${btn(`Disponible (${counts.disponible})`, "disponible")}
      ${btn(`Separado (${counts.separado})`, "separado")}
      ${btn(`Vendido (${counts.vendido})`, "vendido")}
      ${btn(`Utilizado (${counts.utilizado})`, "utilizado")}
      ${btn(`Suspendido (${counts.suspendido})`, "suspendido")}
      ${btn(`Por construir (${counts.por_construir})`, "por_construir")}
      ${btn(`Sin inventario (${counts.sin_inventario})`, "sin_inventario")}
    </div>

    <p style="margin:2px 0;font-size:12px;color:#6b7280;">
      Filtro actual: <b>${safe(filtroEstatusActual)}</b>
    </p>

    <div
      style="
        display:block;
        width:100%;
        max-width:100%;
        box-sizing:border-box;
        margin:8px 0 0 0;
        padding:8px;
        border:1px solid #e5e7eb;
        border-radius:8px;
        background:#fff;
        overflow:hidden;
      "
    >
      <p style="margin:2px 0;font-size:12px;"><b>Resumen de manzana</b></p>
      <p style="margin:2px 0;font-size:12px;">Total: <b>${safe(counts.total)}</b></p>
      <p style="margin:2px 0;font-size:12px;">Disponible: <b>${safe(counts.disponible)}</b></p>
      <p style="margin:2px 0;font-size:12px;">Separado: <b>${safe(counts.separado)}</b></p>
      <p style="margin:2px 0;font-size:12px;">Vendido: <b>${safe(counts.vendido)}</b></p>
      <p style="margin:2px 0;font-size:12px;">Utilizado: <b>${safe(counts.utilizado)}</b></p>
      <p style="margin:2px 0;font-size:12px;">Suspendido: <b>${safe(counts.suspendido)}</b></p>
      <p style="margin:2px 0;font-size:12px;">Por construir: <b>${safe(counts.por_construir)}</b></p>
      <p style="margin:2px 0;font-size:12px;">Sin inventario: <b>${safe(counts.sin_inventario)}</b></p>
      ${counts.desconocido ? `
        <p style="margin:2px 0;font-size:12px;">Desconocido: <b>${safe(counts.desconocido)}</b></p>
      ` : ""}
    </div>
  `;
}

function refreshManzanaPanel(){
  if (!currentManzanaFeature) return;

  const sec = currentSeccion || getPropSeccion(currentManzanaFeature);
  const man = getPropManzana(currentManzanaFeature);
  const manzanaPkg = currentManzanaFeature?.properties?.paquete || null;

  setPanel(`SECCIÓN ${safe(sec)} — MANZANA ${safe(man)}`, `
    <p><b>Paquete (manzana):</b> ${manzanaPkg ? safe(manzanaPkg) : "<i>Sin paquete asignado</i>"}</p>
    <p>Selecciona un lote o usa <b>Mostrar lotes</b>.</p>
    ${getFiltroEstatusHtml()}
  `);

  bindFiltroEstatusButtons();
}

function bindFiltroEstatusButtons(){
  const panelToggleBtn = document.getElementById("panelToggleLotsBtn");

  if (panelToggleBtn){
    panelToggleBtn.onclick = () => {
      showAllLots = !showAllLots;
      updateToggleLotsButton();
      applyFiltroEstatusToLotes();
      refreshManzanaPanel();
    };
  }

  document.querySelectorAll(".statusFilterBtn").forEach(btn => {
    btn.onclick = () => {
      filtroEstatusActual = btn.getAttribute("data-status") || "todos";
      applyFiltroEstatusToLotes();
      refreshManzanaPanel();
    };
  });
}

function deepCopy(obj){ return JSON.parse(JSON.stringify(obj)); }

/* =========================================================
   NICHOS (PÚBLICO)
   - COLUMBARIOS (zonas) como capa hover/click
   - Click abre modal full-screen sobre el mapa
   - Orden: Columbario -> Cara -> Nicho
   - Rectángulos por cara vienen de data/nichos-overlay.geojson
   ========================================================= */

const NICHOS_CARAS = [
  { value: "convexo", label: "CONVEXO" },
  { value: "concavo", label: "CONCAVO" },
];

const nichosUI = {
  open: false,
  zona: null,
  cara: "convexo",
  selectedNicho: null,

  $modal: null,
  $title: null,
  $zona: null,
  $subtitle: null,
  $cara: null,
  $btnClose: null,
  $img: null,
  $svg: null,
  $viewport: null,
  $zoom: null,
  $zoomPct: null,
  scale: 1,
  panX: 0,
  panY: 0,
  panning: false,
  panStart: null,
  $canvas: null,
  $sel: null,
  $info: null,
};

function nichosInitDom(){
  nichosUI.$modal = document.getElementById('nichosModal');
  nichosUI.$title = document.getElementById('nmTitle');
  nichosUI.$zona = document.getElementById('nmZona');
  nichosUI.$subtitle = document.getElementById('nmSubtitle');
  nichosUI.$sel = document.getElementById('nmSelection');
  nichosUI.$cara = document.getElementById('nmCara');
  nichosUI.$btnClose = document.getElementById('nmBtnClose');
  nichosUI.$img = document.getElementById('nmImg');
  nichosUI.$svg = document.getElementById('nmSvg');
  nichosUI.$viewport = document.getElementById('nmViewport');
  nichosUI.$zoom = document.getElementById('nmZoom');
  nichosUI.$zoomPct = document.getElementById('nmZoomPct');
  nichosUI.$canvas = document.querySelector('#nichosModal .nm-canvas');
  nichosUI.$info = document.getElementById('nmNichoInfo');

  if (nichosUI.$btnClose) nichosUI.$btnClose.onclick = () => nichosClose();


  // Zoom (range 10..250)
  if (nichosUI.$zoom){
    nichosUI.$zoom.oninput = () => {
      const pct = Number(nichosUI.$zoom.value || 100);
      const s = Math.max(0.10, Math.min(6.00, pct/100));
      nichosUI.scale = s;
      nichosApplyZoom();
      if (nichosUI.$zoomPct) nichosUI.$zoomPct.textContent = `${Math.round(nichosUI.scale*100)}%`;
    };
  }

  // Zoom con rueda del mouse + pan con drag/toque.
  // Nota: el slider se oculta por CSS, pero lo mantenemos sincronizado.
  if (nichosUI.$canvas){
    nichosUI.$canvas.addEventListener('wheel', (ev) => {
      if (!nichosUI.open) return;
      ev.preventDefault();

      const rect = nichosUI.$canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;

      const oldS = nichosUI.scale || 1;
      const factor = Math.exp((-ev.deltaY) * 0.0012);
      const newS = clamp(oldS * factor, 0.10, 6.00);
      if (newS === oldS) return;

      const wx = (mx - nichosUI.panX) / oldS;
      const wy = (my - nichosUI.panY) / oldS;
      nichosUI.panX = mx - wx * newS;
      nichosUI.panY = my - wy * newS;
      nichosUI.scale = newS;

      nichosApplyZoom();
      if (nichosUI.$zoom) nichosUI.$zoom.value = String(Math.round(newS * 100));
      if (nichosUI.$zoomPct) nichosUI.$zoomPct.textContent = `${Math.round(newS*100)}%`;
    }, { passive:false });

    const PAN_THRESHOLD = 6;

    nichosUI.$canvas.addEventListener('pointerdown', (ev) => {
      if (!nichosUI.open) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      nichosUI.panning = false;
      nichosUI.panStart = {
        x: ev.clientX,
        y: ev.clientY,
        panX: nichosUI.panX,
        panY: nichosUI.panY,
        target: ev.target || null,
        pointerId: ev.pointerId,
      };
      try { nichosUI.$canvas.setPointerCapture(ev.pointerId); } catch {}
    });

    nichosUI.$canvas.addEventListener('pointermove', (ev) => {
      if (!nichosUI.panStart) return;
      const dx = ev.clientX - nichosUI.panStart.x;
      const dy = ev.clientY - nichosUI.panStart.y;
      if (!nichosUI.panning && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      nichosUI.panning = true;
      try { ev.preventDefault(); ev.stopPropagation(); } catch {}
      nichosUI.panX = nichosUI.panStart.panX + dx;
      nichosUI.panY = nichosUI.panStart.panY + dy;
      nichosApplyZoom();
    });

    const endPan = (ev) => {
      const start = nichosUI.panStart;
      const didPan = !!nichosUI.panning;
      if (didPan) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch {}
        nichosUI.ignoreClickUntil = Date.now() + 250;
      }
      nichosUI.panning = false;
      nichosUI.panStart = null;
      try { nichosUI.$canvas.releasePointerCapture(ev.pointerId); } catch {}

      if (start && !didPan){
        const feat = start.target?.__nichoFeature || null;
        const pathEl = start.target?.closest ? start.target.closest('path') : null;
        if (feat && pathEl) nichosSelectFeature(feat, pathEl);
      }
    };
    nichosUI.$canvas.addEventListener('pointerup', endPan);
    nichosUI.$canvas.addEventListener('pointercancel', endPan);
  }

  if (nichosUI.$cara){
    // poblar opciones una vez
    if (nichosUI.$cara.options.length === 0){
      for (const c of NICHOS_CARAS){
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.textContent = c.label;
        nichosUI.$cara.appendChild(opt);
      }
    }

    nichosUI.$cara.onchange = () => {
      nichosUI.cara = (nichosUI.$cara.value || 'convexo');
      nichosUI.selectedNicho = null;
      nichosRender();
      nichosFocusStageMobile();
    };
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nichosUI.open) nichosClose();
  });
}

function nichosGetProp(f, key){
  return (f?.properties?.[key] ?? '').toString().trim();
}

function nichosIsMobile(){
  try { return window.matchMedia('(max-width: 768px)').matches; }
  catch { return window.innerWidth <= 768; }
}

function nichosFocusStageMobile(){
  if (!nichosIsMobile() || !nichosUI.open) return;
  const body = document.querySelector('#nichosModal .nm-body');
  const stage = document.querySelector('#nichosModal .nm-stage');
  if (!body || !stage) return;
  window.requestAnimationFrame(() => {
    const top = Math.max(0, (stage.offsetTop || 0) - 12);
    try { body.scrollTo({ top, behavior:'smooth' }); }
    catch { body.scrollTop = top; }
  });
}

function nichosLockBackgroundScroll(locked){
  try {
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;

    if (locked){
      if (body.dataset.nichosScrollLock === '1') return;
      const y = window.scrollY || window.pageYOffset || 0;
      body.dataset.nichosScrollLock = '1';
      body.dataset.nichosScrollY = String(y);
      html.classList.add('nichos-modal-open');
      body.classList.add('nichos-modal-open');
      body.style.position = 'fixed';
      body.style.top = `-${y}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';
      return;
    }

    if (body.dataset.nichosScrollLock !== '1') return;
    const y = Number(body.dataset.nichosScrollY || 0);
    delete body.dataset.nichosScrollLock;
    delete body.dataset.nichosScrollY;
    html.classList.remove('nichos-modal-open');
    body.classList.remove('nichos-modal-open');
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.right = '';
    body.style.width = '';
    body.style.overflow = '';
    html.style.overflow = '';
    window.scrollTo(0, y);
  } catch {}
}

function nichosZonaId(zona){
  return nichosGetProp(zona, 'id') || nichosGetProp(zona, 'zonaId') || '(sin id)';
}

function nichosResolveImageUrl(zona, cara){
  const p = zona?.properties || {};
  const k = (cara === 'concavo') ? 'imagenConcavo' : 'imagenConvexo';
  const url = (p[k] || '').toString().trim();
  return url || null;
}

function nichosFilterOverlayFeatures(zid, cara){
  const feats = (nichosOverlayRaw?.features || []);
  const z = (zid || '').toString().trim();
  const c = (cara || '').toString().trim().toLowerCase();
  return feats.filter(f => {
    const p = f?.properties || {};
    const tipo = (p.tipo || '').toString().trim().toLowerCase();
    const fz = (p.zonaId || p.columbarioId || '').toString().trim();
    const fc = (p.cara || '').toString().trim().toLowerCase();
    return tipo === 'nicho' && fz === z && (!fc || fc === c);
  });
}


function nichosFeatureCoordMode(feature){
  const p = feature?.properties || {};
  const explicit = (p.coordMode || p.coords || p.coordinateMode || '').toString().trim().toLowerCase();
  if (explicit === 'normalized' || explicit === 'normalizado' || explicit === 'ratio' || explicit === 'relativo' || explicit === 'norm') return 'normalized';
  if (explicit === 'pixel' || explicit === 'pixels' || explicit === 'px' || explicit === 'pixeles') return 'pixel';

  const ring = feature?.geometry?.coordinates?.[0] || [];
  let maxAbs = 0;
  for (const pt of ring){
    const x = Math.abs(Number(pt?.[0] || 0));
    const y = Math.abs(Number(pt?.[1] || 0));
    maxAbs = Math.max(maxAbs, x, y);
  }
  return maxAbs <= 2 ? 'normalized' : 'pixel';
}

function nichosRingToImageSpace(feature, imageWidth, imageHeight){
  const ring = feature?.geometry?.coordinates?.[0] || [];
  const mode = nichosFeatureCoordMode(feature);
  if (mode === 'normalized'){
    return ring.map(([x, y]) => [Number(x) * imageWidth, Number(y) * imageHeight]);
  }
  return ring.map(([x, y]) => [Number(x), Number(y)]);
}

function nichosRingFromImageSpace(ring, imageWidth, imageHeight, mode = 'normalized'){
  if (mode === 'normalized'){
    return ring.map(([x, y]) => [
      imageWidth ? Number(x) / imageWidth : 0,
      imageHeight ? Number(y) / imageHeight : 0,
    ]);
  }
  return ring.map(([x, y]) => [Number(x), Number(y)]);
}

function nichosGetPaqueteKey(feature, zonaFeature = null){
  const fp = feature?.properties || {};
  const zp = zonaFeature?.properties || {};
  return (
    fp.paquete || fp.paqueteId || fp.package ||
    zp.paquete || zp.paqueteId || zp.package ||
    null
  );
}

function nichosOpen(zonaFeature){
  if (!nichosUI.$modal) nichosInitDom();

  nichosUI.open = true;
  nichosUI.zona = zonaFeature;
  nichosUI.cara = 'convexo';
  nichosUI.scale = 1;
  nichosUI.panX = 0;
  nichosUI.panY = 0;
  nichosUI.panning = false;
  nichosUI.panStart = null;
  nichosUI.selectedNicho = null;

  if (nichosUI.$cara) nichosUI.$cara.value = nichosUI.cara;

  if (nichosUI.$title) nichosUI.$title.textContent = 'Nichos';
  const zonaTxt = `Columbario: ${nichosGetProp(zonaFeature,'nombre') || nichosZonaId(zonaFeature)}`;
  if (nichosUI.$zona) nichosUI.$zona.textContent = zonaTxt;
  if (nichosUI.$subtitle) nichosUI.$subtitle.textContent = zonaTxt;
  if (nichosUI.$sel) nichosUI.$sel.textContent = '(ninguno)';
  if (nichosUI.$zoom) nichosUI.$zoom.value = '100';
  if (nichosUI.$zoomPct) nichosUI.$zoomPct.textContent = '100%';
  if (nichosUI.$info) nichosUI.$info.innerHTML = '<p style="color:#6b7280">Paso 1: elige CARA. Paso 2: haz click en un NICHO.</p>';

  if (nichosUI.$modal) nichosUI.$modal.style.display = 'flex';
  nichosLockBackgroundScroll(true);

  // evita que el mapa (Leaflet) capture wheel/drag cuando el modal está abierto
  try {
    if (map && map.dragging) map.dragging.disable();
    if (map && map.scrollWheelZoom) map.scrollWheelZoom.disable();
    if (map && map.doubleClickZoom) map.doubleClickZoom.disable();
    if (map && map.boxZoom) map.boxZoom.disable();
    if (map && map.keyboard) map.keyboard.disable();
  } catch {}

  nichosRender();
}

function nichosClose(){
  if (!nichosUI.$modal) return;
  nichosUI.open = false;
  nichosUI.zona = null;
  nichosUI.selectedNicho = null;
  nichosUI.$modal.style.display = 'none';
  if (nichosUI.$svg) nichosUI.$svg.innerHTML = '';
  nichosLockBackgroundScroll(false);

  // re-activa mapa
  try {
    if (map && map.dragging) map.dragging.enable();
    if (map && map.scrollWheelZoom) map.scrollWheelZoom.enable();
    if (map && map.doubleClickZoom) map.doubleClickZoom.enable();
    if (map && map.boxZoom) map.boxZoom.enable();
    if (map && map.keyboard) map.keyboard.enable();
  } catch {}
}


function nichosApplyZoom(){
  const vp = nichosUI.$viewport;
  if (!vp) return;
  vp.style.transformOrigin = 'top left';
  vp.style.transform = `translate(${nichosUI.panX}px, ${nichosUI.panY}px) scale(${nichosUI.scale})`;
  if (nichosUI.$zoomPct){
    nichosUI.$zoomPct.textContent = `${Math.round(nichosUI.scale*100)}%`;
  }
}

function nichosSelectFeature(feature, pathEl){
  if (!feature) return;
  nichosUI.selectedNicho = feature;
  nichosRenderNichoInfo(feature);
  try {
    for (const el of nichosUI.$svg.querySelectorAll('path')){
      el.setAttribute('fill', 'rgba(59,130,246,.16)');
      el.setAttribute('stroke', 'rgba(59,130,246,.85)');
    }
    if (pathEl){
      pathEl.setAttribute('fill', 'rgba(16,185,129,.18)');
      pathEl.setAttribute('stroke', 'rgba(16,185,129,.95)');
    }
  } catch {}
}

function nichosRender(){
  const zona = nichosUI.zona;
  if (!zona || !nichosUI.$img || !nichosUI.$svg) return;

  const zid = nichosZonaId(zona);
  const cara = nichosUI.cara;
  const imgUrl = nichosResolveImageUrl(zona, cara);

  if (!imgUrl){
    if (nichosUI.$info) nichosUI.$info.innerHTML = `<p style="color:#b91c1c">Falta imagenConvexo/imagenConcavo para ${cara} en nichos-zonas.geojson</p>`;
    nichosUI.$img.removeAttribute('src');
    nichosUI.$svg.innerHTML = '';
    nichosFocusStageMobile();
    return;
  }

  nichosUI.$img.onload = () => {
    const w = nichosUI.$img.naturalWidth || 1;
    const h = nichosUI.$img.naturalHeight || 1;

    // Fit inicial dentro del contenedor (lo más "zoomed out" posible)
    try {
      const canvas = nichosUI.$canvas || document.querySelector('#nichosModal .nm-canvas');
      const cw = canvas?.clientWidth || w;
      const ch = canvas?.clientHeight || h;
      const pad = 24;
      const fitScale = clamp(Math.min((cw - pad * 2) / w, (ch - pad * 2) / h, 1), 0.10, 6.00);
      nichosUI.scale = fitScale;
      // centra
      nichosUI.panX = (cw - w * fitScale) / 2;
      nichosUI.panY = (ch - h * fitScale) / 2;

      if (nichosUI.$zoom) nichosUI.$zoom.value = String(Math.round(fitScale*100));
      if (nichosUI.$zoomPct) nichosUI.$zoomPct.textContent = `${Math.round(fitScale*100)}%`;
    } catch {}

    nichosUI.$svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    nichosUI.$svg.setAttribute('width', String(w));
    nichosUI.$svg.setAttribute('height', String(h));
    nichosUI.$svg.innerHTML = '';

    if (nichosUI.$viewport){
      nichosUI.$viewport.style.width = w + 'px';
      nichosUI.$viewport.style.height = h + 'px';
    }
    nichosApplyZoom();
    nichosFocusStageMobile();

    const rects = nichosFilterOverlayFeatures(zid, cara);
    if (rects.length === 0){
      if (nichosUI.$info) nichosUI.$info.innerHTML = `<p style="color:#6b7280">No hay nichos definidos en ${NICHOS_OVERLAY_URL} para ${zid}-${cara}.</p>`;
      return;
    }

    for (const f of rects){
      if (f?.geometry?.type !== 'Polygon') continue;
      const ring = nichosRingToImageSpace(f, w, h);
      if (ring.length < 4) continue;

      const d = ring.map(([x,y], i) => `${i===0?'M':'L'} ${x} ${y}`).join(' ') + ' Z';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'rgba(59,130,246,.16)');
      path.setAttribute('stroke', 'rgba(59,130,246,.85)');
      path.setAttribute('stroke-width', '2');
      path.style.cursor = 'pointer';

      path.__nichoFeature = f;
      path.addEventListener('click', (ev) => {
        if ((nichosUI.ignoreClickUntil || 0) > Date.now()) {
          try { ev.preventDefault(); ev.stopPropagation(); } catch {}
          return;
        }
        nichosSelectFeature(f, path);
      });

      nichosUI.$svg.appendChild(path);
    }
  };

  nichosUI.$img.onerror = () => {
    if (nichosUI.$info) nichosUI.$info.innerHTML = `<p style="color:#b91c1c">No se pudo cargar: ${imgUrl}</p>`;
    nichosUI.$svg.innerHTML = '';
    nichosFocusStageMobile();
  };

  nichosUI.$img.src = imgUrl;
}

function nichosRenderNichoInfo(feature){
  const p = feature?.properties || {};
  const codigo = (p.codigo || p.id || '(sin código)').toString();
  const estatus = (p.estatus || '').toString().trim() || 'desconocido';
  const paqueteKey = nichosGetPaqueteKey(feature, nichosUI.zona);

  if (nichosUI.$sel) nichosUI.$sel.textContent = codigo;

  let html = `<h3 style="margin:0 0 6px 0;">Nicho: ${safe(codigo)}</h3>`;
  html += `<div style="font-size:12px;color:#6b7280;margin-bottom:8px;">Columbario → Cara → Nicho</div>`;
  html += `<p><b>Estatus:</b> ${safe(estatus)}</p>`;

  html += `<h3 style="margin:14px 0 6px 0;">Paquete</h3>`;
  if (!paqueteKey){
    html += `<p><i>Sin paquete asignado.</i></p>`;
  } else if (!paquetesInfo?.[paqueteKey]){
    html += `<p><b>${safe(paqueteKey)}</b> (no definido en <code>data/paquetes.json</code>)</p>`;
  } else {
    const paquete = paquetesInfo[paqueteKey];
    html += `<p><b>${safe(paquete.nombre || paqueteKey)}</b></p>`;
    if (Array.isArray(paquete.items) && paquete.items.length){
      html += `<ul>${paquete.items.map(it => `<li>${safe(it)}</li>`).join('')}</ul>`;
    }
  }

  if (nichosUI.$info) nichosUI.$info.innerHTML = html;
}

// Normaliza las manzanas para que no queden inconsistencias tipo:
// id="PLATA-H" pero seccion="PLATA", manzana="A", nombre="PLATA - A".
// Regla: si existe seccion+manzana, el id y nombre se recalculan.
// También elimina lotesFile (la app ya resuelve el archivo de lotes por sección).
function normalizeManzanasGeoJSON(geojson){
  if (!geojson || !Array.isArray(geojson.features)) return geojson;

  const usedIds = new Set();

  function normStr(v){
    return (v ?? "").toString().trim();
  }
  function normSeccion(v){
    return normStr(v).toUpperCase();
  }
  function normManzana(v){
    // A, B, C... / 1,2... o cualquier etiqueta corta
    return normStr(v).toUpperCase();
  }
  function makeId(seccion, manzana){
    return `${seccion}-${manzana}`;
  }
  function makeNombre(seccion, manzana){
    return `${seccion} - ${manzana}`;
  }
  function uniqueId(base){
    if (!usedIds.has(base)){
      usedIds.add(base);
      return base;
    }
    let i = 2;
    while (usedIds.has(`${base}__DUP${i}`)) i++;
    const id = `${base}__DUP${i}`;
    usedIds.add(id);
    return id;
  }

  // primer pase: registrar ids existentes para detectar duplicados
  for (const f of geojson.features){
    const p = f?.properties || {};
    const id = normStr(p.id);
    if (id) usedIds.add(id);
  }

  for (const f of geojson.features){
    if (!f.properties) f.properties = {};
    const p = f.properties;

    // elimina lotesFile viejo si existe
    if ("lotesFile" in p) delete p.lotesFile;

    const seccion = normSeccion(p.seccion);
    const manzana = normManzana(p.manzana);

    // si no hay seccion/manzana, intenta inferir desde id
    let finalSeccion = seccion;
    let finalManzana = manzana;
    if ((!finalSeccion || !finalManzana) && p.id){
      const parts = normStr(p.id).split("-");
      if (!finalSeccion && parts[0]) finalSeccion = normSeccion(parts[0]);
      if (!finalManzana && parts[1]) finalManzana = normManzana(parts.slice(1).join("-"));
    }

    // si aún falta algo, deja lo que haya sin romper
    if (finalSeccion) p.seccion = finalSeccion;
    if (finalManzana) p.manzana = finalManzana;

    // regla principal: si hay seccion+manzana, recalcula id/nombre
    if (finalSeccion && finalManzana){
      const baseId = makeId(finalSeccion, finalManzana);
      // si el id actual es otro, se reemplaza; si genera colisión, se vuelve único
      const desired = baseId;
      const alreadyUsed = usedIds.has(desired) && normStr(p.id) !== desired;
      const newId = alreadyUsed ? uniqueId(desired) : desired;
      p.id = newId;
      p.nombre = makeNombre(finalSeccion, finalManzana);
    } else {
      // fallback: normaliza strings
      if (p.id) p.id = normStr(p.id);
      if (p.nombre) p.nombre = normStr(p.nombre);
    }
  }

  return geojson;
}

// CRS.Simple: lat=y, lng=x; GeoJSON: [x,y]=[lng,lat]
function xyToLatLng(xy){ return L.latLng(xy[1], xy[0]); }
function latLngToXY(ll){ return [ll.lng, ll.lat]; }

function distPixels(a,b){
  const dx = (a.lng - b.lng);
  const dy = (a.lat - b.lat);
  return Math.sqrt(dx*dx + dy*dy);
}

function isCircleFeature(f){
  return (
    f &&
    f.geometry &&
    f.geometry.type === "Point" &&
    f.properties &&
    f.properties.shape === "circle" &&
    typeof f.properties.radius === "number"
  );
}

function slugifySeccionPath(s){
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // quita acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Convención: data/lotes/<seccion_slug>/lotes.geojson
function getSharedLotesUrlForSeccion(seccion){
  const slug = slugifySeccionPath(seccion);
  
  // Overrides de carpetas cuando el nombre real NO coincide con el slug default
  const FOLDER_OVERRIDES = {
    "san-mateo-vip": "sanmateovip",
    "san-juan-vip": "sanjuanvip",
    "san-pedro-vip": "sanpedrovip",
  };

  const folder = FOLDER_OVERRIDES[slug] || slug;
  return `./data/lotes/${folder}/lotes.geojson`;
}

// Decide qué archivo leer (compat: si manzana trae lotesFile, úsalo)
// Si NO trae lotesFile => usa el archivo compartido por sección
function getLotesUrlForManzana(manzanaFeature){
  const lf = (manzanaFeature?.properties?.lotesFile || "").toString().trim();
  if (lf) return lf;
  const sec = getPropSeccion(manzanaFeature);
  return getSharedLotesUrlForSeccion(sec);
}



// Color default para secciones
const DEFAULT_SECCION_COLOR = "#C9A227";
function getSeccionColor(feature){
  const c = feature?.properties?.color;
  if (typeof c === "string" && c.trim()) return c.trim();
  return DEFAULT_SECCION_COLOR;
}

/* =========================================================
   ROTACIÓN + IDs
   ========================================================= */
function degToRad(d){ return (d * Math.PI) / 180; }
function rotatePoint(x, y, deg){
  const r = degToRad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x*c - y*s, y: x*s + y*c };
}



// IDs:
// - manzanas: A, B, C, ... Z, AA, AB...
// - lotes: 001, 002...
function numToLetters(n){ // 1->A, 2->B ... 26->Z, 27->AA...
  let out = "";
  while (n > 0){
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
function lettersToNum(s){
  s = String(s || "").toUpperCase().trim();
  let n = 0;
  for (let i=0; i<s.length; i++){
    const c = s.charCodeAt(i) - 64; // A=1
    if (c < 1 || c > 26) return null;
    n = n * 26 + c;
  }
  return n;
}
function nextManzanaLetter(base, step){
  const n0 = lettersToNum(base);
  if (n0 === null) return `${base}-${step+1}`;
  return numToLetters(n0 + step);
}
function nextPaddedNumber(base, step, inc){
  const s = String(base || "").trim();
  const m = s.match(/^\d+$/);
  if (!m) return `${s}-${step+1}`;
  const pad = s.length;
  const n0 = Number(s);
  const val = n0 + step * (inc || 1);
  return String(val).padStart(pad, "0");
}

function makeRotatedRect(x0, y0, localX, localY, w, h, rotDeg){
  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map(pt => {
    const rotated = rotatePoint(pt.x + localX, pt.y + localY, rotDeg);
    return [x0 + rotated.x, y0 + rotated.y];
  });
  corners.push(corners[0]);
  return corners;
}

/* =========================================================
   COORD SCALE (solo para público: data->imagen cargada)
   ========================================================= */
function scaleCoordsRecursive(obj, sx, sy){
  if (Array.isArray(obj)){
    if (obj.length === 2 && typeof obj[0] === "number" && typeof obj[1] === "number"){
      const x = obj[0], y = obj[1];
      return [x * sx, y * sy];
    }
    return obj.map(v => scaleCoordsRecursive(v, sx, sy));
  }
  return obj;
}

function applyCoordScaleToGeoJSON(data, sx, sy){
  if (!data) return data;
  const radiusScale = (sx + sy) / 2;

  const scaleGeom = (geom) => {
    if (!geom || !geom.coordinates) return;
    geom.coordinates = scaleCoordsRecursive(geom.coordinates, sx, sy);
  };

  if (data.type === "FeatureCollection"){
    for (const f of (data.features || [])){
      if (f && f.geometry) scaleGeom(f.geometry);
      if (isCircleFeature(f) && typeof f.properties.radius === "number"){
        f.properties.radius = f.properties.radius * radiusScale;
      }
    }
  } else if (data.type === "Feature"){
    if (data.geometry) scaleGeom(data.geometry);
    if (isCircleFeature(data) && typeof data.properties.radius === "number"){
      data.properties.radius = data.properties.radius * radiusScale;
    }
  }
  return data;
}

/* =========================================================
   ANIMACIONES
   ========================================================= */
function flyToBoundsSmooth(bounds, durationSeconds, maxZoom = null){
  if (IS_MOBILE) {
    map.fitBounds(bounds, maxZoom !== null ? { maxZoom } : undefined);
    return;
  }
  try {
    map.flyToBounds(bounds, maxZoom !== null
      ? { animate: true, duration: durationSeconds, easeLinearity: 0.2, maxZoom }
      : { animate: true, duration: durationSeconds, easeLinearity: 0.2 }
    );
  } catch {
    map.fitBounds(bounds, maxZoom !== null ? { maxZoom } : undefined);
  }
}


// Para casos donde NO queremos hacer zoom (solo centrar)
function centerOnLayerNoZoom(layer, paddingPx = 0){
  try {
    const c = layer.getBounds ? layer.getBounds().getCenter() : (layer.getLatLng ? layer.getLatLng() : null);
    if (!c) return;
    if (paddingPx){
      // panInside intenta mantener el punto dentro de un margen
      try { map.panInside(c, { padding: [paddingPx, paddingPx] }); return; } catch {}
    }
    map.panTo(c);
  } catch {}
}

function clearHoverNameTooltip(){
  try {
    if (hoverNameTooltip && map) map.removeLayer(hoverNameTooltip);
  } catch {}
  hoverNameTooltip = null;
}

function getLayerCenterLatLng(layer){
  try {
    if (layer?.getBounds){
      const b = layer.getBounds();
      if (b?.isValid ? b.isValid() : true) return b.getCenter();
    }
  } catch {}
  try {
    if (layer?.getLatLng) return layer.getLatLng();
  } catch {}
  return null;
}

function showHoverNameTooltip(layer, text, kind = ''){
  clearHoverNameTooltip();
  const label = (text || '').toString().trim();
  if (!map || !layer || !label) return;

  const latlng = getLayerCenterLatLng(layer);
  if (!latlng) return;

  const extraClass = kind ? ` map-hover-center-label-${kind}` : '';
  hoverNameTooltip = L.tooltip({
    permanent: false,
    direction: 'center',
    opacity: 1,
    interactive: false,
    className: `map-hover-center-label${extraClass}`
  })
    .setLatLng(latlng)
    .setContent(`<span>${safe(label)}</span>`);

  try { hoverNameTooltip.addTo(map); }
  catch { hoverNameTooltip = null; }
}

function pulseLayer(layer, baseStyle, pulseAdd){
  const ms = pulseAdd?.ms ?? 200;
  const weightAdd = pulseAdd?.weightAdd ?? 2;
  const fillAdd = pulseAdd?.fillAdd ?? 0.10;

  const pulseStyle = {
    ...baseStyle,
    weight: (baseStyle.weight ?? 1) + weightAdd,
    fillOpacity: Math.min(0.85, (baseStyle.fillOpacity ?? 0) + fillAdd)
  };

  try { layer.setStyle(pulseStyle); } catch {}
  setTimeout(() => {
    try { layer.setStyle(baseStyle); } catch {}
  }, ms);
}

/* =========================================================
   STYLES
   ========================================================= */
function hiddenStyle(){ return { weight: 2, opacity: 0, fillOpacity: 0 }; }

function hoverStyle(c){
  return {
    color: c || "#111827",
    weight: 2,
    opacity: 1,
    fillColor: c || "#111827",
    fillOpacity: 0.28
  };
}

function pinnedStyle(c){
  return {
    color: c || "#111827",
    weight: 3,
    opacity: 1,
    fillColor: c || "#111827",
    fillOpacity: 0.40
  };
}

// estilo selección múltiple (editor)
function multiSelectedStyle(){
  return {
    color: "#ef4444",
    weight: 3,
    opacity: 1,
    fillColor: "#ef4444",
    fillOpacity: 0.10,
    dashArray: "6 4"
  };
}

function styleByStatus(status){
  const s = normStatus(status);

  if (s === "disponible") {
    return {
      color: "#16a34a",
      fillColor: "#22c55e",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.30
    };
  }

  if (s === "separado") {
    return {
      color: "#ca8a04",
      fillColor: "#facc15",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.45
    };
  }

  if (s === "suspendido") {
    return {
      color: "#7c3aed",
      fillColor: "#a78bfa",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.45
    };
  }

  if (s === "vendido") {
    return {
      color: "#dc2626",
      fillColor: "#ef4444",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.50
    };
  }

  if (s === "utilizado") {
    return {
      color: "#374151",
      fillColor: "#111827",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.60
    };
  }

  if (s === "por_construir") {
    return {
      color: "#6b7280",
      fillColor: "#9ca3af",
      weight: 1,
      opacity: 1,
      dashArray: "4 4",
      fillOpacity: 0.20
    };
  }

  if (s === "sin_inventario") {
    return {
      color: "#9333ea",
      fillColor: "#c084fc",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.35,
      dashArray: "3 3"
    };
  }

  return {
    color: "#2563eb",
    fillColor: "#60a5fa",
    weight: 1,
    opacity: 1,
    fillOpacity: 0.25
  };
}

function lotHiddenStyle(){ return { weight: 1, opacity: 0, fillOpacity: 0 }; }
function lotBaseStyle(status){ return showAllLots ? styleByStatus(status) : lotHiddenStyle(); }
function lotPinnedStyle(status){ const s = styleByStatus(status); return { ...s, weight: 2 }; }

function updateToggleLotsButton(){
  if (!$toggleLotsBtn) return;

  const enabled = !!currentManzanaFeature && !(isEditSecciones || isEditManzanas || isEditLotes);

  $toggleLotsBtn.disabled = !enabled;
  $toggleLotsBtn.textContent = showAllLots ? "Ocultar lotes" : "Mostrar lotes";

  // Oculta el botón superior en modo público porque ahora vive dentro del panel.
  if (!IS_EDIT){
    $toggleLotsBtn.style.display = "none";
  }
}

/* =========================================================
   UI helpers (dropdowns)
   ========================================================= */
function getPropSeccion(f){
  return (f?.properties?.seccion || f?.properties?.id || "SIN-SECCION").toString().trim();
}
function getPropManzana(f){
  return (f?.properties?.manzana || f?.properties?.id || "").toString().trim();
}
function getPropNombre(f){
  return (f?.properties?.nombre || `${getPropSeccion(f)} - ${getPropManzana(f)}`).toString().trim();
}


// Editor LOTES: obtener filtros actuales desde UI
function getSelectedSeccion(){ return ($seccionSelect?.value || "").toString().trim(); }
function getSelectedManzana(){ return ($manzanaSelect?.value || "").toString().trim(); }

// Asegura contexto en lotes: seccion/manzana para poder copiar/pegar entre manzanas sin perder info
function ensureLoteContextProps(feature, seccion, manzana){
  if (!feature) return;
  if (!feature.properties) feature.properties = {};

  const sec = (seccion || feature.properties.seccion || getSelectedSeccion() || "").toString().trim();
  const man = (manzana || feature.properties.manzana || feature.properties.manzanaId || getSelectedManzana() || "").toString().trim();

  if (sec) feature.properties.seccion = sec;
  if (man){
    feature.properties.manzana = man;
    feature.properties.manzanaId = man;
  }
}

// Normaliza el dataset antes de copiar GeoJSON (para no perder manzana)
function normalizeLotesContext(fc){
  if (!fc || fc.type !== "FeatureCollection") return;
  const sec = getSelectedSeccion();
  const man = editor?.lotesFilterManzana || getSelectedManzana() || "";
  for (const f of (fc.features || [])){
    if (!f) continue;
    const hasMan = (f?.properties?.manzana || f?.properties?.manzanaId || "").toString().trim();
    const hasSec = (f?.properties?.seccion || "").toString().trim();
    ensureLoteContextProps(f, hasSec || sec, hasMan || (man || ""));
  }
}

function buildSeccionesList(features){
  const set = new Set();

  for (const f of features){
    const sec = getPropSeccion(f);

    if (!isSeccionVisibleEnDropdown(sec)) continue;

    set.add(sec);
  }

  return Array.from(set).sort((a,b) =>
    a.localeCompare(b, "es", { sensitivity:"base" })
  );
}

function normalizeManzanaLabel(v){
  return (v ?? "").toString().trim().toUpperCase();
}

function manzanaToOrderValue(value){
  const m = normalizeManzanaLabel(value);

  if (!m) return 999999;

  // Si es número: 1, 2, 3...
  if (/^\d+$/.test(m)) {
    return Number(m);
  }

  // Si es letra: A, B, C... Z, AA, AB, AC...
  if (/^[A-Z]+$/.test(m)) {
    let n = 0;

    for (const ch of m) {
      n = n * 26 + (ch.charCodeAt(0) - 64);
    }

    return n;
  }

  // Si es algo mixto, lo manda al final
  return 999999;
}

function compareManzanasLabel(a, b){
  const av = manzanaToOrderValue(a);
  const bv = manzanaToOrderValue(b);

  if (av !== bv) return av - bv;

  return normalizeManzanaLabel(a).localeCompare(
    normalizeManzanaLabel(b),
    "es",
    { sensitivity: "base" }
  );
}

function buildManzanasListBySeccion(features, seccion){
  const byManzana = new Map();
  const seccionActual = (seccion || "").toString().trim().toUpperCase();

  for (const f of features){
    const sec = getPropSeccion(f).toString().trim().toUpperCase();
    const man = getPropManzana(f).toString().trim();

    if (sec !== seccionActual) continue;
    if (!man) continue;

    const key = normalizeManzanaLabel(man);

    // Si ya existe esta manzana, no la vuelve a agregar
    if (!byManzana.has(key)){
      byManzana.set(key, f);
    }
  }

  const out = Array.from(byManzana.values());

  out.sort((fa, fb) => {
    return compareManzanasLabel(getPropManzana(fa), getPropManzana(fb));
  });

  return out;
}

function fillSeccionSelect(secciones){
  $seccionSelect.innerHTML = `<option value="">SECCIÓN...</option>`;

  for (const s of secciones){
    if (!isSeccionVisibleEnDropdown(s)) continue;

    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    $seccionSelect.appendChild(opt);
  }
}

function fillManzanaSelect(manzanaFeatures){
  $manzanaSelect.innerHTML = `<option value="">(Todas las manzanas)</option>`;

  for (const f of manzanaFeatures){
    const m = getPropManzana(f);

    if (!m) continue;

    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    $manzanaSelect.appendChild(opt);
  }
}

/* =========================================================
   Layer builders (polígono/círculo)
   ========================================================= */
function featureToLayerCircleAware(feature, latlng){
  if (isCircleFeature(feature)){
    const r = feature.properties.radius;
    return L.circle(latlng, { radius: r });
  }
  return L.circleMarker(latlng, { radius: 6, weight: 2, fillOpacity: 0.2 });
}

/* =========================================================
   Bounds helpers (círculos)
   ========================================================= */
function getBoundsForCircleFeature(feature, layer){
  const center = layer?.getLatLng ? layer.getLatLng() : xyToLatLng(feature.geometry.coordinates);
  const r = layer?.getRadius ? layer.getRadius() : feature.properties.radius;

  const sw = L.latLng(center.lat - r, center.lng - r);
  const ne = L.latLng(center.lat + r, center.lng + r);
  return L.latLngBounds(sw, ne);
}

function flyToManzanaFeature(feature, layer){
  const isC = isCircleFeature(feature);
  const pad = isC ? 1.10 : 0.20;
  const mz  = isC ? 2 : null;

  try {
    let b;
    if (isC) b = getBoundsForCircleFeature(feature, layer).pad(pad);
    else b = (layer?.getBounds ? layer.getBounds() : L.geoJSON(feature).getBounds()).pad(pad);
    flyToBoundsSmooth(b, 0.65, mz);
  } catch {}
}

/* =========================================================
   ================= PÚBLICO: SECCIONES → MANZANAS → LOTES =================
   ========================================================= */
let pinnedSeccionLayer = null;
let pinnedManzanaLayer = null;
let pinnedLotLayer = null;

// NICHOS: capa de zonas (columbarios)
function bringNichosZonasToFront(){
  try { if (nichosZonasLayerPublic) nichosZonasLayerPublic.bringToFront(); } catch {}
}

function clearNichosZonasLayerPublic(){
  if (nichosZonasLayerPublic){
    try { nichosZonasLayerPublic.remove(); } catch {}
    nichosZonasLayerPublic = null;
  }
  pinnedNichoZonaLayer = null;
}

function renderNichosZonasLayerPublic(){
  if (IS_EDIT) return;
  if (!nichosZonasScaled?.features?.length) return;

  const zonas = nichosZonasScaled.features.filter(f => {
    const t = (f?.properties?.tipo || 'zona').toString().trim().toLowerCase();
    return t === 'zona' || t === 'columbario';
  });
  if (!zonas.length) return;

  clearNichosZonasLayerPublic();

  const fc = { type:'FeatureCollection', features: zonas };

  nichosZonasLayerPublic = L.geoJSON(fc, {
    style: () => {
      const col = '#2563eb';
      return { ...hiddenStyle(), color: col, fillColor: col };
    },
    pointToLayer: (feature, latlng) => {
      const layer = featureToLayerCircleAware(feature, latlng);
      try { layer.setStyle({ ...hiddenStyle(), color:'#2563eb', fillColor:'#2563eb' }); } catch {}
      return layer;
    },
    onEachFeature: (feature, layer) => {
      const col = '#2563eb';

      layer.on('mouseover', () => {
        if (pinnedNichoZonaLayer !== layer) layer.setStyle(hoverStyle(col));
      });
      layer.on('mouseout', () => {
        if (pinnedNichoZonaLayer !== layer) layer.setStyle({ ...hiddenStyle(), color: col, fillColor: col });
      });

      layer.on('click', (ev) => {
        // Evitar click-through a secciones
        try {
          if (ev?.originalEvent){
            ev.originalEvent.preventDefault();
            ev.originalEvent.stopPropagation();
          }
          L.DomEvent.stop(ev);
        } catch {}

        if (pinnedNichoZonaLayer && pinnedNichoZonaLayer !== layer){
          pinnedNichoZonaLayer.setStyle({ ...hiddenStyle(), color: col, fillColor: col });
        }
        pinnedNichoZonaLayer = layer;

        const base = pinnedStyle(col);
        layer.setStyle(base);
        pulseLayer(layer, base, { ms: 220 });

        nichosOpen(feature);
      });
    }
  }).addTo(map);

  bringNichosZonasToFront();
}

function clearLotesLayer(){
  if (lotesLayer){ lotesLayer.remove(); lotesLayer = null; }
}
function clearManzanasLayer(){
  clearHoverNameTooltip();
  if (manzanasLayer){ manzanasLayer.remove(); manzanasLayer = null; }
}
function clearSeccionesLayerPublic(){
  clearHoverNameTooltip();
  if (seccionesLayerPublic){ seccionesLayerPublic.remove(); seccionesLayerPublic = null; }
  pinnedSeccionLayer = null;
}

function showPublicLevelSecciones(){
  closePublicSidePanel();

  currentSeccion = null;
  currentSeccionFeature = null;
  currentManzanaFeature = null;
  showAllLots = false;

  $seccionSelect.value = "";
  $manzanaSelect.innerHTML = `<option value="">MANZANA...</option>`;
  $loteInput.value = "";

  clearLotesLayer();
  clearManzanasLayer();
  clearSeccionesLayerPublic();
  updateToggleLotsButton();

  renderSeccionesLayerPublic();
}

function renderSeccionesLayerPublic(){
  if (!seccionesTopScaled || !seccionesTopScaled.features || seccionesTopScaled.features.length === 0){
    setPanel("Sin SECCIONES", `<p>No hay secciones en <code>data/secciones-top.geojson</code>. Agrega al menos 1.</p>`);
    return;
  }

  const fc = { type:"FeatureCollection", features: seccionesTopScaled.features };

  seccionesLayerPublic = L.geoJSON(fc, {
    style: (feature) => {
      const col = getSeccionColor(feature);
      return { ...hiddenStyle(), color: col, fillColor: col };
    },
    pointToLayer: (feature, latlng) => {
      const layer = featureToLayerCircleAware(feature, latlng);
      try {
        const col = getSeccionColor(feature);
        layer.setStyle({ ...hiddenStyle(), color: col, fillColor: col });
      } catch {}
      return layer;
    },
    onEachFeature: (feature, layer) => {
      const col = getSeccionColor(feature);

      layer.on("mouseover", () => {
        if (pinnedSeccionLayer !== layer) layer.setStyle(hoverStyle(col));
        const label = (feature?.properties?.nombre || feature?.properties?.label || getPropSeccion(feature) || '').toString().trim();
        showHoverNameTooltip(layer, label, 'seccion');
      });
      layer.on("mouseout", () => {
        clearHoverNameTooltip();
        if (pinnedSeccionLayer !== layer) layer.setStyle({ ...hiddenStyle(), color: col, fillColor: col });
      });

      layer.on("click", () => {
        const sec = getPropSeccion(feature);

        // Las secciones visuales sí tienen hover, pero no se pueden seleccionar.
        if (!isSeccionVisibleEnDropdown(sec)) {
          clearHoverNameTooltip();

          try {
            layer.setStyle(hoverStyle(col));
            setTimeout(() => {
              if (pinnedSeccionLayer !== layer) {
                layer.setStyle({ ...hiddenStyle(), color: col, fillColor: col });
              }
            }, 180);
          } catch {}

          return;
        }

        clearHoverNameTooltip();

        if (pinnedSeccionLayer && pinnedSeccionLayer !== layer){
          const prevCol = getSeccionColor(pinnedSeccionLayer.feature);
          pinnedSeccionLayer.setStyle({ ...hiddenStyle(), color: prevCol, fillColor: prevCol });
        }

        pinnedSeccionLayer = layer;

        const base = pinnedStyle(col);
        layer.setStyle(base);
        pulseLayer(layer, base, { ms: 220 });

        selectSeccionPublic(feature, layer);
      });
    }
  }).addTo(map);

  setPanel("SECCIONES", `
    <p>1) Selecciona una <b>SECCIÓN</b> en el mapa.</p>
    <p>2) Luego seleccionarás una <b>MANZANA</b>.</p>
    <p>3) Después un <b>LOTE</b>.</p>
  `);
}

function selectSeccionPublic(feature, layer){
  const sec = getPropSeccion(feature);
  currentSeccion = sec;
  currentSeccionFeature = feature;

  openPublicSidePanel();

  $seccionSelect.value = sec;
  $manzanaSelect.value = "";
  $loteInput.value = "";

  try { flyToBoundsSmooth(layer.getBounds().pad(0.10), 0.65); } catch {}
  showPublicLevelManzanas(sec);
}

function showPublicLevelManzanas(seccion){
  openPublicSidePanel();

  currentSeccion = seccion;
  currentManzanaFeature = null;
  showAllLots = false;

  clearLotesLayer();
  clearManzanasLayer();
  updateToggleLotsButton();

  clearSeccionesLayerPublic();

  const manzanas = buildManzanasListBySeccion(manzanasScaled.features, seccion);
  fillManzanaSelect(manzanas);

  renderManzanasLayer(manzanas, {
    panelTitle: `SECCIÓN ${safe(seccion)}`,
    panelHtml: `<p>Selecciona una <b>MANZANA</b> en el mapa.</p>`
  });
}

function renderManzanasLayer(filteredFeatures, opts){
  if (manzanasLayer){ manzanasLayer.remove(); manzanasLayer = null; }
  pinnedManzanaLayer = null;
  currentManzanaFeature = null;
  clearLotesLayer();
  updateToggleLotsButton();

  const fc = { type:"FeatureCollection", features: filteredFeatures };

  manzanasLayer = L.geoJSON(fc, {
    style: () => hiddenStyle(),
    pointToLayer: (feature, latlng) => {
      const layer = featureToLayerCircleAware(feature, latlng);
      try { layer.setStyle(hiddenStyle()); } catch {}
      return layer;
    },
    onEachFeature: (feature, layer) => {
      layer.on("mouseover", () => {
        if (pinnedManzanaLayer !== layer) layer.setStyle(hoverStyle());
        const label = (feature?.properties?.nombre || feature?.properties?.label || getPropManzana(feature) || '').toString().trim();
        showHoverNameTooltip(layer, label, 'manzana');
      });
      layer.on("mouseout", () => {
        clearHoverNameTooltip();
        if (pinnedManzanaLayer !== layer) layer.setStyle(hiddenStyle());
      });

      layer.on("click", async () => {
        clearHoverNameTooltip();
        if (pinnedManzanaLayer && pinnedManzanaLayer !== layer){
          pinnedManzanaLayer.setStyle(hiddenStyle());
        }
        pinnedManzanaLayer = layer;

        const base = pinnedStyle();
        layer.setStyle(base);
        pulseLayer(layer, base, { ms: 220 });

        await selectManzana(feature, layer);
      });
    }
  }).addTo(map);

  if (opts?.panelTitle){
    setPanel(opts.panelTitle, opts.panelHtml || "");
  } else {
    setPanel("Selección", `
      <p>1) Elige <b>SECCIÓN</b></p>
      <p>2) Elige <b>MANZANA</b></p>
      <p>3) Escribe <b>LOTE</b> (opcional) y presiona Buscar</p>
    `);
  }
}

async function selectManzana(feature, layer){
  openPublicSidePanel();

  currentManzanaFeature = feature;
  $manzanaSelect.value = getPropManzana(feature);
  flyToManzanaFeature(feature, layer);
  await loadLotesForCurrentManzana();
}

async function loadLotesForCurrentManzana(){
  clearLotesLayer();
  pinnedLotLayer = null;
  showAllLots = false;
  updateToggleLotsButton();

  if (!currentManzanaFeature){
    setPanel("Sin manzana", `<p>Primero selecciona una MANZANA.</p>`);
    return;
  }

  const lotesUrl = getLotesUrlForManzana(currentManzanaFeature);
  if (!lotesUrl){
    setPanel("MANZANA sin lotes", `<p>Esta manzana no tiene fuente de lotes.</p>`);
    return;
  }

  let raw;
  try { raw = await loadJson(lotesUrl); }
  catch {
    setPanel("Lotes no encontrados", `<p>No pude cargar: <code>${safe(lotesUrl)}</code></p>`);
    return;
  }

  // Si el archivo es compartido por sección, filtramos por properties.manzana
  const manzanaKey = getPropManzana(currentManzanaFeature);
  const hasManzanaProp = (raw.features || []).some(f => (f?.properties?.manzana || f?.properties?.manzanaId));

  let filtered = raw;
  if (hasManzanaProp){
    const feats = (raw.features || []).filter(f => {
      const pm = (f?.properties?.manzana || f?.properties?.manzanaId || "").toString().trim().toUpperCase();
      return pm === manzanaKey.toUpperCase();
    });
    filtered = { type:"FeatureCollection", features: feats };

    if (feats.length === 0){
      notify(`No encontré lotes con properties.manzana="${manzanaKey}" en ${lotesUrl}`, 2600);
    }
  }

  lotesScaled = deepCopy(filtered);
  applyCoordScaleToGeoJSON(lotesScaled, COORD_SCALE_X, COORD_SCALE_Y);

  lotesLayer = L.geoJSON(lotesScaled, {
    style: (feature) => lotBaseStyle(getLoteStatus(feature)),
    pointToLayer: (feature, latlng) => {
      const layer = featureToLayerCircleAware(feature, latlng);
      const st = getLoteStatus(feature);
      try { layer.setStyle(lotBaseStyle(st)); } catch {}
      return layer;
    },
    onEachFeature: (feature, layer) => {
      const st = getLoteStatus(feature);

      layer.on("mouseover", () => {
        if (pinnedLotLayer !== layer) layer.setStyle(styleByStatus(st));
      });
      layer.on("mouseout", () => {
        if (pinnedLotLayer !== layer) layer.setStyle(lotBaseStyle(st));
      });

      layer.on("click", () => {
        if (pinnedLotLayer && pinnedLotLayer !== layer){
          const prev = getLoteStatus(pinnedLotLayer.feature);
          pinnedLotLayer.setStyle(lotBaseStyle(prev));
        }
        pinnedLotLayer = layer;

        const base = lotPinnedStyle(st);
        layer.setStyle(base);
        pulseLayer(layer, base, { ms: 200 });

        // En manzanas circulares (VIP): no hacer zoom extra al seleccionar lote; solo centrar
        if (isCircleFeature(currentManzanaFeature)) centerOnLayerNoZoom(layer, 120);
        else flyToBoundsSmooth(layer.getBounds().pad(0.30), 0.45);
        showLoteInfo(feature);
      });
    }
  }).addTo(map);

  updateToggleLotsButton();

  const sec = currentSeccion || getPropSeccion(currentManzanaFeature);
  const man = getPropManzana(currentManzanaFeature);
  const manzanaPkg = currentManzanaFeature?.properties?.paquete || null;

  refreshManzanaPanel();
  applyFiltroEstatusToLotes();
}

function showFichaPropiedad(catalogItem, feature){
  if (!catalogItem){
    setPanel("Ficha no encontrada", `
      <p>No encontré una ficha completa para esta propiedad en el catálogo.</p>
    `);
    return;
  }


  const html = `
    <div style="display:flex;flex-direction:column;gap:6px;font-size:14px;line-height:1.25;">
      <div>
        <h3 style="margin:0 0 4px 0;">${safe(catalogItem.displayName || catalogItem.id)}</h3>
        <p style="margin:0;font-size:12px;color:#6b7280;">
          ${safe(catalogItem.id)}
        </p>
      </div>

      <hr/>

      <p style="margin:2px 0;"><b>Tipo:</b> ${safe(catalogItem.tipo)}</p>
      <p style="margin:2px 0;"><b>Sección:</b> ${safe(catalogItem.seccion)}</p>
      <p style="margin:2px 0;"><b>Manzana:</b> ${safe(catalogItem.manzana)}</p>
      <p style="margin:2px 0;"><b>Código:</b> ${safe(catalogItem.codigo)}</p>
      <p style="margin:2px 0;"><b>Estatus:</b> ${safe(catalogItem.estatus)}</p>
      <p style="margin:2px 0;"><b>Referencia ProcaP:</b> ${safe(catalogItem.referencia_procap || "Sin referencia")}</p>

      ${catalogItem.observaciones ? `
        <p><b>Observaciones:</b><br/>${safe(catalogItem.observaciones)}</p>
      ` : ""}


      <button id="backToLoteInfoBtn" style="margin-top:6px;padding:6px 10px;border-radius:8px;border:1px solid #d1d5db;background:white;cursor:pointer;">
        Volver al resumen
      </button>
    </div>
  `;

  showModal("Ficha de propiedad", html);

  const backBtn = document.getElementById("backToLoteInfoBtn");
  if (backBtn && feature){
    backBtn.onclick = () => {
      closeModal();
      showLoteInfo(feature);
    };
  }
}

function showLoteInfo(feature){
  const props = feature?.properties || {};
  const loteVal = (props.lote || props.id || "").toString();
  const inv = getLoteInventoryItem(feature);
  const status = getLoteStatus(feature);
  const catalogItem = getCatalogoItemForLoteFeature(feature);
  const paqueteKey = (props.paquete || currentManzanaFeature?.properties?.paquete || null);

  let html = `
    <p><b>SECCIÓN:</b> ${safe(currentSeccion || getPropSeccion(currentManzanaFeature))}</p>
    <p><b>MANZANA:</b> ${safe(getPropManzana(currentManzanaFeature))}</p>
    <p><b>LOTE:</b> ${safe(loteVal)}</p>
    <p><b>Estatus:</b> ${safe(status)}</p>

    ${catalogItem?.referencia_procap ? `
      <p><b>Referencia ProcaP:</b> ${safe(catalogItem.referencia_procap)}</p>
    ` : ""}

    ${catalogItem?.id ? `
      <p style="margin:2px 0;font-size:12px;color:#6b7280;"><b>ID:</b> ${safe(catalogItem.id)}</p>
    ` : ""}

    ${inv ? `<p style="margin:2px 0;font-size:12px;color:#6b7280;"><b>Fuente:</b> inventario</p>` : `<p style="margin:2px 0;font-size:12px;color:#6b7280;"><b>Fuente:</b> GeoJSON actual</p>`}
  `;

  if (String(status).toLowerCase() === "disponible"){
    html += `<h3>Paquete</h3>`;
    if (!paqueteKey){
      html += `<p><i>Sin paquete asignado.</i></p>`;
    } else if (!paquetesInfo[paqueteKey]) {
      html += `<p><b>${safe(paqueteKey)}</b> (no definido en <code>data/paquetes.json</code>)</p>`;
    } else {
      const p = paquetesInfo[paqueteKey];
      html += `<p><b>${safe(p.nombre)}</b></p>`;
      html += `<ul>${(p.items||[]).map(it => `<li>${safe(it)}</li>`).join("")}</ul>`;
    }
  } else if (["vendido", "utilizado", "ocupado"].includes(String(status).toLowerCase())){
    html += `
      <button id="moreBtn" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">
        Más información
      </button>
      <p style="font-size:12px;color:#666;">
        Nota: el saldo se conectará después con login + consulta segura.
      </p>
    `;
  }

  setPanel("Lote", html);

  const btn = document.getElementById("moreBtn");
  if (btn){
    btn.onclick = () => {
      if (catalogItem){
        showFichaPropiedad(catalogItem, feature);
      } else {
        setPanel("Ficha no disponible", `
          <p>Este lote aún no tiene ficha completa en el catálogo.</p>
          <p style="margin:2px 0;font-size:12px;color:#6b7280;">
            Revisa que exista en <code>data/catalogo-propiedades.json</code>.
          </p>
        `);
      }
    };
  }
}

/* =========================================================
   BÚSQUEDA (SECCIÓN → MANZANA → LOTE)
   ========================================================= */
function findLotLayerByInput(loteInput){
  if (!lotesLayer) return null;

  const targetRaw = (loteInput || "").toString().trim().toUpperCase();
  const targetCodigo = normalizeCodigoBusqueda(targetRaw);

  if (!targetRaw) return null;

  let found = null;

  lotesLayer.eachLayer(layer => {
    if (found) return;

    const p = layer.feature?.properties || {};

    const candidates = [
      p.lote,
      p.id,
      p.codigo,
      p.name,
      p.nombre
    ].map(v => (v ?? "").toString().trim().toUpperCase())
     .filter(Boolean);

    const normalizedCandidates = candidates.map(v => normalizeCodigoBusqueda(v));

    const match =
      candidates.includes(targetRaw) ||
      normalizedCandidates.includes(targetCodigo);

    if (match) {
      found = layer;
    }
  });

  return found;
}

async function ensureManzanaSelected(sec, man){
  if (!currentSeccion || currentSeccion !== sec){
    showPublicLevelManzanas(sec);
  }

  if (currentManzanaFeature && getPropSeccion(currentManzanaFeature) === sec && getPropManzana(currentManzanaFeature) === man){
    if (!lotesLayer) await loadLotesForCurrentManzana();
    return;
  }

  const f = (manzanasScaled?.features || []).find(x => getPropSeccion(x) === sec && getPropManzana(x) === man);
  if (!f){
    setPanel("No encontrada", `<p>No encontré la manzana <b>${safe(man)}</b> en <b>${safe(sec)}</b>.</p>`);
    return;
  }

  $seccionSelect.value = sec;
  showPublicLevelManzanas(sec);
  $manzanaSelect.value = man;

  currentManzanaFeature = f;
  await loadLotesForCurrentManzana();
  flyToManzanaFeature(f, null);
}

function setupSearch(){
  const run = async () => {
    openPublicSidePanel();
    const sec = ($seccionSelect.value || "").trim();
    const man = ($manzanaSelect.value || "").trim();
    const query = ($loteInput.value || "").trim();

    if (!query){
      setPanel("Buscar propiedad", `
        <p>Escribe una referencia, lote o clave de propiedad.</p>
        <p>Ejemplos:</p>
        <ul>
          <li><b>PLATINO - 011 - B</b></li>
          <li><b>LOTE-PLATINO-B-011</b></li>
          <li><b>PLATINO B 011</b></li>
          <li><b>011</b></li>
        </ul>
      `);
      return;
    }

    // 1. Si hay sección y manzana seleccionadas, intenta primero búsqueda directa en la manzana actual.
    if (sec && man){
      await ensureManzanaSelected(sec, man);

      const layer = findLotLayerByInput(query);

      if (layer){
        if (isCircleFeature(currentManzanaFeature)) {
          centerOnLayerNoZoom(layer, 120);
        } else {
          flyToBoundsSmooth(layer.getBounds().pad(0.35), 0.45);
        }

        const st = getLoteStatus(layer.feature);
        const base = lotPinnedStyle(st);

        layer.setStyle(base);
        pulseLayer(layer, base, { ms: 200 });

        showLoteInfo(layer.feature);
        return;
      }
    }

    // 2. Si no lo encontró directamente, busca en el catálogo global.
    const catalogResults = searchCatalogoPropiedades(query, 20);

    if (catalogResults.length === 1){
      const item = findCatalogoById(catalogResults[0].id);
      await openCatalogoItem(item);
      return;
    }

    if (catalogResults.length > 1){
      renderCatalogoSearchResults(catalogResults, query);
      return;
    }

    // 3. Intento adicional: si el usuario escribió solo un lote y tiene sección/manzana seleccionadas.
    if (sec && man){
      setPanel("Lote no encontrado", `
        <p>No encontré el lote <b>${safe(query)}</b> en <b>${safe(sec)} - ${safe(man)}</b>.</p>
        <p style="margin:2px 0;font-size:12px;color:#6b7280;">
          También busqué en el catálogo global y no hubo coincidencias.
        </p>
      `);
      return;
    }

    setPanel("Sin resultados", `
      <p>No encontré ninguna propiedad relacionada con:</p>
      <p><b>${safe(query)}</b></p>
      <p style="margin:2px 0;font-size:12px;color:#6b7280;">
        Prueba buscando por referencia ProcaP, por ejemplo:
        <b>PLATINO - 011 - B</b>
      </p>
    `);
  };

  $searchBtn.onclick = run;

  $loteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") run();
  });
}

/* =========================================================
   DROPDOWNS (PUBLICO)
   ========================================================= */
function setupDropdowns(){
  $seccionSelect.onchange = () => {
    const sec = ($seccionSelect.value || "").trim();

    $loteInput.value = "";
    $manzanaSelect.value = "";
    currentManzanaFeature = null;
    clearLotesLayer();
    updateToggleLotsButton();

    if (!sec){
      closePublicSidePanel();
      showPublicLevelSecciones();
      forceInitialPublicMapResize();
      renderNichosZonasLayerPublic();
      bringNichosZonasToFront();
      return;
    }

    openPublicSidePanel();
    showPublicLevelManzanas(sec);
  };

  $manzanaSelect.onchange = async () => {
    const sec = ($seccionSelect.value || "").trim();
    const man = ($manzanaSelect.value || "").trim();

    $loteInput.value = "";

    if (!sec){
      closePublicSidePanel();
      return;
    }

    openPublicSidePanel();

    if (!man) return;

    await ensureManzanaSelected(sec, man);
  };
}

/* =========================================================
   BOTONES (PUBLICO)
   ========================================================= */
function setupButtons(){
  $backBtn.onclick = () => {
    // Si estás dentro del modal de columbarios/nichos: volver = regresar a SECCIONES
    try {
      if (nichosUI?.open){
        nichosClose();
        showPublicLevelSecciones();
        return;
      }
    } catch {}

    if (lotesLayer){
      clearLotesLayer();
      pinnedLotLayer = null;
      currentManzanaFeature = null;
      showAllLots = false;
      updateToggleLotsButton();
      if (currentSeccion) showPublicLevelManzanas(currentSeccion);
      else showPublicLevelSecciones();
      return;
    }

    if (manzanasLayer){
      showPublicLevelSecciones();
      renderNichosZonasLayerPublic();
      bringNichosZonasToFront();
      return;
    }

    showPublicLevelSecciones();
  };

  if ($toggleLotsBtn){
    $toggleLotsBtn.onclick = () => {
      showAllLots = !showAllLots;
      updateToggleLotsButton();

      if (!lotesLayer) return;

      applyFiltroEstatusToLotes();
      refreshManzanaPanel();
    };
  }
}

/* =========================================================
   ================= EDITOR CORE =================
   - Editar puntos / círculo
   - Borrar
   - Copiar/Pegar
   - Cuadrícula lotes y manzanas (rotación)
   - Mover CUADRÍCULA COMPLETA con 1 marcador
   - MULTI-SELECT + MOVE + SCALE por handles
   - NUEVO: selección simple abre por defecto “Mover/Escalar” (sin vértices)
           y se entra a vértices con botón “Editar puntos”.
   ========================================================= */
const editor = {
  mode: "edit",          // "edit" | "create" | "grid"
  drawShape: "polygon",  // "polygon" | "circle"

  // polygon draw
  polyPoints: [],
  polyMarkers: [],
  polyLine: null,
  polyPreview: null,

  // circle draw
  circleCenter: null,
  circleCenterMarker: null,
  circleRadiusMarker: null,
  circlePreview: null,
  circleRadius: null,

  // selection (single + multi)
  selectedLayer: null,
  selectedFeature: null,
  selectedIsCircle: false,
  originalGeometry: null,
  originalRadius: null,

  // circular repeat (lotes)
  circularArmed: false,
  circularPickingTemplate: false,
  circularConfig: null,

  // editor LOTES: filtro visual (no afecta el dataset)
  lotesFilterSeccion: null,
  lotesFilterManzana: null,

  // sub-mode for single selection: "transform" (default) | "vertices"
  editSubmode: "transform",

  // MULTI selection set
  selectedSet: new Set(), // stores feature references (object identity)
  selectedLayers: [],

  // vertex edit markers
  vertexMarkers: [],

  // group transform handles
  groupBoxLayer: null,
  groupCenterMarker: null,
  groupScaleMarker: null,
  groupTransformActive: false,
  groupCenterLL: null,
  groupScaleStart: null, // { baseDist, center, snapshot }

  // copy/paste
  clipboardFeature: null,
  pasteArmed: false,

  // grid state
  gridArmed: false,
  gridConfig: null,

  // last created grid group (for moving whole grid)
  lastGrid: null, // { datasetArr, features[], overlay, centerMarker, bounds, centerLL }

  iconVertex: L.divIcon({
    className: "",
    html: `<div style="width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #111;"></div>`,
    iconSize: [14,14],
    iconAnchor: [7,7]
  }),
  iconHandle: L.divIcon({
    className: "",
    html: `<div style="width:12px;height:12px;border-radius:50%;background:#111;border:2px solid #fff;"></div>`,
    iconSize: [16,16],
    iconAnchor: [8,8]
  }),
  iconCenter: L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 0 1px #111;"></div>`,
    iconSize: [18,18],
    iconAnchor: [9,9]
  }),
  iconScale: L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:4px;background:#22c55e;border:2px solid #fff;box-shadow:0 0 0 1px #111;"></div>`,
    iconSize: [18,18],
    iconAnchor: [9,9]
  })
};

function editorClearPoly(){
  editor.polyPoints = [];
  editor.polyMarkers.forEach(m => map.removeLayer(m));
  editor.polyMarkers = [];
  if (editor.polyLine) map.removeLayer(editor.polyLine);
  if (editor.polyPreview) map.removeLayer(editor.polyPreview);
  editor.polyLine = null;
  editor.polyPreview = null;
  const el = document.getElementById("ptCount");
  if (el) el.textContent = "0";
}

function editorRefreshPolyPreview(){
  if (editor.polyLine) map.removeLayer(editor.polyLine);
  if (editor.polyPreview) map.removeLayer(editor.polyPreview);
  editor.polyLine = null;
  editor.polyPreview = null;

  if (editor.polyPoints.length >= 2){
    editor.polyLine = L.polyline(editor.polyPoints, { weight: 2 }).addTo(map);
  }
  if (editor.polyPoints.length >= 3){
    editor.polyPreview = L.polygon(editor.polyPoints, { weight: 2, fillOpacity: 0.12 }).addTo(map);
  }
}

function editorClearCircle(){
  editor.circleCenter = null;
  editor.circleRadius = null;

  if (editor.circleCenterMarker) map.removeLayer(editor.circleCenterMarker);
  if (editor.circleRadiusMarker) map.removeLayer(editor.circleRadiusMarker);
  if (editor.circlePreview) map.removeLayer(editor.circlePreview);

  editor.circleCenterMarker = null;
  editor.circleRadiusMarker = null;
  editor.circlePreview = null;
}

function clearGroupTransformUI(){
  if (editor.groupBoxLayer) { try { map.removeLayer(editor.groupBoxLayer); } catch {} }
  if (editor.groupCenterMarker) { try { map.removeLayer(editor.groupCenterMarker); } catch {} }
  if (editor.groupScaleMarker) { try { map.removeLayer(editor.groupScaleMarker); } catch {} }
  editor.groupBoxLayer = null;
  editor.groupCenterMarker = null;
  editor.groupScaleMarker = null;
  editor.groupTransformActive = false;
  editor.groupCenterLL = null;
  editor.groupScaleStart = null;
}

function clearMultiSelection(){
  editor.selectedSet.clear();
  editor.selectedLayers = [];
  clearGroupTransformUI();
}

function editorStopVertexEditing(){
  editor.vertexMarkers.forEach(m => map.removeLayer(m));
  editor.vertexMarkers = [];

  if (editor.circleCenterMarker && editor.selectedIsCircle) {
    try { map.removeLayer(editor.circleCenterMarker); } catch {}
    try { map.removeLayer(editor.circleRadiusMarker); } catch {}
    editor.circleCenterMarker = null;
    editor.circleRadiusMarker = null;
  }
}

function editorStopEditing(){
  editorStopVertexEditing();

  editor.selectedLayer = null;
  editor.selectedFeature = null;
  editor.selectedIsCircle = false;
  editor.originalGeometry = null;
  editor.originalRadius = null;
}

function ringToGeoJsonCoords(ringLatLng){
  const coords = ringLatLng.map(latLngToXY);
  if (coords.length) coords.push(coords[0]);
  return [coords];
}

/* ---------- DATASET ACTIVO POR MODO ---------- */
function getActiveEditDatasetArr(){
  if (isEditSecciones) return seccionesTopRaw?.features || null;
  if (isEditManzanas)  return manzanasRaw?.features || null;
  if (isEditLotes)     return currentLotesRaw?.features || null;
  if (isEditNichos)    return nichosZonasRaw?.features || null;
  return null;
}

function rerenderActiveEditor(){
  if (isEditSecciones) return rerenderSecciones_Edit();
  if (isEditManzanas)  return rerenderManzanas_Edit();
  if (isEditLotes)     return rerenderLotes_Edit();
  if (isEditNichos)    return rerenderNichos_Edit();
}

/* ---------- FEATURE ID helpers ---------- */
function getFeatureId(f){
  return (f?.properties?.id || f?.properties?.lote || f?.properties?.manzana || f?.properties?.seccion || "").toString().trim();
}
function setFeatureId(f, newId){
  if (!f?.properties) f.properties = {};
  f.properties.id = newId;
  if (f.properties.lote !== undefined) f.properties.lote = newId;
}

function stripDupSuffix(value){
  return (value ?? "")
    .toString()
    .trim()
    .replace(/__DUP\d+$/i, "");
}

function getEditorDisplayId(f){
  if (isEditManzanas){
    return (
      f?.properties?.manzana ||
      stripDupSuffix(f?.properties?.id) ||
      ""
    ).toString().trim();
  }

  return getFeatureId(f);
}

function setManzanaDisplayId(f, newManzana){
  if (!f?.properties) f.properties = {};

  const p = f.properties;
  const manzana = (newManzana || "").toString().trim().toUpperCase();

  if (!manzana) return;

  const seccion = (p.seccion || getSelectedSeccion() || "")
    .toString()
    .trim()
    .toUpperCase();

  const currentId = (p.id || "").toString().trim();
  const dupMatch = currentId.match(/__DUP\d+$/i);
  const dupSuffix = dupMatch ? dupMatch[0] : "";

  p.seccion = seccion;
  p.manzana = manzana;
  p.nombre = seccion ? `${seccion} - ${manzana}` : manzana;
  p.id = seccion ? `${seccion}-${manzana}${dupSuffix}` : `${manzana}${dupSuffix}`;
}

function ensureUniqueId(feature, arr){
  const base = getFeatureId(feature) || "item";
  const exists = (id) => arr.some(x => getFeatureId(x) === id);

  if (!exists(base)) { setFeatureId(feature, base); return; }
  let i = 1;
  while (exists(`${base}-copy-${i}`)) i++;
  setFeatureId(feature, `${base}-copy-${i}`);
}

/* ---------- BORRAR FEATURE (single o multi) ---------- */
function deleteSelectedFeature(){
  const arr = getActiveEditDatasetArr();
  if (!arr) return;

  const targets = (editor.selectedSet.size > 0)
    ? Array.from(editor.selectedSet)
    : (editor.selectedFeature ? [editor.selectedFeature] : []);

  if (!targets.length){
    notify("No hay figuras seleccionadas para borrar.", 1800);
    return;
  }

  let removed = 0;
  for (const feat of targets){
    let idx = arr.indexOf(feat);
    if (idx < 0){
      const id = getFeatureId(feat);
      if (id) idx = arr.findIndex(f => getFeatureId(f) === id);
    }
    if (idx >= 0){
      arr.splice(idx, 1);
      removed++;
    }
  }

  editorStopEditing();
  clearMultiSelection();
  rerenderActiveEditor();
  notify(`✅ Borradas ${removed} figura(s) (en memoria).`, 2200);
}

/* ---------- TRANSFORM HELPERS: translate + scale ---------- */
function transformPointAround(x, y, cx, cy, s){
  return [cx + (x - cx) * s, cy + (y - cy) * s];
}

function translateFeatureInPlace(feature, dx, dy){
  if (!feature?.geometry) return;

  if (feature.geometry.type === "Point"){
    const [x,y] = feature.geometry.coordinates;
    feature.geometry.coordinates = [x + dx, y + dy];
    return;
  }

  if (feature.geometry.type === "Polygon"){
    const coords = feature.geometry.coordinates || [];
    feature.geometry.coordinates = coords.map(ring => ring.map(([x,y]) => [x + dx, y + dy]));
    return;
  }
}

function rotatePointAround(x, y, cx, cy, deg){
  const r = degToRad(deg);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = x - cx;
  const dy = y - cy;
  return [
    cx + (dx * cos - dy * sin),
    cy + (dx * sin + dy * cos)
  ];
}

function rotateFeatureInPlace(feature, cx, cy, deg){
  if (!feature?.geometry) return;

  if (feature.geometry.type === "Point"){
    const [x,y] = feature.geometry.coordinates;
    const [nx,ny] = rotatePointAround(x,y,cx,cy,deg);
    feature.geometry.coordinates = [nx,ny];
    return;
  }

  if (feature.geometry.type === "Polygon"){
    const coords = feature.geometry.coordinates || [];
    feature.geometry.coordinates = coords.map(ring =>
      ring.map(([x,y]) => rotatePointAround(x,y,cx,cy,deg))
    );
    return;
  }
}

function scaleFeatureInPlace(feature, cx, cy, scale){
  if (!feature?.geometry) return;

  if (feature.geometry.type === "Point"){
    const [x,y] = feature.geometry.coordinates;
    const [nx, ny] = transformPointAround(x,y,cx,cy,scale);
    feature.geometry.coordinates = [nx, ny];
    if (isCircleFeature(feature) && typeof feature.properties.radius === "number"){
      feature.properties.radius = feature.properties.radius * scale;
    }
    return;
  }

  if (feature.geometry.type === "Polygon"){
    const coords = feature.geometry.coordinates || [];
    feature.geometry.coordinates = coords.map(ring => ring.map(([x,y]) => transformPointAround(x,y,cx,cy,scale)));
    return;
  }
}

function getFeatureCenterXY(feature){
  const b = boundsFromFeature(feature);
  if (!b) return null;
  const c = boundsCenter(b);
  return { cx: c.x, cy: c.y };
}



/* ---------- BOUNDS from features ---------- */
function expandBoundsWithXY(b, x, y){
  if (!b) return { minX:x, minY:y, maxX:x, maxY:y };
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
  return b;
}
function boundsFromFeature(feature){
  let b = null;
  if (!feature?.geometry) return null;

  if (feature.geometry.type === "Point"){
    const [x,y] = feature.geometry.coordinates;
    const r = feature.properties?.radius || 0;
    b = expandBoundsWithXY(b, x - r, y - r);
    b = expandBoundsWithXY(b, x + r, y + r);
    return b;
  }

  if (feature.geometry.type === "Polygon"){
    const ring = feature.geometry.coordinates?.[0] || [];
    for (const pt of ring){
      const [x,y] = pt;
      b = expandBoundsWithXY(b, x, y);
    }
    return b;
  }

  return null;
}
function boundsUnion(a,b){
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
function boundsFromFeatures(features){
  let b = null;
  for (const f of features){
    b = boundsUnion(b, boundsFromFeature(f));
  }
  return b;
}
function boundsCenter(b){
  return { x: (b.minX + b.maxX)/2, y: (b.minY + b.maxY)/2 };
}
function boundsToLatLngBounds(b, pad=0){
  if (!b) return null;
  const w = (b.maxX - b.minX);
  const h = (b.maxY - b.minY);
  const pX = w * pad;
  const pY = h * pad;
  const sw = L.latLng((b.minY - pY), (b.minX - pX));
  const ne = L.latLng((b.maxY + pY), (b.maxX + pX));
  return L.latLngBounds(sw, ne);
}

/* ---------- MULTI selection visuals ---------- */
function applyMultiSelectionStyle(){
  for (const lyr of editor.selectedLayers){
    try { lyr.setStyle(multiSelectedStyle()); } catch {}
  }
}

function rebuildSelectedLayersFromLayerGroup(layerGroup){
  editor.selectedLayers = [];
  if (!layerGroup) return;

  layerGroup.eachLayer(lyr => {
    const f = lyr.feature;
    if (f && editor.selectedSet.has(f)){
      editor.selectedLayers.push(lyr);
    }
  });
}

/* ---------- MODE: handles (move/scale) ---------- */
function showGroupTransformHandles(){
  clearGroupTransformUI();

  const feats = Array.from(editor.selectedSet);
  if (!feats.length) return;

  const b = boundsFromFeatures(feats);
  if (!b) return;

  const c = boundsCenter(b);
  const centerLL = L.latLng(c.y, c.x);

  const rect = [
    [b.minY, b.minX],
    [b.minY, b.maxX],
    [b.maxY, b.maxX],
    [b.maxY, b.minX]
  ].map(([y,x]) => L.latLng(y,x));

  editor.groupBoxLayer = L.polygon(rect, {
    weight: 2,
    color: "#ef4444",
    fillColor: "#ef4444",
    fillOpacity: 0.05,
    dashArray: "6 6"
  }).addTo(map);

  editor.groupCenterMarker = L.marker(centerLL, { draggable:true, icon: editor.iconCenter }).addTo(map);

  const scaleLL = L.latLng(b.minY, b.maxX);
  editor.groupScaleMarker = L.marker(scaleLL, { draggable:true, icon: editor.iconScale }).addTo(map);

  editor.groupTransformActive = true;
  editor.groupCenterLL = centerLL;

  let lastMove = editor.groupCenterMarker.getLatLng();
  editor.groupCenterMarker.on("drag", () => {
    const now = editor.groupCenterMarker.getLatLng();
    const dx = now.lng - lastMove.lng;
    const dy = now.lat - lastMove.lat;

    const latlngs = editor.groupBoxLayer.getLatLngs()[0] || editor.groupBoxLayer.getLatLngs();
    const moved = latlngs.map(p => L.latLng(p.lat + dy, p.lng + dx));
    editor.groupBoxLayer.setLatLngs([moved]);

    const sh = editor.groupScaleMarker.getLatLng();
    editor.groupScaleMarker.setLatLng(L.latLng(sh.lat + dy, sh.lng + dx));

    lastMove = now;
  });

  editor.groupCenterMarker.on("dragend", () => {
    const now = editor.groupCenterMarker.getLatLng();
    const dx = now.lng - editor.groupCenterLL.lng;
    const dy = now.lat - editor.groupCenterLL.lat;

    for (const f of feats){
      translateFeatureInPlace(f, dx, dy);
    }

    rerenderActiveEditor();
    notify("✅ Movido (en memoria).", 1200);
  });

  editor.groupScaleMarker.on("dragstart", () => {
    const cLL = editor.groupCenterMarker.getLatLng();
    const hLL = editor.groupScaleMarker.getLatLng();
    const baseDist = distPixels(cLL, hLL);
    editor.groupScaleStart = {
      baseDist: Math.max(baseDist, 1e-6),
      center: cLL,
      snapshot: feats.map(f => deepCopy(f))
    };
  });

  editor.groupScaleMarker.on("drag", () => {
    if (!editor.groupScaleStart) return;
    const cx = c.x, cy = c.y;
    const cLL = editor.groupScaleStart.center;
    const nowHandle = editor.groupScaleMarker.getLatLng();
    const d = distPixels(cLL, nowHandle);
    const s = d / editor.groupScaleStart.baseDist;

    const bb = b;
    const cornersXY = [
      [bb.minX, bb.minY],
      [bb.maxX, bb.minY],
      [bb.maxX, bb.maxY],
      [bb.minX, bb.maxY]
    ].map(([x,y]) => transformPointAround(x,y,cx,cy,s))
     .map(([x,y]) => L.latLng(y,x));

    editor.groupBoxLayer.setLatLngs([cornersXY]);
  });

  editor.groupScaleMarker.on("dragend", () => {
    if (!editor.groupScaleStart) return;

    const cLL = editor.groupScaleStart.center;
    const nowHandle = editor.groupScaleMarker.getLatLng();
    const d = distPixels(cLL, nowHandle);
    const s = d / editor.groupScaleStart.baseDist;

    const snapshot = editor.groupScaleStart.snapshot;

    for (let i=0; i<feats.length; i++){
      const f = feats[i];
      const snap = snapshot[i];
      f.geometry = deepCopy(snap.geometry);
      f.properties = deepCopy(snap.properties);
      scaleFeatureInPlace(f, cLL.lng, cLL.lat, s);
    }

    editor.groupScaleStart = null;
    rerenderActiveEditor();
    notify("✅ Escalado (en memoria).", 1400);
  });

  if (editor.selectedSet.size > 1){
    setPanel("Selección múltiple", `
      <p><b>${feats.length}</b> figura(s) seleccionada(s).</p>
      <p style="margin-top:8px">
        • <b>Arrastra el punto rojo</b> para mover todo.<br/>
        • <b>Arrastra el cuadro verde</b> para escalar todo.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button id="btnMultiDelete" style="padding:8px 12px;border-radius:8px;border:1px solid #ef4444;background:#fff;color:#b91c1c;cursor:pointer;">Borrar seleccionados</button>
        <button id="btnMultiClear" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar selección</button>
        <button id="btnMultiCopyGeo" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      </div>
      <p style="font-size:12px;color:#6b7280;margin-top:10px;">
        Tip: usa <b>Ctrl/Cmd</b> o <b>Shift</b> + click para seleccionar varias.
      </p>
    `);

    const btnDel = document.getElementById("btnMultiDelete");
    if (btnDel) btnDel.onclick = () => {
      if (!confirm("¿Seguro que quieres borrar todas las figuras seleccionadas?")) return;
      deleteSelectedFeature();
    };
    const btnClr = document.getElementById("btnMultiClear");
    if (btnClr) btnClr.onclick = () => {
      clearMultiSelection();
      rerenderActiveEditor();
      notify("Selección limpiada.", 1200);
    };

    const btnCopy = document.getElementById("btnMultiCopyGeo");
    if (btnCopy) btnCopy.onclick = async () => {
      const ds = getEditDataset();
      const txt = JSON.stringify(ds?.data || { type:"FeatureCollection", features:[] }, null, 2);
      try {
        await navigator.clipboard.writeText(txt);
        notify("GeoJSON copiado. Pégalo en el archivo correspondiente.", 2000);
      } catch {
        setPanel("Copia manual", `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
      }
    };
  }

  try { flyToBoundsSmooth(boundsToLatLngBounds(b, 0.10), 0.35); } catch {}
}

/* ---------- SINGLE: editar puntos (vértices) ---------- */
function editorStartEditPolygonVertices(layer){
  editorStopVertexEditing();

  editor.selectedLayer = layer;
  editor.selectedFeature = layer.feature;
  editor.selectedIsCircle = false;
  editor.originalGeometry = deepCopy(layer.feature.geometry);

  const latlngs = layer.getLatLngs();
  const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;

  let ring2 = ring;
  if (ring2.length >= 2){
    const a = ring2[0], b = ring2[ring2.length-1];
    if (Math.abs(a.lat-b.lat)<1e-9 && Math.abs(a.lng-b.lng)<1e-9) ring2 = ring2.slice(0, -1);
  }

  editor.vertexMarkers = ring2.map((p) => {
    const mk = L.marker(p, { draggable:true, icon: editor.iconVertex }).addTo(map);
    mk.on("drag", () => {
      const newRing = editor.vertexMarkers.map(m => m.getLatLng());
      layer.setLatLngs([newRing]);
    });
    mk.on("dragend", () => {
      const newRing = editor.vertexMarkers.map(m => m.getLatLng());
      layer.setLatLngs([newRing]);
      editor.selectedFeature.geometry.coordinates = ringToGeoJsonCoords(newRing);
      renderEditSelectedPanel();
      notify("Puntos actualizados (en memoria).", 900);
    });
    return mk;
  });

  renderEditSelectedPanel();
}

function editorStartEditCircleVertices(layer){
  editorStopVertexEditing();

  editor.selectedLayer = layer;
  editor.selectedFeature = layer.feature;
  editor.selectedIsCircle = true;

  editor.originalGeometry = deepCopy(layer.feature.geometry);
  editor.originalRadius = layer.feature.properties.radius;

  const center = layer.getLatLng();
  const radius = layer.feature.properties.radius;

  editor.circleCenterMarker = L.marker(center, { draggable:true, icon: editor.iconCenter }).addTo(map);

  const handle = L.latLng(center.lat, center.lng + radius);
  editor.circleRadiusMarker = L.marker(handle, { draggable:true, icon: editor.iconHandle }).addTo(map);

  const updateCircle = () => {
    const c = editor.circleCenterMarker.getLatLng();
    const h = editor.circleRadiusMarker.getLatLng();
    const r = distPixels(c, h);

    layer.setLatLng(c);
    layer.setRadius(r);

    editor.selectedFeature.geometry.coordinates = latLngToXY(c);
    editor.selectedFeature.properties.radius = r;

    renderEditSelectedPanel();
    notify("Círculo actualizado (en memoria).", 900);
  };

  editor.circleCenterMarker.on("drag", () => {
    const c = editor.circleCenterMarker.getLatLng();
    const r = layer.getRadius();
    editor.circleRadiusMarker.setLatLng(L.latLng(c.lat, c.lng + r));
    layer.setLatLng(c);
  });
  editor.circleCenterMarker.on("dragend", updateCircle);

  editor.circleRadiusMarker.on("drag", () => {
    const c = editor.circleCenterMarker.getLatLng();
    const h = editor.circleRadiusMarker.getLatLng();
    layer.setRadius(distPixels(c,h));
  });
  editor.circleRadiusMarker.on("dragend", updateCircle);

  renderEditSelectedPanel();
}

/* ---------- EDIT DATASET META ---------- */
function getEditDataset(){
  if (isEditSecciones) return { label:"SECCIONES", data: seccionesTopRaw, dest: SECCIONES_TOP_URL };
  if (isEditManzanas)  return { label:"MANZANAS",  data: manzanasRaw,     dest: MANZANAS_URL };
  if (isEditLotes)     return { label:"LOTES",     data: currentLotesRaw, dest: currentLotesSourceUrl || (getSelectedSeccion() ? getSharedLotesUrlForSeccion(getSelectedSeccion()) : "(elige SECCIÓN)") };
  if (isEditNichos)    return { label:"NICHOS",    data: nichosZonasRaw,  dest: NICHOS_ZONAS_URL };
  return null;
}

/* =========================================================
   PANEL: EDIT SELECTED (borrar + copy/paste)
   - Si editSubmode=transform: muestra botón “Editar puntos”
   - Si editSubmode=vertices: muestra botón “Mover/Escalar”
   ========================================================= */
function renderEditSelectedPanel(){
  const ds = getEditDataset();
  const kind = ds?.label || "ITEM";
  const currentId = getFeatureId(editor.selectedFeature) || "(sin id)";
  const currentDisplayId = getEditorDisplayId(editor.selectedFeature) || "(sin id)";
  const showColor = isEditSecciones && editor.selectedFeature?.properties;
  const currentColor = showColor ? (editor.selectedFeature.properties.color || DEFAULT_SECCION_COLOR) : DEFAULT_SECCION_COLOR;

  // Editor LOTES: selector de manzana dentro del panel del lote
  let manzanaOptionsHtml = "";
  if (isEditLotes && editor.selectedFeature){
    const secForOpts = (editor.selectedFeature?.properties?.seccion || getSelectedSeccion() || "").toString().trim();
    const list = buildManzanasListBySeccion((manzanasRaw?.features || []), secForOpts);
    const curMan = (editor.selectedFeature?.properties?.manzana || editor.selectedFeature?.properties?.manzanaId || "").toString().trim();

    const opts = [
      `<option value="">(sin manzana)</option>`,
      ...list.map(f => {
        const m = getPropManzana(f);
        const sel = (m && curMan && m.toUpperCase() === curMan.toUpperCase()) ? "selected" : "";
        return `<option value="${safe(m)}" ${sel}>${safe(m)}</option>`;
      })
    ].join("");

    manzanaOptionsHtml = `
      <hr/>
      <label><b>Manzana del lote</b></label><br/>
      <select id="editLoteManzana" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">${opts}</select>
      <p style="font-size:12px;color:#6b7280;margin-top:-2px;">Tip: esto permite copiar lotes entre manzanas sin cambiar de manzana arriba.</p>
    `;
  }

  let paqueteOptionsHtml = "";
  if (isEditManzanas && editor.selectedFeature){
    const curPkg = (editor.selectedFeature?.properties?.paquete || "").toString().trim();

    const pkgKeys = Object.keys(paquetesInfo || {}).sort((a,b) =>
      a.localeCompare(b, "es", { sensitivity:"base" })
    );

    const opts = [
      `<option value="">(sin paquete)</option>`,
      ...pkgKeys.map(k => {
        const sel = (curPkg && k === curPkg) ? "selected" : "";
        const label = (paquetesInfo?.[k]?.nombre) ? `${k} — ${paquetesInfo[k].nombre}` : k;
        return `<option value="${safe(k)}" ${sel}>${safe(label)}</option>`;
      })
    ].join("");

    paqueteOptionsHtml = `
      <hr/>
      <label><b>Paquete de la manzana</b></label><br/>
      <select id="editManzanaPaquete" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">${opts}</select>
      <p style="font-size:12px;color:#6b7280;margin-top:-2px;">
        Este paquete se usará como default para los lotes de esta manzana que no tengan paquete propio.
      </p>
    `;
  }

  const modeLabel = (editor.editSubmode === "vertices") ? "Edición de puntos" : "Mover/Escalar";

  setPanel(`Editar ${kind}: ${safe(currentDisplayId)}`, `
    <p><b>Modo:</b> ${safe(modeLabel)}</p>
    <p><b>Tipo:</b> ${editor.selectedIsCircle ? "Círculo" : "Polígono"}</p>
    <p style="font-size:12px;color:#666;">Destino: <b>${safe(ds?.dest || "")}</b></p>
    <p style="font-size:12px;color:#6b7280;margin-top:8px;">
      Tip multi: <b>Ctrl/Cmd</b> o <b>Shift</b> + click para seleccionar varios. (Multi usa solo mover/escalar).
    </p>

    <hr/>
    <label><b>${isEditManzanas ? "Manzana" : "Nombre / ID"}</b></label><br/>
    <input id="editIdInput" value="${safe(currentDisplayId)}"
      style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

    ${manzanaOptionsHtml}
    ${paqueteOptionsHtml}

    ${showColor ? `
      <hr/>
      <label><b>Color de la sección</b></label><br/>
      <input id="editSeccionColor" type="color" value="${safe(currentColor)}"
        style="width:100%;height:44px;border:1px solid #ccc;border-radius:10px;padding:4px;cursor:pointer;" />
    ` : ""}


    <hr/>
    <label><b>Escalar (factor)</b></label><br/>
    <div style="display:flex;gap:8px;align-items:center;margin:6px 0;">
      <input id="scaleFactorInput" type="number" value="1" step="0.01"
        style="flex:1;padding:8px;border:1px solid #ccc;border-radius:8px;" />
      <button id="btnApplyScale"
        style="padding:8px 12px;border-radius:8px;border:1px solid #22c55e;background:#fff;color:#15803d;cursor:pointer;">
        Aplicar
      </button>
    </div>
    <p style="font-size:12px;color:#6b7280;margin-top:-2px;">
      Ejemplos: 1.10 = +10% · 0.90 = -10% · 2.00 = doble tamaño
    </p>


    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      <button id="btnToggleMode" style="padding:8px 12px;border-radius:8px;border:1px solid #111;background:#fff;cursor:pointer;">
        ${editor.editSubmode === "vertices" ? "Mover/Escalar" : "Editar puntos"}
      </button>

      <button id="btnDeleteShape" style="padding:8px 12px;border-radius:8px;border:1px solid #ef4444;background:#fff;color:#b91c1c;cursor:pointer;">Borrar</button>
      <button id="btnCopyShape" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar</button>
      <button id="btnPasteShape" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Pegar</button>
      <button id="btnCancelPaste" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;display:none;">Cancelar pegado</button>
      <button id="btnCopyGeo" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      <button id="btnBack" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Volver</button>
    </div>
  `);

  // Escalar por número (solo el objeto seleccionado)
  const btnApplyScale = document.getElementById("btnApplyScale");
  if (btnApplyScale){
    btnApplyScale.onclick = () => {
      if (!editor.selectedFeature) return notify("No hay figura seleccionada.", 1600);

      const raw = Number(document.getElementById("scaleFactorInput")?.value || 1);
      if (!isFinite(raw) || raw <= 0) return notify("Factor inválido. Usa un número > 0.", 2000);
      if (raw === 1) return notify("Factor = 1. No cambia nada.", 1400);

      const center = getFeatureCenterXY(editor.selectedFeature);
      if (!center) return notify("No pude calcular el centro de la figura.", 2000);

      // aplica escala respecto al centro del feature
      scaleFeatureInPlace(editor.selectedFeature, center.cx, center.cy, raw);

      // IMPORTANTE: re-render para ver cambios
      rerenderActiveEditor();
      notify(`✅ Escalado aplicado: x${raw}`, 1600);
    };
  }

  const $idInput = document.getElementById("editIdInput");
  if ($idInput){
    $idInput.oninput = () => {
      const newId = ($idInput.value || "").trim();
      if (!newId) return;

      if (isEditManzanas){
        setManzanaDisplayId(editor.selectedFeature, newId);
        $title.textContent = `Editar ${kind}: ${newId.toUpperCase()}`;
      } else {
        setFeatureId(editor.selectedFeature, newId);
        $title.textContent = `Editar ${kind}: ${newId}`;
      }
    };
  }



  // Editor LOTES: cambiar manzana del lote seleccionado
  const $editManSel = document.getElementById('editLoteManzana');
  if ($editManSel){
    $editManSel.onchange = () => {
      const man = ($editManSel.value || '').toString().trim();
      ensureLoteContextProps(editor.selectedFeature, getSelectedSeccion(), man);
      rerenderLotes_Edit();
      notify('Manzana actualizada (en memoria).', 1200);
    };
  }
  const $pkgSel = document.getElementById("editManzanaPaquete");
  if ($pkgSel){
    $pkgSel.onchange = () => {
      const pkg = ($pkgSel.value || "").toString().trim();
      if (!editor.selectedFeature.properties) editor.selectedFeature.properties = {};
      if (!pkg) delete editor.selectedFeature.properties.paquete;
      else editor.selectedFeature.properties.paquete = pkg;

      rerenderManzanas_Edit();
      notify("Paquete de manzana actualizado (en memoria).", 1400);
    };
  }
  if (showColor){
    const $col = document.getElementById("editSeccionColor");
    if ($col){
      $col.oninput = () => {
        editor.selectedFeature.properties.color = $col.value;
        try { editor.selectedLayer.setStyle({ weight: 2, opacity: 1, fillOpacity: 0.06, fillColor: $col.value }); } catch {}
        notify("Color actualizado (en memoria).", 900);
      };
    }
  }

  const btnToggle = document.getElementById("btnToggleMode");
  if (btnToggle){
    btnToggle.onclick = () => {
      if (!editor.selectedLayer || !editor.selectedFeature) return;

      // Multi selection => no vertices
      if (editor.selectedSet.size > 1){
        notify("Para edición de puntos, selecciona solo 1 figura (sin Ctrl/Shift).", 2200);
        return;
      }

      if (editor.editSubmode === "vertices"){
        // pasar a transform
        editor.editSubmode = "transform";
        editorStopVertexEditing();
        rerenderActiveEditor();
        return;
      }

      // pasar a vertices
      editor.editSubmode = "vertices";
      clearGroupTransformUI();

      const layer = editor.selectedLayer;
      const feat = editor.selectedFeature;
      if (isCircleFeature(feat) && layer instanceof L.Circle) editorStartEditCircleVertices(layer);
      else editorStartEditPolygonVertices(layer);
    };
  }

  const btnDelete = document.getElementById("btnDeleteShape");
  if (btnDelete){
    btnDelete.onclick = () => {
      if (!confirm("¿Seguro que quieres borrar esta figura?")) return;
      deleteSelectedFeature();
    };
  }

  const btnCopyShape = document.getElementById("btnCopyShape");
  const btnPasteShape = document.getElementById("btnPasteShape");
  const btnCancelPaste = document.getElementById("btnCancelPaste");

  if (btnCopyShape) btnCopyShape.disabled = !editor.selectedFeature;
  if (btnPasteShape) btnPasteShape.disabled = !editor.clipboardFeature;

  if (btnCancelPaste){
    btnCancelPaste.style.display = editor.pasteArmed ? "inline-block" : "none";
    btnCancelPaste.onclick = () => {
      editor.pasteArmed = false;
      notify("Pegado cancelado.", 1200);
      renderEditSelectedPanel();
    };
  }

  if (btnCopyShape){
    btnCopyShape.onclick = () => {
      if (!editor.selectedFeature) return;
      editor.clipboardFeature = deepCopy(editor.selectedFeature);
      notify("Figura copiada. Presiona 'Pegar' y luego haz click en el mapa.", 2200);
      renderEditSelectedPanel();
    };
  }

  if (btnPasteShape){
    btnPasteShape.onclick = () => {
      if (!editor.clipboardFeature) return;
      editor.pasteArmed = true;
      notify("Modo PEGAR activado. Haz click en el mapa para colocar la copia.", 2200);
      renderEditSelectedPanel();
    };
  }

  document.getElementById("btnCopyGeo").onclick = async () => {
    const ds2 = getEditDataset();
    // Editor LOTES: asegurar que se copie con manzana
    if (isEditLotes && ds2?.data) { try { normalizeLotesContext(ds2.data); } catch {} }
    const txt = JSON.stringify(ds2?.data || { type:"FeatureCollection", features:[] }, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      notify("GeoJSON copiado. Pégalo en el archivo correspondiente.", 2200);
    } catch {
      setPanel("Copia manual", `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };

  document.getElementById("btnBack").onclick = () => {
    editorStopEditing();
    clearMultiSelection();
    editor.pasteArmed = false;
    if (isEditSecciones) renderEditSeccionesPanel();
    else if (isEditManzanas) renderEditManzanasPanel();
    else if (isEditLotes) renderEditLotesPanel();
  };
}

/* =========================================================
   GRID GROUP: mover la última cuadrícula
   ========================================================= */
function clearLastGridOverlay(){
  if (editor.lastGrid?.overlay){
    try { map.removeLayer(editor.lastGrid.overlay); } catch {}
  }
  if (editor.lastGrid?.centerMarker){
    try { map.removeLayer(editor.lastGrid.centerMarker); } catch {}
  }
  editor.lastGrid = null;
}

function activateGridGroup(datasetArr, features){
  clearLastGridOverlay();
  if (!datasetArr || !features || features.length === 0) return;

  const b = boundsFromFeatures(features);
  if (!b) return;

  const llb = boundsToLatLngBounds(b, 0.06);
  const c = boundsCenter(b);

  const rect = [
    [b.minY, b.minX],
    [b.minY, b.maxX],
    [b.maxY, b.maxX],
    [b.maxY, b.minX]
  ].map(([y,x]) => L.latLng(y,x));

  const overlay = L.polygon(rect, {
    weight: 2,
    color: "#ef4444",
    fillColor: "#ef4444",
    fillOpacity: 0.06,
    dashArray: "6 6"
  }).addTo(map);

  const centerMarker = L.marker(L.latLng(c.y, c.x), { draggable:true, icon: editor.iconCenter }).addTo(map);

  let last = centerMarker.getLatLng();

  centerMarker.on("drag", () => {
    const now = centerMarker.getLatLng();
    const dx = now.lng - last.lng;
    const dy = now.lat - last.lat;

    const latlngs = overlay.getLatLngs()[0] || overlay.getLatLngs();
    const moved = latlngs.map(p => L.latLng(p.lat + dy, p.lng + dx));
    overlay.setLatLngs([moved]);

    last = now;
  });

  centerMarker.on("dragend", () => {
    const now = centerMarker.getLatLng();
    const prevCenter = editor.lastGrid?.centerLL || L.latLng(c.y, c.x);
    const dx = now.lng - prevCenter.lng;
    const dy = now.lat - prevCenter.lat;

    for (const f of features){
      translateFeatureInPlace(f, dx, dy);
    }

    rerenderActiveEditor();
    activateGridGroup(datasetArr, features);
    notify("✅ Cuadrícula movida (guardado en memoria). Usa 'Copiar GeoJSON' para pegar en tu archivo.", 2200);
  });

  editor.lastGrid = {
    datasetArr,
    features,
    overlay,
    centerMarker,
    bounds: b,
    centerLL: L.latLng(c.y, c.x),
  };

  try { flyToBoundsSmooth(llb, 0.45); } catch {}
}

function activateLastGridIfAny(){
  if (editor.lastGrid?.datasetArr && editor.lastGrid?.features?.length){
    activateGridGroup(editor.lastGrid.datasetArr, editor.lastGrid.features);
  } else {
    notify("No hay una cuadrícula reciente para seleccionar.", 2000);
  }
}

/* =========================================================
   EDIT PANELS
   ========================================================= */
function renderEditSeccionesPanel(){
  editor.mode = "edit";
  editor.drawShape = "polygon";
  editor.gridArmed = false;
  editor.gridConfig = null;
  editor.pasteArmed = false;

  editorClearPoly();
  editorClearCircle();
  editorStopEditing();
  clearMultiSelection();

  setPanel("Edición: SECCIONES", `
    <p>Editor de <b>SECCIONES</b>.</p>
    <p style="margin:2px 0;font-size:12px;color:#6b7280;">
      Click normal: selecciona y permite <b>mover/escalar</b>.<br/>
      Botón “Editar puntos” para modificar vértices.<br/>
      Multi-select: <b>Ctrl/Cmd</b> o <b>Shift</b> + click (mover/escalar en grupo).
    </p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button id="btnEdit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Editar existente</button>
      <button id="btnCreate" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Crear nueva</button>
      <button id="btnCopy" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      <button id="btnExit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Salir</button>
    </div>

    <hr/>
    <div id="editBody"></div>

    <p style="font-size:12px;color:#666;margin-top:10px;">
      Destino: <b>${safe(SECCIONES_TOP_URL)}</b>
    </p>
  `);

  const $editBody = document.getElementById("editBody");

  document.getElementById("btnEdit").onclick = () => {
    editor.mode = "edit";
    editorClearPoly(); editorClearCircle();
    editorStopEditing();
    clearMultiSelection();
    $editBody.innerHTML = `<p><b>Editar:</b> clic en una sección para seleccionar.</p>`;
    rerenderSecciones_Edit();
  };

  document.getElementById("btnCreate").onclick = () => {
    editor.mode = "create";
    editorStopEditing();
    clearMultiSelection();
    clearGroupTransformUI();
    editorClearPoly(); editorClearCircle();

    $editBody.innerHTML = `
      <p><b>Crear sección:</b> elige forma:</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <button id="btnPoly" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Polígono</button>
        <button id="btnCircle" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Círculo</button>
        <button id="btnClear" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar</button>
      </div>

      <p><b>Puntos (polígono):</b> <span id="ptCount">0</span></p>

      <label><b>SECCIÓN</b></label><br/>
      <input id="newSeccion" placeholder="Ej. SAN ANDRES" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Nombre (opcional)</b></label><br/>
      <input id="newNombre" placeholder="Ej. Zona SAN ANDRES" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Color</b></label><br/>
      <input id="newColor" type="color" value="${DEFAULT_SECCION_COLOR}"
        style="width:100%;height:44px;border:1px solid #ccc;border-radius:10px;padding:4px;cursor:pointer;" />

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button id="btnSaveNew" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar</button>
      </div>
    `;

    document.getElementById("btnPoly").onclick = () => { editor.drawShape = "polygon"; };
    document.getElementById("btnCircle").onclick = () => { editor.drawShape = "circle"; };
    document.getElementById("btnClear").onclick = () => { editorClearPoly(); editorClearCircle(); };

    document.getElementById("btnSaveNew").onclick = () => {
      const seccion = (document.getElementById("newSeccion").value || "").trim();
      const nombre  = (document.getElementById("newNombre").value || "").trim();
      const color   = (document.getElementById("newColor").value || "").trim() || DEFAULT_SECCION_COLOR;

      if (!seccion) return notify("Falta SECCIÓN.", 2000);

      const props = { seccion, nombre: nombre || seccion, id: seccion, color };

      let feature = null;
      if (editor.drawShape === "polygon"){
        if (editor.polyPoints.length < 3) return notify("Polígono: mínimo 3 puntos.", 2200);
        feature = { type:"Feature", geometry:{ type:"Polygon", coordinates:ringToGeoJsonCoords(editor.polyPoints) }, properties: props };
      } else {
        if (!editor.circleCenter || typeof editor.circleRadius !== "number") return notify("Círculo: clic centro y luego borde.", 2200);
        feature = { type:"Feature", geometry:{ type:"Point", coordinates: latLngToXY(editor.circleCenter) }, properties:{ ...props, shape:"circle", radius: editor.circleRadius } };
      }

      seccionesTopRaw.features.push(feature);
      editorClearPoly(); editorClearCircle();
      rerenderSecciones_Edit();
      notify("✅ Sección creada (en memoria). Usa 'Copiar GeoJSON' para pegar en el archivo.", 2400);
    };

    rerenderSecciones_Edit();
  };

  document.getElementById("btnCopy").onclick = async () => {
    const txt = JSON.stringify(seccionesTopRaw || { type:"FeatureCollection", features:[] }, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      notify("GeoJSON copiado. Pégalo en data/secciones-top.geojson.", 2400);
    } catch {
      setPanel("Copia manual", `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };

  document.getElementById("btnExit").onclick = () => location.href = "./";
  document.getElementById("btnEdit").click();
}

function renderEditManzanasPanel(){
  editor.mode = "edit";
  editor.drawShape = "polygon";
  editor.gridArmed = false;
  editor.gridConfig = null;
  editor.pasteArmed = false;

  editorClearPoly(); editorClearCircle(); editorStopEditing();
  clearMultiSelection();

  setPanel("Edición: MANZANAS", `
    <p>Editor de <b>MANZANAS</b> (IDs: A, B, C...).</p>
    <p style="margin:2px 0;font-size:12px;color:#6b7280;">
      Click normal: selecciona y permite <b>mover/escalar</b>. “Editar puntos” para vértices.<br/>
      Multi-select: <b>Ctrl/Cmd</b> o <b>Shift</b> + click.
    </p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button id="btnEdit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Editar existente</button>
      <button id="btnCreate" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Crear 1 manzana</button>
      <button id="btnGrid" style="padding:8px 12px;border-radius:8px;border:1px solid #111;cursor:pointer;">Crear cuadrícula</button>
      <button id="btnSelectGrid" style="padding:8px 12px;border-radius:8px;border:1px solid #ef4444;color:#b91c1c;background:#fff;cursor:pointer;">Seleccionar última cuadrícula</button>
      <button id="btnCopy" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      <button id="btnExit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Salir</button>
    </div>

    <hr/>
    <div id="editBody"></div>

    <p style="font-size:12px;color:#666;margin-top:10px;">
      Destino: <b>${safe(MANZANAS_URL)}</b>
    </p>
  `);

  const $editBody = document.getElementById("editBody");

  document.getElementById("btnSelectGrid").onclick = () => activateLastGridIfAny();

  document.getElementById("btnEdit").onclick = () => {
    editor.mode = "edit";
    editorClearPoly(); editorClearCircle();
    editorStopEditing();
    clearMultiSelection();
    $editBody.innerHTML = `<p><b>Editar:</b> clic en una manzana para seleccionar.</p>`;
    rerenderManzanas_Edit();
  };

  document.getElementById("btnCreate").onclick = () => {
    editor.mode = "create";
    editorStopEditing();
    clearMultiSelection();
    clearGroupTransformUI();
    editorClearPoly(); editorClearCircle();

    $editBody.innerHTML = `
      <p><b>Crear 1 manzana:</b> elige forma:</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <button id="btnPoly" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Polígono</button>
        <button id="btnCircle" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Círculo</button>
        <button id="btnClear" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar</button>
      </div>

      <p><b>Puntos (polígono):</b> <span id="ptCount">0</span></p>

      <label><b>SECCIÓN</b></label><br/>
      <input id="newSeccion" placeholder="Ej. SAN ANDRES" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>MANZANA</b> (A, B, C...)</label><br/>
      <input id="newManzana" placeholder="Ej. A" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Nombre (opcional)</b></label><br/>
      <input id="newNombre" placeholder="Ej. SAN ANDRES - A" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Archivo de lotes</b></label><br/>
      <input id="newLotesFile" placeholder="Ej. ./data/lotes/lotes-SAN ANDRES-A.geojson" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button id="btnSaveNew" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar</button>
      </div>
    `;

    document.getElementById("btnPoly").onclick = () => { editor.drawShape = "polygon"; };
    document.getElementById("btnCircle").onclick = () => { editor.drawShape = "circle"; };
    document.getElementById("btnClear").onclick = () => { editorClearPoly(); editorClearCircle(); };

    document.getElementById("btnSaveNew").onclick = () => {
      const seccion = (document.getElementById("newSeccion").value || "").trim();
      const manzana = (document.getElementById("newManzana").value || "").trim().toUpperCase();
      const nombre  = (document.getElementById("newNombre").value || "").trim();
      const lotesFileIn = (document.getElementById("newLotesFile").value || "").trim();

      if (!seccion) return notify("Falta SECCIÓN.", 2000);
      if (!manzana) return notify("Falta MANZANA.", 2000);

      const lotesFile = lotesFileIn || `./data/lotes/lotes-${seccion}-${manzana}.geojson`;
      const props = { seccion, manzana, nombre: nombre || `${seccion} - ${manzana}`, lotesFile, id: `${seccion}-${manzana}` };

      let feature = null;
      if (editor.drawShape === "polygon"){
        if (editor.polyPoints.length < 3) return notify("Polígono: mínimo 3 puntos.", 2200);
        feature = { type:"Feature", geometry:{ type:"Polygon", coordinates:ringToGeoJsonCoords(editor.polyPoints) }, properties: props };
      } else {
        if (!editor.circleCenter || typeof editor.circleRadius !== "number") return notify("Círculo: clic centro y luego borde.", 2200);
        feature = { type:"Feature", geometry:{ type:"Point", coordinates: latLngToXY(editor.circleCenter) }, properties:{ ...props, shape:"circle", radius: editor.circleRadius } };
      }

      manzanasRaw.features.push(feature);
      editorClearPoly(); editorClearCircle();
      rerenderManzanas_Edit();
      notify("✅ Manzana creada (en memoria). Usa 'Copiar GeoJSON' para guardar.", 2400);
    };

    rerenderManzanas_Edit();
  };

  document.getElementById("btnGrid").onclick = () => {
    editor.mode = "grid";
    editor.gridArmed = true;
    editor.gridConfig = { target: "manzanas" };
    editorStopEditing();
    clearMultiSelection();
    clearGroupTransformUI();
    editorClearPoly(); editorClearCircle();

    $editBody.innerHTML = `
      <p><b>Crear cuadrícula de MANZANAS (con rotación)</b></p>
      <p style="color:#6b7280;font-size:12px;">
        1) Configura filas/columnas/tamaño/espacios/rotación. 2) Presiona <b>Armar</b>.
        3) Da <b>1 click</b> en el mapa para colocar la esquina superior-izquierda.
      </p>

      <label><b>SECCIÓN</b></label><br/>
      <input id="mGridSeccion" placeholder="Ej. SAN ANDRES" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Filas</b></label><br/>
      <input id="mGridRows" type="number" value="3" min="1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Columnas</b></label><br/>
      <input id="mGridCols" type="number" value="5" min="1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Ancho (px)</b></label><br/>
      <input id="mGridW" type="number" value="220" min="1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Alto (px)</b></label><br/>
      <input id="mGridH" type="number" value="160" min="1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Espacio X (px)</b></label><br/>
      <input id="mGridGapX" type="number" value="20" min="0" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Espacio Y (px)</b></label><br/>
      <input id="mGridGapY" type="number" value="20" min="0" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Rotación (grados)</b></label><br/>
      <input id="mGridRot" type="number" value="0" step="0.1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Manzana inicial</b> (A)</label><br/>
      <input id="mGridStart" value="A" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button id="btnArmManzGrid" style="padding:8px 12px;border-radius:8px;border:1px solid #111;cursor:pointer;">Armar</button>
        <button id="btnCancelManzGrid" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Cancelar</button>
      </div>

      <p id="mGridHint" style="margin-top:10px;color:#6b7280;font-size:12px;"></p>
    `;

    const hint = document.getElementById("mGridHint");

    document.getElementById("btnCancelManzGrid").onclick = () => {
      editor.gridArmed = false;
      editor.gridConfig = null;
      notify("Cuadrícula cancelada.", 1400);
      renderEditManzanasPanel();
    };

    document.getElementById("btnArmManzGrid").onclick = () => {
      const seccion = (document.getElementById("mGridSeccion").value || "").trim();
      const rows = Number(document.getElementById("mGridRows").value || 0);
      const cols = Number(document.getElementById("mGridCols").value || 0);
      const w = Number(document.getElementById("mGridW").value || 0);
      const h = Number(document.getElementById("mGridH").value || 0);
      const gapX = Number(document.getElementById("mGridGapX").value || 0);
      const gapY = Number(document.getElementById("mGridGapY").value || 0);
      const rot = Number(document.getElementById("mGridRot").value || 0);
      const start = (document.getElementById("mGridStart").value || "").trim().toUpperCase();

      if (!seccion) return notify("Falta SECCIÓN.", 2000);
      if (!rows || !cols || w <= 0 || h <= 0) return notify("Revisa filas/columnas/ancho/alto.", 2200);
      if (!start) return notify("Falta manzana inicial.", 2000);

      editor.gridConfig = { target:"manzanas", seccion, rows, cols, w, h, gapX, gapY, rot, start };
      editor.gridArmed = true;

      if (hint) hint.textContent = "✅ Listo. Ahora da 1 click en el mapa para colocar la esquina superior-izquierda.";
      notify("Cuadrícula armada. Click en el mapa para colocar.", 2200);
    };

    rerenderManzanas_Edit();
  };

  document.getElementById("btnCopy").onclick = async () => {
    const snapshot = deepCopy(manzanasRaw || { type:"FeatureCollection", features:[] });
    // Arregla id/seccion/manzana/nombre y elimina lotesFile para evitar inconsistencias al pegar
    const normalized = normalizeManzanasGeoJSON(snapshot);
    const txt = JSON.stringify(normalized, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      notify("GeoJSON copiado (normalizado). Pégalo en data/secciones.geojson.", 2600);
    } catch {
      setPanel("Copia manual", `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };

  document.getElementById("btnExit").onclick = () => location.href = "./";
  document.getElementById("btnEdit").click();
}



function renderEditLotesPanel(){
  // NOTA: en editor LOTES, el dataset es por SECCIÓN (archivo compartido).
  // La MANZANA es solo un filtro visual.
  editor.drawShape = 'polygon';
  editor.gridArmed = false;
  editor.gridConfig = null;
  editor.pasteArmed = false;

  // Si estás en circular y vuelves aquí, regresamos a modo edit.
  if (editor.mode !== 'circular') editor.mode = 'edit';
  editor.circularArmed = false;
  editor.circularPickingTemplate = false;

  editorClearPoly(); editorClearCircle(); editorStopEditing();
  clearMultiSelection();

  const sec = getSelectedSeccion();
  const filterMan = editor.lotesFilterManzana || getSelectedManzana() || '';
  const lotesFile = currentLotesSourceUrl || (sec ? getSharedLotesUrlForSeccion(sec) : '(elige SECCIÓN)');

  setPanel('Edición: LOTES', `
    <p><b>SECCIÓN</b>: ${safe(sec || '(elige SECCIÓN arriba)')}</p>
    <p><b>Filtro MANZANA</b>: ${safe(filterMan || '(todas)')}</p>
    <p style="margin:2px 0;font-size:12px;color:#6b7280;">
      • El archivo de lotes es <b>por SECCIÓN</b> (no se borra al cambiar de manzana).<br/>
      • La manzana solo filtra lo que ves. Para asignar manzana a un lote: selecciónalo y usa el selector en el panel.
    </p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button id="btnEdit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Editar existente</button>
      <button id="btnCreate" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Crear 1 lote</button>
      <button id="btnGrid" style="padding:8px 12px;border-radius:8px;border:1px solid #111;cursor:pointer;">Crear cuadrícula</button>
      <button id="btnCirc" style="padding:8px 12px;border-radius:8px;border:1px solid #111;cursor:pointer;">Repetir circular</button>
      <button id="btnSelectGrid" style="padding:8px 12px;border-radius:8px;border:1px solid #ef4444;color:#b91c1c;background:#fff;cursor:pointer;">Seleccionar último grupo</button>
      <button id="btnCopy" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      <button id="btnExit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Salir</button>
    </div>

    <hr/>
    <div id="editBody"></div>

    <p style="font-size:12px;color:#666;margin-top:10px;">
      Destino: <b>${safe(lotesFile)}</b>
    </p>
  `);

  const $editBody = document.getElementById('editBody');

  // Seleccionar último grupo
  document.getElementById('btnSelectGrid').onclick = () => activateLastGridIfAny();

  // Editar
  document.getElementById('btnEdit').onclick = () => {
    editor.mode = 'edit';
    editorClearPoly(); editorClearCircle();
    editorStopEditing();
    clearMultiSelection();
    $editBody.innerHTML = `<p><b>Editar:</b> clic en un lote para seleccionar.</p>`;
    rerenderLotes_Edit();
  };

  // Crear 1 lote
  document.getElementById('btnCreate').onclick = () => {
    if (!getSelectedSeccion()) return notify('Primero elige una SECCIÓN arriba.', 2200);
    editor.mode = 'create';
    editorStopEditing();
    clearMultiSelection();
    clearGroupTransformUI();
    editorClearPoly(); editorClearCircle();

    const sec2 = getSelectedSeccion();
    const list = buildManzanasListBySeccion(manzanasRaw.features, sec2);
    const options = ['<option value="">(sin manzana)</option>'].concat(
      list.map(f => {
        const m = getPropManzana(f);
        return `<option value="${safe(m)}" ${m===filterMan?'selected':''}>${safe(m)}</option>`;
      })
    ).join('');

    $editBody.innerHTML = `
      <p><b>Crear 1 lote:</b> elige forma:</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <button id="btnPoly" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Polígono</button>
        <button id="btnCircle" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Círculo</button>
        <button id="btnClear" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar</button>
      </div>

      <p><b>Puntos (polígono):</b> <span id="ptCount">0</span></p>

      <label><b>MANZANA</b></label><br/>
      <select id="newLoteManzana" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">${options}</select>

      <label><b>LOTE</b></label><br/>
      <input id="newLote" placeholder="Ej. 001" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Estatus</b></label><br/>
      <select id="newStatus" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">
        <option>disponible</option>
        <option>ocupado</option>
        <option>por construir</option>
      </select>

      <label><b>Paquete (opcional)</b></label><br/>
      <input id="newPkg" placeholder="Ej. PAQ-STD" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button id="btnSaveNew" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar</button>
      </div>
    `;

    document.getElementById('btnPoly').onclick = () => { editor.drawShape = 'polygon'; };
    document.getElementById('btnCircle').onclick = () => { editor.drawShape = 'circle'; };
    document.getElementById('btnClear').onclick = () => { editorClearPoly(); editorClearCircle(); };

    document.getElementById('btnSaveNew').onclick = () => {
      if (!currentLotesRaw) currentLotesRaw = { type:'FeatureCollection', features:[] };
      const lote = (document.getElementById('newLote').value || '').trim();
      if (!lote) return notify('Falta LOTE.', 2000);
      const estatus = document.getElementById('newStatus').value;
      const paquete = (document.getElementById('newPkg').value || '').trim() || null;
      const manzana = (document.getElementById('newLoteManzana').value || '').trim();

      const props = { lote, id: lote, estatus, paquete };
      const feature = { type:'Feature', geometry:null, properties: props };

      if (editor.drawShape === 'polygon'){
        if (editor.polyPoints.length < 3) return notify('Polígono: mínimo 3 puntos.', 2200);
        feature.geometry = { type:'Polygon', coordinates:ringToGeoJsonCoords(editor.polyPoints) };
      } else {
        if (!editor.circleCenter || typeof editor.circleRadius !== 'number') return notify('Círculo: clic centro y luego borde.', 2200);
        feature.geometry = { type:'Point', coordinates: latLngToXY(editor.circleCenter) };
        feature.properties.shape = 'circle';
        feature.properties.radius = editor.circleRadius;
      }

      ensureLoteContextProps(feature, sec2, manzana);
      currentLotesRaw.features.push(feature);
      editorClearPoly(); editorClearCircle();
      rerenderLotes_Edit();
      notify('✅ Lote creado (en memoria). Usa "Copiar GeoJSON" para guardar.', 2400);
    };

    rerenderLotes_Edit();
  };

  // Cuadrícula lotes
  document.getElementById('btnGrid').onclick = () => {
    if (!getSelectedSeccion()) return notify('Primero elige una SECCIÓN arriba.', 2200);
    editor.mode = 'grid';
    editor.gridArmed = true;
    editor.gridConfig = { target: 'lotes' };
    editorStopEditing();
    clearMultiSelection();
    clearGroupTransformUI();
    editorClearPoly(); editorClearCircle();

    const sec2 = getSelectedSeccion();
    const list = buildManzanasListBySeccion(manzanasRaw.features, sec2);
    const options = ['<option value="">(sin manzana)</option>'].concat(
      list.map(f => {
        const m = getPropManzana(f);
        return `<option value="${safe(m)}" ${m===filterMan?'selected':''}>${safe(m)}</option>`;
      })
    ).join('');

    $editBody.innerHTML = `
      <p><b>Crear cuadrícula de LOTES (con rotación)</b></p>
      <p style="color:#6b7280;font-size:12px;">
        1) Configura filas/columnas/tamaño/espacios/rotación. 2) Presiona <b>Armar</b>.
        3) Da <b>1 click</b> en el mapa para colocar la esquina superior-izquierda.
      </p>

      <label><b>MANZANA</b> (se asigna a todos los lotes creados)</label><br/>
      <select id="gridManzana" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">${options}</select>

      <label><b>Filas</b></label><br/>
      <input id="gridRows" type="number" value="5" min="1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Columnas</b></label><br/>
      <input id="gridCols" type="number" value="10" min="1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Ancho (px)</b></label><br/>
      <input id="gridW" type="number" value="80" min="1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Alto (px)</b></label><br/>
      <input id="gridH" type="number" value="40" min="1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Espacio X (px)</b></label><br/>
      <input id="gridGapX" type="number" value="10" min="0" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Espacio Y (px)</b></label><br/>
      <input id="gridGapY" type="number" value="10" min="0" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Rotación (grados)</b></label><br/>
      <input id="gridRot" type="number" value="0" step="0.1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Lote inicial</b> (ej. 001)</label><br/>
      <input id="gridStart" value="001" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Incremento</b></label><br/>
      <input id="gridInc" type="number" value="1" min="1" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Estatus</b></label><br/>
      <select id="gridStatus" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">
        <option>disponible</option>
        <option>ocupado</option>
        <option>por construir</option>
      </select>

      <label><b>Paquete (opcional)</b></label><br/>
      <input id="gridPkg" placeholder="Ej. PAQ-STD" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button id="btnArmGrid" style="padding:8px 12px;border-radius:8px;border:1px solid #111;cursor:pointer;">Armar</button>
        <button id="btnCancelGrid" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Cancelar</button>
      </div>

      <p id="gridHint" style="margin-top:10px;color:#6b7280;font-size:12px;"></p>
    `;

    const hint = document.getElementById('gridHint');

    document.getElementById('btnCancelGrid').onclick = () => {
      editor.gridArmed = false;
      editor.gridConfig = null;
      editor.mode = 'edit';
      notify('Cuadrícula cancelada.', 1400);
      renderEditLotesPanel();
    };

    document.getElementById('btnArmGrid').onclick = () => {
      const rows = Number(document.getElementById('gridRows').value || 0);
      const cols = Number(document.getElementById('gridCols').value || 0);
      const w = Number(document.getElementById('gridW').value || 0);
      const h = Number(document.getElementById('gridH').value || 0);
      const gapX = Number(document.getElementById('gridGapX').value || 0);
      const gapY = Number(document.getElementById('gridGapY').value || 0);
      const rot = Number(document.getElementById('gridRot').value || 0);
      const start = (document.getElementById('gridStart').value || '').trim();
      const inc = Number(document.getElementById('gridInc').value || 1);
      const estatus = document.getElementById('gridStatus').value;
      const paquete = (document.getElementById('gridPkg').value || '').trim() || null;
      const manzana = (document.getElementById('gridManzana').value || '').trim();

      if (!rows || !cols || w <= 0 || h <= 0) return notify('Revisa filas/columnas/ancho/alto.', 2200);
      if (!start) return notify('Falta lote inicial.', 2000);

      editor.gridConfig = { target:'lotes', rows, cols, w, h, gapX, gapY, rot, start, inc, estatus, paquete, seccion: sec2, manzana };
      editor.gridArmed = true;

      if (hint) hint.textContent = '✅ Listo. Ahora da 1 click en el mapa para colocar la esquina superior-izquierda.';
      notify('Cuadrícula armada. Click en el mapa para colocar.', 2200);
    };

    rerenderLotes_Edit();
  };

  // Repetir circular
  document.getElementById('btnCirc').onclick = () => {
    if (!getSelectedSeccion()) return notify('Primero elige una SECCIÓN arriba.', 2200);

    editor.mode = 'circular';
    editor.circularArmed = false;
    editor.circularPickingTemplate = true;
    editor.circularConfig = {
      target: 'lotes_circular',
      count: 12,
      degrees: 360,
      startDeg: null,
      includeOriginal: true,
      template: null,
      seccion: getSelectedSeccion(),
      manzana: editor.lotesFilterManzana || ''
    };

    notify('Modo circular: haz click en 1 lote para usarlo como plantilla.', 2400);
    renderCircularRepeatPanel();
    rerenderLotes_Edit();
  };

  // Copiar GeoJSON
  document.getElementById('btnCopy').onclick = async () => {
    const fc = deepCopy(currentLotesRaw || { type:'FeatureCollection', features:[] });
    try { normalizeLotesContext(fc); } catch {}
    const txt = JSON.stringify(fc, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      notify('GeoJSON copiado. Pégalo en el archivo de lotes de la sección.', 2400);
    } catch {
      setPanel('Copia manual', `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };

  document.getElementById('btnExit').onclick = () => location.href = './';

  // estado inicial
  document.getElementById('btnEdit').click();
}

function renderCircularRepeatPanel(){
  const $editBody = document.getElementById('editBody');
  if (!$editBody) return;

  const cfg = editor.circularConfig || { count: 12, degrees: 360, startDeg: null, includeOriginal: true, template: null };
  const tplId = cfg.template ? (getFeatureId(cfg.template) || '(sin id)') : null;

  $editBody.innerHTML = `
    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:10px;background:#fff;">
      <p style="margin:0 0 6px 0;"><b>Repetir circular</b></p>
      <p style="margin:0 0 10px 0;color:#6b7280;font-size:12px;">
        1) Define <b>Copias (X)</b> y <b>Grados (Y)</b>.<br/>
        2) Click en 1 lote para escoger la <b>plantilla</b>.<br/>
        3) Presiona <b>Armar</b> y luego haz <b>1 click</b> en el mapa para poner el <b>centro</b>.
      </p>

      <label><b>Copias (X)</b></label><br/>
      <input id="circCount" type="number" value="${safe(cfg.count ?? 12)}" min="1"
        style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Grados totales (Y)</b></label><br/>
      <input id="circDegrees" type="number" value="${safe(cfg.degrees ?? 360)}" step="1"
        style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Ángulo inicial (opcional)</b></label><br/>
      <input id="circStartDeg" type="number" value="${cfg.startDeg ?? ''}"
        placeholder="vacío = calcular con centro→plantilla"
        style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label style="display:flex;gap:8px;align-items:center;margin-top:8px;">
        <input id="circIncludeOriginal" type="checkbox" ${cfg.includeOriginal !== false ? 'checked' : ''} />
        <span>Incluir la plantilla como una de las copias</span>
      </label>

      <div style="margin-top:10px;padding:10px;border:1px dashed #d1d5db;border-radius:10px;">
        <div style="font-size:12px;color:#6b7280;">Plantilla seleccionada:</div>
        <div style="font-weight:700;">${tplId ? safe(tplId) : 'NINGUNA (haz click en un lote)'}</div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button id="btnArmCirc" style="padding:8px 12px;border-radius:8px;border:1px solid #111;cursor:pointer;">Armar</button>
        <button id="btnCancelCirc" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Cancelar</button>
      </div>

      <p id="circHint" style="margin-top:10px;color:#6b7280;font-size:12px;"></p>
    </div>
  `;

  const hint = document.getElementById('circHint');
  const setHint = (msg) => { if (hint) hint.textContent = msg; };

  document.getElementById('btnCancelCirc').onclick = () => {
    editor.mode = 'edit';
    editor.circularArmed = false;
    editor.circularPickingTemplate = false;
    editor.circularConfig = null;
    notify('Repetición circular cancelada.', 1400);
    renderEditLotesPanel();
  };

  document.getElementById('btnArmCirc').onclick = () => {
    const count = Number(document.getElementById('circCount').value || 0);
    const degrees = Number(document.getElementById('circDegrees').value || 0);
    const startDegRaw = (document.getElementById('circStartDeg').value || '').trim();
    const includeOriginal = !!document.getElementById('circIncludeOriginal').checked;

    if (!count || count < 1) return notify('Copias debe ser >= 1.', 2200);
    if (!isFinite(degrees)) return notify('Grados inválidos.', 2200);

    const startDeg = startDegRaw === '' ? null : Number(startDegRaw);
    if (startDegRaw !== '' && !isFinite(startDeg)) return notify('Ángulo inicial inválido.', 2200);

    cfg.count = count;
    cfg.degrees = degrees;
    cfg.startDeg = startDeg;
    cfg.includeOriginal = includeOriginal;

    if (!cfg.template){
      editor.circularPickingTemplate = true;
      editor.circularArmed = false;
      setHint('⚠️ Falta plantilla: haz click en 1 lote para usarlo como plantilla.');
      return;
    }

    editor.circularPickingTemplate = false;
    editor.circularArmed = true;
    setHint('✅ Armado. Ahora da 1 click en el mapa para colocar el CENTRO.');
    notify('Repetición circular armada. Click en el mapa para colocar el centro.', 2200);
  };

  // hint inicial
  if (!cfg.template) setHint('Paso 1: haz click en 1 lote para elegir la plantilla.');
  else setHint('Plantilla lista. Ajusta X/Y y presiona Armar.');
}
/* =========================================================
   EDIT RENDERERS + CLICK HANDLER
   ========================================================= */
function isMultiKeyEvent(ev){
  const oe = ev?.originalEvent;
  return !!(oe?.ctrlKey || oe?.metaKey || oe?.shiftKey);
}

function handleEditorFeatureClick(feature, layer, ev){
  // MODO CIRCULAR (editor LOTES): el click en un lote selecciona la PLANTILLA
  if (isEditLotes && editor.mode === 'circular'){
    if (!editor.circularConfig) editor.circularConfig = { target: 'lotes_circular' };

    // Si estamos esperando plantilla, este click la asigna
    if (editor.circularPickingTemplate){
      editor.circularConfig.template = deepCopy(feature);
      editor.circularPickingTemplate = false;
      notify(`Plantilla seleccionada: ${getFeatureId(feature) || '(sin id)'}. Ajusta X/Y y presiona Armar.`, 2600);
      renderCircularRepeatPanel();
      return;
    }

    // Si ya hay plantilla pero aún no está armado, mantenemos el panel
    if (!editor.circularArmed){
      renderCircularRepeatPanel();
      return;
    }
    // Si está armado, el siguiente paso es click en el mapa (no aquí)
    return;
  }

  if (editor.mode !== "edit") return;

  const multiKey = isMultiKeyEvent(ev);

  // Multi toggle selection
  if (multiKey){
    editorStopEditing();            // salir de vértices si estabas ahí
    editor.editSubmode = "transform";
    editor.pasteArmed = false;

    if (editor.selectedSet.has(feature)) editor.selectedSet.delete(feature);
    else editor.selectedSet.add(feature);

    // si queda 0, limpia handles
    if (editor.selectedSet.size === 0){
      clearGroupTransformUI();
      rerenderActiveEditor();
      notify("Selección vacía.", 900);
      return;
    }

    rerenderActiveEditor(); // esto re-arma selectedLayers y handles
    return;
  }

  // Single selection: por default TRANSFORM (mover/escalar) sin vértices
  editorStopEditing();
  clearMultiSelection();
  editor.editSubmode = "transform";
  editor.pasteArmed = false;

  editor.selectedFeature = feature;
  editor.selectedLayer = layer;
  editor.selectedIsCircle = isCircleFeature(feature) && (layer instanceof L.Circle);

  editor.selectedSet.add(feature);
  editor.selectedLayers = [layer];

  rerenderActiveEditor(); // re-pinta estilo y crea handles + panel
}

function rerenderSecciones_Edit(){
  if (seccionesLayer){ seccionesLayer.remove(); seccionesLayer = null; }
  editorStopVertexEditing();
  clearGroupTransformUI();

  seccionesLayer = L.geoJSON(seccionesTopRaw || { type:"FeatureCollection", features:[] }, {
    style: (feature) => ({ weight: 2, opacity: 1, fillOpacity: 0.06, fillColor: getSeccionColor(feature) }),
    interactive: (editor.mode === "edit"),
    pointToLayer: (feature, latlng) => {
      const layer = featureToLayerCircleAware(feature, latlng);
      try { layer.setStyle({ weight:2, opacity:1, fillOpacity:0.06, fillColor: getSeccionColor(feature) }); } catch {}
      return layer;
    },
    onEachFeature: (feature, layer) => {
      layer.on("click", (ev) => handleEditorFeatureClick(feature, layer, ev));
    }
  }).addTo(map);

  rebuildSelectedLayersFromLayerGroup(seccionesLayer);
  applyMultiSelectionStyle();
  if (editor.selectedSet.size > 0){
    showGroupTransformHandles();
    if (editor.selectedSet.size === 1 && editor.editSubmode === "transform"){
      renderEditSelectedPanel();
    }
  }
}

function rerenderManzanas_Edit(){
  if (manzanasLayer){ manzanasLayer.remove(); manzanasLayer = null; }
  editorStopVertexEditing();
  clearGroupTransformUI();

  manzanasLayer = L.geoJSON(manzanasRaw || { type:"FeatureCollection", features:[] }, {
    style: { weight: 2, opacity: 1, fillOpacity: 0.06 },
    interactive: (editor.mode === "edit"),
    pointToLayer: (feature, latlng) => {
      const layer = featureToLayerCircleAware(feature, latlng);
      try { layer.setStyle({ weight:2, opacity:1, fillOpacity:0.06 }); } catch {}
      return layer;
    },
    onEachFeature: (feature, layer) => {
      layer.on("click", (ev) => handleEditorFeatureClick(feature, layer, ev));
    }
  }).addTo(map);

  rebuildSelectedLayersFromLayerGroup(manzanasLayer);
  applyMultiSelectionStyle();
  if (editor.selectedSet.size > 0){
    showGroupTransformHandles();
    if (editor.selectedSet.size === 1 && editor.editSubmode === "transform"){
      renderEditSelectedPanel();
    }
  }
}

function rerenderLotes_Edit(){
  if (lotesLayer){ lotesLayer.remove(); lotesLayer = null; }
  editorStopVertexEditing();
  clearGroupTransformUI();
  if (!currentLotesRaw) return;

  // FILTRO VISUAL: por manzana (y opcionalmente por seccion)
  const filterSec = (editor.lotesFilterSeccion || getSelectedSeccion() || '').toString().trim();
  const filterMan = (editor.lotesFilterManzana || getSelectedManzana() || '').toString().trim();

  let feats = (currentLotesRaw.features || []).slice();
  if (filterSec){
    feats = feats.filter(f => (f?.properties?.seccion || '').toString().trim() === filterSec);
  }
  if (filterMan){
    feats = feats.filter(f => {
      const pm = (f?.properties?.manzana || f?.properties?.manzanaId || '').toString().trim();
      return pm.toUpperCase() === filterMan.toUpperCase();
    });
  }

  const fc = { type: 'FeatureCollection', features: feats };

  lotesLayer = L.geoJSON(fc, {
    style: (feature) => ({ ...styleByStatus(feature?.properties?.estatus), fillOpacity: 0.10 }),
    interactive: (editor.mode === 'edit' || (isEditLotes && editor.mode === 'circular' && editor.circularPickingTemplate)),
    pointToLayer: (feature, latlng) => {
      const layer = featureToLayerCircleAware(feature, latlng);
      try { layer.setStyle({ ...styleByStatus(feature?.properties?.estatus), fillOpacity: 0.10 }); } catch {}
      return layer;
    },
    onEachFeature: (feature, layer) => {
      layer.on('click', (ev) => handleEditorFeatureClick(feature, layer, ev));
    }
  }).addTo(map);

  rebuildSelectedLayersFromLayerGroup(lotesLayer);
  applyMultiSelectionStyle();
  if (editor.selectedSet.size > 0){
    showGroupTransformHandles();
    if (editor.selectedSet.size === 1 && editor.editSubmode === 'transform' && editor.mode === 'edit'){
      renderEditSelectedPanel();
    }
  }
}





function renderEditNichosPanel(){
  editor.mode = 'edit';
  editor.drawShape = 'polygon';
  editor.gridArmed = false;
  editor.gridConfig = null;
  editor.pasteArmed = false;

  editorClearPoly(); editorClearCircle(); editorStopEditing();
  clearMultiSelection();

  setPanel('Edición: NICHOS (COLUMBARIOS)', `
    <p>Editor de <b>Columbarios</b> (zonas) en <code>${safe(NICHOS_ZONAS_URL)}</code>.</p>
    <p style="margin:2px 0;font-size:12px;color:#6b7280;">
      Click normal: selecciona y permite <b>mover/escalar</b>. Usa “Editar puntos” para vértices.<br/>
      Multi-select: <b>Ctrl/Cmd</b> o <b>Shift</b> + click.
    </p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button id="btnEdit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Editar existente</button>
      <button id="btnCreate" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Crear columbario</button>
      <button id="btnCopy" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      <button id="btnExit" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Salir</button>
    </div>

    <hr/>
    <div id="editBody"></div>

    <p style="font-size:12px;color:#666;margin-top:10px;">Destino: <b>${safe(NICHOS_ZONAS_URL)}</b></p>
  `);

  const $editBody = document.getElementById('editBody');

  document.getElementById('btnEdit').onclick = () => {
    editor.mode = 'edit';
    editorClearPoly(); editorClearCircle();
    editorStopEditing();
    clearMultiSelection();
    $editBody.innerHTML = '<p><b>Editar:</b> clic en un columbario para seleccionar.</p>';
    rerenderNichos_Edit();
  };

  document.getElementById('btnCreate').onclick = () => {
    editor.mode = 'create';
    editorStopEditing();
    clearMultiSelection();
    clearGroupTransformUI();
    editorClearPoly(); editorClearCircle();

    $editBody.innerHTML = `
      <p><b>Crear columbario:</b> polígono o círculo</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <button id="btnPoly" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Polígono</button>
        <button id="btnCircle" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Círculo</button>
        <button id="btnClear" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar</button>
      </div>

      <p><b>Puntos (polígono):</b> <span id="ptCount">0</span></p>

      <label><b>ID</b> (ej. PLN)</label><br/>
      <input id="newZonaId" placeholder="PLN" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Nombre</b></label><br/>
      <input id="newZonaNombre" placeholder="BUEN PASTOR NICHOS" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Imagen CONVEXO</b></label><br/>
      <input id="newImgConvexo" placeholder="./assets/nichos/PLN-convexo.png" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <label><b>Imagen CONCAVO</b></label><br/>
      <input id="newImgConcavo" placeholder="./assets/nichos/PLN-concavo.png" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button id="btnSaveNew" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar</button>
      </div>
    `;

    document.getElementById('btnPoly').onclick = () => { editor.drawShape = 'polygon'; };
    document.getElementById('btnCircle').onclick = () => { editor.drawShape = 'circle'; };
    document.getElementById('btnClear').onclick = () => { editorClearPoly(); editorClearCircle(); };

    document.getElementById('btnSaveNew').onclick = () => {
      if (!nichosZonasRaw) nichosZonasRaw = { type:'FeatureCollection', features:[] };

      const id = (document.getElementById('newZonaId').value || '').trim();
      const nombre = (document.getElementById('newZonaNombre').value || '').trim();
      const imgConv = (document.getElementById('newImgConvexo').value || '').trim();
      const imgConc = (document.getElementById('newImgConcavo').value || '').trim();

      if (!id) return notify('Falta ID.', 2000);

      const props = { tipo:'zona', id, nombre: nombre || id, imagenConvexo: imgConv, imagenConcavo: imgConc };
      let feature = null;

      if (editor.drawShape === 'polygon'){
        if (editor.polyPoints.length < 3) return notify('Polígono: mínimo 3 puntos.', 2200);
        feature = { type:'Feature', geometry:{ type:'Polygon', coordinates:ringToGeoJsonCoords(editor.polyPoints) }, properties: props };
      } else {
        if (!editor.circleCenter || typeof editor.circleRadius !== 'number') return notify('Círculo: clic centro y luego borde.', 2200);
        feature = { type:'Feature', geometry:{ type:'Point', coordinates: latLngToXY(editor.circleCenter) }, properties:{ ...props, shape:'circle', radius: editor.circleRadius } };
      }

      nichosZonasRaw.features.push(feature);
      editorClearPoly(); editorClearCircle();
      rerenderNichos_Edit();
      notify('✅ Columbário creado (en memoria). Copia GeoJSON para guardar.', 2400);
    };

    rerenderNichos_Edit();
  };

  document.getElementById('btnCopy').onclick = async () => {
    const txt = JSON.stringify(nichosZonasRaw || { type:'FeatureCollection', features:[] }, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      notify('GeoJSON copiado. Pégalo en data/nichos-zonas.geojson.', 2400);
    } catch {
      setPanel('Copia manual', `<pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };

  document.getElementById('btnExit').onclick = () => location.href = './';
  document.getElementById('btnEdit').click();
}

function rerenderNichos_Edit(){
  if (manzanasLayer){ manzanasLayer.remove(); manzanasLayer = null; }
  editorStopVertexEditing();
  clearGroupTransformUI();

  const all = (nichosZonasRaw?.features || []);
  const zonas = all.filter(f => ((f?.properties?.tipo || 'zona').toString().trim().toLowerCase() === 'zona'));

  const fc = { type:'FeatureCollection', features: zonas };

  manzanasLayer = L.geoJSON(fc, {
    style: { weight:2, opacity:1, fillOpacity:0.06 },
    interactive: (editor.mode === 'edit'),
    pointToLayer: (feature, latlng) => {
      const layer = featureToLayerCircleAware(feature, latlng);
      try { layer.setStyle({ weight:2, opacity:1, fillOpacity:0.06 }); } catch {}
      return layer;
    },
    onEachFeature: (feature, layer) => {
      layer.on('click', (ev) => handleEditorFeatureClick(feature, layer, ev));
    }
  }).addTo(map);

  rebuildSelectedLayersFromLayerGroup(manzanasLayer);
  applyMultiSelectionStyle();
  if (editor.selectedSet.size > 0){
    showGroupTransformHandles();
    if (editor.selectedSet.size === 1 && editor.editSubmode === 'transform'){
      renderEditSelectedPanel();
    }
  }
}

/* =========================================================
   MAP CLICK HANDLER (CREATE + PASTE + GRID)
   ========================================================= */
let mapClickAttached = false;
function attachEditorMapClick(){
  if (mapClickAttached) return;
  mapClickAttached = true;

  map.on("click", (e) => {
    if (!(isEditSecciones || isEditManzanas || isEditLotes || isEditNichos)) return;

    // PEGAR
    if (editor.pasteArmed && editor.clipboardFeature){
      const arr = getActiveEditDatasetArr();
      if (!arr) return notify("No hay dataset activo para pegar.", 2200);

      const temp = deepCopy(editor.clipboardFeature);

      const b = boundsFromFeature(temp);
      const c = boundsCenter(b || {minX:0,minY:0,maxX:0,maxY:0});
      const dx = e.latlng.lng - c.x;
      const dy = e.latlng.lat - c.y;

      translateFeatureInPlace(temp, dx, dy);
      ensureUniqueId(temp, arr);

      if (isEditLotes) {
        // Si estás filtrando por manzana, la copia pegada hereda esa manzana si no trae una
        ensureLoteContextProps(temp, getSelectedSeccion(), (temp?.properties?.manzana || temp?.properties?.manzanaId || editor.lotesFilterManzana || getSelectedManzana()));
      }
      arr.push(temp);

      editor.pasteArmed = false;
      rerenderActiveEditor();
      notify("✅ Pegado. Selecciona la figura para cambiar ID si quieres.", 2200);
      return;
    }

    // GRID LOTES
    if (isEditLotes && editor.mode === "grid" && editor.gridArmed && editor.gridConfig?.target === "lotes"){
      const cfg = editor.gridConfig;
      const arr = getActiveEditDatasetArr();
      if (!arr) return notify("No hay dataset de lotes cargado.", 2200);

      const x0 = e.latlng.lng;
      const y0 = e.latlng.lat;

      const created = [];
      for (let r=0; r<cfg.rows; r++){
        for (let c=0; c<cfg.cols; c++){
          const localX = c * (cfg.w + cfg.gapX);
          const localY = r * (cfg.h + cfg.gapY);

          const orderIndex = ((cfg.cols - 1 - c) * cfg.rows) + (cfg.rows - 1 - r);
          const loteId = nextPaddedNumber(cfg.start, orderIndex, cfg.inc);

          const corners = makeRotatedRect(x0, y0, localX, localY, cfg.w, cfg.h, cfg.rot);

          const feature = {
            type:"Feature",
            geometry:{ type:"Polygon", coordinates:[corners] },
            properties:{ id:loteId, lote:loteId, estatus:cfg.estatus, paquete:cfg.paquete }
          };

          // contexto seccion/manzana
          ensureLoteContextProps(feature, cfg.seccion || getSelectedSeccion(), cfg.manzana || editor.lotesFilterManzana || getSelectedManzana());

          arr.push(feature);
          created.push(feature);
        }
      }

      editor.gridArmed = false;
      rerenderLotes_Edit();

      activateGridGroup(arr, created);
      notify(`✅ Cuadrícula LOTES creada (${cfg.rows}x${cfg.cols}). Arrastra el punto rojo para mover TODO.`, 2600);
      return;
    }

    // GRID MANZANAS
    if (isEditManzanas && editor.mode === "grid" && editor.gridArmed && editor.gridConfig?.target === "manzanas"){
      const cfg = editor.gridConfig;
      const arr = getActiveEditDatasetArr();
      if (!arr) return notify("No hay dataset de manzanas cargado.", 2200);

      const x0 = e.latlng.lng;
      const y0 = e.latlng.lat;

      const created = [];
      let idx = 0;
      for (let r=0; r<cfg.rows; r++){
        for (let c=0; c<cfg.cols; c++){
          const localX = c * (cfg.w + cfg.gapX);
          const localY = r * (cfg.h + cfg.gapY);

          const manzanaId = nextManzanaLetter(cfg.start, idx);
          const corners = makeRotatedRect(x0, y0, localX, localY, cfg.w, cfg.h, cfg.rot);

          const lotesFile = `./data/lotes/lotes-${cfg.seccion}-${manzanaId}.geojson`;

          const feature = {
            type:"Feature",
            geometry:{ type:"Polygon", coordinates:[corners] },
            properties:{
              id: `${cfg.seccion}-${manzanaId}`,
              seccion: cfg.seccion,
              manzana: manzanaId,
              nombre: `${cfg.seccion} - ${manzanaId}`,
              lotesFile
            }
          };

          arr.push(feature);
          created.push(feature);
          idx++;
        }
      }

      editor.gridArmed = false;
      rerenderManzanas_Edit();

      activateGridGroup(arr, created);
      notify(`✅ Cuadrícula MANZANAS creada (${cfg.rows}x${cfg.cols}). Arrastra el punto rojo para mover TODO.`, 2600);
      return;
    }

    // CIRCULAR LOTES (repetir plantilla alrededor de un centro)
    if (isEditLotes && editor.mode === "circular" && editor.circularArmed && editor.circularConfig?.target === "lotes_circular"){
      const cfg = editor.circularConfig;
      const arr = getActiveEditDatasetArr();
      if (!arr) return notify("No hay dataset de lotes cargado.", 2200);

      const centerX = e.latlng.lng;
      const centerY = e.latlng.lat;

      const tpl = deepCopy(cfg.template);

      // centro de la plantilla (para calcular radio / ángulo base)
      const tplCenter = getFeatureCenterXY(tpl);
      if (!tplCenter) return notify("No pude calcular centro de la plantilla.", 2200);

      const dx = tplCenter.cx - centerX;
      const dy = tplCenter.cy - centerY;

      // ángulo base (si no se especifica)
      let baseAngleDeg = cfg.startDeg;
      if (baseAngleDeg === null){
        baseAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI; // centro->plantilla
      }

      // si count=1 => solo 1 copia
      const count = cfg.count;
      const totalDeg = cfg.degrees;
      const step = (count <= 1) ? 0 : (totalDeg / (count - 1));

      const created = [];
      for (let i=0; i<count; i++){
        const ang = baseAngleDeg + step * i;

        // copia desde plantilla
        const f = deepCopy(tpl);

        // 1) mover plantilla para que su centro esté en el radio correcto desde el nuevo centro
        //    (o sea: colocarla en la posición "base" relativa al centro click)
        //    ya está en coords absolutas; la rotaremos alrededor del centro click
        rotateFeatureInPlace(f, centerX, centerY, (ang - baseAngleDeg));

        // ids únicos
        ensureUniqueId(f, arr);

        // Asegurar contexto seccion/manzana (para copiar entre manzanas sin perder propiedad)
        ensureLoteContextProps(f, (cfg.seccion || getSelectedSeccion()), (f?.properties?.manzana || f?.properties?.manzanaId || cfg.manzana || editor.lotesFilterManzana || getSelectedManzana()));

        // incluir o no el original
        if (!cfg.includeOriginal && i === 0){
          continue;
        }

        arr.push(f);
        created.push(f);
      }

      editor.circularArmed = false;
      // editor.mode se mantiene en edit al rerender
      editor.mode = "edit";
      editor.circularConfig = null;

      rerenderLotes_Edit();
      activateGridGroup(arr, created); // reutilizamos overlay/marker para mover el grupo recién creado
      notify(`✅ Repetición circular creada (${created.length} copia(s)).`, 2400);
      return;
    }


    // CREATE normal
    if (editor.mode !== "create") return;

    if (editor.drawShape === "polygon"){
      editor.polyPoints.push(e.latlng);
      const mk = L.marker(e.latlng, { icon: editor.iconVertex }).addTo(map);
      editor.polyMarkers.push(mk);
      editorRefreshPolyPreview();
      const el = document.getElementById("ptCount");
      if (el) el.textContent = String(editor.polyPoints.length);
      return;
    }

    // circle create: click center, then click edge
    if (!editor.circleCenter){
      editor.circleCenter = e.latlng;
      editor.circleCenterMarker = L.marker(e.latlng, { icon: editor.iconVertex }).addTo(map);
      return;
    }

    const r = distPixels(editor.circleCenter, e.latlng);
    editor.circleRadius = r;

    if (editor.circlePreview) map.removeLayer(editor.circlePreview);
    editor.circlePreview = L.circle(editor.circleCenter, { radius: r, weight:2, fillOpacity:0.12 }).addTo(map);

    if (editor.circleRadiusMarker) map.removeLayer(editor.circleRadiusMarker);
    editor.circleRadiusMarker = L.marker(e.latlng, { icon: editor.iconHandle }).addTo(map);
  });
}

/* =========================================================
   INIT
   ========================================================= */

async function main(){
  // MODO: EDITOR NICHOS-OVERLAY (standalone, sin Leaflet)
  // Este editor NO debe mostrar el mapa base.
  if (isEditNichosOverlay){
    try {
      await initNichosOverlayEditorStandalone();
    } catch (err) {
      console.error(err);
      setPanel("Error en nichos-overlay", `<pre style="white-space:pre-wrap;color:#b91c1c;">${safe(err?.stack || err)}</pre>`);
    }
    return;
  }


  map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -3,
    maxZoom: (isEditSecciones || isEditManzanas || isEditLotes || isEditNichos || isEditNichosOverlay) ? 6 : 4,
    // En el editor ?edit=nichos-overlay no queremos que el mapa se panée/zoomee;
    // ahí se interactúa con el editor de rectángulos sobre la imagen.
    dragging: !isEditNichosOverlay,
    scrollWheelZoom: !isEditNichosOverlay,
    doubleClickZoom: !isEditNichosOverlay,
    boxZoom: !isEditNichosOverlay,
    keyboard: !isEditNichosOverlay,
    touchZoom: !isEditNichosOverlay,
    zoomAnimation: !IS_MOBILE,
    fadeAnimation: false,
    markerZoomAnimation: !IS_MOBILE,
    preferCanvas: true
  });

  try { lotesInfo = await loadJson(LOTES_INFO_URL); } catch { lotesInfo = {}; }
  try { paquetesInfo = await loadJson(PAQUETES_URL); } catch { paquetesInfo = {}; }

  try {
    inventarioBase = buildInventarioIndex(await loadJson(INVENTARIO_BASE_URL));
  } catch {
    inventarioBase = {};
  }

  try {
    inventarioOverrides = buildInventarioIndex(await loadJson(INVENTARIO_OVERRIDES_URL));
  } catch {
    inventarioOverrides = {};
  }

  try {
    const catalogoRaw = await loadJson(CATALOGO_PROPIEDADES_URL);
    buildCatalogoPropiedades(catalogoRaw);
  } catch {
    catalogoPropiedades = [];
    catalogoById = {};
    catalogoSearch = [];
  }

  console.log("Catálogo de propiedades cargado:", catalogoPropiedades.length);

  const img = new Image();
  img.onload = async () => {
    try {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const bounds = [[0,0],[h,w]];

      // scale solo en PUBLICO (por si DATA_COORD_* no coincide)
      COORD_SCALE_X = w / DATA_COORD_WIDTH;
      COORD_SCALE_Y = h / DATA_COORD_HEIGHT;

      L.imageOverlay(BASE_IMAGE_URL, bounds).addTo(map);
      map.fitBounds(bounds);

      attachEditorMapClick();

      // cargar datasets base
      manzanasRaw = await loadJson(MANZANAS_URL);
      try { seccionesTopRaw = await loadJson(SECCIONES_TOP_URL); }
      catch { seccionesTopRaw = { type:"FeatureCollection", features: [] }; }

      // Nichos (columbarios)
      try { nichosZonasRaw = await loadJson(NICHOS_ZONAS_URL); }
      catch { nichosZonasRaw = { type:'FeatureCollection', features: [] }; }

      // Nichos overlay (rectángulos por cara)
      try { nichosOverlayRaw = await loadJson(NICHOS_OVERLAY_URL); }
      catch { nichosOverlayRaw = { type:'FeatureCollection', features: [] }; }


      // ====== EDIT SECCIONES ======
      if (isEditSecciones){
        if ($toggleLotsBtn) $toggleLotsBtn.disabled = true;
        if ($searchBtn) $searchBtn.disabled = true;

        $seccionSelect.innerHTML = `<option value="">(Edición SECCIONES)</option>`;
        $manzanaSelect.innerHTML = `<option value="">(Edición SECCIONES)</option>`;

        rerenderSecciones_Edit();
        renderEditSeccionesPanel();
        return;
      }

      // ====== EDIT MANZANAS ======
      if (isEditManzanas){
        if ($toggleLotsBtn) $toggleLotsBtn.disabled = true;
        if ($searchBtn) $searchBtn.disabled = true;

        $seccionSelect.innerHTML = `<option value="">(Edición MANZANAS)</option>`;
        $manzanaSelect.innerHTML = `<option value="">(Edición MANZANAS)</option>`;

        rerenderManzanas_Edit();
        renderEditManzanasPanel();
        return;
      }

      // ====== EDIT LOTES ======
      if (isEditLotes){
        if ($toggleLotsBtn) $toggleLotsBtn.disabled = true;
        if ($searchBtn) $searchBtn.disabled = true;

        const secciones = buildSeccionesList(manzanasRaw.features);
        fillSeccionSelect(secciones);
        $manzanaSelect.innerHTML = `<option value="">(Todas las manzanas)</option>`;

        // helpers: carga/actualiza dataset de lotes por SECCIÓN (archivo compartido)
        const loadLotesForSeccion = async (sec) => {
          const s = (sec || '').trim();
          currentLotesSeccion = s || null;
          editor.lotesFilterSeccion = s || null;
          editor.lotesFilterManzana = null;
          currentManzanaFeature = null;

          if (!s){
            currentLotesRaw = { type: 'FeatureCollection', features: [] };
            currentLotesSourceUrl = null;
            rerenderLotes_Edit();
            renderEditLotesPanel();
            return;
          }

          const url = getSharedLotesUrlForSeccion(s);
          currentLotesSourceUrl = url;
          try { currentLotesRaw = await loadJson(url); }
          catch { currentLotesRaw = { type: 'FeatureCollection', features: [] }; }

          // Asegura que al menos tengan seccion (para copiado / filtros)
          try { normalizeLotesContext(currentLotesRaw); } catch {}

          // refrescar lista de manzanas de esa sección
          const list = buildManzanasListBySeccion(manzanasRaw.features, s);
          $manzanaSelect.innerHTML = `<option value="">(Todas las manzanas)</option>`;
          for (const f of list){
            const m = getPropManzana(f);

            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            $manzanaSelect.appendChild(opt);
          
          }

          rerenderLotes_Edit();
          renderEditLotesPanel();

          // zoom a la sección (si existe en secciones-top)
          try {
            const secFeat = (seccionesTopRaw?.features || []).find(sf => getPropSeccion(sf) === s);
            if (secFeat){
              const tmp = L.geoJSON(secFeat);
              flyToBoundsSmooth(tmp.getBounds().pad(0.12), 0.65);
            }
          } catch {}
        };

        $seccionSelect.onchange = async () => {
          const sec = ($seccionSelect.value || '').trim();
          await loadLotesForSeccion(sec);
        };

        // MANZANA en editor LOTES es solo filtro visual (no recarga archivo ni borra cambios)
        $manzanaSelect.onchange = () => {
          const sec = getSelectedSeccion();
          const man = getSelectedManzana();

          editor.lotesFilterSeccion = sec || null;
          editor.lotesFilterManzana = man || null;

          if (sec && man){
            currentManzanaFeature = manzanasRaw.features.find(x => getPropSeccion(x) === sec && getPropManzana(x) === man) || null;
            try {
              if (currentManzanaFeature){
                const tmp = L.geoJSON(currentManzanaFeature);
                flyToBoundsSmooth(tmp.getBounds().pad(0.15), 0.55);
              }
            } catch {}
          } else {
            currentManzanaFeature = null;
          }

          rerenderLotes_Edit();
          renderEditLotesPanel();
        };

        // panel inicial
        renderEditLotesPanel();
        return;
      }


      // ====== EDIT NICHOS (COLUMBARIOS) ======
      if (isEditNichos){
        if ($toggleLotsBtn) $toggleLotsBtn.disabled = true;
        if ($searchBtn) $searchBtn.disabled = true;

        $seccionSelect.innerHTML = `<option value="">(Edición NICHOS)</option>`;
        $manzanaSelect.innerHTML = `<option value="">(Edición NICHOS)</option>`;

        rerenderNichos_Edit();
        renderEditNichosPanel();
        return;
      }

      // ====== EDIT NICHOS OVERLAY ======
      // (ya se maneja ANTES de inicializar Leaflet, en main())
// ====== NORMAL (público) ======
      seccionesTopScaled = deepCopy(seccionesTopRaw);
      applyCoordScaleToGeoJSON(seccionesTopScaled, COORD_SCALE_X, COORD_SCALE_Y);

      manzanasScaled = deepCopy(manzanasRaw);
      applyCoordScaleToGeoJSON(manzanasScaled, COORD_SCALE_X, COORD_SCALE_Y);

      nichosZonasScaled = deepCopy(nichosZonasRaw);
      applyCoordScaleToGeoJSON(nichosZonasScaled, COORD_SCALE_X, COORD_SCALE_Y);


      const secciones = buildSeccionesList(
        seccionesTopScaled.features.length
          ? seccionesTopScaled.features
          : (manzanasScaled?.features || [])
      );
      fillSeccionSelect(secciones);
      $manzanaSelect.innerHTML = `<option value="">MANZANA...</option>`;

      showPublicLevelSecciones();
      forceInitialPublicMapResize();
      renderNichosZonasLayerPublic();
      bringNichosZonasToFront();
      setupDropdowns();
      setupSearch();
      setupButtons();
      updateToggleLotsButton();

      if (!IS_EDIT) notify("Listo.", 900);

    } catch (err) {
      console.error(err);
      setPanel("Error en app.js", `<pre style="white-space:pre-wrap;color:#b91c1c;">${safe(err?.stack || err)}</pre>`);
    }
  };

  img.onerror = () => {
    setPanel("Error", `<p>No pude cargar el mapa base: <code>${safe(BASE_IMAGE_URL)}</code></p>`);
  };

  img.src = BASE_IMAGE_URL;
}



/* =========================================================
   EDITOR: NICHOS OVERLAY (rectángulos sobre imagen)
   - Ejecutar: ?edit=nichos-overlay
   - Guarda FeatureCollection en data/nichos-overlay.geojson
   ========================================================= */
async function initNichosOverlayEditorStandalone(){
  // Cargar datos mínimos para el editor
  try { nichosZonasRaw = await loadJson(NICHOS_ZONAS_URL); } catch { nichosZonasRaw = { type:'FeatureCollection', features:[] }; }
  // OJO: el usuario pidió guardar en data/nichos-overlay.geojson
  // Si no existe, iniciamos vacío.
  const OVERLAY_GEO_URL = "./data/nichos-overlay.geojson";
  let overlayGeo = null;
  try { overlayGeo = await loadJson(OVERLAY_GEO_URL); }
  catch {
    // compat: si todavía existe el JSON viejo, úsalo como fallback
    try { overlayGeo = await loadJson(NICHOS_OVERLAY_URL); } catch { overlayGeo = null; }
  }

  // Normalizamos a FeatureCollection de rectángulos
  // Cada feature: Polygon en coordenadas de imagen (px), properties: { tipo:'nicho', zonaId, cara, codigo }
  if (!overlayGeo || overlayGeo.type !== 'FeatureCollection'){
    overlayGeo = { type:'FeatureCollection', features:[] };
  }

  // Guardamos en global para el editor
  window.__nichosOverlayGeo = overlayGeo;

  // Reusa UI existente
  initNichosOverlayEditor();
}


function initNichosOverlayEditor(){
  let nichosOverlayRaw = window.__nichosOverlayGeo;
  if (!nichosOverlayRaw || nichosOverlayRaw.type !== 'FeatureCollection'){
    nichosOverlayRaw = { type:'FeatureCollection', features:[] };
    window.__nichosOverlayGeo = nichosOverlayRaw;
  }

  try { document.body.classList.add('overlayOnly'); } catch {}

  const mapEl = document.getElementById('map');
  if (mapEl) mapEl.style.display = 'none';
  const layout = document.querySelector('.layout');
  if (layout) layout.style.gridTemplateColumns = '1fr';

  let root = document.getElementById('nichosOverlayEditor');
  if (root) root.remove();

  const paqueteKeys = Object.keys(paquetesInfo || {}).sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity:'base' })
  );
  const paqueteDatalistHtml = paqueteKeys.map(k => {
    const nombre = paquetesInfo?.[k]?.nombre ? `${k} — ${paquetesInfo[k].nombre}` : k;
    return `<option value="${safe(k)}">${safe(nombre)}</option>`;
  }).join('');

  setPanel('Edición: NICHOS overlay', `
    <div id="nichosOverlayEditor" style="height: calc(100vh - 52px); display:flex; flex-direction:column;">
      <div class="noe-toolbar">
        <div class="noe-row">
          <label>Columbario</label>
          <select id="noeZona"></select>

          <label>Cara</label>
          <select id="noeCara">
            <option value="">SELECCIONA CARA...</option>
            <option value="convexo">CONVEXO</option>
            <option value="concavo">CONCAVO</option>
          </select>

          <label>Código</label>
          <input id="noeCodigo" placeholder="PLN-1-AX" />
        </div>

        <div class="noe-row noe-actions">
          <button id="noeToolDraw" class="noe-toolbtn is-active">Dibujar</button>
          <button id="noeToolPan" class="noe-toolbtn">Mover vista</button>
          <button id="noeEdit" disabled>Editar</button>
          <button id="noeDuplicate" disabled>Duplicar</button>
          <button id="noeDelete" disabled>Borrar</button>
          <button id="noeGrid">Cuadrícula</button>
          <button id="noeFit">Ajustar imagen</button>
          <button id="noeZoom100">100%</button>
          <span id="noeZoomLabel" class="noe-zoom-label">100%</span>
          <button id="noeCopy">Copiar GeoJSON</button>
          <button id="noeExit">Salir</button>
        </div>

        <div id="noeMsg" class="noe-msg"></div>
      </div>

      <div class="noe-stage" style="flex:1; min-height:0;">
        <div class="noe-canvas is-draw" id="noeCanvas">
          <div class="noe-viewport" id="noeViewport">
            <img id="noeImg" alt="nichos" draggable="false" />
            <svg id="noeSvg"></svg>
          </div>
        </div>

        <div class="noe-side">
          <div class="noe-side-box">
            <h3 style="margin:0 0 8px 0;">Selección</h3>
            <div id="noeSelection" class="noe-selection">(ninguno)</div>
            <div id="noeSelectionHint" class="noe-side-hint">Haz click en un rectángulo para editarlo.</div>
          </div>

          <div class="noe-side-box">
            <h3 style="margin:0 0 8px 0;">Propiedades del nicho</h3>
            <div class="noe-grid-fields noe-props-fields">
              <div>
                <label>Estatus</label>
                <select id="noeStatus">
                  <option value="disponible">disponible</option>
                  <option value="ocupado">ocupado</option>
                  <option value="por construir">por construir</option>
                  <option value="desconocido">desconocido</option>
                </select>
              </div>
              <div>
                <label>Paquete</label>
                <input id="noePaquete" list="noePaqueteList" placeholder="Sin paquete" />
                <datalist id="noePaqueteList">${paqueteDatalistHtml}</datalist>
              </div>
            </div>
            <div id="noeMetaHint" class="noe-side-hint">Sin selección, estos valores se usarán como default para nuevos nichos y cuadrículas. Si hay un nicho seleccionado, los cambios se guardan en ese nicho.</div>
          </div>

          <div class="noe-side-box">
            <h3 style="margin:0 0 8px 0;">Instrucciones</h3>
            <div style="font-size:12px;color:#6b7280;line-height:1.55;">
              1) Elige <b>Columbario</b> y <b>Cara</b>.<br/>
              2) Usa <b>Dibujar</b> para crear nichos o <b>Cuadrícula</b> para colocarlos en bloque.<br/>
              3) Usa <b>Mover vista</b> o mantén <b>barra espaciadora</b> mientras arrastras para recorrer la imagen.<br/>
              4) Rueda del mouse = <b>zoom</b>. <b>Ajustar imagen</b> regresa al encuadre inicial.<br/>
              5) Para modificar uno existente, selecciónalo y usa <b>Editar</b>, <b>Duplicar</b> o <b>Borrar</b>.<br/>
              6) Al terminar usa <b>Copiar GeoJSON</b> para pegar en <code>data/nichos-overlay.geojson</code>.
            </div>
          </div>

          <div class="noe-side-box">
            <h3 style="margin:0 0 8px 0;">Cuadrícula de nichos</h3>
            <div class="noe-grid-fields">
              <div>
                <label>Filas</label>
                <input id="noeGridRows" type="number" min="1" value="6" />
              </div>
              <div>
                <label>Columnas</label>
                <input id="noeGridCols" type="number" min="1" value="12" />
              </div>
              <div>
                <label>Ancho (px)</label>
                <input id="noeGridW" type="number" min="1" value="32" />
              </div>
              <div>
                <label>Alto (px)</label>
                <input id="noeGridH" type="number" min="1" value="32" />
              </div>
              <div>
                <label>Espacio X (px)</label>
                <input id="noeGridGapX" type="number" min="0" value="2" />
              </div>
              <div>
                <label>Espacio Y (px)</label>
                <input id="noeGridGapY" type="number" min="0" value="2" />
              </div>
              <div>
                <label>Rotación (grados)</label>
                <input id="noeGridRot" type="number" step="0.1" value="0" />
              </div>
              <div>
                <label>Columna inicial</label>
                <input id="noeGridStartCol" type="number" step="1" value="1" />
              </div>
              <div>
                <label>Incremento columna</label>
                <input id="noeGridInc" type="number" min="1" value="1" />
              </div>
              <div>
                <label>Etiquetas filas</label>
                <input id="noeGridRowLabels" value="A,B,C,D,E,F" />
              </div>
            </div>
            <div style="margin-top:10px;">
              <label style="display:block;font-size:12px;font-weight:700;color:#374151;">Plantilla de código</label>
              <input id="noeGridTemplate" value="{rowLabel}X{col}" style="width:100%;padding:8px;margin-top:6px;border:1px solid #d1d5db;border-radius:10px;" />
              <div class="noe-side-hint" style="margin-top:6px;">Tokens: <code>{rowLabel}</code>, <code>{row}</code>, <code>{col}</code>, <code>{n}</code>.</div>
            </div>
            <div class="noe-grid-actions">
              <button id="noeGridArm">Armar cuadrícula</button>
              <button id="noeGridCancel">Cancelar</button>
            </div>
            <div id="noeGridHint" class="noe-side-hint">Configura la cuadrícula y luego haz click en la imagen para colocar la esquina superior izquierda.</div>
          </div>
        </div>
      </div>
    </div>
  `);

  root = document.getElementById('nichosOverlayEditor');
  if (!root) return;

  const $zona = root.querySelector('#noeZona');
  const $cara = root.querySelector('#noeCara');
  const $codigo = root.querySelector('#noeCodigo');
  const $msg = root.querySelector('#noeMsg');
  const $img = root.querySelector('#noeImg');
  const $svg = root.querySelector('#noeSvg');
  const $canvas = root.querySelector('#noeCanvas');
  const $viewport = root.querySelector('#noeViewport');
  const $selection = root.querySelector('#noeSelection');
  const $selectionHint = root.querySelector('#noeSelectionHint');
  const $status = root.querySelector('#noeStatus');
  const $paquete = root.querySelector('#noePaquete');
  const $metaHint = root.querySelector('#noeMetaHint');
  const $btnToolDraw = root.querySelector('#noeToolDraw');
  const $btnToolPan = root.querySelector('#noeToolPan');
  const $btnEdit = root.querySelector('#noeEdit');
  const $btnDuplicate = root.querySelector('#noeDuplicate');
  const $btnDelete = root.querySelector('#noeDelete');
  const $btnFit = root.querySelector('#noeFit');
  const $btnZoom100 = root.querySelector('#noeZoom100');
  const $zoomLabel = root.querySelector('#noeZoomLabel');
  const $gridHint = root.querySelector('#noeGridHint');

  const view = {
    scale: 1,
    panX: 0,
    panY: 0,
    tool: 'draw',
    panning: false,
    panStart: null,
    imageWidth: 0,
    imageHeight: 0,
  };

  let selectedFeat = null;
  let dragState = null;
  let drawing = false;
  let start = null;
  let spacePan = false;
  let gridArmed = false;
  const metaDefaults = {
    estatus:'disponible',
    paquete:'',
  };

  function currentZonaId(){ return ($zona.value || '').toString().trim(); }
  function currentCara(){ return ($cara.value || '').toString().trim().toLowerCase(); }
  function hasLoadedImage(){ return !!($img && $img.complete && $img.naturalWidth && $img.naturalHeight); }
  function _min(a,b){ return a < b ? a : b; }
  function _max(a,b){ return a > b ? a : b; }
  function normCode(v){ return (v || '').toString().trim().toUpperCase(); }
  function setMsg(t){ $msg.textContent = t || ''; }
  function clampLocal(v, min, max){ return Math.max(min, Math.min(max, v)); }

  function alphaLabel(idx){
    let n = Number(idx) + 1;
    let out = '';
    while (n > 0){
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function currentImageWidth(){ return view.imageWidth || $img?.naturalWidth || 1; }
  function currentImageHeight(){ return view.imageHeight || $img?.naturalHeight || 1; }

  function featureCoordMode(f){
    const explicit = (f?.properties?.coordMode || f?.properties?.coords || '').toString().trim().toLowerCase();
    if (explicit === 'normalized' || explicit === 'normalizado' || explicit === 'ratio' || explicit === 'relativo' || explicit === 'norm') return 'normalized';
    if (explicit === 'pixel' || explicit === 'pixels' || explicit === 'px' || explicit === 'pixeles') return 'pixel';
    const ring = f?.geometry?.coordinates?.[0] || [];
    let maxAbs = 0;
    for (const [x, y] of ring){
      maxAbs = Math.max(maxAbs, Math.abs(Number(x || 0)), Math.abs(Number(y || 0)));
    }
    return maxAbs <= 2 ? 'normalized' : 'pixel';
  }

  function featureRingRaw(f){
    return ((f?.geometry?.coordinates?.[0] || []).map(([x, y]) => [Number(x), Number(y)]));
  }

  function imageRingFromFeature(f){
    const ring = featureRingRaw(f);
    const iw = currentImageWidth();
    const ih = currentImageHeight();
    if (featureCoordMode(f) === 'normalized'){
      return ring.map(([x, y]) => [x * iw, y * ih]);
    }
    return ring;
  }

  function storeImageRingOnFeature(f, imageRing, preferredMode = null){
    const mode = preferredMode || featureCoordMode(f) || 'normalized';
    const iw = currentImageWidth();
    const ih = currentImageHeight();
    const rawRing = (mode === 'normalized')
      ? imageRing.map(([x, y]) => [iw ? x / iw : 0, ih ? y / ih : 0])
      : imageRing.map(([x, y]) => [x, y]);
    if (!f.properties) f.properties = {};
    f.properties.coordMode = mode;
    f.geometry = { type:'Polygon', coordinates:[rawRing] };
  }

  function featBox(f){
    const ring = imageRingFromFeature(f);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of ring){
      const x = pt[0], y = pt[1];
      if (!isFinite(x) || !isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!isFinite(minX) || !isFinite(minY)) return null;
    return { l:minX, t:minY, r:maxX, b:maxY };
  }

  function featureRing(f){
    return imageRingFromFeature(f);
  }

  function setFeatBox(f, box){
    const l = box.l, t = box.t, r = box.r, b = box.b;
    const ring = [[l,t],[r,t],[r,b],[l,b],[l,t]];
    storeImageRingOnFeature(f, ring);
  }

  function translateFeature(f, dx, dy, sourceRing = null){
    const ring = sourceRing || featureRing(f);
    storeImageRingOnFeature(f, ring.map(([x, y]) => [x + dx, y + dy]));
  }

  function canResizeFeature(f){
    const ring = featureRing(f);
    if (ring.length < 4) return false;
    const box = featBox(f);
    if (!box) return false;
    const pts = ring.slice(0, -1);
    const tol = 0.01;
    return pts.every(([x, y]) => {
      const onX = Math.abs(x - box.l) < tol || Math.abs(x - box.r) < tol;
      const onY = Math.abs(y - box.t) < tol || Math.abs(y - box.b) < tol;
      return onX && onY;
    });
  }

  function listCurrentRects(zid, cara){
    return (nichosOverlayRaw?.features || []).filter(f => {
      const p = f?.properties || {};
      const tipo = (p.tipo || '').toString().trim().toLowerCase();
      const z = (p.zonaId || p.columbarioId || '').toString().trim();
      const c = (p.cara || '').toString().trim().toLowerCase();
      return tipo === 'nicho' && z === zid && c === cara;
    });
  }

  function featureBelongsToCurrentView(f){
    if (!f) return false;
    const p = f?.properties || {};
    const z = (p.zonaId || p.columbarioId || '').toString().trim();
    const c = (p.cara || '').toString().trim().toLowerCase();
    return z === currentZonaId() && c === currentCara();
  }

  function getSelectedOrDefaultEstatus(){
    const estatus = (selectedFeat?.properties?.estatus || '').toString().trim();
    return estatus || metaDefaults.estatus || 'disponible';
  }

  function getSelectedOrDefaultPaquete(){
    return (
      (selectedFeat?.properties?.paquete || selectedFeat?.properties?.paqueteId || selectedFeat?.properties?.package || '').toString().trim() ||
      metaDefaults.paquete ||
      ''
    );
  }

  function syncMetaInputsFromState(){
    if ($status){
      $status.value = getSelectedOrDefaultEstatus();
    }
    if ($paquete){
      $paquete.value = getSelectedOrDefaultPaquete();
    }
    if ($metaHint){
      $metaHint.textContent = selectedFeat
        ? 'Edita Estatus y Paquete para guardar esos cambios en el nicho seleccionado.'
        : 'Sin selección, estos valores se usarán como default para nuevos nichos y cuadrículas.';
    }
  }

  function applyMetaInputs(targetFeat = null){
    const feat = targetFeat || selectedFeat;
    const estatus = ($status?.value || '').toString().trim() || 'desconocido';
    const paquete = ($paquete?.value || '').toString().trim();

    if (!feat){
      metaDefaults.estatus = estatus || 'disponible';
      metaDefaults.paquete = paquete;
      return;
    }

    if (!feat.properties) feat.properties = {};
    feat.properties.estatus = estatus;
    if (paquete){
      feat.properties.paquete = paquete;
      delete feat.properties.paqueteId;
      delete feat.properties.package;
    } else {
      delete feat.properties.paquete;
      delete feat.properties.paqueteId;
      delete feat.properties.package;
    }
  }

  function refreshSelectionUI(){
    const codigo = (selectedFeat?.properties?.codigo || '').toString().trim();
    const active = !!selectedFeat;
    if ($selection){
      $selection.textContent = active ? `${codigo || '(sin código)'} · ${currentZonaId()} · ${currentCara().toUpperCase()}` : '(ninguno)';
    }
    if ($selectionHint){
      if (!active) $selectionHint.textContent = 'Haz click en un rectángulo para editarlo.';
      else if (canResizeFeature(selectedFeat)) $selectionHint.textContent = 'Arrastra dentro del rectángulo para moverlo. Usa las esquinas verdes para escalarlo.';
      else $selectionHint.textContent = 'Arrastra dentro del rectángulo para moverlo. Al venir de una cuadrícula rotada, las esquinas ya no escalan de forma libre.';
    }
    if ($btnEdit) $btnEdit.disabled = !active;
    if ($btnDuplicate) $btnDuplicate.disabled = !active;
    if ($btnDelete) $btnDelete.disabled = !active;
    syncMetaInputsFromState();
  }

  function selectFeature(f, syncCode = true){
    selectedFeat = f || null;
    if (selectedFeat && syncCode && $codigo){
      $codigo.value = (selectedFeat?.properties?.codigo || '').toString().trim();
    }
    refreshSelectionUI();
  }

  function clearSelection(resetCode = false){
    if (selectedFeat){
      metaDefaults.estatus = ($status?.value || '').toString().trim() || metaDefaults.estatus || 'disponible';
      metaDefaults.paquete = ($paquete?.value || '').toString().trim();
    }
    selectedFeat = null;
    if (resetCode && $codigo) $codigo.value = '';
    refreshSelectionUI();
  }

  function makeUniqueCodigo(base, excludeFeat = null){
    const zid = currentZonaId();
    const cara = currentCara();
    const used = new Set(
      listCurrentRects(zid, cara)
        .filter(f => f !== excludeFeat)
        .map(f => normCode(f?.properties?.codigo || ''))
        .filter(Boolean)
    );

    let seed = (base || '').toString().trim();
    if (!seed) seed = 'NICHO';

    let candidate = seed;
    let i = 2;
    while (used.has(normCode(candidate))){
      candidate = `${seed}-${i}`;
      i += 1;
    }
    return candidate;
  }

  function updateCanvasCursor(){
    if (!$canvas) return;
    $canvas.classList.remove('is-draw', 'is-pan', 'is-panning');
    if (view.panning) $canvas.classList.add('is-panning');
    else if (view.tool === 'pan' || spacePan) $canvas.classList.add('is-pan');
    else $canvas.classList.add('is-draw');
  }

  function setTool(tool){
    view.tool = (tool === 'pan') ? 'pan' : 'draw';
    if ($btnToolDraw) $btnToolDraw.classList.toggle('is-active', view.tool === 'draw');
    if ($btnToolPan) $btnToolPan.classList.toggle('is-active', view.tool === 'pan');
    updateCanvasCursor();
  }

  function applyView(){
    if (!$viewport) return;
    $viewport.style.width = `${view.imageWidth || 0}px`;
    $viewport.style.height = `${view.imageHeight || 0}px`;
    $viewport.style.transformOrigin = 'top left';
    $viewport.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`;
    if ($zoomLabel) $zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function fitToImage(limitToOne = true){
    if (!$canvas || !hasLoadedImage()) return;
    const iw = $img.naturalWidth || 1;
    const ih = $img.naturalHeight || 1;
    const cw = $canvas.clientWidth || iw;
    const ch = $canvas.clientHeight || ih;
    const pad = 24;
    let s = Math.min((cw - pad * 2) / iw, (ch - pad * 2) / ih);
    if (!isFinite(s) || s <= 0) s = 1;
    if (limitToOne) s = Math.min(1, s);
    view.scale = clampLocal(s, 0.05, 20);
    view.panX = (cw - iw * view.scale) / 2;
    view.panY = (ch - ih * view.scale) / 2;
    applyView();
  }

  function setActualSize(){
    if (!hasLoadedImage()) return;
    const iw = $img.naturalWidth || 1;
    const ih = $img.naturalHeight || 1;
    const cw = $canvas.clientWidth || iw;
    const ch = $canvas.clientHeight || ih;
    view.scale = 1;
    view.panX = (cw - iw) / 2;
    view.panY = (ch - ih) / 2;
    applyView();
  }

  function zoomAt(clientX, clientY, nextScale){
    if (!hasLoadedImage()) return;
    const rect = $canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const newScale = clampLocal(nextScale, 0.05, 20);
    const worldX = (x - view.panX) / view.scale;
    const worldY = (y - view.panY) / view.scale;
    view.scale = newScale;
    view.panX = x - worldX * newScale;
    view.panY = y - worldY * newScale;
    applyView();
  }

  function svgPoint(ev){
    const rect = $canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - view.panX) / view.scale,
      y: (ev.clientY - rect.top - view.panY) / view.scale,
    };
  }

  function makePolygonFeature(zid, cara, codigo, ring){
    const props = {
      tipo:'nicho',
      zonaId:zid,
      cara:cara,
      codigo: codigo || '',
      coordMode:'normalized',
      estatus: ($status?.value || metaDefaults.estatus || 'disponible').toString().trim() || 'disponible',
    };
    const paquete = ($paquete?.value || metaDefaults.paquete || '').toString().trim();
    if (paquete) props.paquete = paquete;
    return {
      type:'Feature',
      geometry:{ type:'Polygon', coordinates:[nichosRingFromImageSpace(ring, currentImageWidth(), currentImageHeight(), 'normalized')] },
      properties: props
    };
  }

  function makeRectFeature(zid, cara, codigo, x1, y1, x2, y2){
    const left = _min(x1, x2);
    const right = _max(x1, x2);
    const top = _min(y1, y2);
    const bottom = _max(y1, y2);
    return makePolygonFeature(zid, cara, codigo, [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
      [left, top],
    ]);
  }

  function rotatePoint(x, y, ox, oy, radians){
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = x - ox;
    const dy = y - oy;
    return [ox + dx * cos - dy * sin, oy + dx * sin + dy * cos];
  }

  function buildGridCode(template, rowLabel, rowIndex, colValue, seq){
    const base = (template || '{rowLabel}{col}').toString();
    return base
      .replace(/\{rowLabel\}/gi, rowLabel)
      .replace(/\{row\}/gi, String(rowIndex))
      .replace(/\{col\}/gi, String(colValue))
      .replace(/\{n\}/gi, String(seq));
  }

  function cancelGrid(reason = 'Cuadrícula cancelada.'){
    gridArmed = false;
    if ($gridHint) $gridHint.textContent = 'Configura la cuadrícula y luego haz click en la imagen para colocar la esquina superior izquierda.';
    setMsg(reason);
  }

  function placeGrid(origin){
    const rows = Number(root.querySelector('#noeGridRows')?.value || 0);
    const cols = Number(root.querySelector('#noeGridCols')?.value || 0);
    const w = Number(root.querySelector('#noeGridW')?.value || 0);
    const h = Number(root.querySelector('#noeGridH')?.value || 0);
    const gapX = Number(root.querySelector('#noeGridGapX')?.value || 0);
    const gapY = Number(root.querySelector('#noeGridGapY')?.value || 0);
    const rot = Number(root.querySelector('#noeGridRot')?.value || 0);
    const startCol = Number(root.querySelector('#noeGridStartCol')?.value || 1);
    const inc = Number(root.querySelector('#noeGridInc')?.value || 1);
    const rowLabelsRaw = (root.querySelector('#noeGridRowLabels')?.value || '').trim();
    const template = (root.querySelector('#noeGridTemplate')?.value || '').trim();
    const zid = currentZonaId();
    const cara = currentCara();

    if (!rows || !cols || w <= 0 || h <= 0){
      setMsg('Revisa filas, columnas, ancho y alto de la cuadrícula.');
      return;
    }
    if (!zid || !cara){
      setMsg('Elige columbario y cara antes de crear la cuadrícula.');
      return;
    }

    const rowLabels = rowLabelsRaw
      ? rowLabelsRaw.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean)
      : [];

    const rad = (rot * Math.PI) / 180;
    const features = [];
    let seq = 1;

    for (let r = 0; r < rows; r += 1){
      const rowLabel = rowLabels[r] || alphaLabel(r);
      for (let c = 0; c < cols; c += 1){
        const left = origin.x + c * (w + gapX);
        const top = origin.y + r * (h + gapY);
        let ring = [
          [left, top],
          [left + w, top],
          [left + w, top + h],
          [left, top + h],
          [left, top],
        ];
        if (rad){
          ring = ring.map(([x, y]) => rotatePoint(x, y, origin.x, origin.y, rad));
        }
        const colValue = startCol + c * inc;
        const baseCode = buildGridCode(template || '{rowLabel}{col}', rowLabel, r + 1, colValue, seq);
        const codigo = makeUniqueCodigo(baseCode, null);
        features.push(makePolygonFeature(zid, cara, codigo, ring));
        seq += 1;
      }
    }

    nichosOverlayRaw.features.push(...features);
    window.__nichosOverlayGeo = nichosOverlayRaw;
    gridArmed = false;
    if ($gridHint) $gridHint.textContent = `Se agregaron ${features.length} nichos. Puedes volver a armar otra cuadrícula.`;
    selectFeature(features[features.length - 1] || null, true);
    renderRects();
    setMsg(`Cuadrícula creada con ${features.length} nichos.`);
  }

  const zonas = (nichosZonasRaw?.features || []).filter(f => ((f?.properties?.tipo || 'zona').toString().trim().toLowerCase() === 'zona'));
  $zona.innerHTML = zonas.map(z => {
    const id = nichosZonaId(z);
    const name = nichosGetProp(z, 'nombre') || id;
    return `<option value="${safe(id)}">${safe(id)} — ${safe(name)}</option>`;
  }).join('');

  function renderRects(){
    const zid = currentZonaId();
    const cara = currentCara();
    const rects = listCurrentRects(zid, cara);

    if (selectedFeat && !rects.includes(selectedFeat)) clearSelection(false);
    $svg.innerHTML = '';

    for (const f of rects){
      if (f?.geometry?.type !== 'Polygon') continue;
      const ring = featureRing(f);
      if (ring.length < 4) continue;
      const d = ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ') + ' Z';
      const codigo = (f?.properties?.codigo || '').toString().trim();
      const isSelected = selectedFeat === f;

      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', isSelected ? 'rgba(16,185,129,.14)' : 'rgba(239,68,68,.10)');
      p.setAttribute('stroke', isSelected ? 'rgba(16,185,129,.96)' : 'rgba(239,68,68,.85)');
      p.setAttribute('stroke-width', isSelected ? '3' : '2');
      p.setAttribute('data-codigo', codigo);
      p.style.pointerEvents = 'auto';
      p.style.cursor = 'pointer';

      p.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selectFeature(f, true);
        renderRects();
        setMsg(`Seleccionado: ${codigo || '(sin código)'}`);
      });

      p.addEventListener('pointerdown', (ev) => {
        if (selectedFeat !== f || ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const box = featBox(f);
        if (!box) return;
        const pt = svgPoint(ev);
        dragState = { mode:'move', start:{ x:pt.x, y:pt.y }, box:{ ...box }, ring: featureRing(f) };
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', onDragUp, { once:true });
      });

      $svg.appendChild(p);

      const box = featBox(f);
      if (box && codigo){
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', String((box.l + box.r) / 2));
        txt.setAttribute('y', String((box.t + box.b) / 2));
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'middle');
        txt.setAttribute('font-size', '11');
        txt.setAttribute('font-weight', '700');
        txt.setAttribute('fill', isSelected ? '#065f46' : '#7f1d1d');
        txt.setAttribute('pointer-events', 'none');
        txt.textContent = codigo;
        $svg.appendChild(txt);
      }
    }

    if (!selectedFeat) return;
    const box = featBox(selectedFeat);
    if (!box) return;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-handles', '1');
    g.style.pointerEvents = 'auto';

    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    outline.setAttribute('x', String(box.l));
    outline.setAttribute('y', String(box.t));
    outline.setAttribute('width', String(Math.max(1, box.r - box.l)));
    outline.setAttribute('height', String(Math.max(1, box.b - box.t)));
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', 'rgba(16,185,129,.95)');
    outline.setAttribute('stroke-width', '2');
    outline.setAttribute('stroke-dasharray', '6 4');
    g.appendChild(outline);

    if (canResizeFeature(selectedFeat)){
      const corners = [
        { h:'tl', x:box.l, y:box.t, cur:'nwse-resize' },
        { h:'tr', x:box.r, y:box.t, cur:'nesw-resize' },
        { h:'bl', x:box.l, y:box.b, cur:'nesw-resize' },
        { h:'br', x:box.r, y:box.b, cur:'nwse-resize' },
      ];

      for (const c of corners){
        const h = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const s = 14;
        h.setAttribute('x', String(c.x - s / 2));
        h.setAttribute('y', String(c.y - s / 2));
        h.setAttribute('width', String(s));
        h.setAttribute('height', String(s));
        h.setAttribute('rx', '3');
        h.setAttribute('fill', 'rgba(16,185,129,.95)');
        h.setAttribute('stroke', '#fff');
        h.setAttribute('stroke-width', '2');
        h.setAttribute('data-h', c.h);
        h.style.cursor = c.cur;
        h.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const b0 = featBox(selectedFeat);
          if (!b0) return;
          const pt = svgPoint(ev);
          dragState = { mode:c.h, start:{ x:pt.x, y:pt.y }, box:{ ...b0 } };
          window.addEventListener('pointermove', onDragMove);
          window.addEventListener('pointerup', onDragUp, { once:true });
        });
        g.appendChild(h);
      }
    }

    $svg.appendChild(g);
  }

  function onDragMove(ev){
    if (!dragState || !selectedFeat) return;
    const pt = svgPoint(ev);
    const dx = pt.x - dragState.start.x;
    const dy = pt.y - dragState.start.y;
    const minSize = 8;

    if (dragState.mode === 'move'){
      translateFeature(selectedFeat, dx, dy, dragState.ring);
    } else {
      let b = { ...dragState.box };
      if (dragState.mode === 'tl'){ b.l += dx; b.t += dy; }
      if (dragState.mode === 'tr'){ b.r += dx; b.t += dy; }
      if (dragState.mode === 'bl'){ b.l += dx; b.b += dy; }
      if (dragState.mode === 'br'){ b.r += dx; b.b += dy; }

      if ((b.r - b.l) < minSize){
        const mid = (b.l + b.r) / 2;
        b.l = mid - minSize / 2;
        b.r = mid + minSize / 2;
      }
      if ((b.b - b.t) < minSize){
        const mid = (b.t + b.b) / 2;
        b.t = mid - minSize / 2;
        b.b = mid + minSize / 2;
      }
      setFeatBox(selectedFeat, b);
    }
    renderRects();
  }

  function onDragUp(){
    window.removeEventListener('pointermove', onDragMove);
    dragState = null;
    setMsg('Rectángulo actualizado (en memoria).');
  }

  function loadImage(){
    const zid = currentZonaId();
    const cara = currentCara();
    const zonaF = zonas.find(z => nichosZonaId(z) === zid);

    clearSelection(true);
    $svg.innerHTML = '';
    gridArmed = false;
    if ($gridHint) $gridHint.textContent = 'Configura la cuadrícula y luego haz click en la imagen para colocar la esquina superior izquierda.';

    if (!cara){
      $img.removeAttribute('src');
      view.imageWidth = 0;
      view.imageHeight = 0;
      applyView();
      setMsg('Selecciona una cara para cargar la imagen del columbario.');
      return;
    }

    const url = nichosResolveImageUrl(zonaF, cara);
    if (!url){
      $img.removeAttribute('src');
      view.imageWidth = 0;
      view.imageHeight = 0;
      applyView();
      setMsg('Falta imagenConvexo/imagenConcavo en data/nichos-zonas.geojson');
      return;
    }

    setMsg(`Imagen: ${url}`);

    $img.onload = () => {
      const w = $img.naturalWidth || 1;
      const h = $img.naturalHeight || 1;
      view.imageWidth = w;
      view.imageHeight = h;
      $svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      $svg.setAttribute('width', String(w));
      $svg.setAttribute('height', String(h));
      fitToImage(true);
      renderRects();
    };

    $img.onerror = () => {
      view.imageWidth = 0;
      view.imageHeight = 0;
      applyView();
      setMsg(`No se pudo cargar: ${url}`);
      $svg.innerHTML = '';
    };

    $img.src = url;
  }

  function applySelectedCode(){
    if (!selectedFeat) return;
    const codigo = ($codigo.value || '').toString().trim();
    if (!codigo){
      setMsg('Escribe un CÓDIGO para actualizar el nicho seleccionado.');
      return;
    }
    const duplicate = listCurrentRects(currentZonaId(), currentCara()).some(f => f !== selectedFeat && normCode(f?.properties?.codigo || '') === normCode(codigo));
    if (duplicate){
      setMsg(`Ya existe otro nicho con código ${codigo} en esta cara.`);
      return;
    }
    if (!selectedFeat.properties) selectedFeat.properties = {};
    selectedFeat.properties.codigo = codigo;
    renderRects();
    selectFeature(selectedFeat, false);
    setMsg('Código actualizado (en memoria).');
  }

  function duplicateSelectedFeature(){
    if (!selectedFeat) return;
    const copy = deepCopy(selectedFeat);
    const currentCode = (selectedFeat?.properties?.codigo || '').toString().trim();
    const inputCode = ($codigo.value || '').toString().trim();
    const baseCode = (inputCode && normCode(inputCode) !== normCode(currentCode)) ? inputCode : `${currentCode || 'NICHO'}-COPIA`;
    const newCode = makeUniqueCodigo(baseCode, null);
    if (!copy.properties) copy.properties = {};
    copy.properties.codigo = newCode;
    translateFeature(copy, 16, 16);
    nichosOverlayRaw.features.push(copy);
    window.__nichosOverlayGeo = nichosOverlayRaw;
    selectFeature(copy, true);
    renderRects();
    setMsg(`Duplicado: ${newCode}.`);
  }

  function deleteSelectedFeature(){
    if (!selectedFeat) return;
    const codigo = (selectedFeat?.properties?.codigo || '').toString().trim() || '(sin código)';
    if (!confirm(`¿Seguro que quieres borrar el nicho ${codigo}?`)) return;
    nichosOverlayRaw.features = (nichosOverlayRaw.features || []).filter(f => f !== selectedFeat);
    window.__nichosOverlayGeo = nichosOverlayRaw;
    clearSelection(true);
    renderRects();
    setMsg(`Nicho borrado: ${codigo}.`);
  }

  $canvas.addEventListener('wheel', (ev) => {
    if (!hasLoadedImage()) return;
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.12 : (1 / 1.12);
    zoomAt(ev.clientX, ev.clientY, view.scale * factor);
  }, { passive:false });

  $canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !hasLoadedImage()) return;
    const tag = (ev.target?.tagName || '').toLowerCase();
    const backgroundClick = (ev.target === $canvas || ev.target === $viewport || ev.target === $svg || ev.target === $img);

    if ((view.tool === 'pan' || spacePan) && backgroundClick){
      ev.preventDefault();
      view.panning = true;
      view.panStart = { x: ev.clientX, y: ev.clientY, panX: view.panX, panY: view.panY };
      updateCanvasCursor();
      return;
    }

    if (!backgroundClick || tag === 'path' || tag === 'rect') return;
    if (!currentCara()){
      setMsg('Selecciona una cara antes de dibujar.');
      return;
    }

    if (gridArmed){
      ev.preventDefault();
      placeGrid(svgPoint(ev));
      return;
    }

    if (view.tool !== 'draw') return;

    drawing = true;
    start = svgPoint(ev);
    if (selectedFeat){
      clearSelection(false);
      renderRects();
    }
  });

  window.addEventListener('pointermove', (ev) => {
    if (view.panning && view.panStart){
      view.panX = view.panStart.panX + (ev.clientX - view.panStart.x);
      view.panY = view.panStart.panY + (ev.clientY - view.panStart.y);
      applyView();
      return;
    }

    if (!drawing || !start) return;
    const prev = $svg.querySelector('path[data-preview="1"]');
    if (prev) prev.remove();

    const p = svgPoint(ev);
    const ring = [
      [_min(start.x, p.x), _min(start.y, p.y)],
      [_max(start.x, p.x), _min(start.y, p.y)],
      [_max(start.x, p.x), _max(start.y, p.y)],
      [_min(start.x, p.x), _max(start.y, p.y)],
      [_min(start.x, p.x), _min(start.y, p.y)],
    ];

    const d = ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ') + ' Z';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'rgba(16,185,129,.12)');
    path.setAttribute('stroke', 'rgba(16,185,129,.90)');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('data-preview', '1');
    path.setAttribute('pointer-events', 'none');
    $svg.appendChild(path);
  });

  window.addEventListener('pointerup', (ev) => {
    if (view.panning){
      view.panning = false;
      view.panStart = null;
      updateCanvasCursor();
      return;
    }

    if (!drawing || !start) return;
    drawing = false;

    const prev = $svg.querySelector('path[data-preview="1"]');
    if (prev) prev.remove();

    const codigoRaw = ($codigo.value || '').toString().trim();
    if (!codigoRaw){
      setMsg('Escribe un CÓDIGO antes de dibujar.');
      start = null;
      renderRects();
      return;
    }

    const p = svgPoint(ev);
    const width = Math.abs(p.x - start.x);
    const height = Math.abs(p.y - start.y);
    if (width < 4 || height < 4){
      start = null;
      renderRects();
      return;
    }

    const codigo = makeUniqueCodigo(codigoRaw, null);
    const f = makeRectFeature(currentZonaId(), currentCara(), codigo, start.x, start.y, p.x, p.y);

    nichosOverlayRaw.features.push(f);
    window.__nichosOverlayGeo = nichosOverlayRaw;

    start = null;
    selectFeature(f, true);
    renderRects();
    setMsg(codigo !== codigoRaw
      ? `Rectángulo guardado con código ${codigo} (el original ya existía).`
      : 'Rectángulo guardado en memoria. Usa Copiar GeoJSON para pegar en data/nichos-overlay.geojson');
  });

  root.querySelector('#noeGrid').onclick = () => {
    gridArmed = true;
    setTool('draw');
    if ($gridHint) $gridHint.textContent = '✅ Cuadrícula armada. Haz click en la imagen para colocarla.';
    setMsg('Cuadrícula armada. Click en la imagen para colocar la esquina superior izquierda.');
  };
  root.querySelector('#noeGridArm').onclick = () => {
    gridArmed = true;
    setTool('draw');
    if ($gridHint) $gridHint.textContent = '✅ Cuadrícula armada. Haz click en la imagen para colocarla.';
    setMsg('Cuadrícula armada. Click en la imagen para colocar la esquina superior izquierda.');
  };
  root.querySelector('#noeGridCancel').onclick = () => cancelGrid();

  root.querySelector('#noeCopy').onclick = async () => {
    const txt = JSON.stringify(nichosOverlayRaw || { type:'FeatureCollection', features:[] }, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      notify('GeoJSON copiado. Pégalo en data/nichos-overlay.geojson', 2400);
    } catch {
      setMsg('No pude copiar automáticamente. Revisa consola (F12).');
      console.log(txt);
    }
  };

  root.querySelector('#noeExit').onclick = () => location.href = './';
  if ($btnToolDraw) $btnToolDraw.onclick = () => setTool('draw');
  if ($btnToolPan) $btnToolPan.onclick = () => setTool('pan');
  if ($btnFit) $btnFit.onclick = () => { fitToImage(true); renderRects(); };
  if ($btnZoom100) $btnZoom100.onclick = () => { setActualSize(); renderRects(); };
  if ($btnEdit) $btnEdit.onclick = applySelectedCode;
  if ($btnDuplicate) $btnDuplicate.onclick = duplicateSelectedFeature;
  if ($btnDelete) $btnDelete.onclick = deleteSelectedFeature;
  if ($status) {
    $status.addEventListener('change', () => {
      applyMetaInputs(selectedFeat);
      if (selectedFeat){
        const codigo = (selectedFeat?.properties?.codigo || '').toString().trim() || '(sin código)';
        setMsg(`Propiedades actualizadas para ${codigo}.`);
      } else {
        setMsg('Estatus default actualizado para nuevos nichos.');
      }
      refreshSelectionUI();
    });
  }
  if ($paquete) {
    $paquete.addEventListener('change', () => {
      applyMetaInputs(selectedFeat);
      if (selectedFeat){
        const codigo = (selectedFeat?.properties?.codigo || '').toString().trim() || '(sin código)';
        setMsg(`Propiedades actualizadas para ${codigo}.`);
      } else {
        setMsg('Paquete default actualizado para nuevos nichos.');
      }
      refreshSelectionUI();
    });
  }

  $codigo.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && selectedFeat){
      ev.preventDefault();
      applySelectedCode();
    }
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space'){
      const ae = document.activeElement;
      const isTyping = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      if (!isTyping){
        spacePan = true;
        updateCanvasCursor();
      }
    }
    if (!featureBelongsToCurrentView(selectedFeat)) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedFeat){
      const ae = document.activeElement;
      const isTyping = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      if (isTyping) return;
      ev.preventDefault();
      deleteSelectedFeature();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd' && selectedFeat){
      ev.preventDefault();
      duplicateSelectedFeature();
    }
  });

  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space'){
      spacePan = false;
      updateCanvasCursor();
    }
  });

  window.addEventListener('resize', () => {
    try { fitToImage(true); renderRects(); } catch {}
  });

  $zona.onchange = loadImage;
  $cara.onchange = loadImage;

  refreshSelectionUI();
  setTool('draw');
  syncMetaInputsFromState();
  loadImage();
}

main();
