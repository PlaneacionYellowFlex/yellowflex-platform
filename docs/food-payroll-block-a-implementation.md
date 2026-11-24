# Food Services — Prenómina, Bloque A: implementación

**Estado:** implementado en `feature/yf002-food-payroll`. Validado en PostgreSQL aislado (`yellowflex_restore_test`). Sin APIs ni interfaz: eso corresponde al Bloque B.
**Base:** `food-payroll-block1-database-constraints.md` y `food-payroll-block2-design.md`, con los deltas Δ1–Δ10 de YF-002.

## Modelo y migración `20261124130000_food_payroll_core`
- `FoodPayrollBatch` ya no tiene semana ni periodo fijo. Lleva `payrollReference`: texto libre de RH, de 1 a 40 caracteres, sin formato ni calendario. Para idempotencia guarda `idempotencyKey`, `idempotencyRequestHash`, `idempotencyResponse` (jsonb) y `contractVersion`; además `previewDigest`, totales en centavos exactos (`Decimal`) y los metadatos de exportación y anulación que usará el Bloque B.
- `FoodPayrollBatchItem` es el snapshot por pedido. Conserva su **propia** `serviceWeekStart`/`menuWeekId`, así que un lote puede incluir pedidos de varias semanas. Guarda el precio histórico (`FoodOrder.unitPrice`), la identidad del colaborador, departamento y turno, `employeeStatusSnapshot`, `inactiveEmployeeReviewed` y la huella del pedido.
- `FoodPayrollBatchItemService` guarda un snapshot por reserva: fecha, tipo y nombre del servicio.
- `FoodPayrollAssignment` tiene un índice único parcial `FoodPayrollAssignment_one_active_per_order`, que garantiza a nivel PostgreSQL que no haya cargos duplicados.
- `FoodPayrollAuditEvent` es el historial append-only: `BATCH_CREATED`, `BATCH_REPLAYED`, `BATCH_REJECTED`, y las acciones del Bloque B y C.
- **CHECK:** referencia, hashes, moneda, totales, coherencia de estado (generado, exportado, anulado), `committedAmount = itemCount × historicalUnitPrice`, snapshots `CONFIRMED`/`PENDING` y liberación de asignaciones.
- **Triggers:**
  - Lote: no se puede borrar. `DRAFT → GENERATED` solo si los totales cuadran con detalles, servicios y asignaciones. Después de eso los datos quedan congelados y solo se permiten las transiciones del ciclo de vida.
  - Detalles y servicios: solo se insertan en un lote `DRAFT`, deben coincidir con el pedido fuente y nunca se modifican.
  - Asignaciones: se crean solo en `DRAFT` y sobre pedidos `CONFIRMED`/`PENDING`. Solo pasan de `ACTIVE` a `RELEASED` cuando el lote está `VOIDED`.
  - `FoodOrder` y `Reservation`: un pedido con asignación activa no se cancela ni cambia su obligación.
  - Historial de auditoría: append-only.
- **Limpieza de fixtures QA:** es la única excepción a la inmutabilidad. Exige las tres condiciones a la vez: `SET LOCAL yellowflex.qa_fixture_cleanup = 'on'`, que la base sea `yellowflex_restore_test` y que la referencia empiece con `QA-FIXTURE-%`. En cualquier otra base de datos es imposible.

## Servicios
- `lib/food-services/order-lock.ts` es el mecanismo único de bloqueo (`FOR UPDATE`, ordenado por id). Lo comparten la cancelación y la generación.
- `lib/food-services/payroll-batch-contract.ts` es puro: centavos, JSON canónico, huella del pedido, token HMAC de vista previa (actor, referencia, huellas, expiración de 10 min), digest de selección y huella de idempotencia (actor, versión, selección ordenada, excolaboradores revisados, referencia y digest).
- `lib/food-services/payroll-batch-service.ts`:
  - `previewFoodPayrollBatch` es de solo lectura (`READ ONLY`). Devuelve elegibles, excluidos con motivos, excolaboradores que requieren revisión, semanas, totales y token.
  - `createFoodPayrollBatch` primero resuelve el replay idempotente (incluso con el token ya expirado). Después valida token, actor, referencia y selección, y abre una transacción:
    1. Revalida permisos.
    2. Bloquea los pedidos en orden.
    3. Revalida elegibilidad y huellas (`PREVIEW_STALE`).
    4. Crea snapshots, servicios y asignaciones, y pasa el lote a `GENERATED` con la respuesta persistida.
    5. Registra la auditoría.

    Cualquier error revierte todo. Las violaciones de unicidad se resuelven como replay o como `409 ACTIVE_ASSIGNMENT_EXISTS`.
- **Permiso C-PANEL** `food-services/create-payroll-batch`: exige rol RH y además `view` y `manage`. ADMIN **no** obtiene acceso implícito. La API de permisos lo trata como acción exclusiva de Food Services y de RH, igual que `cancel-food-order`.
- **Excolaboradores:** si el único motivo es `EMPLOYEE_INACTIVE`, el pedido no se excluye. Pasa a `requiresReview` y solo entra al lote si RH lo marca en `reviewedInactiveOrderIds`. Los pedidos `UNVERIFIED` nunca se incluyen.
- Generar un lote **no** cambia `FoodOrder.payrollStatus`.

## Configuración
`FOOD_PAYROLL_PREVIEW_SECRET` debe tener al menos 32 caracteres y se requiere para emitir y verificar tokens. Si falta, el servicio responde 503. Las pruebas lo fijan solo dentro de su proceso. Hay que definirlo en el entorno de la aplicación antes del Bloque B.

## Pruebas
- `tests/food-payroll-batch-contract.test.cjs`: pruebas unitarias.
- `tests/food-payroll-batch-postgres.test.cjs`: PostgreSQL real, con `RUN_FOOD_PAYROLL_DB_TESTS=1` y `--require ./tests/helpers/server-only-register.cjs`.
- `scripts/apply-isolated-food-payroll.cjs`: verifica el destino, aplica solo esta migración en QA y comprueba la estructura.
