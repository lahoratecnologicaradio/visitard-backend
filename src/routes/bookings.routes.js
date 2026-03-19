// ============================================================
// routes/bookings.routes.js — VisitaRD
// Reservas con pago Stripe + generación QR
// ============================================================

const router = require('express').Router();
const db     = require('../config/db');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require('crypto');
const { authenticate, authorize } = require('../middleware/auth');

// ════════════════════════════════════════════════════════════
// POST /api/bookings — crear reserva + PaymentIntent Stripe
// ════════════════════════════════════════════════════════════
router.post('/', authenticate, authorize('tourist', 'admin'), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { trip_id, seats = 1 } = req.body;

    if (!trip_id) {
      return res.status(400).json({ success: false, message: 'trip_id requerido' });
    }

    // 1. Verificar disponibilidad con lock de fila
    const [trips] = await conn.query(
      'SELECT id, seats_available, price, status, title FROM trips WHERE id = ? FOR UPDATE',
      [trip_id]
    );

    if (!trips.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Viaje no encontrado' });
    }

    const trip = trips[0];

    if (trip.status !== 'scheduled' && trip.status !== 'boarding') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Este viaje ya no acepta reservas' });
    }

    if (trip.seats_available < seats) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Solo quedan ${trip.seats_available} asientos disponibles`,
      });
    }

    const totalPrice = trip.price * seats;

    // 2. Crear PaymentIntent en Stripe (en centavos)
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(totalPrice * 100),
      currency: 'usd',
      metadata: {
        trip_id:    trip_id.toString(),
        user_id:    req.user.id.toString(),
        seats:      seats.toString(),
        trip_title: trip.title,
      },
      description: `VisitaRD - ${trip.title} (${seats} asiento${seats > 1 ? 's' : ''})`,
    });

    // 3. Generar código QR único (se usa para embarque)
    const qrCode = crypto
      .createHash('sha256')
      .update(`${trip_id}-${req.user.id}-${Date.now()}`)
      .digest('hex')
      .substring(0, 16)
      .toUpperCase();

    // 4. Crear reserva en estado 'pending' (se confirma al recibir webhook de Stripe)
    const [result] = await conn.query(
      `INSERT INTO bookings
         (trip_id, user_id, seats, total_price, status, payment_intent_id, qr_code)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      [trip_id, req.user.id, seats, totalPrice, paymentIntent.id, qrCode]
    );

    // 5. Reducir asientos disponibles temporalmente
    await conn.query(
      'UPDATE trips SET seats_available = seats_available - ? WHERE id = ?',
      [seats, trip_id]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      booking_id:           result.insertId,
      client_secret:        paymentIntent.client_secret,  // el frontend lo usa para Stripe SDK
      payment_intent_id:    paymentIntent.id,
      qr_code:              qrCode,
      total_price:          totalPrice,
      message:              'Reserva creada. Completa el pago para confirmar.',
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/bookings/my — mis reservas (turista logueado)
// ════════════════════════════════════════════════════════════
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const [bookings] = await db.query(
      `SELECT
         b.id, b.seats, b.total_price, b.status, b.qr_code, b.created_at,
         t.title, t.origin, t.destination, t.departure_at,
         t.origin_lat, t.origin_lng, t.dest_lat, t.dest_lng, t.status AS trip_status,
         a.name AS agency_name, a.logo AS agency_logo, a.rating AS agency_rating
       FROM bookings b
       JOIN trips    t ON b.trip_id   = t.id
       JOIN agencies a ON t.agency_id = a.id
       WHERE b.user_id = ?
       ORDER BY t.departure_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, data: bookings });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/bookings/:id — detalle de una reserva
// ════════════════════════════════════════════════════════════
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, t.title, t.origin, t.destination, t.departure_at,
              t.origin_lat, t.origin_lng, t.dest_lat, t.dest_lng,
              a.name AS agency_name, a.phone AS agency_phone
       FROM bookings b
       JOIN trips t    ON b.trip_id   = t.id
       JOIN agencies a ON t.agency_id = a.id
       WHERE b.id = ? AND (b.user_id = ? OR ? = 'admin')`,
      [req.params.id, req.user.id, req.user.role]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Reserva no encontrada' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════
// DELETE /api/bookings/:id — cancelar reserva
// ════════════════════════════════════════════════════════════
router.delete('/:id', authenticate, async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT * FROM bookings WHERE id = ? AND user_id = ? FOR UPDATE',
      [req.params.id, req.user.id]
    );

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Reserva no encontrada' });
    }

    const booking = rows[0];

    if (booking.status === 'confirmed') {
      // Reembolso en Stripe
      await stripe.refunds.create({ payment_intent: booking.payment_intent_id });
    }

    await conn.query(
      'UPDATE bookings SET status = ? WHERE id = ?',
      ['cancelled', booking.id]
    );

    // Devolver asientos
    await conn.query(
      'UPDATE trips SET seats_available = seats_available + ? WHERE id = ?',
      [booking.seats, booking.trip_id]
    );

    await conn.commit();
    res.json({ success: true, message: 'Reserva cancelada y reembolso procesado' });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
