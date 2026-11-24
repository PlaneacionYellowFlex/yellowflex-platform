# Food Services: Prenómina, Bloque B (operación RH)

**Base:** Bloque A (`870734a`). Sin migraciones nuevas: el Bloque B usa las tablas, restricciones y triggers de `20261124130000_food_payroll_core`.

## Permisos C-PANEL (granulares, sin atajo ADMIN)
| Acción | Uso |
|---|---|
| `view-payroll-batches` | Historial, detalle y descarga del archivo oficial |
| `create-payroll-batch` | Búsqueda de pedidos, vista previa y generación |
| `void-payroll-batch` | Anulación antes de exportar |
| `export-payroll-batch` | Exportación oficial Excel |

Cada acción exige además el rol RH, cuenta activa sin contraseña temporal y `view` + `manage` de Food Services. Las cinco acciones de Food RH, incluida `cancel-food-order`, solo se conceden en el módulo food-services a usuarios RH y por alcance de administrador. Se aplican en la interfaz (`/api/food-services/hr/payroll/capabilities`), en cada API antes de tocar datos y de nuevo dentro de cada servicio y transacción.

## APIs (`/api/food-services/hr/payroll`)
| Método | Ruta | Acción | Notas |
|---|---|---|---|
| GET | `capabilities` | acceso RH Food | Capacidades del usuario |
| GET | `candidates?weekFrom&weekTo&employee&view` | create | Pedidos con clasificación: elegible, revisión de excolaborador o excluido con motivo, y lote activo |
| POST | `preview` | create | Solo lectura; token firmado |
| POST | `batches` | create | `Idempotency-Key` obligatorio. 201 nuevo, 200 reintento |
| GET | `batches?status&reference` | view | Historial sin contenido del archivo |
| GET | `batches/[id]` | view | Detalle: snapshots, servicios, asignaciones, historial auditable |
| POST | `batches/[id]/void` | void | `{ reason }`, 5 a 500 caracteres |
| POST | `batches/[id]/export` | export | `{ externalReference? }`. Una sola vez |
| GET | `batches/[id]/export` | view | Descarga los bytes registrados, con el encabezado `X-File-SHA256` |

Los errores de prenómina responden `{ error, code, details }` con códigos estables: `PREVIEW_STALE`, `PREVIEW_EXPIRED`, `ACTIVE_ASSIGNMENT_EXISTS`, `BATCH_ALREADY_EXPORTED`, `BATCH_ALREADY_VOIDED`, `IDEMPOTENCY_KEY_REUSED`, etc.

## Reglas operativas
- **Anulación** (`GENERATED → VOIDED`):
  - Bloquea los pedidos en orden y después el lote.
  - Libera todas las asignaciones `ACTIVE → RELEASED` en la misma transacción, con actor y motivo, y registra `BATCH_VOIDED` y `ASSIGNMENT_RELEASED`.
  - Los pedidos vuelven a ser elegibles.
  - Un lote exportado no se anula: se corrige con conciliación y ajuste (Bloque C).
- **Exportación oficial** (`GENERATED → EXPORTED`):
  - Bloquea el lote y genera un Excel con tres hojas (Prenomina, Servicios, Control).
  - Guarda los bytes, el nombre del archivo, el SHA-256, el actor y la referencia externa, y registra `BATCH_EXPORTED`.
  - La segunda exportación responde 409. La descarga verifica el SHA-256 antes de entregar el archivo.
  - Exportar **no** cambia `FoodOrder.payrollStatus` ni significa que el descuento se haya aplicado; EXPORTED ≠ RECONCILED.
- **Concurrencia:** si se anula y se exporta el mismo lote al mismo tiempo, una sola operación gana. Con doble clic en exportar se registra un solo archivo. La interfaz bloquea las acciones mientras hay una en curso y reutiliza el `Idempotency-Key` en los reintentos de generación.
- **Reportes informativos:** los actuales (`/hr/billing`, `/hr/billing/export`) se conservan sin cambios y no modifican estados.

## Interfaz
`/modules/food-services/hr/payroll` (enlace desde Administración y cobros). Fondo blanco, azul corporativo `#0B3A82` y dorado `#F4B400`.
1. Selección: filtros por semana y colaborador, selección explícita y referencia libre.
2. Vista previa: totales, semanas, excolaboradores que requieren marcar la revisión de RH, excluidos con motivo y vencimiento.
3. Confirmación.
4. Historial: estado, SHA-256, detalle y acciones de exportar, descargar y anular con motivo.

Hay indicadores de procesamiento y mensajes de éxito y error.

## Configuración
`FOOD_PAYROLL_PREVIEW_SECRET` (mínimo 32 caracteres) debe estar definido en el entorno de la aplicación para usar la vista previa y la generación desde la interfaz.
