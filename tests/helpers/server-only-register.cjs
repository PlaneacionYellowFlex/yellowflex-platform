// Test process only: Next normally aliases this marker during its build.
// Keep every production module unchanged and use Next's bundled empty server marker.
const Module = require('node:module');
const originalResolve = Module._resolveFilename;
const marker = require.resolve('next/dist/compiled/server-only/empty.js');
Module._resolveFilename = function(id, ...args) {
  return id === 'server-only' ? marker : originalResolve.call(this, id, ...args);
};
