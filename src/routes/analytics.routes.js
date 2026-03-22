// routes/analytics.routes.js — VisitaRD
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate, authorize } = require('../middleware/auth')

// GET /api/analytics/agency — stats de la agencia autenticada
router.get('/agency', authenticate, authorize('agency', 'admin'), async (req, res, next) => {
  try {
    // Obtener agency_id
    const [agRows] = await db.query('SELECT id FROM agencies WHERE user_id = ?', [req.user.id])
    if (!agRows.length) return res.status(404).json({ success: false, message: 'Agencia no encontrada' })
    const agencyId = agRows[0].id

    // Stats generales
    const [[stats]] = await db.query(`
      SELECT
        COUNT(DISTINCT t.id)                                          AS total_trips,
        COUNT(DISTINCT b.id)                                          AS total_bookings,
        COALESCE(SUM(b.total_price), 0)                               AS total_revenue,
        COALESCE(AVG(r.rating), 5)                                    AS avg_rating,
        COUNT(DISTINCT CASE WHEN b.status = 'confirmed' THEN b.id END) AS confirmed_bookings,
        COUNT(DISTINCT CASE WHEN b.status = 'pending'   THEN b.id END) AS pending_bookings,
        COUNT(DISTINCT CASE WHEN t.status = 'scheduled' THEN t.id END) AS upcoming_trips,
        COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) AS completed_trips
      FROM trips t
      LEFT JOIN bookings b ON b.trip_id = t.id
      LEFT JOIN reviews  r ON r.target_id = ? AND r.target_type = 'agency'
      WHERE t.agency_id = ?
    `, [agencyId, agencyId])

    // Ingresos por mes (últimos 6 meses)
    const [monthlyRevenue] = await db.query(`
      SELECT
        DATE_FORMAT(b.created_at, '%Y-%m') AS month,
        DATE_FORMAT(b.created_at, '%b %Y') AS label,
        COUNT(b.id)                         AS bookings,
        COALESCE(SUM(b.total_price), 0)     AS revenue
      FROM bookings b
      JOIN trips t ON b.trip_id = t.id
      WHERE t.agency_id = ?
        AND b.created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        AND b.status = 'confirmed'
      GROUP BY DATE_FORMAT(b.created_at, '%Y-%m')
      ORDER BY month ASC
    `, [agencyId])

    // Viajes más populares
    const [topTrips] = await db.query(`
      SELECT
        t.id, t.title, t.destination, t.price,
        COUNT(b.id)                     AS total_bookings,
        COALESCE(SUM(b.total_price), 0) AS revenue,
        t.seats, t.seats_available
      FROM trips t
      LEFT JOIN bookings b ON b.trip_id = t.id AND b.status = 'confirmed'
      WHERE t.agency_id = ?
      GROUP BY t.id
      ORDER BY total_bookings DESC
      LIMIT 5
    `, [agencyId])

    // Últimas reservas
    const [recentBookings] = await db.query(`
      SELECT
        b.id, b.seats, b.total_price, b.status, b.created_at,
        u.name AS passenger_name, u.phone AS passenger_phone,
        t.title AS trip_title, t.destination, t.departure_at
      FROM bookings b
      JOIN trips t ON b.trip_id = t.id
      JOIN users  u ON b.user_id = u.id
      WHERE t.agency_id = ?
      ORDER BY b.created_at DESC
      LIMIT 10
    `, [agencyId])

    // Destinos más visitados
    const [topDestinations] = await db.query(`
      SELECT
        t.destination,
        COUNT(b.id)                     AS bookings,
        COALESCE(SUM(b.total_price), 0) AS revenue
      FROM trips t
      LEFT JOIN bookings b ON b.trip_id = t.id AND b.status = 'confirmed'
      WHERE t.agency_id = ?
      GROUP BY t.destination
      ORDER BY bookings DESC
      LIMIT 6
    `, [agencyId])

    // Reseñas recientes
    const [recentReviews] = await db.query(`
      SELECT r.rating, r.comment, r.created_at, u.name AS reviewer_name
      FROM reviews r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.target_id = ? AND r.target_type = 'agency'
      ORDER BY r.created_at DESC
      LIMIT 5
    `, [agencyId])

    res.json({
      success: true,
      data: {
        stats,
        monthly_revenue:  monthlyRevenue,
        top_trips:        topTrips,
        recent_bookings:  recentBookings,
        top_destinations: topDestinations,
        recent_reviews:   recentReviews,
      }
    })
  } catch (err) { next(err) }
})

module.exports = router
