> Actualización: esta auditoría conserva el estado histórico previo. Ver [flujo mínimo corregido y validado](food-services-minimum-qa-results.md).

# Food Services — auditoría funcional de lectura

Fecha: 2026-11-06. Destino SQL comprobado: 127.0.0.1:55432/yellowflex_restore_test. Las consultas se ejecutaron dentro de transacciones READ ONLY. No se modificó código, cuentas, turnos, permisos, menús, reservas, pedidos ni consumos. No se usó Storage ni se ejecutaron migraciones, commits o despliegues.

## Mapa de rutas

Base QA: http://127.0.0.1:3100.

| Función | Página | API / acción exacta |
|---|---|---|
| Entrada corporativa | /login | POST /api/auth/login; operativo por número + contraseña, administrativo/CHEF por correo + contraseña |
| Índice Food Services | /modules/food-services | Tarjetas filtradas por rol, Employee y permisos |
| CHEF: editor, guardar y publicar | /modules/food-services/chef | GET /api/food-services/chef/menu obtiene o CREA borrador; PUT guarda; POST publica |
| CHEF: historial | Misma página | GET /api/food-services/chef/menu?view=history; últimas 5 publicadas, solo lectura |
| CHEF: demanda y pendientes | Misma página | GET /api/food-services/chef/menu?view=production; botón Actualizar; consulta automática al montar, sin push |
| Colaborador: Mi menú | /modules/food-services/employee | GET /api/food-services/menu y GET /api/food-services/reservations |
| Puente sesión corporativa a comedor | Botón Continuar como colaborador | POST /api/food-services/corporate-employee-access |
| Identificación de comedor por PIN | Formulario del portal del empleado | POST /api/food-services/employee-access con employeeNumber y pin |
| Cambio de PIN | Portal del empleado | POST /api/food-services/change-pin |
| Guardar selección semanal | Botón Revisar y confirmar mi pedido | POST /api/food-services/reservations con menuItemIds; guarda antes de mostrar el diálogo |
| Confirmar definitivamente | Diálogo Confirmación 1 de 2 / 2 de 2 | POST /api/food-services/reservations/confirm |
| Registrar consumo/entrega | /modules/food-services/consumption | La página es preparatoria. POST /api/food-services/consumptions existe, pero ningún componente invoca ese endpoint |
| Administración RH y extraordinarios | /modules/food-services/hr | GET /api/food-services/hr/billing; GET/POST/PATCH /api/food-services/hr/extraordinary |
| Exportación | CHEF / RH | GET /api/food-services/chef/billing/export?weekId=... y /api/food-services/hr/billing/export?weekId=... |

Advertencia funcional: entrar al editor CHEF puede escribir un borrador mediante GET. No se abrió esa ruta ni se invocó ese GET durante esta auditoría.

## Matriz de estado

IMPLEMENTADO significa localizado en código. VALIDADO identifica lo observado en la ejecución descrita, no una prueba integral implícita.

| Capacidad | Estado | Evidencia y límite |
|---|---|---|
| Identidad y aislamiento de SQL QA | VALIDADO | Base/host/puerto exactos; READ ONLY=on |
| Permisos efectivos Food Services de seis perfiles | VALIDADO | Se ejecutaron los guards de consulta con datos reales QA, sin crear sesiones |
| Crear, guardar y publicar menú CHEF | IMPLEMENTADO / BLOQUEADO para prueba ficticia | Usa próxima semana editable del reloj real; no se ejecutó publicación |
| Consultar publicados | VALIDADO en backend | getPublishedMenu devolvió 3 semanas de agosto; no significa que el empleado vea una semana utilizable hoy |
| Menú utilizable para el colaborador QA | BLOQUEADO | No está publicado el 2026-11-09 y los cuatro empleados QA carecen de turno |
| Guardar selección y confirmar pedido | IMPLEMENTADO / BLOQUEADO | Ventana, turno, semana publicada y permisos son requisitos; no se escribieron pedidos |
| Demanda del CHEF | VALIDADO solo lectura | Resumen devuelve 2 servicios confirmados del respaldo para 2026-08-24; cero solicitudes nuevas QA |
| Retirar selección antes de confirmar | IMPLEMENTADO | Guardar nueva lista elimina reservas no seleccionadas; no se ejecutó modificación |
| Cancelar pedido ya confirmado | NO IMPLEMENTADO | FoodOrderStatus solo CONFIRMED; no hay endpoint/botón de cancelación o reapertura |
| Cancelar extraordinario RH | IMPLEMENTADO | PATCH marca CANCELLED con cancelledAt; función separada de los pedidos de empleados |
| Consumo/entrega por API | IMPLEMENTADO PARCIALMENTE | Existe registro y protección de duplicados, pero faltan controles de negocio descritos abajo; no se probó escritura |
| Captura operativa/escáner de entrega | NO IMPLEMENTADO | Pantalla informativa; QR/BARCODE/NFC son valores del modelo, no dispositivos integrados |
| Prueba integral CHEF → empleado → CHEF → entrega | BLOQUEADO | No se cumplen preparación de turno, semana ficticia y captura operativa |

## Resultado de las lecturas QA

A las 14:26, America/Mexico_City, del viernes 6 de noviembre de 2026:

- Ventana de reserva abierta. Semana objetivo del empleado y primera editable CHEF: 2026-11-09.
- No existe menú para esa semana. No se creó.
- Publicados existentes: 2026-08-10 (2 platillos), 2026-08-17 (14) y 2026-08-24 (2).
- El resumen CHEF toma el último publicado por weekStart, 2026-08-24: 2 servicios confirmados, 0 consumidos, 2 pendientes. Son datos restaurados; no se usaron como fixtures de escritura.
- Los cuatro empleados QA vinculados tienen workShift=NULL. El catálogo contiene T1/T2/T3/T4 activos y con horarios reconocibles, pero no están asignados a esos empleados.
- Los seis perfiles tienen passwordMustChange=false al consultar. No se cambió ninguna contraseña en esta auditoría.
- Actividad de empleados QA: 0 reservas, 0 pedidos, 0 consumos. Por tanto no existe evidencia de una solicitud QA entregada al CHEF.
- Se ejecutó el GET productivo de reservas con identidad del empleado QA proporcionada en el contexto de prueba y DB real de solo lectura: 409, El colaborador no tiene un turno activo configurado para Food Services. No fue una sesión HTTP real ni se creó una para la prueba.

## Relación de datos y reglas

MenuWeek tiene weekStart único, estado DRAFT/PUBLISHED/ARCHIVED y hasta 7 MenuDay por fecha. Cada MenuDay contiene MenuItem con BREAKFAST/LUNCH, nombre, descripción, disponibilidad, archivo y precio. El editor admite como máximo un desayuno y una comida por día, 14 servicios semanales, y permite días sin servicio. El precio de negocio actual es 25.00 por servicio.

Employee se relaciona con Department, WorkShift y opcionalmente User. La selección se filtra por turno: T1/T2 trabajan lunes-jueves; T3/T4 jueves-domingo. Horario diurno 07:00-19:00 permite desayuno y comida; nocturno 19:00-07:00 permite solo LUNCH, mostrado como alimento de turno. El código del turno debe pertenecer a T1/T2/T3/T4; crear un código QA-T1 no habilitaría esa política.

Reservation vincula Employee y MenuItem con unicidad por ambos, ACTIVE/CANCELLED y FoodOrder opcional. Guardar selección crea reservas provisionales sin FoodOrder y elimina las desmarcadas dentro de la ventana. Confirmar crea FoodOrder CONFIRMED único por empleado/semana, fija cantidad/precio/total y vuelve a crear sus reservas vinculadas dentro de una transacción. Se bloquean nuevas modificaciones y confirmaciones duplicadas.

Consumption vincula empleado, platillo y reserva, registra hora, precio aplicado y tipo de credencial. Sus restricciones únicas impiden una segunda entrega de la misma reserva/platillo/empleado. Es independiente de la reserva: reservar no equivale a recibir el alimento.

El CHEF no recibe una notificación externa. Su dashboard consulta reservas ACTIVE cuyo FoodOrder sea CONFIRMED, agrega cantidades por día, servicio, departamento y turno, y cuenta consumos vinculados. Las selecciones guardadas pero no confirmadas NO llegan a la demanda CHEF. Es necesario montar/actualizar el dashboard para refrescarlo.

## Autenticación y restricciones C-PANEL

La página está dentro del layout corporativo: hace falta sesión yellowflex_corporate_session, User activo, contraseña definitiva y permiso view de Food Services. La subpágina de empleado exige además Employee vinculado.

Con sesión corporativa, Continuar como colaborador obtiene el Employee vinculado y crea la sesión yf_food_access, de 30 minutos por defecto. No necesita pedir PIN adicional en ese camino. Alternativamente la API de PIN verifica número de empleado y PIN y crea la misma sesión de comedor. Las reservas usan yf_food_access: la sesión corporativa por sí sola no sustituye ese paso.

La API de PIN ya no es una vía independiente para un empleado sin User: createEmployeeSession exige User vinculado activo, contraseña definitiva y view. El portal tampoco puede abrirse anónimamente para llegar al formulario PIN, porque primero aplican los layouts corporativos. Esto restringe el flujo histórico de PIN autónomo; debe definirse si el producto quiere conservarlo. El formulario todavía existe, pero no constituye una entrada pública operativa.

| Acción | Requisitos efectivos |
|---|---|
| Editor y publicación CHEF | CHEF + view + operate; ADMIN conserva excepción; no requiere Employee |
| Historia y demanda CHEF | CHEF + view; ADMIN conserva excepción |
| Lectura del colaborador | User/Employee activos, contraseña definitiva, view y sesión de comedor para sus reservas; turno activo reconocido |
| Guardar/confirmar/registrar consumo | Requisitos anteriores + operate; reservas/confirmaciones además ventana y próxima semana publicada |
| Cambiar PIN | Sesión de comedor y view; la interfaz pide sustituir el PIN temporal |
| Administración RH | ADMIN o RH con view + manage explícitos; manage no concede operate automáticamente |
| Exportación CHEF | CHEF + view + audit, o ADMIN |

Permisos observados en QA: CHEF tiene view/operate y no audit/manage; Producción tiene view/operate; RH tiene view/manage y no operate; administrativo y Warehouse no tienen Food Services; ADMIN conserva su excepción. El ADMIN QA no tiene Employee y por eso no puede usar el portal del empleado. Estas restricciones de rol/permisos no deben confundirse con el bloqueo actual de turno.

## Brechas funcionales concretas

1. **Semana y reloj no aislables por la interfaz actual.** getEditableWeekStart parte del próximo lunes real y avanza semanas ya publicadas. El empleado siempre usa exactamente el próximo lunes real. No hay selector de semana ficticia; FOOD_RESERVATION_DEV_OPEN solo abre la ventana, no cambia su fecha objetivo. Publicar hoy con las rutas existentes significaría publicar una semana real, expresamente prohibido en esta tarea. No se hizo.
2. **Desalineación potencial entre semanas.** CHEF puede avanzar a semanas posteriores al publicar, mientras el empleado solo mira la próxima. El menú API devuelve todos los publicados, pero EmployeeAccess filtra exactamente reservationState.weekStart. El resumen CHEF toma siempre el último publicado, no necesariamente la semana objetivo del empleado. Publicar otra semana no garantiza que sea visible/solicitada hoy.
3. **Turno QA incompleto.** Asignar un turno soportado al empleado ficticio es preparación de datos, no reconstrucción del módulo. Sin hacerlo, GET reservations devuelve 409 y la interfaz ni siquiera completa la carga de menú/reservas.
4. **Error de turno disimulado como problema de acceso.** EmployeeAccess atrapa cualquier error de carga inicial y conserva el formulario PIN como si no hubiera sesión. Tras Continuar como colaborador puede ofrecer PIN aunque el bloqueo real sea el turno. No se cambió el comportamiento.
5. **Entrega no operativa desde interfaz.** La tarjeta Registro de consumo lleva a un placeholder. No existe formulario ni llamada cliente a POST consumptions. Los enums QR/BARCODE/NFC no son lectores implementados.
6. **Controles de consumo incompletos.** registerConsumption exige reserva activa y menú publicado/disponible y evita duplicados, pero no comprueba que FoodOrder esté CONFIRMED ni que corresponda a fecha/horario de entrega. isWithinServiceWindow está definido y no se usa. La API usa la identidad de la sesión del empleado, no un operador que escanee otra credencial. Esto requiere una decisión de flujo antes de habilitar entregas.
7. **Cancelación definitiva ausente.** Antes de confirmar se puede desmarcar/guardar. Después de confirmar no hay cancelación/reapertura; el enum de FoodOrder solo admite CONFIRMED. Volver/Regresar en el diálogo cancela la confirmación visual, no borra automáticamente la selección guardada antes de abrirlo.
8. **Sesiones no acopladas al logout corporativo.** /api/auth/logout destruye solo la sesión corporativa. No invalida yf_food_access ni sus registros; las APIs de comedor aceptan esa sesión hasta su vencimiento, según su guard actual. Observación de código, sin prueba HTTP de logout en esta auditoría.
9. **PIN temporal: control de interfaz.** pinMustChange se devuelve a la UI, pero los servicios de guardar/confirmar no lo comprueban en servidor. No se ejecutó un intento de elusión.
10. **Atribución de publicación incompleta.** Existen publishedById/updatedById en el modelo, pero guardar/publicar no los asigna. Los tres publicados restaurados tienen publishedById=NULL. No se atribuyeron a CHEF QA.

## Evidencia de código

- lib/food-services/chef-service.ts:49,120,234,410 — semana editable, creación, guardado y publicación.
- app/api/food-services/chef/menu/route.ts — GET con efecto de creación y métodos PUT/POST.
- lib/food-services/service.ts:101,200,497,802 — consulta, selección, confirmación y consumo.
- components/food-services/employee-access.tsx:136,318,458,503 — carga conjunta, filtro de semana, guardado y confirmación.
- app/api/food-services/reservations/route.ts:75 — rechazo por turno ausente.
- lib/food-services/chef-production-service.ts:5,45 — última semana publicada y filtro CONFIRMED.
- lib/food-services/employee-session.ts:13,27,48 — validaciones y sesión PIN/comedor.
- lib/food-services/shift-policy.ts:17 — códigos/días admitidos.
- app/(platform)/modules/food-services/consumption/page.tsx — pantalla preparatoria.
- app/api/auth/logout/route.ts — solo logout corporativo.

## Decisión de esta auditoría

No se preparó ni publicó una semana y no se ejecutó una prueba de escritura integral: el flujo actual no cumple las condiciones para hacerlo sin usar semanas reales y la entrega de interfaz está incompleta. Tampoco se modificaron los menús restaurados.

Antes de modificar código se deben resolver, de forma puntual: preparación de turno del empleado QA; mecanismo acordado de reloj/semana ficticia de extremo a extremo en un proceso QA separado; decisión sobre PIN autónomo y sesiones; y alcance operativo de entrega/cancelación. El núcleo guardar-publicar-seleccionar-confirmar-consultar demanda existe, pero su operación completa todavía NO está validada. No se propone reconstruir módulos.
