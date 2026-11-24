# Food Services — conciliación CHEF–RH–Nómina, etapa 1

Fecha: 11 de noviembre de 2026.

## Resultado

Una sola consulta de FoodOrder CONFIRMED y sus reservas ACTIVE alimenta RH, la demanda ordinaria CHEF y los reportes Excel. No se crea un padrón alternativo de pedidos. Las cantidades de pedidos, colaboradores y servicios permanecen separadas. El importe usa unitPrice/totalAmount fijados al confirmar, sin depender de Consumption ni del precio actual del menú.

CHEF conserva la demanda agregada de ordinarios más extraordinarios, con ordinaryServices y ordinaryAmount separados. Incluye platillos archivados o deshabilitados y permite consultar una semana archivada que conserve pedidos confirmados. Mantiene la semana objetivo como predeterminada; las APIs de producción CHEF y resumen RH admiten weekId para comparar el mismo periodo. El selector visual histórico CHEF no se añadió en esta etapa.

Las rutas independientes CHEF y RH conservan sus permisos actuales, POST y estructura Excel. GET también descarga el mismo reporte informativo. Se mantienen las cuatro hojas, columnas, formatos y nombres de archivo existentes. La descarga se ejecuta en una transacción READ ONLY, RepeatableRead, incluyendo la consulta de extraordinarios. No actualiza payrollStatus, payrollExportedAt ni payrollExportedById. No genera un lote oficial ni acredita descuento. Repetir la descarga recalcula el estado confirmado al momento de cada consulta; no es una copia inmutable de un lote.

No se cambian la doble confirmación, las reglas de cancelación excepcional ni los permisos. Al dejar de marcar EXPORTED por una descarga informativa, descargar un reporte ya no impide por sí mismo la cancelación: los bloqueos de los estados oficiales previamente existentes siguen en la función de cancelación sin modificaciones.

## Archivos escritos en esta etapa

Producción:
- lib/food-services/confirmed-orders.ts (nuevo): consulta y normalización compartidas; sumas ordinarias en centavos.
- lib/food-services/hr-billing-service.ts: adaptador de la consulta compartida.
- lib/food-services/chef-production-service.ts: demanda ordinaria desde la misma fuente; sin ocultar platillos archivados/deshabilitados; importes ordinarios separados.
- lib/food-services/payroll-export.ts: conserva firma y cambia la descarga a operación informativa de solo lectura.
- lib/food-services/billing-export-service.ts: conserva Excel y usa el mismo cliente transaccional para extraordinarios; identifica el reporte como informativo.
- lib/food-services/extraordinary-service.ts: cliente opcional para la consulta de reportes; no cambia autorización, creación ni cancelación.
- app/api/food-services/chef/menu/route.ts: weekId opcional exclusivamente en consulta de producción.
- app/api/food-services/hr/billing/route.ts: filtro opcional weekId.
- app/api/food-services/chef/billing/export/route.ts: GET/POST informativos con guard existente.
- app/api/food-services/hr/billing/export/route.ts: GET/POST informativos con guard existente.
- components/food-services/chef-production-dashboard.tsx: importes ordinarios y aviso de reporte informativo.
- components/food-services/hr-billing-dashboard.tsx: precio confirmado en detalle, importe comprometido y aviso informativo.

Pruebas:
- tests/food-reconciliation.test.cjs (nuevo).
- tests/chef-production-presentation.test.cjs: fixture adaptado a la fuente FoodOrder.
- tests/delivery11-auth.test.cjs: GET autorizado ahora descarga; permisos sin cambios.
- tests/food-self-service.test.cjs: permite semana con pedidos confirmados aunque esté archivada.
- tests/food-order-cancellation-postgres.test.cjs: actualiza la expectativa antigua de descarga que marcaba EXPORTED. Esta integración con escrituras de fixtures no fue ejecutada en esta etapa.

Se conservaron los numerosos cambios preexistentes del árbol; esta lista no atribuye a esta etapa todo el diff contra HEAD. Los archivos se guardaron completos. No se cambió schema.prisma ni se añadieron migraciones.

## Verificación

- TypeScript: node node_modules/typescript/bin/tsc --noEmit --incremental false.
- Regresión sin base de datos: 119 aprobadas, 0 fallidas (presentación CHEF, cancelación, autorización, C-PANEL, autoservicio y guard de aislamiento).
- Conciliación: 5 aprobadas, 0 fallidas, incluyendo integración QA de solo lectura.
- Casos sintéticos: precios confirmados distintos para un mismo platillo, precio actual 99, platillo/semana archivados, disponibilidad false, presencia/ausencia de consumo, exclusión CANCELLED, extraordinarios separados, permisos y GET/POST, dos descargas con columnas e importes estables.
- Excel: carga del archivo generado con ExcelJS, cuatro hojas conservadas, columnas de detalle verificadas, control CUADRA, importes históricos y repetición de reportes verificados. No se realizó aceptación visual autenticada en navegador o Excel.
- QA real: identidad PostgreSQL comprobada 127.0.0.1:55432/yellowflex_restore_test; todas las consultas dentro de transacción READ ONLY.
- QA 2099-06-08: 2 pedidos, 2 colaboradores, 3 servicios, $75.00 en ambas consultas.
- Histórico 2026-08-24: 1 pedido, 1 colaborador, 2 servicios, $50.00 en ambas consultas.
- Dos reportes por semana con control CUADRA; pedidos, reservas, cancelaciones y permisos comparados antes/después, sin cambios. El permiso cancel-food-order del RH delegado se verificó true.
- No se ejecutaron suites que preparan datos HTTP piloto ni fixtures de escritura; no se tocaron pedidos originales QA ni Warehouse.
- Sin conexiones a Supabase, migraciones, commits ni despliegues. No se inició ni reinició la aplicación; las comprobaciones invocaron módulos de producción con el cliente QA explícito.

## Pendientes de la siguiente etapa

- Lotes oficiales inmutables, idempotencia y prevención de doble inclusión de pedidos en lotes oficiales.
- Conciliación de resultados efectivos con nómina, referencias, diferencias y ajustes controlados.
- Revisión explícita de históricos UNVERIFIED; no se convirtieron automáticamente a PENDING ni EXPORTED.
- Validación y tratamiento de inconsistencias históricas entre itemCount, reservas y totalAmount. El Excel conserva su control CUADRA/REVISAR, sin introducir aquí un workflow nuevo de ajuste.
- Aceptación visual de CHEF/RH y archivos informativos por el responsable de negocio.

No se desarrollaron entrega física, consumos, escáner, PIN de entrega, horarios, expediente digital ni inventario de consumibles.
