# Cancelación excepcional Food Services — QA

Validación: 9 de noviembre de 2026. Destino comprobado por ambas conexiones Prisma: `127.0.0.1:55432/yellowflex_restore_test`. No se modificaron variables persistentes, Supabase ni las piezas de Warehouse.

## Comportamiento

- Solo una cuenta activa con rol RH, acceso RH de Food Services y concesión explícita `food-services / cancel-food-order` puede cancelar. ADMIN gobierna la concesión; ADMIN sin rol RH no ejecuta cancelaciones. No hay concesiones automáticas.
- El acceso RH conserva su requisito existente: `view` y `manage` para RH; una cuenta ADMIN+RH necesita de todos modos la concesión específica.
- CHEF, colaboradores, RH sin concesión y cuentas con contraseña temporal son rechazados en API.
- Se exige motivo de 5 a 500 caracteres. Pedido, reservas y bitácora se actualizan en una sola transacción. No se borran registros del negocio.
- La bitácora conserva responsable, fecha, motivo, pedido y transición `CONFIRMED → CANCELLED`. El pedido mantiene sus importes originales como historia; no se carga a nómina.
- Demanda CHEF y cobros ya filtran pedidos confirmados; las reservas canceladas quedan excluidas sin modificar sus cálculos.
- El colaborador ve la cancelación y el motivo, sin poder editar, reconfirmar o reactivar. Se conservan los dos avisos originales de confirmación y el bloqueo de confirmados antes del cierre.
- Cancelación, consumo y exportación comparten bloqueo de fila del pedido. El guardado y confirmación semanales también se serializan para impedir que un guardado concurrente reactive o borre reservas de un pedido definitivo.

## Nómina: límite deliberado

El esquema anterior no registraba exportación ni procesamiento de nómina. La migración conserva los pedidos previos como `UNVERIFIED`: su cancelación simple se rechaza. Los pedidos nuevos confirmados por el servicio quedan `PENDING`.

La descarga de nómina, tanto desde RH como desde CHEF, ahora usa POST y confirmación visible. Bloquea los pedidos incluidos como `EXPORTED` antes de entregar el archivo, conservando fecha y responsable. El GET autenticado devuelve 405 y no escribe. Las interfaces existentes usan POST. El archivo se genera desde los mismos pedidos bloqueados; si falla su generación, se revierte la transacción. Una reexportación vuelve a consultar los confirmados y nunca reincorpora cancelados.

`EXPORTED`, `PROCESSED`, `UNVERIFIED`, una marca de exportación o consumos existentes impiden cancelar simplemente. No se modifica nómina automáticamente. No existe integración que confirme procesamiento externo; se bloquea desde la exportación como protección conservadora.

Para un cargo anterior o enviado: detener la cancelación simple, conciliar el archivo/lote y deducción con nómina, documentar el ajuste y autorizarlo por el procedimiento financiero correspondiente. La pantalla no permite marcar esos pedidos como pendientes ni borrar su historial. El workflow digital de conciliación/ajuste queda fuera de esta entrega.

## Migración

Aplicada únicamente en QA: `20261109120000_food_order_exceptional_cancellation`.

Añade `CANCELLED`, control de nómina y `FoodOrderCancellation`. QA tiene 29 migraciones terminadas. Script de aplicación dedicado comprueba identidad, `DATABASE_URL`, `DIRECT_URL` y que no existan otras migraciones pendientes. El cliente Prisma fue regenerado. Producción requiere un procedimiento de despliegue futuro; no se aplicó allí.

## Archivos de esta entrega

- `prisma/schema.prisma` y `prisma/migrations/20261109120000_food_order_exceptional_cancellation/migration.sql`.
- `lib/food-services/order-cancellation.ts`, `payroll-export.ts`, `service.ts`, `hr-billing-service.ts`, `billing-export-service.ts`.
- `app/api/food-services/hr/orders/route.ts`, `reservations/route.ts`, `hr/billing/export/route.ts`, `chef/billing/export/route.ts`.
- `app/(platform)/modules/food-services/hr/page.tsx`.
- `components/food-services/hr-order-cancellations.tsx`, `hr-billing-dashboard.tsx`, `chef-production-dashboard.tsx`, `employee-access.tsx`.
- `lib/cpanel/permission-catalog.ts`, `components/cpanel-permission-editor.tsx`, `app/api/admin/cpanel/permissions/route.ts`.
- `scripts/apply-isolated-food-cancellation.cjs`, `scripts/start-isolated-pilot.cjs`.
- `tests/food-order-cancellation.test.cjs`, `food-order-cancellation-postgres.test.cjs`, `delivery11-auth.test.cjs`, `helpers/isolated-auth.cjs`.
- Este informe. Se conservaron todos los cambios preexistentes.

## Resultados automatizados

- `npx tsc --noEmit`: sin errores.
- Regresión combinada: **131 aprobadas, 0 fallidas, 2 omitidas**. Las omitidas son las dos integraciones PostgreSQL de Warehouse; no se ejecutaron para respetar su alcance.
- Integración PostgreSQL incluida: API autorizada, denegaciones por rol/concesión y revocación, motivo obligatorio, doble cancelación, dos cancelaciones simultáneas, fallo de auditoría con rollback de pedido/reservas, exclusión CHEF/nómina, bloqueo de nómina exportada/procesada/desconocida y de consumos, carreras contra consumo y exportación, inmutabilidad para el colaborador.
- Fixtures exclusivos `QA-CANCEL-*`, semana de 2199; eliminados al finalizar. No se concedieron permisos a usuarios piloto. Cero pedidos de esos fixtures restantes.
- Verificación final del piloto: **3 servicios, 2 colaboradores y 2 pedidos confirmados**, sin consumos. Los pedidos piloto anteriores no se cancelaron.
- `git diff --check`: sin errores de espacios; advertencias de normalización de líneas en archivos preexistentes.

## Aceptación visual pendiente

Servidor QA reiniciado en `http://127.0.0.1:3100`, con referencia ficticia de 2099 y Storage externo deshabilitado por el lanzador. La ruta HTTP responde 200 (el acceso anónimo conduce a autenticación); esto no sustituye una sesión de aceptación en navegador.

1. Con ADMIN QA, en C-PANEL conceder explícitamente a RH QA `Food Services: Ver`, `Administrar` y `Cancelar pedido Food`, con motivo. Solo hacerlo si se desea habilitar esa cuenta para aceptación; la entrega no lo concede.
2. Crear y confirmar un pedido ficticio nuevo con un empleado QA que aún no tenga pedido en la semana QA. Mantener ambos avisos. No intentar cancelar los dos pedidos piloto previos, que quedan sin verificar para nómina.
3. Abrir `http://127.0.0.1:3100/modules/food-services/hr` con RH autorizado. En «Cancelación excepcional», revisar colaborador/semana, pulsar «Cancelar pedido», comprobar motivo obligatorio y confirmar. Ver responsable, fecha, motivo y transición.
4. Actualizar `http://127.0.0.1:3100/modules/food-services/chef`: desaparecen solo los servicios de ese pedido. En el portal del empleado, `/modules/food-services/employee`, verificar «Pedido cancelado por RH» y ausencia de posibilidad de reactivarlo.
5. Probar acceso con CHEF/RH sin concesión y revocar la concesión desde ADMIN: la API debe denegar, incluso desde una pantalla abierta previamente.
6. Con otro pedido ficticio nuevo, exportar nómina desde RH: confirmar el aviso y comprobar que después se bloquea la cancelación simple. No enviar el archivo a nómina real.

Bloqueos para producción: conciliación de cargos históricos y aceptación visual autenticada. Sin commits ni despliegues.
