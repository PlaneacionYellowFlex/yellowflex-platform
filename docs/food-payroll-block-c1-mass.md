# Food Services: Prenómina, Bloque C1 (prenómina masiva)

**Base:** Bloque B. Sin migraciones nuevas. Reutiliza autorización, elegibilidad, persistencia, idempotencia, auditoría y las barreras de PostgreSQL de los bloques A y B.

## Objetivo
RH prepara la prenómina de todos los colaboradores de YellowFlex en minutos, sin seleccionar pedido por pedido y sin límites que omitan pedidos en silencio.

## Flujo masivo
1. **Vista previa** (`POST /api/food-services/hr/payroll/period/preview`, permiso `create-payroll-batch`). Recibe `{ payrollReference, weekFrom, weekTo }`.
   - Es de solo lectura (`READ ONLY`). Toma **todos** los pedidos `CONFIRMED` cuyas semanas de servicio caen en el periodo, sin tope de cantidad; la carga se hace en bloques de 1,000.
   - Devuelve colaboradores únicos, pedidos, servicios, importe y el descuento agrupado por número de empleado.
   - **Solo enumera excepciones:** excolaboradores que requieren revisión de RH y pedidos que requieren atención, como UNVERIFIED o importes inconsistentes. Los pedidos ya procesados o asignados solo se cuentan.
   - El token firmado no lista los pedidos. Fija periodo, referencia, actor, expiración, conteos, excepciones y un digest SHA-256 de todas las huellas elegibles.
2. **Generación** (`POST /api/food-services/hr/payroll/period/batches`, con `Idempotency-Key`). Recibe `{ payrollReference, weekFrom, weekTo, reviewedInactiveOrderIds, previewToken }`.
   - Dentro de una sola transacción:
     - bloquea en orden por id **todos** los pedidos confirmados del periodo (el mismo mecanismo que la cancelación y la anulación);
     - vuelve a clasificar y exige el mismo digest y los mismos conteos que la vista previa;
     - inserta snapshots, servicios y asignaciones en bloques.
   - Un pedido nuevo, cancelado o modificado después de la vista previa produce `PREVIEW_STALE`. Nunca se incluye ni se omite en silencio.
   - Un periodo sin elegibles responde `NOTHING_TO_GENERATE`. Un reintento con la misma clave devuelve 200 con la misma respuesta. Una clave usada con otra solicitud responde 409.
   - Dos generaciones simultáneas del mismo periodo producen un solo lote.

## Consulta individual (opcional)
`GET …/candidates` ahora pagina con total exacto (`total`, `page`, `pages`). Los filtros por colaborador y semana quedan como herramienta de consulta y para lotes de casos puntuales. La selección explícita del Bloque B se conserva.

## Excel oficial
La primera hoja, **"Descuentos por colaborador"**, tiene un renglón por número de empleado con pedidos, servicios, semanas y descuento total, más el renglón TOTAL. Si el agrupado no cuadra con el total del lote, no se exporta. Le siguen las hojas de detalle Prenomina, Servicios y Control.

## Detalle del lote
Se pagina en bloques de 200 renglones con total exacto; el Excel oficial siempre incluye todos los renglones.

## Navegación
En **Food Services** hay una tarjeta **Prenómina**, visible para RH con acceso de administración. La migaja de pan muestra "Food Services › Prenómina", y también se llega desde Administración y cobros.

## Rendimiento (QA aislado en Linux, PostgreSQL 16)
- 625 pedidos de 232 colaboradores: vista previa en 0.1 s y generación en 0.8 s.
- 4,907 pedidos de 1,802 colaboradores: vista previa en 0.5 s y generación en 12.2 s.
