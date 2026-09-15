# YellowFlex Platform

Plataforma corporativa modular construida con Next.js, TypeScript, Tailwind CSS, PostgreSQL y Prisma.

## Arquitectura

- `app/(platform)`: shell corporativo y módulos.
- `app/api/food-services`: Route Handlers con validación de entrada y controles de sesión.
- `lib/food-services`: reglas de dominio, validaciones, acceso de empleado y configuración centralizada.
- `prisma/schema.prisma`: modelo normalizado de plataforma y Food Services.

La autorización administrativa se valida en servidor. El punto de integración `requireCorporateRole` permanece cerrado hasta elegir y configurar un proveedor de identidad corporativo; no hay usuarios ni roles simulados en frontend.

## Instalación y ejecución

1. Copia `.env.example` a `.env` y configura `DATABASE_URL` para PostgreSQL.
2. Ejecuta `npm install`.
3. Genera el cliente: `npm run db:generate`.
4. Crea y aplica la primera migración: `npm run db:migrate -- --name init_food_services`.
5. Inicia el proyecto: `npm run dev`.

Comprobaciones disponibles: `npm run db:validate`, `npm run lint` y `npm run build`.

## Variables de entorno

Consulta `.env.example`. `DATABASE_URL` es obligatoria. Los horarios de desayuno/comida y la duración de sesión de empleado se configuran sin depender de rutas, componentes ni archivos locales. `AUTH_SECRET` queda reservado para la posterior integración Auth.js/OIDC.

## Roles

Roles corporativos: `ADMIN`, `DIRECCION`, `RH`, `CHEF`, `PLANEACION`, `PRODUCCION`, `MANTENIMIENTO`, `EMPLEADO`.

Food Services usa principalmente `ADMIN`, `RH`, `CHEF` y `EMPLEADO`. CHEF/RH/ADMIN requieren identidad corporativa. El PIN sólo habilita una sesión limitada del portal de empleado y no sustituye autenticación administrativa.

## Rutas principales

- `/modules/food-services`: dashboard y áreas de Food Services.
- `/modules/food-services/employee`: identificación de empleado.
- `/modules/food-services/chef`: gestión de menú (requiere identidad corporativa).
- `/modules/food-services/hr`: administración RH (requiere identidad corporativa).
- `/modules/food-services/consumption`: flujo de consumo preparado para operación.

## Flujo Food Services

El chef crea/publica una semana; el empleado se identifica con número y PIN hasheado; consulta el menú publicado y reserva. El consumo se registra posteriormente como entidad independiente, conserva el precio aplicado y puede referenciar una reserva. Las restricciones únicas en la base evitan reservas o consumos duplicados por empleado y opción.
