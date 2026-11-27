# YF-003 · Almacén (Warehouse) — Arquitectura (Enterprise V2)

Rama `feature/yf003-warehouse`, base `cb42415f4e24ae0648b8670ab8618320c981f0f4` (cierre oficial YF-002). Módulo existente fortalecido; no se reconstruyó. Esta versión **sustituye** a la V1: su única migración es `20261125200000_warehouse_yf003_enterprise_v2` (la migración V1 `20261125120000_warehouse_yf003_integrity` nunca se instaló en ltflexi040 y no forma parte del paquete).

## 1. Fuente de verdad

| Concepto | Dónde vive | Regla |
|---|---|---|
| Existencia en Almacén | `InventoryMovement` (libro mayor) | Saldo(artículo, ubicación) = Σ entradas − Σ salidas. **El libro mayor es la única fuente de verdad.** |
| Existencia materializada (consulta) | `InventoryStockBalance` | Copia exacta del libro mayor por (artículo, ubicación) mantenida por disparador **en la misma transacción** de cada movimiento. Nadie más la escribe. R8 compara ambos con diferencia exacta. |
| Material bajo custodia de Producción | `InventoryCustody` + `InventoryCustodyEvent` | La entrega (`OPERATIONAL_HANDOFF`) saca la cantidad de Almacén y abre una custodia **vinculada** (`sourceMovementId`, único). La custodia no es existencia de Almacén. |
| Devolución parcial | Custodia hija (`parentCustodyId`) | La parte devuelta viaja en una custodia separada vinculada a su origen. |
| Regreso a Almacén / cancelación | `closingMovementId` (único) | El movimiento `OPERATIONAL_RETURN` que cierra la custodia queda vinculado. |
| Consumo | Evento `CONSUMED` | Solo reduce la custodia. |
| Diferencia física | `WarehouseCount` → `WarehouseDiscrepancy` (+ `WarehouseDiscrepancyEvent`) | Una diferencia no mueve inventario. |
| Ajuste | Movimiento `ADJUSTMENT_IN/OUT` (`referenceType = WAREHOUSE_DISCREPANCY`) | Solo de un expediente aprobado. |
| Corrección | Movimiento compensatorio `REVERSO` | El original nunca se modifica. |
| Inconsistencia histórica | `WarehouseReconciliationException` | Documenta (no corrige) una entrega histórica sin custodia; no crea custodias ni movimientos. |
| Catálogo | `InventoryItem`, `WarehouseLocation` + `WarehouseCatalogAudit` | Altas, ediciones e inactivaciones con usuario, motivo, antes y después. Nada se elimina. |

### Invariantes (reconciliación R1–R8, solo lectura)

- **R1** Saldo ≥ 0. **R2** Cantidad > 0 y forma válida por tipo. **R3** Por artículo: entregas − devoluciones − consumos = custodias abiertas (las entregas históricas documentadas se muestran aparte como «documentado»). **R4** Custodia abierta ⇒ cantidad > 0; cerrada ⇒ 0. **R5** Un movimiento se revierte a lo sumo una vez. **R6** Expediente REAL cerrado ⇒ aprobado y ajuste = cantidad aprobada.
- **R7 (nuevo)** Toda entrega tiene custodia vinculada (salvo excepción documentada) y toda custodia de origen tiene entrega vinculada.
- **R8 (nuevo)** Existencia materializada = libro mayor, diferencia exacta 0 en cada (artículo, ubicación).

## 2. Controles en la base de datos (migración V2, aditiva)

1. **Historiales append-only** (función `yf_append_only`): `InventoryMovement`, `InventoryCustodyEvent`, `InventoryCustodyOperation`, `WarehouseStockOperation` (registros de idempotencia), `WarehouseDiscrepancyEvent`, `WarehouseCatalogAudit`, `WarehouseReconciliationException`. Se rechaza **todo UPDATE** y **todo TRUNCATE** (también en `InventoryStockBalance`).
2. **DELETE solo de datos sintéticos de la prueba declarada**; deben cumplirse las tres condiciones a la vez:
   - base aislada: `current_database() = 'yellowflex_restore_test'` **y** puerto `55432`;
   - la sesión declara marcador(es) en `yellowflex.fixture_cleanup`, cada uno con formato `QA-` + ≥ 6 caracteres (se ignoran `on`, `*`, `%`, `QA-` a secas);
   - el registro pertenece a ese marcador: el código del artículo **o** el nombre del usuario actor empieza con el marcador.
   La variable de sesión por sí sola no elimina nada (probado: V01–V06). En producción la función devuelve cero marcadores.
3. **Existencia materializada**: disparador `InventoryMovement_stock_balance` (AFTER INSERT/DELETE) aplica el efecto en la misma transacción; en transferencias actualiza las dos filas en orden determinista (sin interbloqueos). `InventoryStockBalance_guard` rechaza cualquier escritura que no venga del disparador o de `yf_rebuild_inventory_stock_balance()` (reconstrucción controlada que verifica cero diferencias o se revierte). `yf_stock_balance_differences()` = R8.
4. `CHECK` de cantidad positiva y forma por tipo (NOT VALID para no reescribir históricos), custodia no negativa.
5. Vínculos de custodia: `sourceMovementId` (único), `closingMovementId` (único), `parentCustodyId` con llaves foráneas.
6. Tablas nuevas: `InventoryStockBalance`, `WarehouseCatalogAudit`, `WarehouseReconciliationException`, `WarehouseDiscrepancyEvent`. Índice de reportes `occurredAt/createdAt/id`.

### Privilegios efectivos (riesgo residual, documentado)

Los disparadores no protegen contra quien **es dueño de las tablas o superusuario** (puede `ALTER TABLE … DISABLE TRIGGER` o `session_replication_role = replica`). `scripts/warehouse-db-privileges.cjs` lo reporta (en el sandbox: el usuario QA es superusuario y dueño ⇒ hallazgos CRÍTICO/ALTO). Recomendación para producción (requiere decisión de infraestructura): rol de aplicación sin propiedad de tablas ni superusuario, `REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER` sobre los historiales y migraciones con un rol dueño distinto. Esta parte queda **PARCIAL** hasta que se aplique en el servidor.

## 3. Transacciones, bloqueos e idempotencia

- Transacciones `READ COMMITTED` con bloqueos consultivos jerárquicos: documento → custodia → existencias.
- **Catálogo vigente dentro de la transacción** (`assertActiveCatalog`): cada movimiento toma `FOR SHARE` sobre el artículo y sus ubicaciones/almacenes y verifica que sigan activos; la administración del catálogo toma `FOR UPDATE`. Un movimiento y una inactivación simultáneos se serializan: nunca quedan ambos aceptados ni material en un artículo o ubicación inactivos (V27–V28).
- Idempotencia universal (`runStockOperationOnce`), clave obligatoria; misma clave ⇒ misma respuesta; otro contenido ⇒ 409.
- Aritmética decimal exacta.

## 4. Consulta habitual de existencias (rendimiento)

- `GET /api/warehouse/inventory`: totales por artículo desde `InventoryStockBalance` (sin descargar cada saldo; `?include=balances` solo bajo petición).
- `GET /api/warehouse/reports/stock`: existencias por artículo y ubicación con búsqueda, filtro por artículo o ubicación, paginación por cursor estable y CSV completo.
- Kardex y reportes siguen leyendo el libro mayor (historia).
- Medición antes/después a 520,000 movimientos: ver `YF-003-ENTERPRISE-V2_RESULTADO.md`.

## 5. Permisos (C-PANEL; sin sistema paralelo)

| Capacidad | C-PANEL | Bandera operativa | Quién la administra |
|---|---|---|---|
| Consultar | view | canViewInventory | ADMIN o RH delegado |
| Operar | view + operate | canRegisterMovement | ADMIN o RH delegado |
| Investigar | view + operate | canManageWarehouse | Solo ADMIN |
| Aprobar ajustes / documentar excepciones históricas | view + approve | canApproveWarehouseAdjustments | Solo ADMIN |
| Auditar | audit | — | Solo ADMIN |
| Producción | view + operate + rol PRODUCCIÓN/DIRECCIÓN | — | ADMIN o RH delegado |
| **Administrar catálogo (nuevo)** | view + **manage-catalog** | canManageCatalog | **Solo ADMIN** (sensible; exclusiva del módulo Almacén; no se otorga por rol, tampoco a ADMIN ni Dirección) |

Nadie cambia sus propios permisos; todo cambio queda en `CorporatePermissionAudit`. La asignación real del permiso de catálogo queda pendiente de decisión de Dirección.

## 6. APIs nuevas o modificadas en V2

| Ruta | Capacidad | Notas |
|---|---|---|
| GET/POST `/api/warehouse/catalog/items` | catálogo | Búsqueda, estado, unidad, cursor; alta con motivo; código único sin distinguir mayúsculas |
| PATCH/DELETE `/api/warehouse/catalog/items/[itemId]` | catálogo | Descripción; unidad base solo sin historial; activar/inactivar protegido; el código no cambia; DELETE ⇒ 405 |
| GET/POST `/api/warehouse/catalog/locations` | catálogo | Filtros y alta por almacén |
| PATCH/DELETE `/api/warehouse/catalog/locations/[locationId]` | catálogo | Nombre; inactivar solo sin existencias, conteos ni custodias pendientes; DELETE ⇒ 405 |
| GET `/api/warehouse/catalog/history` | catálogo o auditar | Historial inmutable |
| GET `/api/warehouse/reports/stock` | consultar | Consulta habitual de existencias paginada + CSV |
| POST `/api/warehouse/reports/reconciliation/exceptions` | aprobar | Documenta una entrega histórica sin custodia (motivo ≥ 20, persona distinta de quien la registró) |
| GET `/api/warehouse/inventory` | consultar | Totales desde la existencia materializada |
| GET `/api/warehouse/reports/reconciliation` | auditar | R1–R8 + excepciones documentadas |

Scripts: `warehouse-custody-link.cjs` (diagnóstico de vínculos; `--aplicar` solo inequívocos y solo en QA aislado), `warehouse-db-privileges.cjs` (privilegios efectivos), `warehouse-volume-benchmark.cjs` (antes/después), `apply-isolated-warehouse-yf003.cjs` (migración V2 solo en QA).

## 7. Fronteras para el ERP YellowFlex

Sin cambios respecto de V1: Compras (referencia de OC en recepciones), Producción (orden en entrega/consumo), Calidad (estados de custodia), BOM/planner/IA consumen lecturas por API; consumibles de RH son un módulo independiente.
