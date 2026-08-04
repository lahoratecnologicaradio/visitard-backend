// ============================================================
// settings.routes.js — CaribGo · Rutas de Configuración Frontend
// Carousel, banners, contenido visible en el sitio web
// ============================================================
const express    = require('express')
const cloudinary = require('cloudinary').v2
const { pool }   = require('../config/db')
const router     = express.Router()

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// GET /api/settings/carousel — obtener slides activos
router.get('/carousel', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM hero_slides WHERE active = 1 ORDER BY sort_order ASC'
    )
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('GET /settings/carousel:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /api/settings/carousel/all — todos los slides (admin)
router.get('/carousel/all', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM hero_slides ORDER BY sort_order ASC'
    )
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('GET /settings/carousel/all:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /api/settings/carousel — crear slide
router.post('/carousel', async (req, res) => {
  try {
    const { img, title, highlight, sub, tag, sort_order = 0, active = 1 } = req.body
    if (!img) return res.status(400).json({ success: false, message: 'La imagen es requerida' })

    const [result] = await pool.query(
      'INSERT INTO hero_slides (img, title, highlight, sub, tag, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [img, title || '', highlight || '', sub || '', tag || '', sort_order, active ? 1 : 0]
    )
    const [rows] = await pool.query('SELECT * FROM hero_slides WHERE id = ?', [result.insertId])
    res.status(201).json({ success: true, data: rows[0] })
  } catch (err) {
    console.error('POST /settings/carousel:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /api/settings/carousel/:id — actualizar slide
router.put('/carousel/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { img, title, highlight, sub, tag, sort_order, active } = req.body

    await pool.query(
      `UPDATE hero_slides SET
        img        = COALESCE(?, img),
        title      = COALESCE(?, title),
        highlight  = COALESCE(?, highlight),
        sub        = COALESCE(?, sub),
        tag        = COALESCE(?, tag),
        sort_order = COALESCE(?, sort_order),
        active     = COALESCE(?, active),
        updated_at = NOW()
      WHERE id = ?`,
      [img, title, highlight, sub, tag, sort_order,
       active !== undefined ? (active ? 1 : 0) : undefined, id]
    )
    const [rows] = await pool.query('SELECT * FROM hero_slides WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Slide no encontrado' })
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    console.error('PUT /settings/carousel/:id:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// PATCH /api/settings/carousel/:id/toggle — activar/desactivar
router.patch('/carousel/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params
    await pool.query('UPDATE hero_slides SET active = NOT active WHERE id = ?', [id])
    const [rows] = await pool.query('SELECT * FROM hero_slides WHERE id = ?', [id])
    res.json({ success: true, data: rows[0] })
  } catch (err) {
    console.error('PATCH /settings/carousel/:id/toggle:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// DELETE /api/settings/carousel/:id — eliminar slide
router.delete('/carousel/:id', async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query('SELECT id FROM hero_slides WHERE id = ?', [id])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Slide no encontrado' })
    await pool.query('DELETE FROM hero_slides WHERE id = ?', [id])
    res.json({ success: true, message: 'Slide eliminado' })
  } catch (err) {
    console.error('DELETE /settings/carousel/:id:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
