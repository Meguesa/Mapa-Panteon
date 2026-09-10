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

  function installHoverTooltipStyles() {
    if (document.getElementById("jp-map-hover-tooltip-style")) return;

    const style = document.createElement("style");
    style.id = "jp-map-hover-tooltip-style";
    style.textContent = `
      body.mapa-page .leaflet-tooltip-pane {
        z-index: 700 !important;
        pointer-events: none !important;
      }
      body.mapa-page .leaflet-tooltip.map-hover-center-label {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        background: rgba(255,255,255,0.96) !important;
        color: #111827 !important;
        border: 2px solid rgba(17,24,39,0.18) !important;
        border-radius: 999px !important;
        box-shadow: 0 8px 24px rgba(0,0,0,0.20) !important;
        padding: 8px 14px !important;
        font-size: 15px !important;
        font-weight: 800 !important;
        line-height: 1.2 !important;
        white-space: nowrap !important;
        pointer-events: none !important;
      }
      body.mapa-page .leaflet-tooltip.map-hover-center-label::before {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function getHoverLabel(feature, kind) {
    const props = feature?.properties || {};

    if (kind === "seccion") {
      return String(props.nombre || props.label || getPropSeccion(feature) || "").trim();
    }

    return String(props.nombre || props.label || getPropManzana(feature) || "").trim();
  }

  function bindTooltipsToGroup(group, kind) {
    if (!group || typeof group.eachLayer !== "function") return;

    try {
      group.eachLayer(function (layer) {
        if (!layer || typeof layer.bindTooltip !== "function") return;

        const label = getHoverLabel(layer.feature, kind);
        if (!label) return;

        if (layer.__jpHoverTooltipLabel === label && layer.__jpHoverTooltipKind === kind) return;

        try { layer.unbindTooltip(); } catch {}

        layer.bindTooltip(safe(label), {
          permanent: false,
          sticky: true,
          direction: "top",
          offset: [0, -10],
          opacity: 1,
          interactive: false,
          className: `map-hover-center-label map-hover-center-label-${kind}`
        });

        layer.__jpHoverTooltipLabel = label;
        layer.__jpHoverTooltipKind = kind;
      });
    } catch {}
  }

  function bindCurrentHoverTooltips() {
    try {
      if (typeof seccionesLayerPublic !== "undefined" && seccionesLayerPublic) {
        bindTooltipsToGroup(seccionesLayerPublic, "seccion");
      }
    } catch {}

    try {
      if (typeof manzanasLayer !== "undefined" && manzanasLayer) {
        bindTooltipsToGroup(manzanasLayer, "manzana");
      }
    } catch {}
  }

  function installHoverTooltips() {
    installHoverTooltipStyles();

    // Desactivamos el tooltip manual anterior para evitar duplicados.
    try {
      showHoverNameTooltip = function () {};
      clearHoverNameTooltip = function () {};
    } catch {}

    try {
      const originalRenderSecciones = renderSeccionesLayerPublic;
      renderSeccionesLayerPublic = function () {
        const result = originalRenderSecciones.apply(this, arguments);
        bindCurrentHoverTooltips();
        return result;
      };
    } catch {}

    try {
      const originalRenderManzanas = renderManzanasLayer;
      renderManzanasLayer = function () {
        const result = originalRenderManzanas.apply(this, arguments);
        bindCurrentHoverTooltips();
        return result;
      };
    } catch {}

    // La capa inicial de secciones puede haber sido creada antes de cargar este archivo.
    bindCurrentHoverTooltips();
  }

  function installEnhancements() {
    if (window.__portalMapaEnhancementsInstalled) return;
    window.__portalMapaEnhancementsInstalled = true;

    const originalFlyToBoundsSmooth = flyToBoundsSmooth;
    const originalShowLoteInfo = showLoteInfo;

    installHoverTooltips();

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

    console.info("[Mapa] Mejoras del Portal activadas: barra compacta, ficha VIP, navegación por niveles y etiquetas hover.");
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
