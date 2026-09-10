# Mapa-Panteon

Aplicacion del Mapa del Panteon de Jardines de Juan Pablo.

## Estructura activa

- `index.html`, `app.js`, `styles.css`: aplicacion base.
- `sharepoint-inventario.js`: integracion del inventario SharePoint.
- `lotes-nv2-match.js`: homologacion visual/funcional de lotes con Nichos V2.
- `nichos-v2-preview.js`, `nichos-v2-preview.css`, `nichos-v2-map-integration.js`: runtime actual de Nichos V2 en produccion.
- `mapa-enhancements.js`, `public-ui-fixes.js`, `section-visual-references.js`: mejoras de interfaz y referencias visuales.
- `portal-integration.css`, `account-menu.css`: integracion con el Portal Interno.
- `assets/map/`: imagenes activas del mapa.
- `assets/nichos-v2-src/`: imagenes fuente activas de Nichos V2.
- `assets/nichos/`: recursos legacy conservados porque el constructor base aun los usa como compatibilidad.
- `data/`: geometria, catalogos e inventario activos.
- `tools/`: scripts de construccion, mantenimiento y generacion de datos.
- `uploads/PLANOS.xlsx`: fuente del inventario base.
- `.github/workflows/deploy-cpanel.yml`: despliegue productivo de `/mapa/`.

## Construccion de produccion

El workflow productivo ejecuta, en este orden:

1. `tools/build_portal_map.py`
2. `tools/apply_nichos_v2_production.py`
3. validaciones de PHP, JavaScript, JSON y GeoJSON
4. publicacion FTPS a cPanel

No se deben editar manualmente archivos dentro de `deploy/`; esa carpeta se genera en cada ejecucion.

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

Las geometrías finales se generan durante el build. No sustituirlas por archivos legacy de `assets/nichos/`.
