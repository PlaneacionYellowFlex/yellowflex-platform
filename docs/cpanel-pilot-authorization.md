# C-PANEL — cobertura de autorización para piloto

Fecha: 2026-11-06. Trabajo local, sin migraciones, modificación de registros reales, commits ni despliegues.

## Reglas aplicadas

- Sesión corporativa válida, usuario activo y contraseña definitiva son requisitos previos de las APIs protegidas. Cambio de contraseña y logout conservan sus excepciones.
- Salvo gobierno ADMIN y consulta general de Control Tower, no hay accesos implícitos por rol: se necesita `view` y la acción correspondiente. Una revocación se comprueba de nuevo en la siguiente solicitud.
- ADMIN conserva sus excepciones de gobierno existentes. En Compras, ADMIN tampoco recibe automáticamente permisos especializados de solicitud, aprobación o ejecución: se conserva el registro especializado y la separación de funciones.
- Los módulos siguen visibles en el menú lateral, cuyo archivo no se modificó. Las páginas/URL no autorizadas muestran «Acceso restringido»; las APIs devuelven 401 sin sesión y 403 sin autorización.
- Los wrappers de páginas conservan sus implementaciones existentes en `page-content.tsx`. Las páginas de servidor de RH comprueban permisos antes de consultar datos, además de los layouts.
- No se encontraron Server Actions (`use server`) en app/lib. Las escrituras revisadas se realizan por Route Handlers y siguen protegidas allí.

## Matriz por módulo y acción

En la tabla, V=`view`, O=`operate`, A=`approve`, U=`audit`, M=`manage`. Todo permiso por acción incluye V. Los controles de propiedad, estado, cantidades, idempotencia y separación de funciones siguen vigentes.

| Módulo / función | Lectura / URL | Escritura o acción | Restricciones adicionales |
|---|---|---|---|
| Compras: solicitudes propias | V + O + `canRequest` | V + O + `canRequest`; urgentes además `canRequestUrgent` | Solo registros propios, salvo permiso especializado para consulta/gestión global |
| Compras: consulta global | V + `canViewAll` | No habilita escritura | La consulta no concede solicitud ni aprobación |
| Compras: decisiones | Lectura según el alcance especializado existente | V + O + A + `canAuthorize` | Nunca aprobar solicitud propia |
| Compras: gestión, documentos y registro de compra | V + O + M + `canManagePurchases` cuando se usa la vía de gestor | Mismo control de gestor; solicitante puede actuar sobre sus registros con V + O + `canRequest` | Estados de autorización y factura se conservan |
| Compras: gobierno de permisos especializados | ADMIN | ADMIN | RH y DIRECCION no pueden usar el endpoint heredado para conceder permisos sensibles |
| Warehouse: inventario, artículos, expedientes, conteos (lectura) | V + `canViewInventory` | No habilita escritura | ADMIN conserva excepción existente |
| Warehouse: entradas, movimientos, transferencias, entregas, devoluciones de almacén | V + O + `canRegisterMovement` | V + O + `canRegisterMovement` | El GET de preparación conserva también el control operativo heredado |
| Warehouse: iniciar/cerrar conteo | Lectura con V + `canViewInventory` | V + O + `canRegisterMovement` | Reglas de conteo e idempotencia existentes |
| Warehouse: investigar diferencias, solicitar/completar reconteo | V + `canViewInventory` | V + O + `canManageWarehouse` | Ningún reconteo ajusta inventario automáticamente |
| Warehouse: aprobar ajuste | V + `canViewInventory` para la pantalla | V + A + `canApproveWarehouseAdjustments` | Recuento y separación entre contador/aprobador se conservan |
| Warehouse: material bajo custodia / recepción de Producción | V + rol DIRECCION o PRODUCCION | V + O + rol DIRECCION o PRODUCCION | ADMIN conserva excepción; sin reemplazar reglas de custodia |
| Food Services: entrada y menú publicado | V | No habilita escritura | Cuenta corporativa o sesión PIN vinculada a una cuenta activa con permisos |
| Food Services: reservas y consumos propios | V + sesión de empleado | V + O + sesión de empleado | Cuenta vinculada, empleado activo, contraseña definitiva y controles existentes de PIN, turno y ventana |
| Food Services: cambiar PIN | V + sesión de empleado | Excepción de credencial bajo V | No concede operar ni evita el cambio obligatorio de contraseña |
| Food Services: CHEF, historia y demanda | V + rol CHEF | V + O + rol CHEF para crear borrador, guardar y publicar | CHEF externo no requiere Employee; ADMIN conserva excepción |
| Food Services: exportación CHEF | V + U + rol CHEF | Exportación con el mismo control | El botón se deshabilita sin U |
| Food Services: administración RH, cobros y extraordinarios | ADMIN o RH con V + M | ADMIN o RH con V + M | CHEF y RH sin concesión expresa no acceden; regla compartida entre página y API |
| RH: colaboradores, catálogos, tiempo y expedientes | V + rol RH | V + O + rol RH para perfil, movimientos e incidencias | ADMIN conserva excepción |
| RH: jerarquía y restablecer credencial | V + rol RH para consulta | V + M + rol RH | Los formularios sensibles se restringen también en servidor |
| RH: solicitudes, alcance global y resolución final | V + rol RH | V + A + rol RH | Se conserva etapa RH y validación de estado |
| Mi RH: propias y equipo | V, filtros de empleado/jefatura existentes | V + O para solicitar; V + A para decidir como jefe asignado | No confiere acceso global a RH; la API vuelve a comprobar etapa y jefe |
| Control Tower / OEE | Consulta general para colaborador corporativo autenticado | No existe escritura expuesta | Sin permiso C-PANEL adicional; CHEF exclusivamente externo sin Employee queda fuera |
| C-PANEL: delegación | ADMIN o RH con `c-panel/manage` explícito | ADMIN gobierna; RH delegado solo V/O de módulos no sensibles | RH no se modifica a sí mismo, ni a ADMIN/DIRECCION, ni concede A/U/M, settings o C-PANEL |

Las acciones del catálogo sin endpoint implementado no activan funcionalidades nuevas ni conceden facultades por sí solas.

## Pruebas automatizadas

- `tests/cpanel-authorization.test.cjs`: matriz de concesión/denegación y revocación, herencia de Compras/Warehouse, roles, delegación, páginas, OEE, CHEF externo y sesiones por PIN. Recorre los métodos de las APIs en alcance y comprueba denegación antes de datos.
- `tests/delivery11-auth.test.cjs`: regresiones de login, contraseña temporal, cambio de contraseña, logout, alta de CHEF y política de Food Services RH.
- `tests/helpers/isolated-auth.cjs`: carga módulos productivos con dependencias cerradas/simuladas; no carga PrismaClient, archivos de entorno ni conecta servicios reales.
- Se conservan las pruebas de cantidades, diferencias, transferencias e idempotencia de Warehouse. Las dos integraciones PostgreSQL deben permanecer desactivadas en esta validación.

Comandos de validación (PowerShell):

```powershell
npx tsc --noEmit
$env:RUN_WAREHOUSE_IDEMPOTENCY_DB_TESTS = '0'
$env:RUN_WAREHOUSE_TRANSFER_DB_TESTS = '0'
node --import tsx --test tests/delivery11-auth.test.cjs tests/cpanel-authorization.test.cjs tests/warehouse-discrepancy-adjustment.test.ts tests/warehouse-idempotency.test.ts tests/warehouse-transfers.test.ts
```

## Resultado de esta ejecución

- `npx tsc --noEmit`: aprobado, sin errores.
- Suite completa: 104 pruebas, 102 aprobadas, 0 fallidas y 2 integraciones PostgreSQL omitidas explícitamente.
- `git diff --check`: sin errores de whitespace. Git conserva advertencias existentes de conversión LF/CRLF.
- El primer intento con `tsx` falló al consultar el usuario de Windows dentro del aislamiento (`uv_os_get_passwd`, ENOMEM). La repetición autorizada fuera del aislamiento pasó con ambas integraciones DB desactivadas.
- Se verificó por SHA-256 que `components/sidebar.tsx` no cambió durante esta tarea.
- No se modificaron registros reales ni se ejecutaron migraciones, commits o despliegues.

## Preparación y bloqueos del piloto

1. ADMIN debe revisar y asignar explícitamente los permisos de las cuentas de prueba; no se realizó ninguna concesión automática ni inspección/modificación de usuarios reales.
2. Las cuentas que usen PIN de comedor necesitan User vinculado, activo y con V/O según su función. Los empleados sin cuenta vinculada quedan restringidos hasta su preparación autorizada.
3. Validar en navegador con cuentas controladas: menú visible, URLs directas, denegaciones, login/cambio temporal, revocaciones, RH con/sin delegación, CHEF externo y consulta OEE. Las pruebas aisladas no sustituyen esa aceptación.
4. Verificar de forma controlada las operaciones de dominio en una base de pruebas aislada: transacciones, restricciones de DB e idempotencia. En esta ejecución no se probaron escrituras reales.
5. La interfaz de identificación de consumo ya era una pantalla preparatoria; no se agregó hardware ni una nueva interfaz de captura. Esto permanece como limitación funcional existente para un piloto de consumo presencial.
6. La preparación general de producción (carga, sesiones concurrentes y revisión operativa) no se certifica con estas pruebas de autorización.

## Archivos cambiados en esta intervención

La lista se calculó contra las huellas de los archivos locales al comenzar esta tarea, no contra HEAD; así separa estos cambios de los preexistentes.

### Archivos existentes modificados

- `app/(platform)/modules/control-tower/layout.tsx`
- `app/(platform)/modules/food-services/chef/layout.tsx`
- `app/(platform)/modules/food-services/chef/page.tsx`
- `app/(platform)/modules/food-services/hr/page.tsx`
- `app/(platform)/modules/food-services/page.tsx`
- `app/(platform)/modules/purchases/[id]/page.tsx`
- `app/(platform)/modules/purchases/page.tsx`
- `app/(platform)/modules/rrhh/employees/[id]/page.tsx`
- `app/(platform)/modules/rrhh/layout.tsx`
- `app/(platform)/modules/rrhh/page.tsx`
- `app/(platform)/modules/rrhh/time-control/page.tsx`
- `app/(platform)/modules/warehouse/[itemId]/page.tsx`
- `app/(platform)/modules/warehouse/counts/page.tsx`
- `app/(platform)/modules/warehouse/discrepancies/page.tsx`
- `app/(platform)/modules/warehouse/page.tsx`
- `app/api/food-services/chef/billing/export/route.ts`
- `app/api/food-services/chef/menu/route.ts`
- `app/api/food-services/consumptions/route.ts`
- `app/api/food-services/corporate-employee-access/route.ts`
- `app/api/food-services/menu/route.ts`
- `app/api/food-services/reservations/confirm/route.ts`
- `app/api/food-services/reservations/route.ts`
- `app/api/hr/requests/[id]/decision/route.ts`
- `app/api/hr/requests/route.ts`
- `app/api/oee/route.ts`
- `app/api/purchases/admin/permissions/route.ts`
- `app/api/purchases/requests/[id]/decision/route.ts`
- `app/api/purchases/requests/[id]/documents/[documentId]/download/route.ts`
- `app/api/purchases/requests/[id]/documents/route.ts`
- `app/api/purchases/requests/[id]/purchase/route.ts`
- `app/api/purchases/requests/[id]/route.ts`
- `app/api/purchases/requests/route.ts`
- `app/api/rrhh/catalogs/route.ts`
- `app/api/rrhh/employees/[id]/credential/reset/route.ts`
- `app/api/rrhh/employees/[id]/hierarchy/route.ts`
- `app/api/rrhh/employees/[id]/movements/route.ts`
- `app/api/rrhh/employees/[id]/profile/route.ts`
- `app/api/rrhh/employees/route.ts`
- `app/api/rrhh/time-control/[id]/route.ts`
- `app/api/rrhh/time-control/route.ts`
- `app/api/warehouse/counts/[countId]/complete/route.ts`
- `app/api/warehouse/counts/route.ts`
- `app/api/warehouse/custodies/[custodyId]/consume/route.ts`
- `app/api/warehouse/custodies/[custodyId]/receive/route.ts`
- `app/api/warehouse/custodies/[custodyId]/return/route.ts`
- `app/api/warehouse/discrepancies/[id]/approve/route.ts`
- `app/api/warehouse/discrepancies/[id]/recounts/route.ts`
- `app/api/warehouse/discrepancies/[id]/route.ts`
- `app/api/warehouse/discrepancies/route.ts`
- `app/api/warehouse/inventory/[itemId]/route.ts`
- `app/api/warehouse/inventory/route.ts`
- `app/api/warehouse/movements/handoffs/route.ts`
- `app/api/warehouse/movements/route.ts`
- `app/api/warehouse/movements/transfers/route.ts`
- `app/api/warehouse/production/material/route.ts`
- `app/api/warehouse/production/receipts/route.ts`
- `app/api/warehouse/recounts/[id]/complete/route.ts`
- `app/api/warehouse/returns/[custodyId]/receive/route.ts`
- `app/api/warehouse/returns/route.ts`
- `components/cpanel-access-restricted.tsx`
- `components/food-services/chef-production-dashboard.tsx`
- `lib/food-services/employee-session.ts`
- `lib/food-services/rh-authorization.ts`
- `lib/purchases/purchase-permissions.ts`
- `tests/delivery11-auth.test.cjs`

### Archivos nuevos

- `app/(platform)/modules/food-services/consumption/layout.tsx`
- `app/(platform)/modules/food-services/employee/layout.tsx`
- `app/(platform)/modules/food-services/layout.tsx`
- `app/(platform)/modules/my-rh/layout.tsx`
- `app/(platform)/modules/purchases/[id]/page-content.tsx`
- `app/(platform)/modules/purchases/admin/layout.tsx`
- `app/(platform)/modules/purchases/layout.tsx`
- `app/(platform)/modules/purchases/page-content.tsx`
- `app/(platform)/modules/rrhh/requests/layout.tsx`
- `app/(platform)/modules/warehouse/[itemId]/page-content.tsx`
- `app/(platform)/modules/warehouse/counts/layout.tsx`
- `app/(platform)/modules/warehouse/discrepancies/page-content.tsx`
- `app/(platform)/modules/warehouse/handoffs/layout.tsx`
- `app/(platform)/modules/warehouse/layout.tsx`
- `app/(platform)/modules/warehouse/page-content.tsx`
- `app/(platform)/modules/warehouse/production/layout.tsx`
- `app/(platform)/modules/warehouse/production/material/layout.tsx`
- `app/(platform)/modules/warehouse/production/receipts/layout.tsx`
- `app/(platform)/modules/warehouse/receipts/layout.tsx`
- `app/(platform)/modules/warehouse/returns/layout.tsx`
- `app/(platform)/modules/warehouse/transfers/layout.tsx`
- `lib/cpanel/module-access.ts`
- `lib/cpanel/module-page-access.tsx`
- `tests/cpanel-authorization.test.cjs`
- `tests/helpers/isolated-auth.cjs`
- `docs/cpanel-pilot-authorization.md`
