(function () {
  "use strict";

  const ES_PORTAL_MAPA =
    window.location.hostname === "portal.juanpablo.com.mx" &&
    window.location.pathname.startsWith("/mapa/");

  if (!ES_PORTAL_MAPA) {
    return;
  }

  const CONFIG = {
    clientId: "a1bf32aa-d442-4cdd-967c-33b5f758d2b5",
    tenantId: "888d54c0-f785-49d1-b967-54da8b0aed94",
    redirectUri: "https://portal.juanpablo.com.mx/mapa/",
    siteId: "meguesajdjp.sharepoint.com,7d618515-ccdf-44ae-aec4-c446c915b022,deb28a80-f058-4343-87f1-e268cef2dc10",
    listId: "208b6147-b487-48f8-ba3f-97aeb1ba9021",
    scopes: ["User.Read", "Sites.Read.All"]
  };

  const INVENTORY_FILE_SUFFIX = "/data/inventario-base.json";
  const originalFetch = window.fetch.bind(window);

  let msalApp = null;
  let authReadyPromise = null;
  let inventoryPromise = null;

  function isInventoryRequest(input) {
    const rawUrl = typeof input === "string" ? input : input && input.url;
    if (!rawUrl) return false;

    try {
      const url = new URL(rawUrl, window.location.href);
      return url.pathname.endsWith(INVENTORY_FILE_SUFFIX);
    } catch {
      return false;
    }
  }

  function getMsalApp() {
    if (msalApp) return msalApp;

    if (!window.msal || !window.msal.PublicClientApplication) {
      throw new Error("No se cargó la biblioteca MSAL Browser.");
    }

    msalApp = new window.msal.PublicClientApplication({
      auth: {
        clientId: CONFIG.clientId,
        authority: `https://login.microsoftonline.com/${CONFIG.tenantId}`,
        redirectUri: CONFIG.redirectUri,
        navigateToLoginRequestUrl: true
      },
      cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false
      },
      system: {
        loggerOptions: {
          loggerCallback: function (_level, message, containsPii) {
            if (!containsPii && message) {
              console.debug("[MSAL]", message);
            }
          },
          piiLoggingEnabled: false
        }
      }
    });

    return msalApp;
  }

  function initializeAuthentication() {
    if (authReadyPromise) return authReadyPromise;

    const app = getMsalApp();

    authReadyPromise = app.handleRedirectPromise()
      .then(function (response) {
        if (response && response.account) {
          app.setActiveAccount(response.account);
          return response.account;
        }

        const activeAccount = app.getActiveAccount();
        if (activeAccount) return activeAccount;

        const accounts = app.getAllAccounts();
        if (accounts.length > 0) {
          app.setActiveAccount(accounts[0]);
          return accounts[0];
        }

        return null;
      });

    return authReadyPromise;
  }

  async function redirectAndWait(action) {
    await action();

    // Los métodos redirect normalmente navegan de inmediato. Este Promise evita
    // que el Mapa continúe con datos incompletos si el navegador tarda en salir.
    return new Promise(function () {});
  }

  async function getAccessToken() {
    const app = getMsalApp();
    let account = await initializeAuthentication();

    if (!account) {
      return redirectAndWait(function () {
        return app.loginRedirect({
          scopes: CONFIG.scopes,
          redirectUri: CONFIG.redirectUri
        });
      });
    }

    try {
      const response = await app.acquireTokenSilent({
        scopes: CONFIG.scopes,
        account: account
      });

      return response.accessToken;
    } catch (error) {
      const requiresInteraction =
        error instanceof window.msal.InteractionRequiredAuthError ||
        ["interaction_required", "login_required", "consent_required"].includes(error && error.errorCode);

      if (!requiresInteraction) throw error;

      return redirectAndWait(function () {
        return app.acquireTokenRedirect({
          scopes: CONFIG.scopes,
          account: account,
          redirectUri: CONFIG.redirectUri
        });
      });
    }
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function graphGet(url, accessToken, attempt) {
    const currentAttempt = attempt || 0;
    const response = await originalFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if ((response.status === 429 || response.status >= 500) && currentAttempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.pow(2, currentAttempt) * 1000;

      await wait(delay);
      return graphGet(url, accessToken, currentAttempt + 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Microsoft Graph respondió ${response.status}: ${body.slice(0, 500)}`);
    }

    return response.json();
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

    const hasUsage = number(fields.Uso_Inhumacion) > 0 || number(fields.Usos_Cenizas) > 0;
    if (hasUsage) return "utilizado";

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

  function mapItem(graphItem) {
    const fields = graphItem && graphItem.fields ? graphItem.fields : {};
    const type = normalizeType(fields);

    return {
      tipo: type,
      seccion: text(fields.Seccion),
      manzana: text(fields.Manzana),
      zonaId: text(fields.ZonaId),
      cara: text(fields.Cara),
      codigo: text(fields.Codigo || fields.Clave_Busqueda_Principal || fields.Title),
      estatus: resolveStatus(fields),
      referencia_procap: text(fields.Referencia_ProcaP),
      observaciones: text(fields.Observaciones || fields.Observacion_Automatizacion),

      // Campos adicionales de SharePoint. El Mapa actual ignora los que no usa,
      // pero quedan disponibles para mostrar capacidad y trazabilidad después.
      clave_propiedad: text(fields.Clave_Propiedad),
      clave_busqueda_principal: text(fields.Clave_Busqueda_Principal),
      claves_busqueda_alternas: text(fields.Claves_Busqueda_Alternas),
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

  async function loadInventoryFromSharePoint() {
    const accessToken = await getAccessToken();
    const fields = [
      "Title",
      "Clave_Propiedad",
      "Tipo_Propiedad",
      "Seccion",
      "Manzana",
      "Esta_Construida",
      "Estatus_Venta",
      "Estatus_Uso",
      "Referencia_ProcaP",
      "Fecha_Venta",
      "Fecha_Uso",
      "Fuente_Ultima_Actualizacion",
      "Fecha_Actualizacion",
      "Categoria",
      "Codigo",
      "ZonaId",
      "Cara",
      "Estatus_Ocupacion",
      "Finado",
      "Observaciones",
      "Ultima_Actualizacion_Venta",
      "Ultima_Actualizacion_Ocupacion",
      "Fuente_Actualizacion_Venta",
      "Fuente_Actualizacion_Ocupacion",
      "Observacion_Automatizacion",
      "Capacidad_Inhumaciones",
      "Uso_Inhumacion",
      "Capacidad_Cenizas",
      "Usos_Cenizas",
      "Estatus_Capacidad",
      "Clave_Busqueda_Principal",
      "Claves_Busqueda_Alternas"
    ];

    let nextUrl =
      `https://graph.microsoft.com/v1.0/sites/${CONFIG.siteId}` +
      `/lists/${CONFIG.listId}/items` +
      `?$top=500&$expand=fields($select=${fields.join(",")})`;

    const graphItems = [];

    while (nextUrl) {
      const page = await graphGet(nextUrl, accessToken, 0);
      graphItems.push.apply(graphItems, Array.isArray(page.value) ? page.value : []);
      nextUrl = page["@odata.nextLink"] || "";
    }

    const items = graphItems
      .map(mapItem)
      .filter(function (item) {
        if (!item.codigo) return false;
        if (item.tipo === "nicho") return Boolean(item.zonaId && item.cara);
        return Boolean(item.seccion && item.manzana);
      });

    return {
      source: "sharepoint",
      updatedAt: new Date().toISOString(),
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

  window.fetch = async function (input, init) {
    if (!isInventoryRequest(input)) {
      return originalFetch(input, init);
    }

    try {
      if (!inventoryPromise) {
        inventoryPromise = loadInventoryFromSharePoint();
      }

      const inventory = await inventoryPromise;
      console.info(`[Mapa] Inventario cargado desde SharePoint: ${inventory.items.length} registros.`);
      return inventoryResponse(inventory);
    } catch (error) {
      inventoryPromise = null;
      console.error("[Mapa] No se pudo cargar el inventario de SharePoint. Se usará el respaldo JSON.", error);

      try {
        if (typeof window.toast === "function") {
          window.toast("No fue posible consultar SharePoint. Se cargará el respaldo temporal.", 4500);
        }
      } catch {}

      return originalFetch(input, init);
    }
  };
})();
