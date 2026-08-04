const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken, requireAdmin } = require('../middleware/auth')

// GET /api/slides — público, para el frontend
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM hero_slides ORDER BY sort_order ASC, id ASC'
    )
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('GET /slides:', err)
    res.status(500).json({ success: false, message: 'Error al obtener slides' })
  }
})

// GET /api/slides/active — solo slides activos (para el hero del frontend)
router.get('/active', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM hero_slides WHERE active = 1 ORDER BY sort_order ASC'
    )
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('GET /slides/active:', err)
    res.status(500).json({ success: false, message: 'Error al obtener slides' })
  }
})

// POST /api/slides — crear slide (solo admin)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { img, title, highlight, sub, tag, sort_order = 0, active = 1 } = req.body
    if (!img) return res.status(400).json({ success: false, message: 'La imagen es requerida' })

    const [result] = await db.query(
      'INSERT INTO hero_slides (img, title, highlight, sub, tag, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [img, title || '', highlight || '', sub || '', tag || '', sort_order, active ? 1 : 0]
    )
    const [rows] = await db.query('SELECT * FROM hero_slides WHERE id = ?', [result.insertId])
    res.status(201).json({ success: true, data: rows[0] })
  } catch (err) {
    console.error('POST /slides:', err)
    res.status(500).json({ success: false, message: 'Error al crear slide' })
  }
})

// PUT /api/slides/:id — actualizar slide (solo admin)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { img, title, highlight, sub, tag, sort_order, active } = req.body

    await db.query(
      `UPDATE hero_slides SET
        img        = COALESCE(?, img),
        title      = COALESCE(?, title),
        highlight  = COALESCE(?, highlight),
        sub        = COALESCE(?, sub),
        tag        = COALESCE(?, tag),
        sort_order = COALESCE(?, sort_order),
        active     = COALESCE(?, active)
      WHERE id = ?`,
      [img, title, highlight, sub, tag, sort_order, active !== undefined ? (active ? 1 : 0) : undefined, id]
    )
    const [rows] = await db.query('SELECT * FROM hero_slides WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Slide no encontrado' })
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    console.error('PUT /slides/:id:', err)
    res.status(500).json({ success: false, message: 'Error al actualizar slide' })
  }
})

// PATCH /api/slides/:id/toggle — activar/desactivar (solo admin)
router.patch('/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    await db.query('UPDATE hero_slides SET active = NOT active WHERE id = ?', [id])
    const [rows] = await db.query('SELECT * FROM hero_slides WHERE id = ?', [id])
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    console.error('PATCH /slides/:id/toggle:', err)
    res.status(500).json({ success: false, message: 'Error al cambiar estado' })
  }
})

// DELETE /api/slides/:id — eliminar slide (solo admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await db.query('SELECT id FROM hero_slides WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Slide no encontrado' })
    await db.query('DELETE FROM hero_slides WHERE id = ?', [id])
    res.json({ success: true, message: 'Slide eliminado' })
  } catch (err) {
    console.error('DELETE /slides/:id:', err)
    res.status(500).json({ success: false, message: 'Error al eliminar slide' })
  }
})

// PUT /api/slides/reorder — reordenar slides (solo admin)
router.put('/reorder', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { order } = req.body // [{ id: 1, sort_order: 0 }, ...]
    if (!Array.isArray(order)) return res.status(400).json({ success: false, message: 'order debe ser un array' })
    await Promise.all(
      order.map(({ id, sort_order }) =>
        db.query('UPDATE hero_slides SET sort_order = ? WHERE id = ?', [sort_order, id])
      )
    )
    res.json({ success: true, message: 'Orden actualizado' })
  } catch (err) {
    console.error('PUT /slides/reorder:', err)
    res.status(500).json({ success: false, message: 'Error al reordenar' })
  }
})

module.exports = router
