# Mapa-Panteon

Aplicacion del Mapa del Panteon de Jardines de Juan Pablo.

## Estructura activa

- `index.html`, `app.js`, `styles.css`: entrypoints principales del mapa. Se mantienen en la raiz por compatibilidad con GitHub Pages, edicion historica y el build productivo.
- `src/js/`: modulos JavaScript auxiliares y funcionalidades complementarias.
  - `sharepoint-inventario.js`: inventario dinamico desde SharePoint.
  - `public-ui-fixes.js`: ajustes publicos de interfaz.
  - `section-visual-references.js`: referencias visuales Americano/VIP.
  - `mapa-enhancements.js`: mejoras de navegacion y ficha.
  - `lotes-nv2-match.js`: homologacion visual/funcional de lotes con Nichos V2.
  - `nichos-v2-preview.js`: runtime vigente de Nichos V2.
  - `nichos-v2-map-integration.js`: integracion de Nichos V2 con el mapa principal.
- `src/css/`: estilos modulares.
  - `account-menu.css`: menu de usuario del Portal.
  - `portal-integration.css`: integracion visual con el Portal Interno.
  - `nichos-v2-preview.css`: estilos del runtime de Nichos V2.
- `assets/map/`: imagenes activas del mapa.
- `assets/nichos-v2-src/`: imagenes fuente activas de Nichos V2.
- `assets/nichos/`: recursos legacy conservados porque el constructor base aun los usa como compatibilidad.
- `data/`: geometria, catalogos e inventario activos.
- `tools/`: scripts de construccion, mantenimiento y generacion de datos.
  - `tools/calibration/calibrate.html`: utilidad manual de calibracion.
  - `tools/build_portal_map.py`: constructor base del mapa productivo.
  - `tools/build_nichos_v2_preview.py`: wrapper del builder de Nichos V2.
  - `tools/nichos_v2_builder_core.py`: nucleo de generacion de Nichos V2.
  - `tools/apply_nichos_v2_production.py`: integra Nichos V2 al paquete productivo.
- `uploads/PLANOS.xlsx`: fuente del inventario base.
- `.github/workflows/deploy-cpanel.yml`: unico workflow productivo vigente de `/mapa/`.

## Construccion de produccion

El workflow productivo ejecuta, en este orden:

1. `tools/build_portal_map.py`
2. `tools/apply_nichos_v2_production.py`
3. validaciones de PHP, JavaScript, JSON y GeoJSON
4. publicacion FTPS a cPanel

Aunque los modulos fuente viven bajo `src/`, el build los copia con nombres planos dentro de `deploy/` para conservar las mismas URLs publicadas en cPanel y no romper el mapa existente.

No se deben editar manualmente archivos dentro de `deploy/`; esa carpeta se genera en cada ejecucion.

## Workflows

En `main` solo debe existir:

- `.github/workflows/deploy-cpanel.yml`

Los workflows de preview, calibracion, diagnostico y referencias visuales fueron retirados de `main`. GitHub puede seguir mostrando nombres de workflows antiguos en el historial de Actions mientras existan ejecuciones historicas; eso no significa que los archivos sigan activos en la rama principal.

## Archivos historicos

Los respaldos historicos se conservaron fuera de `main` en la rama:

`backup/pre-cleanup-20260910`

Por esta razon no se deben volver a crear carpetas `backups/` dentro de `main`.

## Nichos V2

Las cuatro imagenes fuente vigentes son:

- `assets/nichos-v2-src/PLN-concavo.png`
- `assets/nichos-v2-src/PLN-convexo.png`
- `assets/nichos-v2-src/SPN-concavo.png`
- `assets/nichos-v2-src/SPN-convexo.png`

Las geometrias finales se generan durante el build. No sustituirlas por archivos legacy de `assets/nichos/`.
