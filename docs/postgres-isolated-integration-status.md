> Actualización: el bloqueo de esquema descrito aquí ya fue resuelto únicamente en la copia local. Ver [resultados actuales](postgres-isolated-integration-results.md). Este documento conserva el diagnóstico histórico.

# Integración PostgreSQL aislada — estado y pruebas manuales

Fecha: 2026-11-06.

## Verificaciones realizadas

Se leyó YELLOWFLEX_TEST_DATABASE_URL del entorno de usuario de Windows fuera del aislamiento. No se imprimieron credenciales ni se usaron DATABASE_URL/DIRECT_URL como origen de conexión.

La consulta de solo lectura devolvió:

- current_database(): yellowflex_restore_test
- inet_server_addr(): 127.0.0.1
- inet_server_port(): 55432
- transaction_read_only: on
- servidores externos registrados: 0

No se creó otra base, no se restauró un respaldo, no se cambiaron conexiones de Supabase y no se ejecutaron escrituras.

## Bloqueo concreto

La copia local tiene 27 migraciones y User.email todavía es NOT NULL. La comparación con prisma/migrations encontró pendiente exactamente:

`20261104170000_operational_login_email_optional`

El archivo existente contiene el cambio para permitir correo nulo. No se aplicó. El control previo termina con código 1 y bloquea las escrituras; no es un fallo de autenticación.

Las dos integraciones existentes además siguen limitadas explícitamente a yellowflex_idempotencia_test. No se debilitó esa protección ni se creó esa base. Cuando se resuelva el esquema de la copia autorizada, deberán configurarse sus guards para yellowflex_restore_test y sustituirse las selecciones del primer usuario/artículo por fixtures ficticios creados por la ejecución.

## Archivos preparados

- scripts/verify-isolated-postgres.ps1: verificación exclusivamente de lectura, con destino fijo, comprobación de identidad, esquema y migraciones. Conserva y restaura sus variables PG del proceso; no cambia DATABASE_URL/DIRECT_URL.
- tests/fixtures/pilot-profiles.json: especificación de los seis perfiles ficticios. Es un plan de fixtures; NO se insertaron cuentas ni se generaron contraseñas.

Comprobación segura en PowerShell, desde el proyecto:

```powershell
./scripts/verify-isolated-postgres.ps1 -VerifyOnly
```

Con el estado actual debe identificar la base correcta y luego detenerse por el esquema pendiente.

TypeScript (`npx tsc --noEmit`): aprobado. Las integraciones PostgreSQL y la provisión de fixtures no se ejecutaron, por el bloqueo previo. Los resultados de 102 pruebas pertenecen a la validación anterior, no a una nueva ejecución PostgreSQL.

## Condiciones antes de continuar

1. Resolver únicamente en yellowflex_restore_test la migración pendiente existente; no ejecutar comandos Prisma que puedan cargar las URLs habituales de Supabase.
2. Repetir la verificación de solo lectura hasta confirmar identidad exacta y esquema compatible.
3. Preparar un ejecutor con conexión exclusiva y guards duplicados antes de las escrituras. Generar actores y artículos ficticios con marcador por ejecución; no elegir registros restaurados arbitrarios.
4. Ejecutar las dos integraciones: consumos de custodia (reintento, conflicto, duplicación concurrente, rollback por saldo insuficiente y cierre total) y transferencias (reintento, conflicto, saldo, concurrencia y bloqueo compartido con entrega a Producción).
5. Sembrar los seis perfiles solo con registros QA-PILOT y contraseñas temporales aleatorias entregadas fuera del repositorio. Configurar grants explícitos; no modificar usuarios del respaldo.
6. Deshabilitar integraciones externas antes de abrir un servidor de navegador: Compras usa SUPABASE_URL, SUPABASE_SECRET_KEY y SUPABASE_PURCHASE_BUCKET para documentos. Una DB local por sí sola NO aísla Storage. Las pruebas de archivos quedan fuera hasta disponer de Storage de pruebas; nunca usar el bucket real.

## Pruebas manuales para autorizar el piloto

Realizar únicamente cuando la aplicación de pruebas esté confirmada contra la base local, con sesión de navegador separada y perfiles QA ya provisionados. No usar el servidor habitual ni cuentas reales. Las siguientes rutas son relativas al origen LOCAL de pruebas que se habilite.

| Perfil | Pasos exactos | Resultado esperado |
|---|---|---|
| Todos | Abrir /login, entrar con credencial QA temporal, intentar /modules/purchases antes del cambio y completar /change-password. Cerrar sesión y repetir una URL protegida. | Cambio obligatorio; después de logout no hay sesión válida. Producción entra por número de empleado; administrativos por correo. |
| ADMIN | Abrir /settings/cpanel-rh y conceder/revocar c-panel/manage a QA RH. | Gobierno disponible; el cambio se registra en auditoría. Usar exclusivamente usuarios QA. |
| RH delegado | Abrir /settings/cpanel-rh y conceder warehouse/view a una cuenta QA; intentar approve/manage, editarse a sí mismo y modificar QA ADMIN. Revocar su delegación desde QA ADMIN y repetir. | Solo view/operate delegados; operaciones sensibles, autoedición y cuentas protegidas denegadas. Tras revocación se restringe C-PANEL. |
| Administrativo | Abrir /modules/purchases, registrar solicitud ficticia normal y abrirla. Intentar urgencia, aprobación y /modules/rrhh. | Puede actuar sobre su propia solicitud; demás acciones denegadas según fixture. No cargar documentos. |
| Producción | Abrir /modules/warehouse/production/receipts y /modules/warehouse/production/material con custodias QA; recibir/consumir/devolver solo esas custodias. | Operación permitida y saldo coherente; inventario global y aprobación de ajustes denegados. |
| Warehouse | Abrir /modules/warehouse, registrar movimiento y conteo QA, investigar/recontar una diferencia QA y aprobar con un usuario QA distinto al contador. | Respeta permisos especializados y separación contador/aprobador. No ajustar artículos del respaldo. |
| CHEF externo | Entrar por correo sin Employee; abrir /modules/food-services/chef, guardar/publicar menú QA. Intentar exportación sin audit y visitar /modules/rrhh, /settings/cpanel-rh, /modules/food-services/employee y /modules/control-tower. | Menú autorizado sin Employee; exportación y funciones ajenas denegadas. |
| Revocación | Mantener abierta una pantalla QA. Desde QA ADMIN revocar operate; repetir la acción en la pestaña anterior y recargar URL. | La siguiente llamada se deniega aunque la página estuviera abierta. |
| Consulta general | Con QA administrativo y QA Producción abrir /modules/control-tower; cerrar sesión e intentar la misma consulta/API OEE. | Consulta corporativa permitida; acceso anónimo rechazado. |

Registrar por caso: perfil QA, ruta, acción, resultado esperado/observado y evidencia sin contraseñas ni cookies. Aprobar el piloto solo después de resolver el esquema, completar las integraciones y cerrar estas verificaciones de navegador.
