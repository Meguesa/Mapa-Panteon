(function () {
  "use strict";

  const INVENTORY_FILE_SUFFIX = "/data/inventario-base.json";
  const ENDPOINT = "./inventory.php";
  const originalFetch = window.fetch.bind(window);

  let inventoryPromise = null;
  let liveInventory = null;

  window.JP_INVENTORY_RUNTIME = {
    source: "portal-sharepoint",
    mode: "portal-session",
    refreshing: false,
    inventory: null
  };

  function ensureLoadingOverlay() {
    if (document.getElementById("jp-map-loading")) return;

    const host = document.querySelector("main") || document.body;
    if (host !== document.body && window.getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }

    if (!document.getElementById("jp-map-loading-style")) {
      const style = document.createElement("style");
      style.id = "jp-map-loading-style";
      style.textContent = `
        @keyframes jpMapLoadingSpin {
          to { transform: rotate(360deg); }
        }
        #jp-map-loading {
          position: absolute;
          inset: 0;
          z-index: 50000;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.94);
          opacity: 1;
          transition: opacity 180ms ease;
        }
        #jp-map-loading.jp-map-loading--hide {
          opacity: 0;
          pointer-events: none;
        }
        #jp-map-loading .jp-map-loading-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          border: 1px solid #dbe3ec;
          border-radius: 14px;
          background: #ffffff;
          color: #0f2740;
          font-size: 16px;
          font-weight: 700;
          box-shadow: 0 12px 30px rgba(15, 39, 64, 0.12);
        }
        #jp-map-loading .jp-map-loading-spinner {
          width: 22px;
          height: 22px;
          border: 3px solid #dbe7f1;
          border-top-color: #265585;
          border-radius: 50%;
          animation: jpMapLoadingSpin 0.8s linear infinite;
          flex: 0 0 auto;
        }
      `;
      document.head.appendChild(style);
    }

    const overlay = document.createElement("div");
    overlay.id = "jp-map-loading";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
      <div class="jp-map-loading-card">
        <span class="jp-map-loading-spinner" aria-hidden="true"></span>
        <span id="jp-map-loading-label">Cargando...</span>
      </div>
    `;
    host.appendChild(overlay);
  }

  function hideLoadingOverlay() {
    const overlay = document.getElementById("jp-map-loading");
    if (!overlay) return;
    overlay.classList.add("jp-map-loading--hide");
    window.setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 220);
  }

  function watchMapReady() {
    const params = new URLSearchParams(window.location.search);
    if (params.has("edit")) {
      window.setTimeout(hideLoadingOverlay, 250);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(function () {
      const mapImage = document.querySelector("#map .leaflet-image-layer");
      const sectionSelect = document.getElementById("sectionSelect");
      const sectionsReady = Boolean(
        sectionSelect && sectionSelect.options && sectionSelect.options.length > 1
      );
      const panelTitle = document.getElementById("panelTitle");
      const panelText = panelTitle ? String(panelTitle.textContent || "").trim().toLowerCase() : "";

      if (mapImage && sectionsReady) {
        window.clearInterval(timer);
        hideLoadingOverlay();
        return;
      }

      if (panelText.startsWith("error")) {
        window.clearInterval(timer);
        hideLoadingOverlay();
        return;
      }

      if (Date.now() - startedAt > 60000) {
        const label = document.getElementById("jp-map-loading-label");
        if (label) label.textContent = "Cargando...";
      }
    }, 150);
  }

  ensureLoadingOverlay();
  watchMapReady();

  function isInventoryRequest(input) {
    const rawUrl = typeof input === "string" ? input : input && input.url;
    if (!rawUrl) return false;
    try {
      const url = new URL(rawUrl, window.location.href);
      return url.pathname.endsWith(INVENTORY_FILE_SUFFIX);
    } catch (_) {
      return false;
    }
  }

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function lower(value) {
    return text(value).toLowerCase();
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isFalse(value) {
    if (value === false || value === 0) return true;
    return ["false", "no", "0"].includes(lower(value));
  }

  function normalizeType(fields) {
    const value = lower(fields.Tipo_Propiedad || fields.Categoria);
    return value.includes("nicho") ? "nicho" : "lote";
  }

  function normalizeStatus(value) {
    const status = lower(value);
    if (["disponible", "libre"].includes(status)) return "disponible";
    if (["separado", "separada", "apartado", "apartada"].includes(status)) return "separado";
    if (["suspendido", "suspendida"].includes(status)) return "suspendido";
    if (["vendido", "vendida"].includes(status)) return "vendido";
    if (["utilizado", "utilizada", "ocupado", "ocupada", "usado", "usada", "parcialmente utilizado", "parcialmente utilizada"].includes(status)) return "utilizado";
    if (["por construir", "por_construir", "no construida", "no construido"].includes(status)) return "por_construir";
    return status;
  }

  function resolveStatus(fields) {
    if (isFalse(fields.Esta_Construida)) return "por_construir";
    if (number(fields.Uso_Inhumacion) > 0 || number(fields.Usos_Cenizas) > 0) return "utilizado";

    const usageStatus = normalizeStatus(fields.Estatus_Uso);
    if (usageStatus === "utilizado") return usageStatus;

    const occupancyStatus = normalizeStatus(fields.Estatus_Ocupacion);
    if (occupancyStatus === "utilizado") return occupancyStatus;

    const saleStatus = normalizeStatus(fields.Estatus_Venta);
    if (saleStatus) return saleStatus;

    const capacityStatus = normalizeStatus(fields.Estatus_Capacidad);
    if (capacityStatus) return capacityStatus;

    return occupancyStatus || usageStatus || "desconocido";
  }

  function buildNichoCodigo(fields) {
    const seccion = text(fields.ZonaId || fields.Seccion).toUpperCase();
    const manzanaRaw = text(fields.Manzana).toUpperCase();
    const codigoRaw = text(fields.Codigo);

    if (!seccion || !codigoRaw || !manzanaRaw) {
      return text(fields.Clave_Busqueda_Principal || fields.Title);
    }

    const codigoNumerico = /^\d+$/.test(codigoRaw)
      ? String(Number(codigoRaw)).padStart(3, "0")
      : codigoRaw.toUpperCase();

    let manzanaMapa = manzanaRaw;
    const match = manzanaRaw.match(/^([A-Z]+)0*(\d+)$/);
    if (match && /^\d+$/.test(codigoRaw) && Number(match[2]) === Number(codigoRaw)) {
      manzanaMapa = match[1];
    }

    return `${seccion}-${codigoNumerico}-${manzanaMapa}`;
  }

  function mapItem(graphItem) {
    const fields = graphItem && graphItem.fields ? graphItem.fields : {};
    const type = normalizeType(fields);
    const zonaId = type === "nicho" ? text(fields.ZonaId || fields.Seccion) : text(fields.ZonaId);
    const codigo = type === "nicho"
      ? buildNichoCodigo(fields)
      : text(fields.Codigo || fields.Clave_Busqueda_Principal || fields.Title);

    return {
      tipo: type,
      seccion: text(fields.Seccion),
      manzana: text(fields.Manzana),
      zonaId: zonaId,
      cara: text(fields.Cara),
      codigo: codigo,
      codigo_origen: text(fields.Codigo),
      title_origen: text(fields.Title),
      estatus: resolveStatus(fields),
      referencia_procap: text(fields.Referencia_ProcaP),
      observaciones: text(fields.Observaciones || fields.Observacion_Automatizacion),
      clave_propiedad: text(fields.Clave_Propiedad),
      clave_busqueda_principal: text(fields.Clave_Busqueda_Principal),
      claves_busqueda_alternas: text(fields.Claves_Busqueda_Alternas),
      esta_construido: !isFalse(fields.Esta_Construida),
      estatus_venta: text(fields.Estatus_Venta),
      estatus_uso: text(fields.Estatus_Uso),
      estatus_ocupacion: text(fields.Estatus_Ocupacion),
      estatus_capacidad: text(fields.Estatus_Capacidad),
      finado: text(fields.Finado),
      capacidad_inhumaciones: number(fields.Capacidad_Inhumaciones),
      uso_inhumacion: number(fields.Uso_Inhumacion),
      capacidad_cenizas: number(fields.Capacidad_Cenizas),
      usos_cenizas: number(fields.Usos_Cenizas),
      fecha_actualizacion: text(fields.Fecha_Actualizacion),
      fuente_ultima_actualizacion: text(fields.Fuente_Ultima_Actualizacion)
    };
  }

  async function loadInventoryFromPortal() {
    const response = await originalFetch(ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      throw new Error(`Respuesta invalida de ${ENDPOINT}: ${raw.slice(0, 300)}`);
    }

    if (!response.ok) {
      throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status} al cargar inventario`);
    }

    const graphItems = Array.isArray(payload.graphItems) ? payload.graphItems : [];
    const items = graphItems.map(mapItem).filter(function (item) {
      if (!item.codigo) return false;
      if (item.tipo === "nicho") return Boolean(item.zonaId && item.cara);
      return Boolean(item.seccion && item.manzana);
    });

    return {
      source: "sharepoint",
      updatedAt: payload.updatedAt || new Date().toISOString(),
      items: items
    };
  }

  function inventoryResponse(data) {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }

  function publishInventory(inventory) {
    liveInventory = inventory;
    window.JP_INVENTORY_RUNTIME.source = "sharepoint";
    window.JP_INVENTORY_RUNTIME.updatedAt = inventory.updatedAt;
    window.JP_INVENTORY_RUNTIME.refreshing = false;
    window.JP_INVENTORY_RUNTIME.inventory = inventory;

    console.info(`[Mapa] Inventario cargado con la sesion del Portal: ${inventory.items.length} registros.`);

    try {
      window.dispatchEvent(new CustomEvent("jp-inventory-updated", {
        detail: { inventory: inventory }
      }));
    } catch (_) {}

    return inventory;
  }

  function startInventoryLoad() {
    if (liveInventory) return Promise.resolve(liveInventory);
    if (inventoryPromise) return inventoryPromise;

    window.JP_INVENTORY_RUNTIME.refreshing = true;
    inventoryPromise = loadInventoryFromPortal()
      .then(publishInventory)
      .catch(function (error) {
        inventoryPromise = null;
        window.JP_INVENTORY_RUNTIME.refreshing = false;
        window.JP_INVENTORY_RUNTIME.source = "sharepoint-error";
        window.JP_INVENTORY_RUNTIME.error = error && error.message ? error.message : String(error || "");
        console.error("[Mapa] No fue posible cargar inventario mediante la sesion del Portal.", error);
        throw error;
      });

    return inventoryPromise;
  }

  window.JP_REFRESH_INVENTORY = startInventoryLoad;

  window.fetch = async function (input, init) {
    if (!isInventoryRequest(input)) return originalFetch(input, init);

    try {
      const inventory = await startInventoryLoad();
      return inventoryResponse(inventory);
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "Error desconocido");
      return new Response(JSON.stringify({
        source: "sharepoint-error",
        items: [],
        error: message
      }), {
        status: 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }
  };
})();
