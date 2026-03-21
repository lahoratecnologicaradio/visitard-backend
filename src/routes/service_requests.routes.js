// routes/service_requests.routes.js — VisitaRD
// Sistema de solicitudes y ofertas entre organizadores y proveedores
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate, authorize } = require('../middleware/auth')

// GET /api/requests — solicitudes abiertas (para proveedores)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { service_type, lat, lng, radius = 100 } = req.query
    let sql = `
      SELECT r.*, u.name AS requester_name, u.avatar AS requester_avatar,
             t.title AS trip_title, t.origin, t.destination
      FROM service_requests r
      JOIN users u ON r.requester_id = u.id
      LEFT JOIN trips t ON r.trip_id = t.id
      WHERE r.status = 'open'
    `
    const params = []
    if (service_type) { sql += ' AND r.service_type = ?'; params.push(service_type) }
    if (lat && lng) {
      sql += ` AND r.lat IS NOT NULL AND (
        6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(r.lat)) *
          COS(RADIANS(r.lng) - RADIANS(?)) +
          SIN(RADIANS(?)) * SIN(RADIANS(r.lat))
        )
      ) <= ?`
      params.push(lat, lng, lat, radius)
    }
    sql += ' ORDER BY r.created_at DESC'
    const [requests] = await db.query(sql, params)
    res.json({ success: true, data: requests })
  } catch (err) { next(err) }
})

// POST /api/requests — crear solicitud (organizadores y turistas)
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { trip_id, service_type, description, budget, lat, lng } = req.body
    if (!service_type) {
      return res.status(400).json({ success: false, message: 'service_type es requerido' })
    }
    const [result] = await db.query(
      `INSERT INTO service_requests (trip_id, requester_id, service_type, description, budget, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [trip_id || null, req.user.id, service_type, description || null,
       budget || null, lat || null, lng || null]
    )
    res.status(201).json({ success: true, request_id: result.insertId })
  } catch (err) { next(err) }
})

// POST /api/requests/:id/offers — hacer oferta
router.post('/:id/offers', authenticate, async (req, res, next) => {
  try {
    const { price, message, provider_type } = req.body
    await db.query(
      `INSERT INTO service_offers (request_id, provider_id, provider_type, price, message)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, req.user.id, provider_type, price || null, message || null]
    )
    // Cambiar status de la solicitud a 'negotiating'
    await db.query(
      `UPDATE service_requests SET status = 'negotiating' WHERE id = ? AND status = 'open'`,
      [req.params.id]
    )
    res.status(201).json({ success: true, message: 'Oferta enviada' })
  } catch (err) { next(err) }
})

// GET /api/requests/:id/offers — ver ofertas de una solicitud
router.get('/:id/offers', authenticate, async (req, res, next) => {
  try {
    const [offers] = await db.query(
      `SELECT o.*, u.name AS provider_name, u.phone AS provider_phone, u.avatar
       FROM service_offers o
       JOIN users u ON o.provider_id = u.id
       WHERE o.request_id = ?
       ORDER BY o.created_at ASC`,
      [req.params.id]
    )
    res.json({ success: true, data: offers })
  } catch (err) { next(err) }
})

// PATCH /api/requests/:id/offers/:offerId/accept — aceptar oferta
router.patch('/:id/offers/:offerId/accept', authenticate, async (req, res, next) => {
  try {
    await db.query(
      `UPDATE service_offers SET status = 'accepted' WHERE id = ?`,
      [req.params.offerId]
    )
    await db.query(
      `UPDATE service_offers SET status = 'rejected'
       WHERE request_id = ? AND id != ?`,
      [req.params.id, req.params.offerId]
    )
    await db.query(
      `UPDATE service_requests SET status = 'accepted' WHERE id = ?`,
      [req.params.id]
    )
    res.json({ success: true, message: 'Oferta aceptada' })
  } catch (err) { next(err) }
})

module.exports = router
