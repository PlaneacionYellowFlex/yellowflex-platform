/* eslint-disable @typescript-eslint/no-require-imports */
// Pruebas de integración de rutas API contra PostgreSQL aislado SIN mocks de base de datos ni de permisos.
// Solo se sustituye el lector de la cookie de sesión (next/headers no existe fuera de una solicitud de Next): la "sesión"
// apunta a un usuario real y se relee de la base de datos en cada solicitud (roles y estado activo vigentes), igual que la
// sesión real. Todas las demás funciones y clases de error son las del módulo de producción.
const Module = require('node:module');
const path = require('node:path');

const REAL = path.join(__dirname, '..', '..', 'lib', 'auth', 'corporate-auth.ts');
const STUB = path.join(__dirname, 'route-session-stub.cjs');
let installed = false;

function installRouteSession() {
  if (installed) return;
  installed = true;
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === '@/lib/auth/corporate-auth' && !(parent && parent.filename === STUB)) return STUB;
    return original.call(this, request, parent, ...rest);
  };
}

function setSessionUser(userId) { globalThis.__yfRouteSessionUserId = userId ?? null; }

module.exports = { installRouteSession, setSessionUser, REAL };
