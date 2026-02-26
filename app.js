const BASE_IMAGE_URL = "./assets/map/base.png";
let GEOJSON_URL      = "./data/seccion-demo.geojson";
const LOTES_URL      = "./data/lotes.json";
const PAQUETES_URL   = "./data/paquetes.json";

// Si abres la página con ?edit=1, entra al modo dibujo
const isEditMode = new URLSearchParams(location.search).get("edit") === "1";

let map, lotesInfo = {}, paquetesInfo = {};
let geoLayer = null;

const $title = document.getElementById("panelTitle");
const $body  = document.getElementById("panelBody");

function setPanel(title, html){
  $title.textContent = title;
  $body.innerHTML = html;
}
function safe(v){ return (v === null || v === undefined) ? "" : String(v); }

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

function findFeatureById(id){
  let found = null;
  if (!geoLayer) return null;
  geoLayer.eachLayer(layer => {
    const fid = layer?.feature?.properties?.id;
    if (fid && fid.toLowerCase() === id.toLowerCase()) found = layer;
  });
  return found;
}

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

function setupSearch(){
  const input = document.getElementById("searchInput");
  const btn   = document.getElementById("searchBtn");

  const run = () => {
    const id = input.value.trim();
    if (!id) return;

    const layer = findFeatureById(id);
    if (!layer){
      setPanel("No encontrado", `<p>No encontré el ID <b>${safe(id)}</b>.</p>`);
      return;
    }
    map.fitBounds(layer.getBounds().pad(0.25));
    showLote(layer.feature.properties.id);
  };

  btn.onclick = run;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

function addGeoLayer(geojson){
  if (geoLayer) geoLayer.remove();

  geoLayer = L.geoJSON(geojson, {
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
}

/* =========================
   MODO DIBUJO (EDIT)
   ========================= */
let editPoints = [];       // puntos que marcas con click
let tempLine = null;       // línea provisional
let tempPoly = null;       // polígono provisional
let createdFeatures = [];  // lotes guardados “en memoria”

function toGeoJSONPolygon(pointsLatLng){
  // Leaflet (CRS.Simple): lat = Y, lng = X
  // GeoJSON requiere [X,Y] => [lng,lat]
  const coords = pointsLatLng.map(p => [p.lng, p.lat]);
  if (coords.length) coords.push(coords[0]); // cerrar el contorno
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

function setupEditorUI(){
  setPanel("Modo dibujo (edit=1)", `
    <p><b>Cómo dibujar:</b> haz clic en el mapa para marcar puntos alrededor del lote.</p>
    <p><b>Tip:</b> haz zoom para acercarte y que quede más preciso.</p>
    <p><b>Puntos marcados:</b> <span id="ptCount">0</span></p>

    <label><b>ID del lote</b></label><br/>
    <input id="e_id" placeholder="Ej. L-1411" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

    <label><b>Estatus</b></label><br/>
    <select id="e_status" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">
      <option>disponible</option>
      <option>ocupado</option>
      <option>por construir</option>
    </select>

    <label><b>Paquete (opcional)</b></label><br/>
    <input id="e_pkg" placeholder="Ej. PAQ-JARDIN-STD" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button id="e_save"  style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar lote</button>
      <button id="e_copy"  style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      <button id="e_clear" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar puntos</button>
    </div>

    <p style="font-size:12px;color:#666;margin-top:10px;">
      “Copiar GeoJSON” te da el texto para pegarlo en un archivo dentro de <b>/data</b>.
    </p>
  `);

  const ptCount = document.getElementById("ptCount");
  const idEl = document.getElementById("e_id");
  const stEl = document.getElementById("e_status");
  const pkEl = document.getElementById("e_pkg");

  function updateCount(){ ptCount.textContent = String(editPoints.length); }
  updateCount();

  document.getElementById("e_clear").onclick = () => {
    editPoints = [];
    refreshEditPreview();
    updateCount();
  };

  document.getElementById("e_save").onclick = () => {
    const id = idEl.value.trim();
    if (!id) return alert("Pon un ID (ej. L-1411).");
    if (editPoints.length < 3) return alert("Necesitas mínimo 3 puntos.");

    const feature = {
      type: "Feature",
      geometry: toGeoJSONPolygon(editPoints),
      properties: {
        id,
        estatus: stEl.value,
        paquete: pkEl.value.trim() || null
      }
    };

    createdFeatures.push(feature);

    // reset para el siguiente lote
    editPoints = [];
    refreshEditPreview();
    updateCount();

    alert(`Guardado: ${id}. Puedes dibujar otro lote ahora.`);
  };

  document.getElementById("e_copy").onclick = async () => {
    const fc = { type: "FeatureCollection", features: createdFeatures };
    const txt = JSON.stringify(fc, null, 2);

    try {
      await navigator.clipboard.writeText(txt);
      alert("Copiado al portapapeles. Ahora pégalo en un archivo .geojson en /data.");
    } catch {
      // fallback: mostrar el texto si el navegador bloquea el portapapeles
      setPanel("Copia manual", `<p>Copia este texto:</p><pre style="white-space:pre-wrap">${safe(txt)}</pre>`);
    }
  };

  // Click en mapa = agregar punto
  map.on("click", (e) => {
    editPoints.push(e.latlng);
    refreshEditPreview();
    updateCount();
  });
}

async function main(){
  map = L.map("map", { crs: L.CRS.Simple, minZoom: -3, maxZoom: 4 });

  try { lotesInfo = await loadJson(LOTES_URL); } catch { lotesInfo = {}; }
  try { paquetesInfo = await loadJson(PAQUETES_URL); } catch { paquetesInfo = {}; }

  const img = new Image();
  img.onload = async () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    const bounds = [[0,0],[h,w]];
    L.imageOverlay(BASE_IMAGE_URL, bounds).addTo(map);
    map.fitBounds(bounds);

    // En modo normal, cargamos GeoJSON; en modo dibujo también lo cargamos (si existe)
    try {
      const geo = await loadJson(GEOJSON_URL);
      addGeoLayer(geo);
    } catch {
      // no pasa nada si aún no existe o no está listo
    }

    if (isEditMode) setupEditorUI();
  };

  img.onerror = () => {
    setPanel("Falta base.png", `
      <p>No encontré la imagen del mapa en:</p>
      <p><code>${safe(BASE_IMAGE_URL)}</code></p>
    `);
  };

  img.src = BASE_IMAGE_URL;

  setupSearch();
}

main();