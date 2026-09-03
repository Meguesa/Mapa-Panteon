(function () {
  'use strict';

  const INSTALL_FLAG = '__jpSectionVisualReferencesInstalled';
  const STYLE_ID = 'jp-section-visual-references-style';
  const CARD_ID = 'jpSectionVisualReferenceCard';

  const REFERENCES = {
    americano: {
      title: 'Lotes tipo Americano',
      label: 'Referencia visual',
      description: 'Así se ven los lotes tipo jardín Americano dentro del parque.',
      sections: new Set(['PLATINO', 'PLATINO 2', 'ORO', 'PLATA', 'PLATA 2', 'BRONCE']),
      images: [
        './assets/referencias/lotes-americano/americano-01.webp',
        './assets/referencias/lotes-americano/americano-02.webp',
        './assets/referencias/lotes-americano/americano-03.webp',
        './assets/referencias/lotes-americano/americano-04.webp'
      ]
    },
    vip: {
      title: 'Lotes VIP',
      label: 'Referencia visual',
      description: 'Así se ven los lotes VIP ubicados en plazoletas dentro del parque.',
      sections: new Set(['SAN JUAN VIP', 'SAN MATEO VIP', 'SAN PEDRO VIP']),
      images: [
        './assets/referencias/lotes-vip/vip-01.webp',
        './assets/referencias/lotes-vip/vip-02.webp',
        './assets/referencias/lotes-vip/vip-03.webp'
      ]
    }
  };

  function normalizeSectionName(value) {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  }

  function getReferenceForSection(section) {
    const sec = normalizeSectionName(section);
    if (!sec) return null;

    if (REFERENCES.vip.sections.has(sec) || sec.endsWith(' VIP')) {
      return REFERENCES.vip;
    }

    if (REFERENCES.americano.sections.has(sec)) {
      return REFERENCES.americano;
    }

    return null;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .jp-section-visual-card {
        margin: 0 0 14px 0;
        border: 1px solid #eadcc6;
        border-radius: 14px;
        overflow: hidden;
        background: #fff;
        box-shadow: 0 8px 24px rgba(17, 24, 39, 0.08);
      }

      .jp-section-visual-card__image-wrap {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        background: #f3f4f6;
      }

      .jp-section-visual-card__image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .jp-section-visual-card__badge {
        position: absolute;
        left: 10px;
        bottom: 10px;
        padding: 5px 8px;
        border-radius: 999px;
        background: rgba(17, 24, 39, 0.80);
        color: #fff;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.02em;
      }

      .jp-section-visual-card__body {
        padding: 12px;
      }

      .jp-section-visual-card__title {
        margin: 0;
        font-size: 15px;
        font-weight: 800;
        color: #111827;
      }

      .jp-section-visual-card__text {
        margin: 5px 0 10px 0 !important;
        color: #4b5563 !important;
        font-size: 12px;
        line-height: 1.4;
      }

      .jp-section-visual-card__button {
        width: 100%;
        min-height: 36px;
        border: 1px solid #265585;
        border-radius: 10px;
        background: #265585;
        color: #fff;
        font-weight: 800;
      }

      .jp-section-visual-card__button:hover {
        filter: brightness(0.96);
      }

      .jp-section-visual-gallery {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }

      .jp-section-visual-gallery figure {
        margin: 0;
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        background: #fff;
      }

      .jp-section-visual-gallery img {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
      }

      .jp-section-visual-gallery figcaption {
        padding: 7px 9px;
        font-size: 11px;
        color: #6b7280;
      }

      @media (max-width: 520px) {
        .jp-section-visual-gallery {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function buildGalleryHtml(reference) {
    return `
      <p style="margin:0 0 14px 0;color:#4b5563;">
        ${reference.description}
      </p>
      <div class="jp-section-visual-gallery">
        ${reference.images.map(function (src, index) {
          return `
            <figure>
              <img
                src="${src}"
                alt="${reference.title} - referencia ${index + 1}"
                loading="lazy"
              />
              <figcaption>Referencia ${index + 1}</figcaption>
            </figure>
          `;
        }).join('')}
      </div>
    `;
  }

  function openGallery(reference) {
    if (!reference) return;

    try {
      if (typeof showModal === 'function') {
        showModal(reference.title, buildGalleryHtml(reference));
        return;
      }
    } catch (_) {}

    try {
      const firstImage = reference.images[0];
      window.open(firstImage, '_blank', 'noopener,noreferrer');
    } catch (_) {}
  }

  function renderSectionReference(section) {
    const panelBody = document.getElementById('panelBody');
    if (!panelBody) return;

    const existing = document.getElementById(CARD_ID);
    if (existing) existing.remove();

    const reference = getReferenceForSection(section);
    if (!reference) return;

    const card = document.createElement('section');
    card.id = CARD_ID;
    card.className = 'jp-section-visual-card';
    card.innerHTML = `
      <div class="jp-section-visual-card__image-wrap">
        <img
          class="jp-section-visual-card__image"
          src="${reference.images[0]}"
          alt="${reference.title}"
          loading="lazy"
        />
        <div class="jp-section-visual-card__badge">${reference.label}</div>
      </div>
      <div class="jp-section-visual-card__body">
        <h3 class="jp-section-visual-card__title">${reference.title}</h3>
        <p class="jp-section-visual-card__text">${reference.description}</p>
        <button type="button" class="jp-section-visual-card__button">
          Ver ${reference.images.length} fotos
        </button>
      </div>
    `;

    panelBody.insertBefore(card, panelBody.firstChild);

    const button = card.querySelector('.jp-section-visual-card__button');
    const image = card.querySelector('.jp-section-visual-card__image');

    if (button) button.addEventListener('click', function () { openGallery(reference); });
    if (image) {
      image.style.cursor = 'pointer';
      image.addEventListener('click', function () { openGallery(reference); });
    }
  }

  function install() {
    if (window[INSTALL_FLAG]) return true;

    if (typeof window.showPublicLevelManzanas !== 'function') {
      return false;
    }

    window[INSTALL_FLAG] = true;
    injectStyles();

    const originalShowPublicLevelManzanas = window.showPublicLevelManzanas;

    window.showPublicLevelManzanas = function (section) {
      const result = originalShowPublicLevelManzanas.apply(this, arguments);

      try {
        renderSectionReference(section);
      } catch (error) {
        console.warn('[Mapa Panteon] No se pudo mostrar la referencia visual de la seccion.', error);
      }

      return result;
    };

    try {
      if (typeof currentSeccion !== 'undefined' && currentSeccion) {
        renderSectionReference(currentSeccion);
      }
    } catch (_) {}

    console.info('[Mapa Panteon] Referencias visuales de secciones instaladas.');
    return true;
  }

  if (!install()) {
    let attempts = 0;
    const timer = window.setInterval(function () {
      attempts += 1;
      if (install() || attempts >= 240) {
        window.clearInterval(timer);
      }
    }, 50);
  }
})();
