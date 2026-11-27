# YF-003 - Warehouse Enterprise V2.1

## Cierre tecnico y operativo en QA

Fecha: 27 de noviembre de 2026.

Estado: validado en QA dentro del alcance documentado.
Publicacion GitHub y liberacion productiva pendientes.

## Objetivo

Administrar inventarios mediante un libro mayor de movimientos,
existencias materializadas, custodias, controles de acceso,
trazabilidad y conciliacion de diferencias.

El inventario no depende de modificaciones manuales de Excel.

## Arquitectura

Next.js, React, TypeScript, Prisma y PostgreSQL.
Interfaces, APIs, servicios de acceso y repositorios separados.
C-PANEL como gobierno de permisos individuales.

El libro mayor es la fuente de verdad del inventario.
Las existencias materializadas deben coincidir con el libro mayor.
Los movimientos y ajustes requieren controles transaccionales.

## Funcionalidades implementadas

- Consulta de existencias y ubicaciones.
- Entradas externas.
- Transferencias internas.
- Entregas a Produccion y custodias.
- Recepciones, consumos y devoluciones.
- Salidas de material.
- Conteos fisicos y reconteos.
- Investigacion y resolucion autorizada de diferencias.
- Kardex e historial de movimientos.
- Reversiones controladas.
- Catalogo de articulos y ubicaciones.
- Reportes y reconciliacion del inventario.
- Documentacion controlada de excepciones.
- Permisos granulares por usuario y funcion.
- Proteccion contra solicitudes duplicadas.

La conciliacion SAP permanece como fase futura.

## Validaciones tecnicas

- 236 pruebas unitarias aprobadas en la validacion V2.1.
- Matriz Enterprise: 69/69.
- Regresion Warehouse V2: 32/32.
- Regresion Warehouse PostgreSQL: 16/16.
- Regresiones de autenticacion y Food Services aprobadas
  en laboratorio con conexiones restringidas.
- Prisma validate, generate, TypeScript y build aprobados.
- Ensayo de recuperacion: 58/58 tablas identicas.
- Instalacion de seguridad QA: EXIT 0.
- Conexion PostgreSQL restringida real: EXIT 0.
- Validacion Prisma en QA: 19/19 controles.
- Publicacion: 106/106 archivos del paquete coincidentes.

Los resultados corresponden a diferentes etapas de validacion.
No deben sumarse como pruebas independientes.

## Seguridad PostgreSQL

QA: 127.0.0.1:55432/yellowflex_restore_test.

Cuenta de aplicacion: yf_platform_qa_login.
La aplicacion no necesita privilegios de superusuario.

Se establecieron propietarios separados, roles de aplicacion,
migracion y mantenimiento, permisos minimos y protecciones
contra modificaciones indebidas del libro mayor y los saldos.

Se instalaron 16 protecciones de identidad referencial.
Se verificaron bloqueos transaccionales y permisos efectivos.

Instalador validado:

scripts/warehouse-yf003-security-qa.sql

SHA256:
E1AEA2AEFF1C55296C14BFDC074D4EE7C162515E63906941E9332C0B7BE8A0C4

Este instalador es EXCLUSIVO de QA.
No es una migracion automatica ni un instalador de produccion.
La instalacion productiva requiere adaptacion, revision y
autorizacion expresa.

Las credenciales no forman parte del repositorio.

## Migraciones

Migracion Enterprise V2.1:

20261125200000_warehouse_yf003_enterprise_v2

Aplicada en QA.
No modificar migraciones historicas.
Seguridad adicional instalada mediante SQL independiente.

## Validacion funcional desde navegador

ADMIN QA:
Consulta de Warehouse, indicadores, Kardex, movimientos,
conteos, diferencias y reconciliacion.

Warehouse QA:
Acceso a entradas, transferencias, entregas a Produccion,
salidas y devoluciones.

Produccion QA:
Acceso a recepciones pendientes y custodias.

RH Delegado QA:
Acceso a Food Services.

Restricciones observadas:
Catalogo para Warehouse, Compras para ADMIN y Administrativo,
y Recursos Humanos para RH Delegado.

Estas restricciones requieren contraste con los permisos
asignados antes de declararlas correctas o defectuosas.

Las pruebas de navegador fueron de acceso y consulta.
Las escrituras fueron validadas en laboratorio.

## Integridad observada

- 478 movimientos.
- 475 saldos.
- 204 articulos activos.
- 457 ubicaciones.
- 344 ubicaciones ocupadas.
- 113 ubicaciones libres.
- 58 tablas.
- 32 migraciones.
- R8: cero diferencias entre saldos y libro mayor.

Reconciliacion R1-R6 y R8 sin hallazgos en la revision visual.
R7: dos entregas sin custodia vinculada y dos custodias
sin movimiento de entrega vinculado.

R8 igual a cero no significa que el inventario fisico
haya sido conciliado ni que R7 este resuelto.

## Pendientes obligatorios antes de produccion

1. Investigar y resolver o documentar con evidencia los
   cuatro hallazgos R7.
2. Conciliar fisicamente el articulo 22-001-005 en A-1-18.
   La existencia observada en QA fue de dos piezas.
   No asumir que deben descontarse dos o tres piezas.
   Aplicar conteo, reconteo y autorizacion segun corresponda.
3. Revisar los permisos restringidos observados.
4. Completar aislamiento entre bases PostgreSQL.
   La cuenta QA puede conectarse a otras bases del servidor,
   aunque no tiene permisos de lectura o escritura a nivel
   de tabla sobre las 45 tablas externas evaluadas.
   Revisar funciones, otros objetos y permisos efectivos.
5. Preparar roles y seguridad especificos de produccion.
6. Autorizar migracion, despliegue y plan de recuperacion.
7. Capacitar al personal de Almacen y Produccion.
8. Revisar la guia operativa contra los permisos definitivos.

No se autoriza eliminar movimientos historicos, realizar
ajustes directos ni modificar inventario sin evidencia.

## Evidencias

Conservadas localmente en:

C:\yellowflex\temp\YF-003-F

Fases F5, F6 y F7.
Los respaldos, credenciales y diagnosticos privados
no deben incorporarse a GitHub.

## Continuidad

YF-004: Compras.
YF-005: Seguridad integral y QA.
YF-006: Lanzamiento Platform.

El cierre tecnico QA no equivale a liberacion productiva.
