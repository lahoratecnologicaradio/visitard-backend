// ============================================================
// controllers/stripe.webhook.js — VisitaRD
// Confirma pagos cuando Stripe notifica el evento
// ============================================================

const stripe = require('stripe')(process.env.STRIPE_SECRET);
const db     = require('../config/db');

module.exports = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK
    );
  } catch (err) {
    console.error('[Stripe Webhook] Firma inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    try {
      await db.query(
        "UPDATE bookings SET status = 'confirmed' WHERE payment_intent_id = ?",
        [pi.id]
      );
      console.log('[Stripe] Pago confirmado para PaymentIntent:', pi.id);
    } catch (err) {
      console.error('[Stripe Webhook] Error actualizando DB:', err.message);
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        'SELECT trip_id, seats FROM bookings WHERE payment_intent_id = ?',
        [pi.id]
      );
      if (rows.length) {
        await conn.query(
          "UPDATE bookings SET status = 'failed' WHERE payment_intent_id = ?",
          [pi.id]
        );
        await conn.query(
          'UPDATE trips SET seats_available = seats_available + ? WHERE id = ?',
          [rows[0].seats, rows[0].trip_id]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
    } finally {
      conn.release();
    }
  }

  res.json({ received: true });
};
