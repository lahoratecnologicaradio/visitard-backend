// routes/notifications.routes.js — VisitaRD
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate } = require('../middleware/auth')

// Guardar token push del dispositivo
router.post('/token', authenticate, async (req, res, next) => {
  try {
    const { token, platform } = req.body
    if (!token) return res.status(400).json({ success: false, message: 'token requerido' })

    // Upsert — actualizar si existe, insertar si no
    await db.query(
      `INSERT INTO push_tokens (user_id, token, platform, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE token = VALUES(token), updated_at = NOW()`,
      [req.user.id, token, platform || 'unknown']
    )

    res.json({ success: true, message: 'Token guardado' })
  } catch (err) { next(err) }
})

// Enviar notificación a usuarios cercanos (dueños de bus)
router.post('/send-to-nearby-buses', authenticate, async (req, res, next) => {
  try {
    const { lat, lng, radius = 100, title, body, data } = req.body

    // Obtener dueños de bus en radio
    const [buses] = await db.query(
      `SELECT DISTINCT pt.token
       FROM buses b
       JOIN push_tokens pt ON pt.user_id = b.owner_id
       WHERE b.available = 1
         AND b.lat IS NOT NULL
         AND (
           6371 * ACOS(
             COS(RADIANS(?)) * COS(RADIANS(b.lat)) *
             COS(RADIANS(b.lng) - RADIANS(?)) +
             SIN(RADIANS(?)) * SIN(RADIANS(b.lat))
           )
         ) <= ?`,
      [lat, lng, lat, radius]
    )

    if (buses.length === 0) {
      return res.json({ success: true, sent: 0, message: 'No hay buses en el área' })
    }

    // Enviar via Expo Push API
    const tokens  = buses.map((b) => b.token)
    const messages = tokens.map((token) => ({
      to:    token,
      sound: 'default',
      title,
      body,
      data:  data || {},
      channelId: 'buses',
    }))

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(messages),
    })

    const result = await response.json()
    res.json({ success: true, sent: tokens.length, result })
  } catch (err) { next(err) }
})

// Enviar notificación a un usuario específico
router.post('/send-to-user', authenticate, async (req, res, next) => {
  try {
    const { user_id, title, body, data } = req.body

    const [tokens] = await db.query(
      'SELECT token FROM push_tokens WHERE user_id = ?',
      [user_id]
    )

    if (!tokens.length) {
      return res.json({ success: false, message: 'Usuario sin token push' })
    }

    const messages = tokens.map((t: { token: string }) => ({
      to:    t.token,
      sound: 'default',
      title,
      body,
      data:  data || {},
    }))

    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(messages),
    })

    res.json({ success: true, sent: tokens.length })
  } catch (err) { next(err) }
})

// Notificaciones del usuario actual
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const [notifs] = await db.query(
      `SELECT * FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    )
    res.json({ success: true, data: notifs })
  } catch (err) { next(err) }
})

// Marcar notificación como leída
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    await db.query(
      'UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    )
    res.json({ success: true })
  } catch (err) { next(err) }
})

module.exports = router
EOF
