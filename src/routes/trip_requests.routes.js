// routes/trip_requests.routes.js — CaribGo
// Sistema de solicitudes de viaje: turista solicita → agencia acepta/rechaza

const router = require('express').Router()
const db     = require('../config/db')
const { authenticate, authorize } = require('../middleware/auth')

// ════════════════════════════════════════════════════════════
// POST /api/trip-requests — crear solicitud (turista)
// ════════════════════════════════════════════════════════════
router.post('/', authenticate, authorize('tourist', 'admin'), async (req, res, next) => {
  try {
    const { origin, destination, origin_lat, origin_lng, dest_lat, dest_lng, passengers = 1, preferred_date } = req.body

    if (!origin || !destination) {
      return res.status(400).json({ success: false, message: 'origin y destination son requeridos' })
    }

    // Crear solicitud
    const [result] = await db.query(
      `INSERT INTO trip_requests 
       (requester_id, origin, destination, origin_lat, origin_lng, dest_lat, dest_lng, passengers, preferred_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [req.user.id, origin, destination, origin_lat || null, origin_lng || null, 
       dest_lat || null, dest_lng || null, passengers, preferred_date || null]
    )

    const requestId = result.insertId

    // Buscar agencias cercanas con viajes a ese destino
    const [agencies] = await db.query(`
      SELECT DISTINCT a.id, a.user_id, pt.token
      FROM agencies a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN push_tokens pt ON pt.user_id = a.user_id
      JOIN trips t ON t.agency_id = a.id
      WHERE t.destination LIKE ?
        AND t.status = 'scheduled'
        AND t.seats_available > 0
      LIMIT 10
    `, [`%${destination}%`])

    // Enviar notificaciones push a las agencias
    if (agencies.length > 0) {
      const messages = agencies
        .filter(a => a.token)
        .map(a => ({
          to: a.token,
          sound: 'default',
          title: '🎯 Nueva solicitud de viaje',
          body: `${req.user.name} solicita un viaje a ${destination}`,
          data: {
            request_id: requestId.toString(),
            type: 'trip_request',
            origin,
            destination,
            passengers
          },
          channelId: 'trip_requests'
        }))

      if (messages.length > 0) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messages)
        }).catch(err => console.error('Push error:', err))
      }
    }

    res.status(201).json({
      success: true,
      request_id: requestId,
      message: 'Solicitud enviada. Las agencias serán notificadas.',
      agencies_notified: agencies.length
    })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// GET /api/trip-requests/my — mis solicitudes (turista)
// ════════════════════════════════════════════════════════════
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const [requests] = await db.query(`
      SELECT 
        tr.id, tr.origin, tr.destination, tr.passengers, 
        tr.preferred_date, tr.status, tr.created_at,
        u.name AS requester_name, u.avatar AS requester_avatar,
        a.name AS agency_name, a.logo AS agency_logo,
        (SELECT COUNT(*) FROM trips t WHERE t.destination LIKE CONCAT('%', tr.destination, '%') AND t.status = 'scheduled') AS available_trips
      FROM trip_requests tr
      JOIN users u ON tr.requester_id = u.id
      LEFT JOIN agencies a ON tr.accepted_by_agency = a.id
      WHERE tr.requester_id = ?
      ORDER BY tr.created_at DESC
    `, [req.user.id])

    res.json({ success: true, data: requests })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// GET /api/trip-requests/agency/pending — solicitudes pendientes (agencia)
// ════════════════════════════════════════════════════════════
router.get('/agency/pending', authenticate, authorize('agency', 'admin'), async (req, res, next) => {
  try {
    // Obtener agency_id
    const [agRows] = await db.query('SELECT id FROM agencies WHERE user_id = ?', [req.user.id])
    if (!agRows.length) return res.status(404).json({ success: false, message: 'Agencia no encontrada' })
    const agencyId = agRows[0].id

    // Solicitudes pendientes para esta agencia
    const [requests] = await db.query(`
      SELECT 
        tr.id, tr.origin, tr.destination, tr.passengers, 
        tr.preferred_date, tr.status, tr.created_at,
        u.id AS requester_id, u.name AS requester_name, u.avatar AS requester_avatar,
        u.phone AS requester_phone, u.email AS requester_email,
        (SELECT COUNT(*) FROM trips t 
         WHERE t.destination LIKE CONCAT('%', tr.destination, '%') 
           AND t.agency_id = ? 
           AND t.status = 'scheduled' 
           AND t.seats_available > 0) AS available_trips
      FROM trip_requests tr
      JOIN users u ON tr.requester_id = u.id
      WHERE tr.status = 'pending'
        AND tr.destination IN (
          SELECT DISTINCT destination FROM trips WHERE agency_id = ? AND status = 'scheduled'
        )
      ORDER BY tr.created_at DESC
    `, [agencyId, agencyId])

    res.json({ success: true, data: requests })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// PATCH /api/trip-requests/:id/accept — agencia acepta solicitud
// ════════════════════════════════════════════════════════════
router.patch('/:id/accept', authenticate, authorize('agency', 'admin'), async (req, res, next) => {
  try {
    const { trip_id } = req.body

    // Obtener agency_id
    const [agRows] = await db.query('SELECT id FROM agencies WHERE user_id = ?', [req.user.id])
    if (!agRows.length) return res.status(404).json({ success: false, message: 'Agencia no encontrada' })
    const agencyId = agRows[0].id

    // Obtener datos de solicitud
    const [requests] = await db.query(
      'SELECT * FROM trip_requests WHERE id = ?',
      [req.params.id]
    )
    if (!requests.length) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })
    const request = requests[0]

    // Actualizar solicitud como aceptada
    await db.query(
      'UPDATE trip_requests SET status = ?, accepted_by_agency = ?, accepted_at = NOW() WHERE id = ?',
      ['accepted', agencyId, req.params.id]
    )

    // Si se proporciona trip_id, crear booking automáticamente
    if (trip_id) {
      const [trips] = await db.query(
        'SELECT price FROM trips WHERE id = ? AND agency_id = ? AND seats_available > 0',
        [trip_id, agencyId]
      )
      
      if (trips.length > 0) {
        const totalPrice = trips[0].price * request.passengers
        
        await db.query(
          `INSERT INTO bookings (trip_id, user_id, seats, total_price, status)
           VALUES (?, ?, ?, ?, 'confirmed')`,
          [trip_id, request.requester_id, request.passengers, totalPrice]
        )

        // Reducir asientos disponibles
        await db.query(
          'UPDATE trips SET seats_available = seats_available - ? WHERE id = ?',
          [request.passengers, trip_id]
        )
      }
    }

    // Enviar notificación al turista
    const [tokens] = await db.query(
      'SELECT token FROM push_tokens WHERE user_id = ?',
      [request.requester_id]
    )

    if (tokens.length > 0) {
      const messages = tokens.map(t => ({
        to: t.token,
        sound: 'default',
        title: '✅ Solicitud aceptada',
        body: `La agencia ha aceptado tu solicitud a ${request.destination}`,
        data: { request_id: req.params.id, type: 'request_accepted' }
      }))

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages)
      }).catch(err => console.error('Push error:', err))
    }

    res.json({ success: true, message: 'Solicitud aceptada' })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// PATCH /api/trip-requests/:id/reject — agencia rechaza solicitud
// ════════════════════════════════════════════════════════════
router.patch('/:id/reject', authenticate, authorize('agency', 'admin'), async (req, res, next) => {
  try {
    const { reason } = req.body

    // Obtener datos de solicitud
    const [requests] = await db.query(
      'SELECT requester_id, destination FROM trip_requests WHERE id = ?',
      [req.params.id]
    )
    if (!requests.length) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })

    // Actualizar solicitud como rechazada
    await db.query(
      'UPDATE trip_requests SET status = ?, rejected_reason = ?, rejected_at = NOW() WHERE id = ?',
      ['rejected', reason || 'Sin especificar', req.params.id]
    )

    // Notificar al turista
    const [tokens] = await db.query(
      'SELECT token FROM push_tokens WHERE user_id = ?',
      [requests[0].requester_id]
    )

    if (tokens.length > 0) {
      const messages = tokens.map(t => ({
        to: t.token,
        sound: 'default',
        title: '❌ Solicitud rechazada',
        body: `La agencia no puede atender tu solicitud a ${requests[0].destination}`,
        data: { request_id: req.params.id, type: 'request_rejected', reason: reason || 'Sin especificar' }
      }))

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages)
      }).catch(err => console.error('Push error:', err))
    }

    res.json({ success: true, message: 'Solicitud rechazada' })
  } catch (err) { next(err) }
})

// ════════════════════════════════════════════════════════════
// GET /api/trips/by-destination/:destination — viajes disponibles por destino
// ════════════════════════════════════════════════════════════
router.get('/trips/by-destination/:destination', async (req, res, next) => {
  try {
    const { destination } = req.params

    const [trips] = await db.query(`
      SELECT
        t.id, t.title, t.origin, t.destination,
        t.origin_lat, t.origin_lng, t.dest_lat, t.dest_lng,
        t.departure_at, t.seats, t.seats_available,
        t.price, t.status, t.image_url, t.includes,
        a.name AS agency_name, a.logo AS agency_logo, a.rating AS agency_rating,
        u.avatar AS agency_avatar
      FROM trips t
      JOIN agencies a ON t.agency_id = a.id
      JOIN users u ON a.user_id = u.id
      WHERE t.destination LIKE ?
        AND t.status = 'scheduled'
        AND t.departure_at > NOW()
        AND t.seats_available > 0
      ORDER BY t.departure_at ASC
    `, [`%${destination}%`])

    res.json({ success: true, data: trips })
  } catch (err) { next(err) }
})

module.exports = router
