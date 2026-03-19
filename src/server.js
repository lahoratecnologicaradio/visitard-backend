// ============================================================
// server.js — VisitaRD Backend · Entry Point
// HTTP server + Socket.io sobre el mismo puerto
// ============================================================

require('dotenv').config();
const http = require('http');
const app  = require('./app');
const { initSocket } = require('./sockets/tracking.socket');

const PORT = process.env.PORT || 4000;

// Crear servidor HTTP desde Express
const server = http.createServer(app);

// Montar Socket.io sobre el mismo servidor
initSocket(server);

// Arrancar servidor
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════╗
║  VisitaRD Backend — ONLINE       ║
║  Puerto : ${PORT}                    ║
║  Modo   : ${(process.env.NODE_ENV || 'development').padEnd(11)}         ║
╚══════════════════════════════════╝
  `);
});

// Cierre limpio en errores no atrapados
process.on('unhandledRejection', (err) => {
  console.error('[UnhandledRejection]', err.message);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err.message);
  process.exit(1);
});

module.exports = server;
