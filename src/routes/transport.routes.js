// routes/transport.routes.js — VisitaRD
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate, authorize } = require('../middleware/auth')

// GET /api/transport — todas las empresas
router.get('/', async (_req, res, next) => {
  try {
    const [companies] = await db.query(
      `SELECT * FROM transport_companies WHERE active = 1 ORDER BY type, name`
    )
    res.json({ success: true, data: companies })
  } catch (err) { next(err) }
})

// GET /api/transport/:id — empresa con rutas y horarios
router.get('/:id', async (req, res, next) => {
  try {
    const [companies] = await db.query(
      'SELECT * FROM transport_companies WHERE id = ?', [req.params.id]
    )
    if (!companies.length) return res.status(404).json({ success: false, message: 'No encontrado' })

    const [routes] = await db.query(
      `SELECT r.*, 
        JSON_ARRAYAGG(
          JSON_OBJECT('id', s.id, 'departure', s.departure, 'days', s.days, 'notes', s.notes)
        ) AS schedules
       FROM transport_routes r
       LEFT JOIN transport_schedules s ON s.route_id = r.id
       WHERE r.company_id = ? AND r.active = 1
       GROUP BY r.id
       ORDER BY r.origin, r.destination`,
      [req.params.id]
    )

    res.json({ success: true, data: { ...companies[0], routes } })
  } catch (err) { next(err) }
})

// POST /api/transport — crear empresa (admin)
router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, type, description, phone, website, logo } = req.body
    if (!name || !type) return res.status(400).json({ success: false, message: 'name y type son requeridos' })
    const [result] = await db.query(
      `INSERT INTO transport_companies (name, type, description, phone, website, logo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, type, description || null, phone || null, website || null, logo || null]
    )
    res.status(201).json({ success: true, id: result.insertId })
  } catch (err) { next(err) }
})

// PATCH /api/transport/:id — actualizar empresa (admin)
router.patch('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, description, phone, website, active } = req.body
    await db.query(
      `UPDATE transport_companies SET
        name        = COALESCE(?, name),
        description = COALESCE(?, description),
        phone       = COALESCE(?, phone),
        website     = COALESCE(?, website),
        active      = COALESCE(?, active)
       WHERE id = ?`,
      [name, description, phone, website, active, req.params.id]
    )
    res.json({ success: true })
  } catch (err) { next(err) }
})

// POST /api/transport/:id/routes — agregar ruta
router.post('/:id/routes', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { origin, destination, price, duration_min, notes } = req.body
    if (!origin || !destination) return res.status(400).json({ success: false, message: 'origin y destination son requeridos' })
    const [result] = await db.query(
      `INSERT INTO transport_routes (company_id, origin, destination, price, duration_min, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.id, origin, destination, price || null, duration_min || null, notes || null]
    )
    res.status(201).json({ success: true, route_id: result.insertId })
  } catch (err) { next(err) }
})

// POST /api/transport/routes/:routeId/schedules — agregar horario
router.post('/routes/:routeId/schedules', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { departure, days, notes } = req.body
    if (!departure) return res.status(400).json({ success: false, message: 'departure es requerido' })
    await db.query(
      `INSERT INTO transport_schedules (route_id, departure, days, notes) VALUES (?, ?, ?, ?)`,
      [req.params.routeId, departure, days || 'Lun-Dom', notes || null]
    )
    res.status(201).json({ success: true })
  } catch (err) { next(err) }
})

// DELETE /api/transport/routes/:routeId/schedules/:id — eliminar horario
router.delete('/routes/:routeId/schedules/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM transport_schedules WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) { next(err) }
})

// DELETE /api/transport/:id — eliminar empresa
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    await db.query('UPDATE transport_companies SET active = 0 WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) { next(err) }
})

module.exports = router
