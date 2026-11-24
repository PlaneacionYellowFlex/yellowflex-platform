# Food Services Etapa 2 — Bloque 1.1: restricciones pendientes

Este documento describe protección pendiente para la futura migración. Ningún SQL aquí fue aplicado ni probado en PostgreSQL. No ejecutar hasta preparar una migración revisada y validar los datos existentes.

## Nombres y tipos comprobados en el esquema

El `schema.prisma` actual no usa `@@map`/`@map` en estos modelos, por lo que Prisma usa los nombres físicos `"FoodPayrollAssignment"`, `"FoodPayrollBatchItem"`, `"FoodPayrollBatch"`, `"FoodPayrollReconciliation"`, `"FoodPayrollReconciliationItem"` y `"FoodPayrollAdjustment"`; sus campos conservan el nombre Prisma (por ejemplo, `orderId`, `batchItemId`, `status`). Los enums reales incluyen `FoodPayrollAssignmentStatus.ACTIVE`, `FoodPayrollBatchStatus.DRAFT/GENERATED/EXPORTED/PARTIALLY_RECONCILED/RECONCILED/VOIDED`, y los estados de conciliación y ajuste definidos en el schema.

El schema define las relaciones compuestas necesarias:

- Asignación → detalle por `(batchItemId, orderId, batchId)` y la referencia directa `orderId` → `FoodOrder.id`.
- Detalle → lote por `(batchId, serviceWeekStart, payrollPeriod)`.
- Línea de conciliación → conciliación y detalle usando `batchId` en ambas relaciones.

Las claves candidatas compuestas están declaradas en `FoodPayrollBatchItem` y `FoodPayrollReconciliation`. No se inventan nombres de constraints Prisma: cualquier SQL para crear o reemplazar FKs debe partir del DDL real generado/revisado en la futura etapa. Estas FKs no sustituyen la unicidad parcial siguiente.

## Una sola asignación activa por pedido

Prisma no expresa un índice único parcial. Añadir en PostgreSQL:

```sql
CREATE UNIQUE INDEX "FoodPayrollAssignment_one_active_per_order"
ON "FoodPayrollAssignment" ("orderId")
WHERE "status" = 'ACTIVE'::"FoodPayrollAssignmentStatus";
```

El nombre del índice es explícito y elegido por esta propuesta; no es un nombre generado por Prisma. La columna enum y su valor se verificaron contra el esquema actual. Antes de aplicar, detectar duplicados:

```sql
SELECT "orderId", count(*)
FROM "FoodPayrollAssignment"
WHERE "status" = 'ACTIVE'::"FoodPayrollAssignmentStatus"
GROUP BY "orderId"
HAVING count(*) > 1;
```

El servicio creador futuro deberá abrir una transacción, bloquear primero la fila de `FoodOrder` (`SELECT ... FOR UPDATE`), releer elegibilidad y crear lote/detalle/asignación antes de confirmar. Capturará Prisma `P2002`/PostgreSQL `23505` para este índice como conflicto de asignación, revertirá la transacción completa y devolverá conflicto de negocio; no reintentará el lote sin volver a evaluar. El índice es la barrera final ante carreras y escritores que no respeten el bloqueo de aplicación.

La cancelación usa el mismo bloqueo antes de consultar asignaciones activas. Los escritores de nómina deben respetar el orden `FoodOrder` primero y después los registros de lote/asignación; no deben tomar primero bloqueos de lote y luego bloquear pedidos. Esta regla reduce riesgo de interbloqueo entre cancelación y generación.

## Snapshots y estados

Al pasar de `DRAFT` a `GENERATED`, quedan congelados:

- En `FoodPayrollBatch`: semana de servicio, periodo de nómina, moneda, conteos y total comprometido, creador/fecha de generación y contenido de cada archivo/exportación generado. Los metadatos de exportación se establecen al exportar; no reemplazan el archivo histórico.
- En `FoodPayrollBatchItem`: pedido, empleado, número/nombre y snapshots de departamento/turno, semana/periodo, estados de origen, fecha de confirmación, cantidad, precio histórico e importe comprometido.
- En una asignación: pedido, lote, detalle e instante de asignación. Su única transición prevista es `ACTIVE` → `RELEASED`, con actor, fecha y motivo requeridos; no se borra ni se reactiva la misma fila.

El diseño deberá rechazar `UPDATE`/`DELETE` de detalles cuando el lote ya no sea `DRAFT`, y cambios de identidad/periodo/moneda/conteos/importes del lote después de `DRAFT`. También deberá impedir borrar lotes no borrables por política y validar transiciones permitidas. La implementación debe consultar el estado del lote y comparar `OLD`/`NEW` campo por campo; no basta con bloquear todas las actualizaciones porque exportación, conciliación y anulación tienen metadatos propios.

**Decisión funcional pendiente:** si un lote generado pero aún no exportado puede anularse y liberar asignaciones; y si luego se permite crear un lote sustituto. Hasta decidirlo, no definir una transición que libere asignaciones ni permitir mutaciones de snapshots. La liberación deberá ser evento explícito, auditado y coordinado con la unicidad parcial.

## Conciliaciones y ajustes

Una conciliación recibida y sus líneas son evidencia histórica: no deben actualizarse ni eliminarse. Correcciones se agregan como una conciliación/acto posterior con referencia y motivo, sin sobrescribir montos, diferencias, evidencia, actor o fecha anteriores. `RECEIVED` → `PARTIALLY_RECONCILED` → `RECONCILED` describe avance, pero el esquema actual guarda el estado en la misma fila; no existe modelo de eventos de estado.

Los ajustes conservan su registro original y evidencia. El modelo actual tiene estados `PENDING`, `APPLIED`, `VOIDED`, pero no una tabla de eventos ni datos de actor/fecha por cada transición. **Decisión funcional pendiente:** antes de imponer append-only estricto, definir cómo auditar aprobación/aplicación/anulación y si esos estados se materializan en la fila o como eventos separados. No actualizar el motivo, monto, evidencia o actor originales para representar una corrección.

No se agrega aquí un trigger de conciliación/ajustes: faltan decisiones de ciclo de vida y triggers sin ese contrato podrían impedir operaciones legítimas o permitir cambios no auditados. La siguiente migración debe incorporar restricciones/funciones transaccionales acordes al contrato decidido, más pruebas PostgreSQL aisladas antes de habilitar operación.

## Aritmética y validación

Los tipos actuales son `Decimal(10,2)` para `FoodOrder.unitPrice` y precio histórico, y `Decimal(12,2)` para importes agregados/conciliados. La función TypeScript valida centavos y relación cantidad × precio, pero el futuro despliegue debe añadir `CHECK` equivalentes para cantidad positiva, importes válidos y diferencias coherentes, y exigir motivo cuando exista una diferencia. Definir con RH si deducciones negativas o reversas se representan mediante importes negativos o nuevos eventos antes de fijar restricciones de signo.

## Periodo de nómina

El esquema solo define `payrollPeriod` como `VARCHAR(40)`. El código no establece una sintaxis canónica; `2026-11-P2` es un ejemplo de prueba, no una regla funcional confirmada. Hasta que RH defina formato y calendario, aceptar cualquier valor no vacío de hasta 40 caracteres y mantenerlo separado de `serviceWeekStart`. No añadir una expresión regular que pueda excluir periodos válidos.

## Puesta en práctica futura

- Revisar DDL de Prisma y nombres de constraints existentes antes de agregar FKs; no reutilizar nombres hipotéticos.
- Detectar y resolver duplicados/inconsistencias existentes antes de crear el índice.
- Aplicar cambios solo mediante migración autorizada, con respaldo y validación QA aislada.
- Esta propuesta no crea lotes oficiales, no marca pedidos como exportados/procesados y no modifica datos históricos.
