# Food Services: diseño de datos y operación

## Modelo

`User` y `UserRole` representan identidad corporativa. `Employee` guarda número único, departamento, estatus y `pinHash`; nunca se devuelve el hash. `MenuWeek` contiene días y opciones. Una opción conserva precio, disponibilidad y archivo lógico.

`Reservation` expresa intención anticipada. `Consumption` expresa entrega efectiva: guarda `priceApplied`, momento, método de credencial y una referencia opcional a reserva. Son entidades distintas y sus restricciones de base evitan duplicados por empleado/opción.

`FoodAccessSession` guarda únicamente el hash de un token aleatorio de sesión de empleado, con caducidad. El token original vive como cookie HttpOnly con `SameSite=Lax`.

## Seguridad

- Zod valida entradas en Route Handlers.
- bcryptjs compara PIN contra hash exclusivamente en servidor.
- Las mutaciones verifican una sesión de empleado o, para administración, deben pasar por `requireCorporateRole` al integrar OIDC/Auth.js.
- Restricciones Prisma y manejo de `P2002` impiden duplicidad por carreras concurrentes.

## Decisiones por confirmar

- Ventanas reales de servicio y política para reservas fuera de horario.
- Si un empleado puede reservar más de una opción por servicio/día (el esquema actual limita por opción, no por servicio).
- Política de cancelación y de sustitución de menú publicado.
- Proveedor de identidad corporativo y mapeo de sus grupos a roles YellowFlex.
