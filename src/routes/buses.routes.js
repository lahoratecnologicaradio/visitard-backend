// routes/buses.routes.js — VisitaRD
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate, authorize } = require('../middleware/auth')

// GET /api/buses — listar buses disponibles (público)
router.get('/', async (req, res, next) => {
  try {
    const { lat, lng, radius = 50, date } = req.query

    let sql = `
      SELECT b.*, u.name AS owner_name, u.phone AS owner_phone, u.avatar AS owner_avatar
      FROM buses b
      JOIN users u ON b.owner_id = u.id
      WHERE b.verified = 1 AND b.available = 1
    `
    const params = []

    // Filtro por proximidad geográfica
    if (lat && lng) {
      sql += ` AND (
        6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(b.lat)) *
          COS(RADIANS(b.lng) - RADIANS(?)) +
          SIN(RADIANS(?)) * SIN(RADIANS(b.lat))
        )
      ) <= ?`
      params.push(lat, lng, lat, radius)
    }

    sql += ' ORDER BY b.created_at DESC'
    const [buses] = await db.query(sql, params)
    res.json({ success: true, data: buses })
  } catch (err) { next(err) }
})

// GET /api/buses/:id
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, u.name AS owner_name, u.phone AS owner_phone
       FROM buses b JOIN users u ON b.owner_id = u.id
       WHERE b.id = ?`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ success: false, message: 'Bus no encontrado' })
    res.json({ success: true, data: rows[0] })
  } catch (err) { next(err) }
})

// POST /api/buses — registrar bus (bus_owner)
router.post('/', authenticate, authorize('bus_owner', 'admin'), async (req, res, next) => {
  try {
    const { plate, capacity, type, model, year, lat, lng, price_per_day, photos } = req.body
    if (!plate || !capacity) {
      return res.status(400).json({ success: false, message: 'plate y capacity son requeridos' })
    }
    const [result] = await db.query(
      `INSERT INTO buses (owner_id, plate, capacity, type, model, year, lat, lng, price_per_day, photos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, plate, capacity, type || 'bus', model || null, year || null,
       lat || null, lng || null, price_per_day || null, JSON.stringify(photos || [])]
    )
    res.status(201).json({ success: true, bus_id: result.insertId })
  } catch (err) { next(err) }
})

// PATCH /api/buses/:id — actualizar bus
router.patch('/:id', authenticate, authorize('bus_owner', 'admin'), async (req, res, next) => {
  try {
    const { lat, lng, available, price_per_day } = req.body
    await db.query(
      `UPDATE buses SET
         lat           = COALESCE(?, lat),
         lng           = COALESCE(?, lng),
         available     = COALESCE(?, available),
         price_per_day = COALESCE(?, price_per_day)
       WHERE id = ? AND owner_id = ?`,
      [lat, lng, available, price_per_day, req.params.id, req.user.id]
    )
    res.json({ success: true })
  } catch (err) { next(err) }
})

// GET /api/buses/my — mis buses (autenticado)
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const [buses] = await db.query(
      `SELECT b.*, u.name AS owner_name, u.phone AS owner_phone
       FROM buses b JOIN users u ON b.owner_id = u.id
       WHERE b.owner_id = ?
       ORDER BY b.created_at DESC`,
      [req.user.id]
    )
    res.json({ success: true, data: buses })
  } catch (err) { next(err) }
})

module.exports = router
