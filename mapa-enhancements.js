(function () {
  "use strict";

  if (window.__portalMapaEnhancementsInstalled) return;

  const MAX_READY_ATTEMPTS = 200;
  const READY_DELAY_MS = 100;
  let attempts = 0;

  function isReady() {
    return (
      typeof map !== "undefined" &&
      !!map &&
      typeof flyToBoundsSmooth === "function" &&
      typeof showLoteInfo === "function" &&
      typeof getLoteInventoryItem === "function" &&
      typeof getCatalogoItemForLoteFeature === "function" &&
      typeof flyToManzanaFeature === "function" &&
      typeof showPublicLevelManzanas === "function" &&
      typeof showPublicLevelSecciones === "function" &&
      typeof refreshManzanaPanel === "function" &&
      typeof $backBtn !== "undefined" &&
      !!$backBtn
    );
  }

  function getFullMapBounds() {
    let result = null;
    try {
      map.eachLayer(function (layer) {
        if (result) return;
        if (typeof L !== "undefined" && layer instanceof L.ImageOverlay && typeof layer.getBounds === "function") {
          result = layer.getBounds();
        }
      });
    } catch {}
    return result;
  }

  function focusFullMap(originalFly) {
    const bounds = getFullMapBounds();
    if (!bounds) return;
    try { originalFly(bounds, 0.55); } catch {}
  }

  function focusSection(originalFly, seccion) {
    const target = normSeccionInv(seccion);
    const feature = (seccionesTopScaled?.features || []).find(function (item) {
      return normSeccionInv(getPropSeccion(item)) === target;
    });
    if (!feature) return;
    try {
      const layer = L.geoJSON(feature);
      originalFly(layer.getBounds().pad(0.12), 0.55);
    } catch {}
  }

  function findLayerForFeature(feature) {
    if (!lotesLayer || !feature) return null;
    let result = null;
    try {
      lotesLayer.eachLayer(function (layer) {
        if (result) return;
        if (layer.feature === feature) result = layer;
      });
    } catch {}
    return result;
  }

  function buildInventoryDetails(inv, catalogItem) {
    if (!inv) return "";
    const rows = [];
    const add = function (label, value) {
      if (value === null || value === undefined || String(value).trim() === "") return;
      rows.push(`<p style="margin:6px 0;"><b>${safe(label)}:</b> ${safe(value)}</p>`);
    };

    if (!catalogItem?.referencia_procap) add("Referencia ProCaP", inv.referencia_procap);
    add("Estatus de venta", inv.estatus_venta);
    add("Estatus de uso", inv.estatus_uso);
    add("Estatus de ocupación", inv.estatus_ocupacion);
    add("Estatus de capacidad", inv.estatus_capacidad);

    const capacidadInhumaciones = Number(inv.capacidad_inhumaciones || 0);
    const usoInhumacion = Number(inv.uso_inhumacion || 0);
    const capacidadCenizas = Number(inv.capacidad_cenizas || 0);
    const usosCenizas = Number(inv.usos_cenizas || 0);

    if (capacidadInhumaciones > 0) add("Inhumaciones", `${usoInhumacion} de ${capacidadInhumaciones}`);
    if (capacidadCenizas > 0) add("Cenizas", `${usosCenizas} de ${capacidadCenizas}`);

    add("Finado", inv.finado);
    add("Observaciones", inv.observaciones);

    if (!rows.length) return "";

    return `
      <div id="portalInventoryDetails" style="margin-top:10px;padding-top:8px;border-top:1px solid #eadcc6;">
        ${rows.join("")}
      </div>
    `;
  }

  function showInventoryModal(inv, feature) {
    if (!inv) return;

    const props = feature?.properties || {};
    const seccion = props.seccion || currentSeccion || getPropSeccion(currentManzanaFeature);
    const manzana = props.manzana || props.manzanaId || getPropManzana(currentManzanaFeature);
    const lote = props.lote || props.id || props.codigo || inv.codigo || "";

    const rows = [];
    const add = function (label, value) {
      if (value === null || value === undefined || String(value).trim() === "") return;
      rows.push(`<p style="margin:6px 0;"><b>${safe(label)}:</b> ${safe(value)}</p>`);
    };

    add("Sección", seccion);
    add("Manzana", manzana);
    add("Lote", lote);
    add("Estatus", inv.estatus || getLoteStatus(feature));
    add("Referencia ProCaP", inv.referencia_procap);
    add("Estatus de venta", inv.estatus_venta);
    add("Estatus de uso", inv.estatus_uso);
    add("Estatus de ocupación", inv.estatus_ocupacion);
    add("Estatus de capacidad", inv.estatus_capacidad);

    const capacidadInhumaciones = Number(inv.capacidad_inhumaciones || 0);
    const usoInhumacion = Number(inv.uso_inhumacion || 0);
    const capacidadCenizas = Number(inv.capacidad_cenizas || 0);
    const usosCenizas = Number(inv.usos_cenizas || 0);

    if (capacidadInhumaciones > 0) add("Inhumaciones", `${usoInhumacion} de ${capacidadInhumaciones}`);
    if (capacidadCenizas > 0) add("Cenizas", `${usosCenizas} de ${capacidadCenizas}`);

    add("Finado", inv.finado);
    add("Observaciones", inv.observaciones);
    add("Última actualización", inv.fecha_actualizacion);
    add("Fuente de actualización", inv.fuente_ultima_actualizacion);

    showModal("Ficha de propiedad", `
      <div style="display:flex;flex-direction:column;gap:2px;font-size:14px;line-height:1.3;">
        ${rows.join("")}
      </div>
    `);
  }

  function installEnhancements() {
    if (window.__portalMapaEnhancementsInstalled) return;
    window.__portalMapaEnhancementsInstalled = true;

    const originalFlyToBoundsSmooth = flyToBoundsSmooth;
    const originalShowLoteInfo = showLoteInfo;

    flyToBoundsSmooth = function (bounds, durationSeconds, maxZoom = null) {
      let effectiveMaxZoom = maxZoom;
      if (effectiveMaxZoom === null && Number(durationSeconds) <= 0.5) {
        effectiveMaxZoom = 3;
      }
      return originalFlyToBoundsSmooth(bounds, durationSeconds, effectiveMaxZoom);
    };

    showLoteInfo = function (feature) {
      const layer = findLayerForFeature(feature);
      if (layer) pinnedLotLayer = layer;

      originalShowLoteInfo(feature);

      const inv = getLoteInventoryItem(feature);
      const catalogItem = getCatalogoItemForLoteFeature(feature);
      if (!inv) return;

      const panel = document.getElementById("panelBody");
      if (!panel) return;

      const previous = document.getElementById("portalInventoryDetails");
      if (previous) previous.remove();

      const html = buildInventoryDetails(inv, catalogItem);
      if (html) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        const detail = wrapper.firstElementChild;
        const moreBtn = document.getElementById("moreBtn");
        if (detail) panel.insertBefore(detail, moreBtn || null);
      }

      const moreBtn = document.getElementById("moreBtn");
      if (moreBtn && !catalogItem) {
        moreBtn.onclick = function () {
          showInventoryModal(inv, feature);
        };
      }
    };

    $backBtn.onclick = function () {
      try {
        if (nichosUI?.open) {
          nichosClose();
          showPublicLevelSecciones();
          focusFullMap(originalFlyToBoundsSmooth);
          return;
        }
      } catch {}

      if (pinnedLotLayer && lotesLayer && currentManzanaFeature) {
        try {
          const status = getLoteStatus(pinnedLotLayer.feature);
          pinnedLotLayer.setStyle(lotBaseStyle(status));
        } catch {}

        pinnedLotLayer = null;
        if ($loteInput) $loteInput.value = "";
        refreshManzanaPanel();
        flyToManzanaFeature(currentManzanaFeature, null);
        return;
      }

      if (lotesLayer) {
        const seccion = currentSeccion || getPropSeccion(currentManzanaFeature);
        clearLotesLayer();
        pinnedLotLayer = null;
        currentManzanaFeature = null;
        showAllLots = false;
        updateToggleLotsButton();

        if (seccion) {
          showPublicLevelManzanas(seccion);
          focusSection(originalFlyToBoundsSmooth, seccion);
        } else {
          showPublicLevelSecciones();
          focusFullMap(originalFlyToBoundsSmooth);
        }
        return;
      }

      if (manzanasLayer) {
        showPublicLevelSecciones();
        renderNichosZonasLayerPublic();
        bringNichosZonasToFront();
        focusFullMap(originalFlyToBoundsSmooth);
        return;
      }

      showPublicLevelSecciones();
      focusFullMap(originalFlyToBoundsSmooth);
    };

    console.info("[Mapa] Mejoras del Portal activadas: barra compacta, ficha VIP y navegación por niveles.");
  }

  function waitForApp() {
    if (isReady()) {
      installEnhancements();
      return;
    }

    attempts += 1;
    if (attempts >= MAX_READY_ATTEMPTS) {
      console.warn("[Mapa] No fue posible activar las mejoras del Portal porque app.js no terminó de inicializar.");
      return;
    }

    window.setTimeout(waitForApp, READY_DELAY_MS);
  }

  waitForApp();
})();
