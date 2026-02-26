// ===== Configuración simple =====
const BASE_IMAGE_URL = "./assets/map/base.png";          // mapa en imagen
const GEOJSON_URL    = "./data/seccion-demo.geojson";   // lotes dibujados (demo)
const LOTES_URL      = "./data/lotes.json";             // info de cada lote
const PAQUETES_URL   = "./data/paquetes.json";          // paquetes por zona

// Modo “dibujar” (editor) si abres la página con ?edit=1
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

// Colores/estilos según estatus
function styleByStatus(status){
  const s = (status || "").toLowerCase();
  if (s === "disponible") return { weight: 1, opacity: 1, fillOpacity: 0.35 };
  if (s === "ocupado")    return { weight: 1, opacity: 1, fillOpacity: 0.55 };
  if (s === "por construir") return { weight: 1, opacity: 1, dashArray: "4 4", fillOpacity: 0.20 };
  return { weight: 1, opacity: 1, fillOpacity: 0.25 };
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
  const inh = info.inhumaciones_publicas || [];
  const paqueteKey = info.paquete || null;

  let html = `
    <p><b>ID:</b> ${safe(id)}</p>
    <p><b>Estatus:</b> ${safe(status)}</p>
  `;

  if (status.toLowerCase() === "ocupado"){
    html += `<h3>Inhumaciones (público)</h3>`;
    if (!inh.length){
      html += `<p>No hay datos públicos cargados.</p>`;
    } else {
      html += `<ul>${inh.map(x => `<li>${safe(x.nombre)} — ${safe(x.fecha)}</li>`).join("")}</ul>`;
    }
    html += `
      <button id="moreBtn" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">
        Más información
      </button>
      <p style="font-size:12px;color:#666;">
        Nota: el saldo/estado de cuenta se conectará después con login. (No se guarda en GitHub público.)
      </p>
    `;
  }

  if (status.toLowerCase() === "disponible"){
    html += `<h3>Paquetes</h3>`;
    if (paqueteKey && paquetesInfo[paqueteKey]){
      const p = paquetesInfo[paqueteKey];
      html += `
        <p><b>${safe(p.nombre)}</b></p>
        <ul>${(p.items||[]).map(it => `<li>${safe(it)}</li>`).join("")}</ul>
      `;
    } else {
      html += `<p>No hay paquete asignado todavía a este lote.</p>`;
    }
  }

  setPanel(`Lote ${id}`, html);

  // Botón “Más información” (por ahora solo mensaje)
  const btn = document.getElementById("moreBtn");
  if (btn){
    btn.onclick = () => {
      alert("Aquí irá el login + consulta segura del saldo (fase futura).");
    };
  }
}

async function loadJson(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`No se pudo cargar: ${url}`);
  return await r.json();
}

function geojsonFixStyle(feature){
  const status = feature?.properties?.estatus || lotesInfo[feature?.properties?.id]?.estatus;
  return styleByStatus(status);
}

function setupSearch(){
  const input = document.getElementById("searchInput");
  const btn   = document.getElementById("searchBtn");

  const run = () => {
    const id = input.value.trim();
    if (!id) return;

    const layer = findFeatureById(id);
    if (!layer){
      setPanel("No encontrado", `<p>No encontré el ID <b>${safe(id)}</b>. Revisa que esté dibujado en el mapa.</p>`);
      return;
    }
    map.fitBounds(layer.getBounds().pad(0.25));
    layer.openPopup?.();
    showLote(layer.feature.properties.id);
  };

  btn.onclick = run;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

function addGeoLayer(geojson){
  if (geoLayer) geoLayer.remove();

  geoLayer = L.geoJSON(geojson, {
    style: geojsonFixStyle,
    onEachFeature: (feature, layer) => {
      const id = feature?.properties?.id || "(sin id)";
      layer.bindPopup(`<b>${safe(id)}</b>`);
      layer.on("click", () => showLote(id));
    }
  }).addTo(map);
}

// ===== Editor (dibujar lotes dentro de la misma página) =====
let editPoints = [];
let tempLine = null;
let createdFeatures = [];

function toGeoJSONPolygon(pointsLatLng){
  // Leaflet usa (lat=y, lng=x) en CRS simple.
  // GeoJSON necesita [x,y], y el primer punto se repite al final.
  const coords = pointsLatLng.map(p => [p.lng, p.lat]);
  if (coords.length) coords.push(coords[0]);
  return { type: "Polygon", coordinates: [coords] };
}

function setupEditorUI(){
  setPanel("Modo dibujo", `
    <p><b>Cómo dibujar:</b> haz clic en el mapa para poner puntos del contorno.</p>
    <p>Cuando cierres el contorno, guarda el lote con un ID.</p>

    <label>ID del lote</label><br/>
    <input id="e_id" placeholder="Ej. L-1411" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

    <label>Estatus</label><br/>
    <select id="e_status" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;">
      <option>disponible</option>
      <option>ocupado</option>
      <option>por construir</option>
    </select>

    <label>Zona/Paquete (opcional)</label><br/>
    <input id="e_zona" placeholder="Ej. PAQ-JARDIN-STD" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ccc;border-radius:8px;" />

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button id="e_close" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Cerrar contorno</button>
      <button id="e_save"  style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Guardar lote</button>
      <button id="e_copy"  style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Copiar GeoJSON</button>
      <button id="e_clear" style="padding:8px 12px;border-radius:8px;border:1px solid #ccc;cursor:pointer;">Limpiar</button>
    </div>

    <p style="font-size:12px;color:#666;margin-top:10px;">
      Tip: Después de “Copiar GeoJSON”, lo pegarás en un archivo dentro de /data.
    </p>
  `);

  const $id = () => document.getElementById("e_id");
  const $st = () => document.getElementById("e_status");
  const $zo = () => document.getElementById("e_zona");

  document.getElementById("e_close").onclick = () => {
    if (editPoints.length < 3) return alert("Necesitas al menos 3 puntos.");
    // Solo para visualizar: convertimos línea en polígono
    if (tempLine) map.removeLayer(tempLine);
    tempLine = L.polygon(editPoints, { weight: 2 }).addTo(map);
  };

  document.getElementById("e_save").onclick = () => {
    const id = $id().value.trim();
    if (!id) return alert("Pon un ID primero.");
    if (editPoints.length < 3) return alert("Dibuja al menos 3 puntos.");

    const feature = {
      type: "Feature",
      geometry: toGeoJSONPolygon(editPoints),
      properties: {
        id,
        estatus: $st().value,
        paquete: $zo().value.trim() || null
      }
    };

    createdFeatures.push(feature);
    // Reset para el siguiente lote
    editPoints = [];
    if (tempLine) map.removeLayer(tempLine);
    tempLine = null;

    alert(`Guardado: ${id} (en memoria). Cuando termines varios, usa "Copiar GeoJSON".`);
  };

  document.getElementById("e_copy").onclick = async () => {
    const fc = { type: "FeatureCollection", features: createdFeatures };
    const txt = JSON.stringify(fc, null, 2);
    await navigator.clipboard.writeText(txt);
    alert("GeoJSON copiado al portapapeles. Ahora pégalo en /data/tu-archivo.geojson en GitHub.");
  };

  document.getElementById("e_clear").onclick = () => {
    editPoints = [];
    createdFeatures = [];
    if (tempLine) map.removeLayer(tempLine);
    tempLine = null;
    alert("Limpio.");
  };

  map.on("click", (e) => {
    // Solo en modo editor
    editPoints.push(e.latlng);
    if (tempLine) map.removeLayer(tempLine);
    tempLine = L.polyline(editPoints, { weight: 2 }).addTo(map);
  });
}

async function main(){
  // 1) Crear mapa “simple” (coordenadas tipo imagen, no GPS)
  map = L.map("map", { crs: L.CRS.Simple, minZoom: -3, maxZoom: 4 });

  // 2) Cargar info (si no existe aún, no truena el mapa)
  try { lotesInfo = await loadJson(LOTES_URL); } catch { lotesInfo = {}; }
  try { paquetesInfo = await loadJson(PAQUETES_URL); } catch { paquetesInfo = {}; }

  // 3) Cargar imagen base (base.png). Si no existe, te avisará.
  const img = new Image();
  img.onload = async () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    // Bounds = área total de la imagen: [y,x]
    const bounds = [[0,0],[h,w]];
    L.imageOverlay(BASE_IMAGE_URL, bounds).addTo(map);
    map.fitBounds(bounds);

    // 4) Cargar GeoJSON de lotes (demo)
    try {
      const geo = await loadJson(GEOJSON_URL);
      addGeoLayer(geo);
    } catch (err){
      setPanel("Listo, falta dibujar", `
        <p>El mapa base cargó, pero aún no hay lotes (GeoJSON).</p>
        <p>Si quieres dibujar dentro de la misma página, abre con <b>?edit=1</b>.</p>
        <p style="color:#666;font-size:12px;">Detalle: ${safe(err.message)}</p>
      `);
    }

    if (isEditMode) setupEditorUI();
  };

  img.onerror = () => {
    setPanel("Falta el mapa base", `
      <p>No encontré la imagen del mapa en:</p>
      <p><code>${safe(BASE_IMAGE_URL)}</code></p>
      <p>Más adelante la generamos desde tu PDF (en la nube) y la guardamos como <b>base.png</b>.</p>
    `);
  };

  img.src = BASE_IMAGE_URL;

  setupSearch();
}

main();
