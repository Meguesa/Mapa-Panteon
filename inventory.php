<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/includes/bootstrap.php';
require_once dirname(__DIR__) . '/includes/portal-sharepoint.php';

portal_require_authentication();

// La sincronizacion completa se ejecuta en segundo plano desde el navegador.
// Se amplía el tiempo de ejecución para permitir recorrer todas las paginas de
// Graph sin que el proceso PHP sea terminado por el limite habitual de 30 s.
@set_time_limit(120);

if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$siteId = 'meguesajdjp.sharepoint.com,7d618515-ccdf-44ae-aec4-c446c915b022,deb28a80-f058-4343-87f1-e268cef2dc10';
$listId = '208b6147-b487-48f8-ba3f-97aeb1ba9021';
// Mantener esta consulta deliberadamente compacta: el inventario contiene miles
// de propiedades y una respuesta demasiado grande puede superar el timeout del
// hosting antes de que Microsoft Graph termine de responder.
$fields = [
    'Title','Clave_Propiedad','Tipo_Propiedad','Seccion','Manzana','Esta_Construida',
    'Estatus_Venta','Estatus_Uso','Referencia_ProcaP','Fuente_Ultima_Actualizacion',
    'Fecha_Actualizacion','Categoria','Codigo','ZonaId','Cara','Estatus_Ocupacion',
    'Finado','Observaciones','Observacion_Automatizacion','Capacidad_Inhumaciones',
    'Uso_Inhumacion','Capacidad_Cenizas','Usos_Cenizas','Estatus_Capacidad',
    'Clave_Busqueda_Principal','Claves_Busqueda_Alternas'
];

try {
    $config = portal_sharepoint_config();
    $token = portal_graph_app_token($config);
    $url = 'https://graph.microsoft.com/v1.0/sites/' . rawurlencode($siteId)
        . '/lists/' . rawurlencode($listId)
        . '/items?$top=250&$expand=fields($select=' . implode(',', $fields) . ')';

    $items = [];
    $pageCount = 0;
    while ($url !== '') {
        $pageCount++;
        if ($pageCount > 100) {
            throw new RuntimeException('Se excedio el limite de paginas esperado al consultar inventario.');
        }
        $page = portal_remote_json($url, 'GET', [
            'Authorization: Bearer ' . $token,
            'Accept: application/json',
        ]);
        foreach (($page['value'] ?? []) as $item) {
            if (is_array($item)) $items[] = $item;
        }
        $url = trim((string) ($page['@odata.nextLink'] ?? ''));
    }

    echo json_encode([
        'source' => 'sharepoint',
        'updatedAt' => gmdate('c'),
        'pages' => $pageCount,
        'graphItems' => $items,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    error_log('Mapa Panteon inventario SharePoint: ' . $error->getMessage());
    http_response_code(502);
    echo json_encode([
        'source' => 'sharepoint-error',
        'error' => $error->getMessage(),
        'graphItems' => [],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
