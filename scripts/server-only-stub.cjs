// Console scripts only: lets modules marked "server-only" load outside Next.js (they are server code already).
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload file for the console scripts. */
const Module = require("node:module");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return require.resolve("./empty.cjs");
  return original.call(this, request, ...rest);
};
