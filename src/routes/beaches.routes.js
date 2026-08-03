// ============================================================
// beaches.routes.js — VisitaRD · Rutas de Congestión de Playas
// Endpoints para check-ins, predicciones y análisis de congestión
// ============================================================

const express = require('express');
const db = require('../config/db'); // ✨ RUTA CORRECTA

const router = express.Router();

// ✅ 1️⃣ REGISTRAR CHECK-IN (usuario visita playa)
// POST /api/beaches/checkin
router.post('/checkin', async (req, res, next) => {
  try {
    const { user_id, beach_id, stay_duration } = req.body;

    // Validar
    if (!user_id || !beach_id) {
      return res.status(400).json({ 
        success: false,
        error: 'user_id y beach_id son requeridos' 
      });
    }

    // Verificar playa existe
    const [beach] = await db.query('SELECT id FROM beaches WHERE id = ?', [beach_id]);
    if (beach.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Playa no encontrada' 
      });
    }

    // Insertar check-in
    await db.query(
      'INSERT INTO beach_checkins (user_id, beach_id, stay_duration, checkin_time) VALUES (?, ?, ?, NOW())',
      [user_id, beach_id, stay_duration || null]
    );

    res.json({ 
      success: true, 
      message: 'Check-in registrado exitosamente' 
    });
  } catch (err) {
    next(err);
  }
});

// ✅ 2️⃣ OBTENER TODAS LAS PLAYAS CON CONGESTIÓN ACTUAL
// GET /api/beaches
router.get('/', async (req, res, next) => {
  try {
    const [beaches] = await db.query(`
      SELECT 
        b.id,
        b.name,
        b.type,
        b.lat,
        b.lng,
        b.capacity,
        b.description,
        COALESCE(bp.predicted_congestion, 0) as current_congestion,
        COALESCE(bp.level, 'green') as level,
        COALESCE(bp.predicted_users, 0) as predicted_users
      FROM beaches b
      LEFT JOIN beach_predictions bp ON b.id = bp.beach_id 
        AND bp.prediction_hour = (
          SELECT MAX(prediction_hour) FROM beach_predictions 
          WHERE beach_id = b.id AND prediction_hour <= NOW()
        )
      ORDER BY b.name
    `);

    res.json({ 
      success: true,
      data: beaches 
    });
  } catch (err) {
    next(err);
  }
});

// ✅ 3️⃣ OBTENER DETALLES DE UNA PLAYA (próximas 24h)
// GET /api/beaches/:beach_id
router.get('/:beach_id', async (req, res, next) => {
  try {
    const { beach_id } = req.params;

    // Info de la playa
    const [beach] = await db.query(
      'SELECT * FROM beaches WHERE id = ?',
      [beach_id]
    );

    if (beach.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Playa no encontrada' 
      });
    }

    // Predicciones próximas 24h
    const [predictions] = await db.query(`
      SELECT 
        prediction_hour,
        predicted_congestion,
        predicted_users,
        level
      FROM beach_predictions
      WHERE beach_id = ?
        AND prediction_hour >= NOW()
        AND prediction_hour <= DATE_ADD(NOW(), INTERVAL 24 HOUR)
      ORDER BY prediction_hour ASC
    `, [beach_id]);

    // Mejor hora para visitar
    const [bestTime] = await db.query(`
      SELECT 
        prediction_hour,
        predicted_congestion,
        predicted_users
      FROM beach_predictions
      WHERE beach_id = ?
        AND prediction_hour >= NOW()
        AND prediction_hour <= DATE_ADD(NOW(), INTERVAL 24 HOUR)
      ORDER BY predicted_congestion ASC
      LIMIT 1
    `, [beach_id]);

    res.json({
      success: true,
      data: {
        beach: beach[0],
        current: predictions[0] || {},
        hourly_forecast: predictions,
        best_time: bestTime[0] || null,
        recommendation: generateRecommendation(predictions[0])
      }
    });
  } catch (err) {
    next(err);
  }
});

// ✅ 4️⃣ BÚSQUEDA: "Playas menos concurridas AHORA"
// GET /api/beaches/search/least-crowded
router.get('/search/least-crowded', async (req, res, next) => {
  try {
    const [beaches] = await db.query(`
      SELECT 
        b.id,
        b.name,
        b.type,
        b.lat,
        b.lng,
        COALESCE(bp.predicted_congestion, 0) as congestion,
        COALESCE(bp.level, 'green') as level
      FROM beaches b
      LEFT JOIN beach_predictions bp ON b.id = bp.beach_id 
        AND bp.prediction_hour = (
          SELECT MAX(prediction_hour) FROM beach_predictions 
          WHERE beach_id = b.id AND prediction_hour <= NOW()
        )
      ORDER BY congestion ASC
      LIMIT 5
    `);

    res.json({ 
      success: true,
      data: beaches 
    });
  } catch (err) {
    next(err);
  }
});

// ✅ 5️⃣ ESTADÍSTICAS DE VISITANTES (últimos 30 días)
// GET /api/beaches/:beach_id/stats
router.get('/:beach_id/stats', async (req, res, next) => {
  try {
    const { beach_id } = req.params;

    const [stats] = await db.query(`
      SELECT 
        HOUR(checkin_time) as hour,
        COUNT(*) as visitor_count,
        AVG(stay_duration) as avg_stay_minutes
      FROM beach_checkins
      WHERE beach_id = ?
        AND checkin_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY HOUR(checkin_time)
      ORDER BY hour ASC
    `, [beach_id]);

    res.json({ 
      success: true,
      data: stats 
    });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════

/**
 * Generar recomendación basada en nivel de congestión
 */
function generateRecommendation(prediction) {
  if (!prediction) return null;
  
  switch (prediction.level) {
    case 'green':
      return '🟢 Poco concurrido - Excelente momento para visitar';
    case 'yellow':
      return '🟡 Moderadamente lleno - Espera 2-3 horas para menos gente';
    case 'red':
      return '🔴 Muy concurrido - Recomendamos otro momento o día';
    default:
      return null;
  }
}

module.exports = router;
