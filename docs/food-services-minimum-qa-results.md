# Food Services: flujo mínimo operativo y validación QA

Fecha: 2026-11-06. Continuación de food-services-functional-audit.md; sin reconstrucción de módulos.

## Resultado

El flujo mínimo CHEF → publicación → consulta de colaborador → selección → confirmación → demanda CHEF se ejecutó mediante HTTP real contra Next.js QA y PostgreSQL local, sin Storage externo.

- Base comprobada: 127.0.0.1:55432/yellowflex_restore_test. Ambas variables efectivas de Prisma son locales; no se editaron variables persistentes ni archivos .env de Supabase.
- Referencia ficticia de Food Services: 2099-06-05T18:00:00.000Z (viernes a las 12:00 en México); semana publicada: 2099-06-08. El reloj del sistema, las sesiones y las marcas de auditoría conservan su tiempo real.
- Menú nuevo con dos platillos QA, de desayuno y comida del lunes. Un colaborador ficticio confirmó un servicio por 25.00; el tablero del CHEF mostró un confirmado.
- El colaborador usado no tiene concesiones Food Services en C-PANEL y no necesitó PIN ni sesión de comedor adicional.
- Los menús restaurados se compararon antes/después mediante hash de datos y permanecieron idénticos.
- Los cuatro empleados ficticios se vincularon a T1 del catálogo único de RH. No se creó catálogo ni turno duplicado.
- Cero consumos QA registrados. No se implementaron captura de consumos ni cancelación de pedidos confirmados.

## Reglas y cambios

1. El autoservicio deriva User de la sesión corporativa y Employee activo de corporateUserId en RH. No acepta employeeId, foodOrderId ni fecha de referencia del cliente. Las consultas y escrituras usan esa misma identidad.
2. La consulta y gestión de la selección propia no requieren permisos C-PANEL. CHEF, RH administrativo, facturación/exportaciones y acceso especializado mantienen sus guards anteriores.
3. Sin turno activo/reconocido, GET menú y GET solicitudes siguen respondiendo; la respuesta incluye canRequest=false y un aviso RH. La interfaz muestra los platos/solicitudes y deshabilita la acción; el POST también rechaza la solicitud. El turno no se inventa desde la interfaz.
4. GET del editor devuelve el borrador existente o una vista previa virtual de siete días. Solo PUT guarda/crea el borrador y POST publica. La lectura de sesiones expiradas tampoco borra registros; el cierre/limpieza sigue siendo una acción explícita.
5. El tablero CHEF consulta la misma semana objetivo que el colaborador, evitando que una publicación posterior o el historial desplace la demanda pertinente.
6. La referencia QA solo se lee del entorno privado del servidor. Se rechaza en NODE_ENV=production, sin marca de aislamiento o si DATABASE_URL/DIRECT_URL no coinciden con la conexión exclusiva al destino local fijo. El launcher verifica la identidad SQL antes de habilitarla. Ninguna petición puede cambiarla.
7. El acceso corporativo al portal ya no exige el puente de sesión PIN. Los componentes/APIs PIN heredados permanecen separados; no se utilizan para autorizar solicitudes propias ni para cambiar su identidad.
8. La tarjeta de registro de consumo se retiró del índice operativo. El endpoint heredado no se amplió y la pantalla preparatoria no se presenta como una captura habilitada.

## Rutas funcionales

| Función | Página / API | Requisito |
|---|---|---|
| Entrada | /modules/food-services | Colaborador RH activo o acceso especializado autorizado |
| Mi menú y mis solicitudes | /modules/food-services/employee | Sesión corporativa definitiva + Employee activo; sin C-PANEL adicional |
| Menús publicados | GET /api/food-services/menu | Mismo autoservicio, o consulta especializada autorizada |
| Consultar selección propia | GET /api/food-services/reservations | Identidad corporativa/RH; permite turno pendiente |
| Guardar selección propia | POST /api/food-services/reservations | Identidad propia; turno activo reconocido; ventana y menú objetivo publicado |
| Confirmar selección propia | POST /api/food-services/reservations/confirm | Mismos requisitos; transacción y protección de duplicados |
| Editor CHEF | /modules/food-services/chef y GET /api/food-services/chef/menu | CHEF + view, o ADMIN; GET no escribe |
| Guardar/publicar CHEF | PUT/POST /api/food-services/chef/menu | CHEF + view/operate, o ADMIN |
| Demanda CHEF | GET /api/food-services/chef/menu?view=production | CHEF + view, o ADMIN |
| Administración RH | /modules/food-services/hr y sus APIs | ADMIN o RH + view/manage explícitos |
| Exportación CHEF | /api/food-services/chef/billing/export | Mantiene view/audit + CHEF o excepción ADMIN |

## Pruebas ejecutadas

- Regresión general: 122 aprobadas, 0 fallidas, 0 omitidas, incluidas las integraciones PostgreSQL de Warehouse.
- Prueba HTTP Food Services: 11 aprobadas (1 contenedora y 10 subcasos), 0 fallidas, 0 omitidas. Usa fetch real a http://127.0.0.1:3100 y sesiones corporativas QA persistidas. Las sesiones de prueba se eliminaron al finalizar; no se modificaron contraseñas existentes.
- Comprobaciones específicas posteriores de autoservicio/autorización: 84 aprobadas; son repetición de parte de la regresión, no casos adicionales para sumar.
- TypeScript: npx tsc --noEmit aprobado. git diff --check sin errores de whitespace.
- Verificación final READ ONLY: menú QA PUBLISHED, 1 servicio confirmado en la demanda, 4 asignaciones RH T1 y 0 consumos.

Los diez subcasos HTTP verificaron: GET sin escrituras y fecha controlada; denegación al editor y semana arbitraria; guardar/publicar QA; lectura sin C-PANEL/PIN; lectura sin turno y escritura rechazada; selección provisional invisible al CHEF; suplantación/fechas rechazadas y GET acotado al propietario; confirmación única visible al CHEF y otro empleado sin pedidos ajenos; protección de RH/exportación y logout; integridad de restaurados y ausencia de consumos/catalogación duplicada.

No repetir la prueba de publicación sobre la misma semana ya publicada: el test y el preparador rechazan sobrescribir fixtures existentes. Para una corrida futura debe acordarse una nueva referencia ficticia de servidor y comprobarse que no colisiona con datos existentes.

## Estado listo para navegador

Servidor QA activo: http://127.0.0.1:3100. Launcher de esta ejecución: PID 38096. Storage y telemetría externos deshabilitados. Los seis perfiles existentes conservan sus credenciales; no se imprimieron ni restablecieron.

La configuración ficticia queda en data/qa-food-reference.json. El resultado del escenario queda en data/qa-food-e2e-result.json. El manifiesto de perfiles y ubicación local de credenciales sigue en data/qa-pilot-local-manifest.json. data/ está ignorado por Git y no contiene nuevas contraseñas.

Secuencia manual breve:

1. Entrar con QA Warehouse (sin permisos Food Services) o QA Producción y abrir /modules/food-services/employee. Debe verse la semana 8 de junio de 2099, el turno RH T1 y los platos QA-FOOD. No debe pedir PIN ni concesión C-PANEL.
2. Elegir un alimento y pulsar Revisar y confirmar mi pedido. Volver al diálogo permite revisar; confirmar el segundo paso crea el pedido. La cuenta QA administrativa ya tiene un pedido confirmado del escenario automático y sirve para comprobar el estado bloqueado.
3. En otra sesión de navegador, entrar como CHEF y abrir su demanda; actualizar y comprobar la nueva cantidad. El editor muestra la siguiente semana editable; el menú ya publicado se encuentra en el historial. Para crear otro menú, Guardar borrador antes de Publicar semana y utilizar exclusivamente semanas/platos ficticios autorizados.
4. Con un perfil sin permisos especializados intentar administración RH/exportación/edición CHEF: deben denegarse. Las solicitudes de otro empleado no deben aparecer.
5. En un caso controlado QA, dejar temporalmente sin turno a un empleado ficticio mediante RH: debe poder consultar y ver el aviso; intentar solicitar por API debe dar 409. Restaurar su turno RH al terminar.
6. Cerrar sesión corporativa y volver a consultar solicitudes: debe requerir login. La sesión PIN heredada no autoriza el nuevo autoservicio corporativo.

## Pendientes y límites

- Falta aceptación visual/interactiva en navegador de los formularios y diálogos; la prueba ejecutada sí cubre HTTP real, permisos, persistencia y demanda, pero no clics de navegador.
- Cancelación de pedidos confirmados y captura/escáner de consumos permanecen fuera de alcance y no se consideran operativos.
- Storage de documentos continúa deshabilitado. No se usó Supabase, no se migró producción y no se hizo commit ni despliegue.
- No se modificó el menú lateral ni otros módulos. No se resembraron usuarios ni se cambiaron sus contraseñas.

## Archivos de esta intervención

Calculados contra las huellas locales al inicio de esta tarea, no contra HEAD, para distinguir cambios preexistentes.

### Existentes modificados

- `app/(platform)/modules/food-services/employee/layout.tsx`
- `app/(platform)/modules/food-services/layout.tsx`
- `app/(platform)/modules/food-services/page.tsx`
- `app/api/food-services/chef/menu/route.ts`
- `app/api/food-services/corporate-employee-access/route.ts`
- `app/api/food-services/menu/route.ts`
- `app/api/food-services/reservations/confirm/route.ts`
- `app/api/food-services/reservations/route.ts`
- `components/food-services/employee-access.tsx`
- `components/food-services/employee-portal-access.tsx`
- `lib/auth/corporate-auth.ts`
- `lib/cpanel/module-access.ts`
- `lib/food-services/calendar.ts`
- `lib/food-services/chef-production-service.ts`
- `lib/food-services/chef-service.ts`
- `lib/food-services/reservation-window.ts`
- `lib/food-services/validation.ts`
- `scripts/start-isolated-pilot.cjs`
- `tests/cpanel-authorization.test.cjs`
- `tests/helpers/isolated-auth.cjs`

- `docs/food-services-functional-audit.md` (nota de actualización; conserva el diagnóstico histórico)

### Nuevos

- `lib/food-services/reference-date.ts`
- `lib/food-services/self-service.ts`
- `scripts/prepare-food-services-qa.cjs`
- `tests/food-self-service.test.cjs`
- `tests/food-services-http-qa.test.cjs`
- `docs/food-services-minimum-qa-results.md`
