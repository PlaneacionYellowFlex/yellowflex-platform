# PostgreSQL local: migración e integraciones del piloto

Fecha: 2026-11-06. Estado: migración local e integración de datos aprobadas; aceptación de navegador pendiente.

## Destino efectivo y migración

Se leyó YELLOWFLEX_TEST_DATABASE_URL del ámbito Usuario de Windows sin imprimirla. El ejecutor asignó DATABASE_URL y DIRECT_URL únicamente en su proceso y en el proceso hijo de Prisma CLI; verificó ambas conexiones efectivas con PrismaClient y datasourceUrl explícito. También se verificó SQL local con psql usando host/puerto/base explícitos y modo de solo lectura.

- Host: 127.0.0.1; puerto: 55432; current_database(): yellowflex_restore_test.
- Servidores externos registrados: 0.
- Migraciones antes: 27. Se verificó que la única pendiente era 20261104170000_operational_login_email_optional y que su SQL era exactamente ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL.
- Se ejecutó prisma migrate deploy únicamente después de esa comprobación, con ambas URLs efectivas locales. No se ejecutó migrate dev, db push, reset ni restauración.
- Resultado confirmado: 28 migraciones aplicadas, 0 pendientes, User.email nullable=YES.
- No se editaron .env, .env.production.local ni variables persistentes DATABASE_URL/DIRECT_URL. No se conectó a Supabase.

## Resultados de pruebas

| Ejecución | Resultado |
|---|---|
| Regresión de autorización, autenticación y lógica Warehouse, más guards de destino | 104 aprobadas, 0 fallidas; las 2 entradas PostgreSQL se desactivaron solo en esta corrida porque se ejecutaron por separado |
| Warehouse PostgreSQL: las 2 integraciones anteriormente omitidas | 18 comprobaciones aprobadas, 0 omitidas: 7 pruebas auxiliares y 11 comprobaciones de integración (2 contenedoras + 9 subcasos) |
| Seis perfiles sobre PostgreSQL local | 15 aprobadas, 0 omitidas: 1 contenedora + 14 subcasos |
| TypeScript: npx tsc --noEmit | Aprobado |
| Verificación posterior de esquema y fixtures | Aprobada mediante lecturas |

No sumar las corridas como si fueran casos únicos: las 7 pruebas auxiliares Warehouse se repiten en la regresión.

Las integraciones Warehouse comprobaron reintento, payload conflictivo, doble solicitud concurrente, saldo insuficiente con rollback, cierre total de custodia, transferencia concurrente y bloqueo de saldo compartido con entrega a Producción. Crearon sus propios actores/artículos; los catálogos estructurales ALMACEN/PRODUCCION se consultaron sin modificarlos. Los fixtures transitorios se limpiaron.

La suite de perfiles ejecutó código productivo de autenticación, guards y API de C-PANEL con Prisma y bcrypt reales contra la copia local. Solo se simularon la interfaz de cookies de Next y el transporte de respuesta; NO equivale a una prueba HTTP/navegador completa. Se comprobaron cambios de contraseña, rotación de tokens, logout, expiración, inactividad, permisos permitidos/denegados, revocación sobre una sesión existente, auditoría y rollback de una transacción fallida.

El primer intento de las integraciones detectó que server-only no se resuelve fuera del bundler de Next. Se corrigió únicamente el arranque de pruebas utilizando el marcador vacío que Next ya incluye. No se instalaron dependencias ni se modificaron módulos productivos. Las corridas posteriores pasaron.

## Estado de los seis perfiles ficticios

Los perfiles ADMIN, RH delegado, administrativo, Producción, Warehouse y CHEF externo tienen identificadores y correos con sufijo único de ejecución. Producción conserva email NULL y entra por número de empleado; CHEF externo no tiene Employee.

- 6 cuentas QA activas, 4 empleados ficticios vinculados.
- 6 contraseñas temporales nuevas; 0 sesiones corporativas abiertas al terminar.
- 0 actores/artículos transitorios de las pruebas Warehouse restantes.
- Se conservó un artículo QA, un almacén QA, dos ubicaciones QA y una custodia QA para navegador.
- Saldo inicial manual: 15 EA en origen y 5 EA en tránsito hacia Producción.

El manifiesto local es data/qa-pilot-local-manifest.json (data/ ya está ignorado por Git). No contiene contraseñas. La propiedad credentialsFile indica el archivo de credenciales QA creado en la carpeta temporal del usuario, fuera del repositorio. No se imprimió su contenido.

## Archivos preparados o adaptados

- scripts/apply-isolated-login-migration.cjs: verificación de las URLs efectivas de Prisma y aplicación restringida de la única migración autorizada.
- scripts/verify-isolated-postgres.ps1: comprobación SQL de identidad/esquema de solo lectura, preparada en la fase anterior.
- tests/helpers/isolated-postgres.cjs y .d.cts: guard de conexión sin fallback a URLs habituales; verificación SQL de identidad antes de escrituras.
- tests/helpers/server-only-register.cjs: marcador de servidor solo para el ejecutor de pruebas.
- tests/warehouse-idempotency.test.ts y warehouse-transfers.test.ts: conexión explícita local, fixtures ficticios propios y limpieza acotada; sin seleccionar primer usuario/artículo.
- tests/isolated-postgres-guard.test.cjs: rechazo de destinos remotos, puertos/bases incorrectos y herencia de variables productivas.
- tests/pilot-auth-postgres.test.cjs: provisión y validación de los seis perfiles.
- tests/helpers/isolated-auth.cjs: aclaración del uso explícito de cliente local en la suite de integración.
- scripts/prepare-pilot-warehouse.ts: datos ficticios conservados para pruebas manuales; no duplica fixtures registrados.
- scripts/verify-pilot-state.cjs: verificación de solo lectura del estado inicial del piloto.
- scripts/start-isolated-pilot.cjs: arranque manual local con verificación previa y Storage externo deshabilitado.
- tests/fixtures/pilot-profiles.json: especificación de perfiles de la fase anterior.

No se hicieron commits ni despliegues. Se conservaron los cambios existentes.

## Arranque exacto para pruebas de navegador

No usar npm run dev directamente: cargaría la configuración habitual. Cerrar primero cualquier otro next dev de este workspace para no compartir el lock de .next. En una nueva consola PowerShell, desde la carpeta del proyecto:

```powershell
$env:YELLOWFLEX_TEST_DATABASE_URL = [Environment]::GetEnvironmentVariable('YELLOWFLEX_TEST_DATABASE_URL', 'User')
node scripts/start-isolated-pilot.cjs
```

El ejecutor no edita variables persistentes. Comprueba el destino local antes de iniciar Next en http://127.0.0.1:3100 y fija las variables de Storage al loopback inactivo. Para terminar: Ctrl+C. No se inició este servidor durante la ejecución automática.

Para abrir localmente las credenciales QA sin imprimirlas en consola ni enviarlas al chat:

```powershell
$qaManifest = Get-Content -LiteralPath data/qa-pilot-local-manifest.json -Raw | ConvertFrom-Json
notepad.exe $qaManifest.credentialsFile
```

Usar perfiles separados del navegador o ventanas privadas independientes por usuario. Antes de cada caso confirmar el origen 127.0.0.1:3100. Operar únicamente sobre los IDs/códigos QA del manifiesto; los datos restaurados no son fixtures de escritura.

## Pruebas manuales breves de aceptación

1. **Login y sesión:** con cada perfil abrir /login, introducir su login QA y contraseña temporal, confirmar redirección a /change-password, establecer contraseña definitiva y salir. Abrir de nuevo una URL protegida; debe pedir login. Producción usa su número QA, CHEF su correo QA sin Employee.
2. **Delegación y revocación:** ADMIN abre /settings/cpanel-rh. RH delegado puede cambiar solo view/operate de otras cuentas QA. Intentar approve/manage, autoedición y modificar QA ADMIN: debe denegar. ADMIN revoca c-panel/manage al RH; repetir desde su pestaña abierta: Acceso restringido. Restaurar únicamente el permiso QA al terminar.
3. **Compras y consulta:** administrativo abre /modules/purchases, crea una solicitud ficticia normal y prueba urgencia/aprobación/expedientes RH: denegados. Con administrativo y Producción, /modules/control-tower permite consulta; /api/oee sin sesión debe devolver 401. Todos los módulos siguen visibles en el menú.
4. **Warehouse/Producción:** usar exclusivamente warehouseFixture del manifiesto. Producción recibe la custodia QA de 5 EA en /modules/warehouse/production/receipts; consume 2 en /modules/warehouse/production/material y devuelve 3. Warehouse recibe esas 3 en la ubicación QA destino; después transfiere 2 del origen QA al destino QA. Saldos esperados: origen 13, destino 5. No tocar artículos/restos de la restauración.
5. **Separación de funciones:** QA ADMIN inicia y cierra un conteo del origen QA con 12 frente a 13 teóricas; clasifica REAL y completa el reconteo QA con 12. QA Warehouse aprueba el ajuste como actor distinto. Verificar origen 12, destino 5 y un solo movimiento de ajuste. Repetir intento de aprobación: no debe duplicar movimiento.
6. **CHEF externo:** /modules/food-services/chef debe permitir las funciones concedidas sin Employee. Exportación sin audit, /modules/rrhh, /settings/cpanel-rh, portal de empleado y Control Tower deben restringirse. Para guardar/publicar menú, preparar primero una semana/platos QA sin sobrescribir un menú restaurado; si la próxima semana ya contiene datos del respaldo, detener ese caso y preparar el fixture de menú aparte.
7. **Permiso revocado con pantalla abierta:** ADMIN revoca warehouse/operate a QA Warehouse, repetir operación en la pestaña abierta: 403/Acceso restringido, sin movimiento nuevo. Restaurar el permiso QA tras recoger evidencia.

## Bloqueos y límites pendientes

- Falta ejecutar y documentar la aceptación real en navegador y el arranque HTTP de Next. Lo anterior está preparado, no ejecutado.
- Storage de Compras está intencionalmente deshabilitado. Carga/descarga de documentos requiere un Storage aislado; no usar el bucket de Supabase real.
- La escritura de menú CHEF requiere reservar datos QA sin colisión con semanas restauradas. No se modificaron menús del respaldo.
- La pantalla de identificación de consumos seguía siendo preparatoria; no se agregó hardware ni interfaz nueva.
- Las pruebas confirman las operaciones y permisos descritos, no carga/rendimiento ni preparación general de producción.
