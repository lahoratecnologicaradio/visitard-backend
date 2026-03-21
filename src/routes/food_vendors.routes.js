// routes/food_vendors.routes.js — VisitaRD
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate, authorize } = require('../middleware/auth')

// GET /api/food — listar vendedores de comida
router.get('/', async (req, res, next) => {
  try {
    const { lat, lng, radius = 20, type } = req.query
    let sql = `
      SELECT f.*, u.name AS owner_name, u.phone AS owner_phone
      FROM food_vendors f
      JOIN users u ON f.owner_id = u.id
      WHERE f.verified = 1
    `
    const params = []
    if (type) { sql += ' AND f.type = ?'; params.push(type) }
    if (lat && lng) {
      sql += ` AND (
        6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(f.lat)) *
          COS(RADIANS(f.lng) - RADIANS(?)) +
          SIN(RADIANS(?)) * SIN(RADIANS(f.lat))
        )
      ) <= ?`
      params.push(lat, lng, lat, radius)
    }
    sql += ' ORDER BY f.rating DESC'
    const [rows] = await db.query(sql, params)
    res.json({ success: true, data: rows })
  } catch (err) { next(err) }
})

// POST /api/food — registrar vendedor
router.post('/', authenticate, authorize('food_vendor', 'admin'), async (req, res, next) => {
  try {
    const { name, type, lat, lng, menu, group_packages } = req.body
    if (!name) return res.status(400).json({ success: false, message: 'name es requerido' })
    const [result] = await db.query(
      `INSERT INTO food_vendors (owner_id, name, type, lat, lng, menu, group_packages)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, name, type || 'restaurant', lat || null, lng || null,
       JSON.stringify(menu || []), JSON.stringify(group_packages || [])]
    )
    res.status(201).json({ success: true, vendor_id: result.insertId })
  } catch (err) { next(err) }
})

module.exports = router
