# YF-002 — Cierre técnico y operativo · Food Services (prenómina, conciliación y cierre)

Rama `feature/yf002-food-payroll` · HEAD validado `bbae41ee539a95bc45c2a63c0717bae6ebfb02ab` · generado 2026-11-25 12:11 en ltflexi040. Ambiente: QA aislado `127.0.0.1:55432/yellowflex_restore_test`.

## Alcance cerrado

| Bloque | Contenido |
|---|---|
| A | Motor de prenómina: modelo, migración `20261124130000_food_payroll_core`, bloqueos ordenados, vista previa firmada, generación idempotente |
| B | Operación RH: consulta, anulación controlada, exportación oficial Excel con SHA-256, permisos C-PANEL |
| C1 | Prenómina masiva por periodo sin límites ni omisiones; Excel agrupado por número de empleado |
| C2 | Conciliación masiva de lo aplicado por Nómina, ajustes trazables, cierre `RECONCILED`, reportes de control; migración `20261124180000_food_payroll_reconciliation` |

## Commits de la rama (desde la consolidación d6a738a)

- `870734a feat(food-services): YF-002 Bloque A - motor de prenomina (esquema, migracion, elegibilidad, generacion transaccional e idempotencia)`
- `5844904 feat(food-services): YF-002 Bloque B - operacion RH de prenomina (permisos, APIs, UI, anulacion y exportacion oficial)`
- `cb83aa1 feat(food-services): YF-002 Bloque C1 - prenomina masiva por periodo sin limites ni omisiones`
- `bbae41e feat(food-services): YF-002 Bloque C2 - conciliacion, ajustes y cierre definitivo de prenomina`

## Prueba manual integral YF-002-FINAL (25-nov-2026, terminó 09:05:31)

- 10 colaboradores ficticios, 19 pedidos elegibles, 62 servicios; prenómina de $3,247.75.
- Generación y exportación oficial correctas.
- Conciliación de $2,873.51: 6 descuentos completos, 2 parciales, 1 no aplicado y 1 superior; $394.24 por recuperar y $20.00 por devolver.
- Resolución de un ajuste por $149.00; saldo posterior por recuperar $245.24 y por devolver $20.00; tres ajustes pendientes conservados.
- Cierre administrativo correcto; cuatro reportes Excel de control aprobados.
- Limpieza controlada del lote, conciliación, ajustes, eventos, 19 pedidos, 3 semanas y 10 colaboradores: cero residuos.
- Tres pedidos históricos UNVERIFIED intactos; verificación posterior exitosa; Git sin modificaciones durante la prueba.

## Evidencias (SHA-256)

| Evidencia | Ruta local | SHA-256 |
|---|---|---|
| Crear datos de prueba | `C:\yellowflex\temp\yf002\yf002final-datos-crear-20261125-085214` | `c6d8c2b66eaf5014e89c338400f8434ce833bb4b9f78781a9608293039805985` |
| Limpieza controlada | `C:\yellowflex\temp\yf002\yf002final-datos-limpiar-20261125-090504` | `88365e02454b6db75fe8d9da664faf690d3d513756272f9b5090705fce2a821a` |
| Verificacion posterior | `C:\yellowflex\temp\yf002\yf002final-datos-verificar-20261125-090530` | `a067b65348f3957d3a6113debeee64e441ed4bb0ab7971641af8ad317324d7c0` |
| Instalacion y validacion C2 (16/16) | `C:\yellowflex\temp\yf002\yf002c2-instalar-20261125-072400` | `1ce63b17d6bef62ac406769de35119625fccdb2fd4bd0713135e29fc7804c2f9` |

## Controles de publicación

- Escaneo de secretos, archivos sensibles y datos ficticios sobre los archivos de la rama: sin hallazgos.
- Cambios locales preexistentes preservados y excluidos del commit: 76.
- Publicación solo de la rama, sin fusión con main, sin despliegue y sin migraciones en producción.

## Pendiente para producción (requiere autorización expresa)

- Aplicar en producción las migraciones `20261124130000_food_payroll_core` y `20261124180000_food_payroll_reconciliation` en una ventana autorizada.
- Configurar `FOOD_PAYROLL_PREVIEW_SECRET` de producción fuera de Git.
- Asignar en C-PANEL los permisos de prenómina y conciliación a los usuarios RH de producción.
- Revisión y fusión de la rama mediante el proceso autorizado.
