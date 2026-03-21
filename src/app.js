// ============================================================
// app.js — VisitaRD Backend · Express App
// Configura middleware, rutas, y manejo de errores
// ============================================================

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const path       = require('path');

// ── Rutas ────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth.routes');
const tripRoutes     = require('./routes/trips.routes');
const bookingRoutes  = require('./routes/bookings.routes');
const trackingRoutes = require('./routes/tracking.routes');
const placeRoutes    = require('./routes/places.routes');
const aiRoutes       = require('./routes/ai.routes');
const adminRoutes    = require('./routes/admin.routes');
const reviewRoutes   = require('./routes/reviews.routes');

const app = express();

// ════════════════════════════════════════════════════════════
// MIDDLEWARE GLOBAL
// ════════════════════════════════════════════════════════════

// Seguridad HTTP headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS — permite web (Netlify), admin (Netlify) y app móvil
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, app móvil, Railway health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    callback(new Error(`CORS bloqueado para origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parsear JSON y URL-encoded
app.use(express.json({ limit: '10mb' }));         // 10mb para imágenes base64 (IA)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logger simple en desarrollo
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ════════════════════════════════════════════════════════════
// HEALTH CHECK — Railway lo usa para saber si el server vive
// ════════════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'VisitaRD API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ════════════════════════════════════════════════════════════
// RUTAS DE LA API
// ════════════════════════════════════════════════════════════
app.use('/api/auth',     authRoutes);
app.use('/api/trips',    tripRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/places',   placeRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/reviews',  reviewRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/media', require('./routes/media.routes'));
app.use('/api/videos', require('./routes/videos.routes'));

// ════════════════════════════════════════════════════════════
// WEBHOOK DE STRIPE — debe ir ANTES del express.json()
// (Stripe necesita el body raw, no parseado)
// ════════════════════════════════════════════════════════════
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  require('./controllers/stripe.webhook')
);

// ════════════════════════════════════════════════════════════
// RUTA 404
// ════════════════════════════════════════════════════════════
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada',
  });
});

// ════════════════════════════════════════════════════════════
// MANEJADOR GLOBAL DE ERRORES
// Cualquier next(error) termina aquí
// ════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message);

  // Error de validación de CORS
  if (err.message && err.message.startsWith('CORS')) {
    return res.status(403).json({ success: false, message: err.message });
  }

  // Error de JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Token inválido' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expirado' });
  }

  // Error de Stripe
  if (err.type && err.type.startsWith('Stripe')) {
    return res.status(400).json({ success: false, message: err.message });
  }

  // Error genérico
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Error interno del servidor';

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
