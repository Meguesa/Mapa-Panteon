(function () {
  'use strict';

  const MOBILE_QUERY = '(max-width: 720px)';
  const BODY_OPEN = 'jp-mobile-search-open';
  const BODY_COLLAPSED = 'jp-mobile-search-collapsed';
  const TOGGLE_ID = 'jpMobileSearchToggle';
  const BACK_EXTERNAL_CLASS = 'jp-mobile-back-external';

  let media = null;
  let toggle = null;
  let controls = null;
  let inner = null;
  let backBtn = null;
  let backOriginalParent = null;
  let backOriginalNextSibling = null;
  let installed = false;

  const SEARCH_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="6.5"></circle>
      <path d="M16 16l4.25 4.25"></path>
    </svg>
  `;

  const CLOSE_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18"></path>
    </svg>
  `;

  function isMobile() {
    return Boolean(media && media.matches);
  }

  function invalidateMap() {
    window.setTimeout(function () {
      try {
        window.JP_LEAFLET_MAP?.invalidateSize?.(true);
      } catch (_) {}
    }, 180);
  }

  function updateToggle() {
    if (!toggle) return;
    const open = document.body.classList.contains(BODY_OPEN);
    toggle.innerHTML = open ? CLOSE_ICON : SEARCH_ICON;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Cerrar búsqueda' : 'Abrir búsqueda');
    toggle.title = open ? 'Cerrar búsqueda' : 'Buscar propiedad';
  }

  function moveBackOutsideSearch() {
    if (!backBtn || !inner || !isMobile()) return;
    if (backBtn.parentElement === inner) return;

    // En móvil Volver no forma parte del menú desplegable. Se conserva el
    // mismo botón y todos sus listeners; únicamente cambia de contenedor.
    backBtn.classList.add(BACK_EXTERNAL_CLASS);
    inner.insertBefore(backBtn, toggle || null);
  }

  function restoreBackToControls() {
    if (!backBtn || !backOriginalParent) return;
    if (backBtn.parentElement === backOriginalParent) {
      backBtn.classList.remove(BACK_EXTERNAL_CLASS);
      return;
    }

    backBtn.classList.remove(BACK_EXTERNAL_CLASS);
    if (backOriginalNextSibling && backOriginalNextSibling.parentElement === backOriginalParent) {
      backOriginalParent.insertBefore(backBtn, backOriginalNextSibling);
    } else {
      backOriginalParent.appendChild(backBtn);
    }
  }

  function syncBackPlacement() {
    if (isMobile()) moveBackOutsideSearch();
    else restoreBackToControls();
  }

  function setOpen(open, options) {
    const opts = options || {};

    if (!isMobile()) {
      document.body.classList.remove(BODY_OPEN, BODY_COLLAPSED);
      restoreBackToControls();
      updateToggle();
      if (!opts.skipResize) invalidateMap();
      return;
    }

    moveBackOutsideSearch();
    document.body.classList.toggle(BODY_OPEN, Boolean(open));
    document.body.classList.toggle(BODY_COLLAPSED, !open);
    updateToggle();
    if (!opts.skipResize) invalidateMap();
  }

  function toggleMenu(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const open = document.body.classList.contains(BODY_OPEN);
    setOpen(!open);
  }

  function handleViewportChange() {
    syncBackPlacement();
    if (isMobile()) {
      // En móvil siempre inicia cerrado para que el mapa tenga el máximo espacio.
      setOpen(false);
    } else {
      setOpen(false);
    }
  }

  function install() {
    if (installed) return true;

    const header = document.querySelector('.map-controls-header');
    inner = header?.querySelector('.map-controls-inner');
    controls = header?.querySelector('.controls');
    backBtn = document.getElementById('backBtn');
    if (!header || !inner || !controls || !backBtn) return false;

    backOriginalParent = backBtn.parentElement;
    backOriginalNextSibling = backBtn.nextElementSibling;
    media = window.matchMedia(MOBILE_QUERY);

    toggle = document.getElementById(TOGGLE_ID);
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.id = TOGGLE_ID;
      toggle.className = 'jp-mobile-search-toggle';
      toggle.setAttribute('aria-controls', controls.id || 'mapSearchControls');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Abrir búsqueda');
      toggle.innerHTML = SEARCH_ICON;
      inner.appendChild(toggle);
    }

    if (!controls.id) controls.id = 'mapSearchControls';

    toggle.addEventListener('click', toggleMenu);

    // Evita que tocar la lupa se interprete como una acción del mapa o de otro
    // control contenido en la barra superior.
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach(function (type) {
      toggle.addEventListener(type, function (event) {
        event.stopPropagation();
      }, { passive: type.startsWith('touch') });
    });

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleViewportChange);
    } else if (typeof media.addListener === 'function') {
      media.addListener(handleViewportChange);
    }

    // Cerrar el menú después de ejecutar una búsqueda normal deja visible el
    // resultado sin obligar al usuario a volver a tocar la X.
    const searchBtn = document.getElementById('searchBtn');
    searchBtn?.addEventListener('click', function () {
      if (!isMobile()) return;
      window.setTimeout(function () {
        setOpen(false);
      }, 180);
    });

    // Volver queda siempre visible fuera del desplegable; al utilizarlo,
    // solamente cerramos cualquier búsqueda abierta y devolvemos espacio al mapa.
    backBtn.addEventListener('click', function () {
      if (!isMobile()) return;
      window.setTimeout(function () {
        setOpen(false);
      }, 60);
    });

    // Cuando "Cómo llegar" ya tiene un destino y comienza a dibujar la ruta,
    // cerramos la barra; si está en modo de selección, permanece abierta para
    // poder elegir sección y manzana desde los desplegables.
    document.addEventListener('click', function (event) {
      if (!isMobile()) return;
      const routeBtn = event.target.closest('#routeBtn');
      if (!routeBtn) return;

      window.setTimeout(function () {
        const selecting = Boolean(window.JP_ROUTE_SELECTION_MODE);
        const routing = Boolean(window.JP_ROUTE_UI?.active);
        if (routing && !selecting) setOpen(false);
      }, 120);
    });

    installed = true;
    handleViewportChange();
    console.info('[Mapa] Menú móvil instalado: lupa desplegable y Volver siempre externo.');
    return true;
  }

  let attempts = 0;
  const timer = window.setInterval(function () {
    attempts += 1;
    if (install() || attempts >= 240) {
      window.clearInterval(timer);
    }
  }, 50);
})();
