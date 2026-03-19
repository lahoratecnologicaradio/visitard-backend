// routes/reviews.routes.js
const router = require('express').Router();
const db     = require('../config/db');
const { authenticate } = require('../middleware/auth');

// POST /api/reviews — dejar reseña tras un viaje
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { booking_id, rating, comment, target_type = 'agency' } = req.body;
    if (!booking_id || !rating) {
      return res.status(400).json({ success: false, message: 'booking_id y rating requeridos' });
    }

    // Verificar que el booking pertenece al usuario y está completado
    const [rows] = await db.query(
      `SELECT b.id, t.agency_id FROM bookings b
       JOIN trips t ON b.trip_id = t.id
       WHERE b.id = ? AND b.user_id = ? AND b.status = 'confirmed'`,
      [booking_id, req.user.id]
    );
    if (!rows.length) {
      return res.status(403).json({ success: false, message: 'Reserva no válida para reseña' });
    }

    const target_id = rows[0].agency_id;

    await db.query(
      `INSERT INTO reviews (booking_id, reviewer_id, target_id, target_type, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)`,
      [booking_id, req.user.id, target_id, target_type, rating, comment || null]
    );

    // Recalcular rating promedio de la agencia
    await db.query(
      `UPDATE agencies SET rating = (
        SELECT AVG(r.rating) FROM reviews r WHERE r.target_id = ? AND r.target_type = 'agency'
      ) WHERE id = ?`,
      [target_id, target_id]
    );

    res.status(201).json({ success: true, message: 'Reseña guardada' });
  } catch (err) { next(err); }
});

module.exports = router;
