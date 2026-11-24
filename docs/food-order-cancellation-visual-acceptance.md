# Aceptación visual de cancelación excepcional — 10 de noviembre de 2026

Destino comprobado: `127.0.0.1:55432/yellowflex_restore_test`. Aplicación QA disponible en `http://127.0.0.1:3100`. Las dos conexiones Prisma del proceso de preparación fueron verificadas. El lanzador QA fija ambas conexiones locales y deshabilita Storage externo. Se autenticaron peticiones HTTP utilizando sesiones efímeras creadas únicamente en esa base local; esas sesiones se eliminaron al finalizar, sin cambiar contraseñas ni sesiones del navegador.

## Pedido reservado para aceptación

| Dato | Valor |
|---|---|
| Pedido | `cmwb3d0af0005kays3tzp1uts` |
| Colaborador | QA Pilot RH Delegado 819bb99d |
| Número de empleado | `QA-PILOT-RH-819bb99d` |
| Fecha de servicio | 8 de junio de 2099, semana ficticia QA |
| Turno | T1 |
| Platillo | QA-FOOD-819bb99d desayuno |
| Cantidad / importe | 1 / $25.00 |
| Pedido / reserva | CONFIRMED / ACTIVE |
| Nómina | PENDING; no exportado |
| Consumos / cancelación | Ninguno |

Se creó mediante la API existente de confirmación, reutilizando identidad RH, turno, menú y precio. No se modificaron los pedidos anteriores ni sus reservas: comparación completa de sus registros antes/después. No se modificaron permisos, menús, Warehouse ni datos históricos. Los tres servicios originales continúan confirmados. El nuevo servicio se suma a la misma semana ficticia, sin reemplazarlos.

Verificado por HTTP: Administración RH incluye el pedido; CHEF pasa de 3 servicios/2 colaboradores/2 pedidos a **4 servicios/3 colaboradores/3 pedidos**. El total esperado es $100.00: $75 previos más $25 nuevos.

RH delegado conserva `food-services/view` y `manage`, pero **no tiene** `cancel-food-order`. La API de cancelación devolvió **403 Acceso restringido** con su sesión; se usó un identificador de sondeo inexistente para no enviar una cancelación sobre los pedidos originales. La asignación sensible no se ejecutó.

## Conceder el permiso, exclusivamente con ADMIN QA

1. Iniciar sesión con la cuenta ADMIN QA habitual, sin cambiar ni compartir su contraseña.
2. Abrir `http://127.0.0.1:3100/settings/cpanel-rh?userId=cmw5ausm90002kafoyifjtrdf`.
3. Confirmar que el usuario seleccionado es **QA Pilot RH Delegado 819bb99d**. Si no aparece seleccionado, elegirlo y pulsar **Consultar permisos**.
4. Escribir el motivo: `Aceptación visual QA de cancelación excepcional`.
5. En la fila **Food Services**, marcar **Cancelar pedido Food** (`cancel-food-order`). No cambiar otros permisos. El cambio se guarda inmediatamente al marcar la casilla.
6. Verificar **Permiso actualizado y cambio registrado en auditoría** y la nueva entrada de concesión. RH delegado no puede concederse este permiso.

## Cancelación manual pendiente

1. En otra sesión/perfil del navegador, iniciar sesión como QA RH delegado.
2. Abrir o actualizar `http://127.0.0.1:3100/modules/food-services/hr`.
3. En **Cancelación excepcional de pedidos**, localizar **QA Pilot RH Delegado 819bb99d**, semana del 08/06/2099, **1 servicio**, estado **Confirmado**. El ID de referencia es el de esta ficha; no se muestra innecesariamente en la tarjeta.
4. Pulsar **Cancelar pedido**, escribir un motivo de al menos cinco caracteres y revisar el diálogo. Solo el responsable de aceptación debe pulsar **Confirmar cancelación**. Este paso NO fue ejecutado por el agente.
5. Verificar responsable, fecha, motivo y transición; actualizar CHEF en `http://127.0.0.1:3100/modules/food-services/chef`. Debe volver a **3 servicios/2 colaboradores/2 pedidos**, conservando los tres servicios originales.
6. Con la cuenta RH delegado como colaborador, abrir `http://127.0.0.1:3100/modules/food-services/employee`: debe mostrar **Pedido cancelado por RH**, motivo y selección bloqueada, sin reactivación.

No exportar nómina antes de esta prueba: la exportación bloquearía la cancelación simple. Los pedidos anteriores con nómina UNVERIFIED deben permanecer intactos.

## Revocar el permiso después

1. Volver con ADMIN QA a la misma URL de C-PANEL y al mismo usuario.
2. Escribir `Fin de aceptación visual QA; revocar cancelación excepcional`.
3. Desmarcar únicamente **Food Services → Cancelar pedido Food**. Esperar confirmación y comprobar la entrada de revocación en auditoría.
4. Actualizar Administración RH: no debe ofrecer la acción. Una pestaña abierta anteriormente tampoco puede autorizarla; la API revalida el permiso.

## Bloqueo imprescindible corregido

La primera confirmación del pedido devolvió 500 por Prisma P2010: `pg_advisory_xact_lock` devuelve una columna `void` que Prisma no puede deserializar. No creó un pedido parcial. Se corrigieron únicamente las dos consultas de bloqueo de `lib/food-services/service.ts` para seleccionar `1 AS locked` desde la misma función, conservando el bloqueo. Se amplió `tests/food-order-cancellation-postgres.test.cjs` para ejecutar la confirmación real, además de las pruebas existentes.

TypeScript pasó y la integración PostgreSQL con fixtures desechables de otra semana pasó; esos fixtures se limpiaron antes de crear este pedido reservado. No se ejecutaron migraciones, commits ni despliegues.

Evidencia estructurada local sin credenciales: `data/qa-cancellation-visual-result.json`.
