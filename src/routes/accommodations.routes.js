// routes/accommodations.routes.js — VisitaRD
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate, authorize } = require('../middleware/auth')

// GET /api/accommodations — listar alojamientos
router.get('/', async (req, res, next) => {
  try {
    const { lat, lng, radius = 30, type } = req.query
    let sql = `
      SELECT a.*, u.name AS owner_name, u.phone AS owner_phone
      FROM accommodations a
      JOIN users u ON a.owner_id = u.id
      WHERE a.verified = 1
    `
    const params = []
    if (type) { sql += ' AND a.type = ?'; params.push(type) }
    if (lat && lng) {
      sql += ` AND (
        6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(a.lat)) *
          COS(RADIANS(a.lng) - RADIANS(?)) +
          SIN(RADIANS(?)) * SIN(RADIANS(a.lat))
        )
      ) <= ?`
      params.push(lat, lng, lat, radius)
    }
    sql += ' ORDER BY a.rating DESC'
    const [rows] = await db.query(sql, params)
    res.json({ success: true, data: rows })
  } catch (err) { next(err) }
})

// POST /api/accommodations — registrar alojamiento
router.post('/', authenticate, authorize('accommodation', 'admin'), async (req, res, next) => {
  try {
    const { name, type, lat, lng, price_per_night, capacity, amenities, photos } = req.body
    if (!name) return res.status(400).json({ success: false, message: 'name es requerido' })
    const [result] = await db.query(
      `INSERT INTO accommodations (owner_id, name, type, lat, lng, price_per_night, capacity, amenities, photos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, name, type || 'hotel', lat || null, lng || null,
       price_per_night || null, capacity || null,
       JSON.stringify(amenities || []), JSON.stringify(photos || [])]
    )
    res.status(201).json({ success: true, accommodation_id: result.insertId })
  } catch (err) { next(err) }
})

module.exports = router
