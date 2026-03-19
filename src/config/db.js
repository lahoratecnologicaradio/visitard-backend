// ============================================================
// config/db.js — VisitaRD · MySQL Connection Pool
// Pool de conexiones para alta concurrencia
// ============================================================

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'visitard',
  waitForConnections: true,
  connectionLimit:    10,       // máximo 10 conexiones simultáneas
  queueLimit:         0,
  timezone:           '-04:00', // República Dominicana (AST)
  charset:            'utf8mb4',
});

// Test de conexión al arrancar
pool.getConnection()
  .then((conn) => {
    console.log('[MySQL] Conectado correctamente');
    conn.release();
  })
  .catch((err) => {
    console.error('[MySQL] Error de conexión:', err.message);
    process.exit(1); // Si no hay DB, no arrancar el server
  });

module.exports = pool;
