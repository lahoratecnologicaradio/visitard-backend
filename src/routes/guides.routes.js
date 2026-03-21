// routes/guides.routes.js — VisitaRD
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate, authorize } = require('../middleware/auth')

// GET /api/guides — listar guías disponibles
router.get('/', async (req, res, next) => {
  try {
    const { zone, language } = req.query
    let sql = `
      SELECT g.*, u.name, u.avatar, u.phone
      FROM guides g
      JOIN users u ON g.user_id = u.id
      WHERE g.verified = 1 AND g.available = 1
    `
    const params = []
    if (zone) { sql += ' AND JSON_CONTAINS(g.zones, ?)'; params.push(JSON.stringify(zone)) }
    if (language) { sql += ' AND JSON_CONTAINS(g.languages, ?)'; params.push(JSON.stringify(language)) }
    sql += ' ORDER BY g.rating DESC'
    const [guides] = await db.query(sql, params)
    res.json({ success: true, data: guides })
  } catch (err) { next(err) }
})

// POST /api/guides — crear perfil de guía
router.post('/', authenticate, authorize('guide', 'admin'), async (req, res, next) => {
  try {
    const { languages, specialties, zones, price_per_day, bio } = req.body
    const [result] = await db.query(
      `INSERT INTO guides (user_id, languages, specialties, zones, price_per_day, bio)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, JSON.stringify(languages || []), JSON.stringify(specialties || []),
       JSON.stringify(zones || []), price_per_day || null, bio || null]
    )
    res.status(201).json({ success: true, guide_id: result.insertId })
  } catch (err) { next(err) }
})

module.exports = router
