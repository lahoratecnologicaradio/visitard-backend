// ============================================================
// config/redis.js — VisitaRD · Redis Client
// Cache para tracking GPS, lugares populares y sesiones
// ============================================================

/*const { createClient } = require('redis');

const client = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

client.on('error', (err) => console.error('[Redis] Error:', err.message));
client.on('connect', ()   => console.log('[Redis] Conectado correctamente'));
client.on('reconnecting', () => console.log('[Redis] Reconectando...'));

// Conectar al arrancar
client.connect().catch((err) => {
  console.error('[Redis] No se pudo conectar:', err.message);
  // Redis no es crítico — el servidor sigue funcionando sin cache
});

module.exports = client;*/

const client = {
  get: async () => null,
  set: async () => null,
  del: async () => null,
  on: () => {},
  connect: async () => {},
}
console.log('[Redis] Modo sin caché')
module.exports = client
