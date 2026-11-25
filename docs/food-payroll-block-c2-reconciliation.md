# YF-002-C2 — Conciliación, ajustes y cierre definitivo de la prenómina de Food Services

Base: rama `feature/yf002-food-payroll`, commit C1 `cb83aa1f2e9825b44cf308352543af3cb9c83ea6`.

## Flujo operativo (Food Services → Prenómina)

1. **Lote exportado** (Bloque B). Exportar no significa descuento aplicado: el lote queda `EXPORTED` y sus pedidos siguen `PENDING`.
2. **Plantilla de conciliación**: Excel con un renglón por colaborador del lote (referencia, lote, número, nombre, pedidos, importe esperado) y la
   columna *Importe aplicado por Nómina* vacía. Descargarla no cambia estados (solo registra `CONTROL_EXPORTED`).
3. **Importación y vista previa** (solo lectura): validación estricta de estructura, referencia y lote, colaboradores desconocidos o de otro lote,
   filas duplicadas, importes inválidos (negativos, más de 2 decimales, texto, errores de fórmula), esperado alterado y **colaboradores
   ausentes**. Una fila ausente o una celda vacía **no** es descuento cero: bloquea la conciliación. El cero se captura explícitamente.
   Clasificación por colaborador: Completo, Parcial, No aplicado, Superior al esperado. Totales en centavos enteros.
   Token firmado (HMAC-SHA256, 15 min) ligado a usuario, lote, SHA-256 del archivo, digest del resultado y estado de conciliación del lote.
4. **Confirmación masiva** (una transacción): idempotente por `Idempotency-Key` + huella de la solicitud; vuelve a leer el archivo y exige el
   mismo digest (`PREVIEW_STALE` si algo cambió). Registra la conciliación con el archivo original como evidencia (bytes + SHA-256), el resultado
   inmutable por colaborador y **un ajuste trazable por cada diferencia**. Lote → `PARTIALLY_RECONCILED` ("conciliación registrada, cierre
   pendiente"). Una sola conciliación vigente por lote (índice único parcial).
5. **Ajustes**: saldo positivo = por recuperar del colaborador; negativo = por devolver o compensar. Resoluciones: Recuperado, Corrección
   justificada o Condonado (para saldos por recuperar); Devuelto, Compensado o Corrección (para saldos por devolver). Cada resolución exige
   justificación (≥10 caracteres) y referencia (salvo condonación), registra responsable y fecha. Una resolución parcial deja un **ajuste sucesor**
   con el saldo remanente (cadena trazable). Ningún ajuste genera cargos automáticos en otro lote.
6. **Anulación de conciliación** (solo antes del cierre y sin ajustes resueltos): para un archivo equivocado. Se conserva en el historial con
   motivo; sus ajustes pendientes quedan `VOIDED`; el lote regresa a `EXPORTED`.
7. **Cierre definitivo** (`RECONCILED`): exige conciliación vigente que cubra a todos los colaboradores del lote; registra responsable, fecha y nota.
   Distingue el cierre administrativo de la liquidación económica: las diferencias pendientes siguen vigentes como ajustes.
8. **Reportes de control** (Excel, solo lectura): conciliación por colaborador, diferencias detectadas, ajustes (pendientes y resueltos) y resumen de
   cierre. No modifican el Excel oficial de C1/B ni estados financieros.

## Política de saldos (decisión técnica)

El saldo se mantiene **a nivel colaborador**. No se atribuyen pagos parciales a pedidos individuales (la tabla por pedido del Bloque A
`FoodPayrollReconciliationItem` queda bloqueada por trigger). Estado de nómina de los pedidos al cerrar:

| Situación del colaborador | `FoodOrder.payrollStatus` |
|---|---|
| Aplicado ≥ esperado (Completo o Superior) | `PROCESSED` |
| Parcial / No aplicado con saldo pendiente o condonado | `EXPORTED` (nunca `PROCESSED`) |
| Parcial / No aplicado con todo el saldo recuperado o corregido | `PROCESSED` (también si se recupera después del cierre) |

La asignación del pedido al lote permanece `ACTIVE`: un pedido con descuento parcial **no se libera** y no puede volver a cobrarse en otro lote.

## Base de datos — migración incremental `20261124180000_food_payroll_reconciliation`

- No modifica `20261124130000_food_payroll_core` (SHA-256 `c677f768…`). SHA-256 de la migración C2: `33844ad52c30edb6fb2e53ae2642d4e325254af07886643bd668e27c03eb6b6a`.
- Precondición: sin conciliaciones ni ajustes previos. Columnas de cierre del lote, columnas de conciliación/ajuste, tabla
  `FoodPayrollReconciliationEmployee`, enums de resultado/tipo/resolución, 6 valores de auditoría.
- CHECK de importes exactos y coherencia de ciclo de vida; índices únicos parciales: una conciliación vigente por lote, un ajuste raíz por
  colaborador conciliado y un solo sucesor por ajuste.
- Función `food_payroll_employee_covered` (mismo criterio que el servicio).
- Guardas: reemplazo conservador (`CREATE OR REPLACE`) de `food_payroll_batch_guard` y `food_order_payroll_assignment_guard` conservando todas las
  reglas del Bloque A; nuevas guardas de conciliación, resultado por colaborador (inmutable, esperado verificado contra snapshots), ítems por pedido
  (bloqueados) y ajustes (identidad e importes inmutables; resuelto/anulado definitivo). `EXPORTED → RECONCILED` directo ya no es posible.
- Aplicación en QA: `scripts/apply-isolated-food-payroll-c2.cjs` (verifica destino `127.0.0.1:55432/yellowflex_restore_test`, SHA-256 de ambas
  migraciones, que A esté aplicada y que solo falte C2; si ya está aplicada, solo verifica).

## Concurrencia e idempotencia

Orden de bloqueo uniforme: pedidos (id ascendente) → lote → conciliación → ajuste. Confirmaciones concurrentes: una gana, la otra
`RECONCILIATION_EXISTS`. Cierres concurrentes: uno gana, el otro `BATCH_ALREADY_RECONCILED`. Errores a mitad de transacción revierten todo.

## Permisos C-PANEL (solo Food Services, solo rol RH, sin acceso implícito de ADMIN)

| Acción | Uso |
|---|---|
| `view-payroll-reconciliations` | Consultar conciliaciones, ajustes y evidencia |
| `register-payroll-reconciliation` | Plantilla, vista previa, confirmación y anulación de conciliación |
| `manage-payroll-adjustments` | Resolver ajustes |
| `close-payroll-batch` | Cierre definitivo |
| `export-payroll-control` | Reportes de control |

Además se requieren `view` y `manage` de Food Services. Se validan en la interfaz, en cada API (antes de leer datos), en el servicio y dentro de la
transacción. CHEF no tiene acceso.

## APIs nuevas (`/api/food-services/hr/payroll/…`)

`batches/[id]/reconciliation` (GET estado paginado y filtros; POST confirmar) · `…/reconciliation/template` · `…/reconciliation/preview` ·
`…/reconciliation/void` · `…/reconciliation/evidence` · `batches/[id]/close` · `batches/[id]/control-report?type=reconciliation|differences|adjustments|summary` ·
`adjustments` (lista paginada) · `adjustments/[id]/resolve`.

## Pruebas

`tests/food-payroll-reconciliation-postgres.test.cjs` (20 escenarios obligatorios, PostgreSQL real), `tests/food-payroll-reconciliation-contract.test.cjs`
(contrato puro), `tests/food-payroll-routes.test.cjs` (autorización de las rutas nuevas). Regresiones A (15), B (11), C1 (9) y cancelación conservadas.
