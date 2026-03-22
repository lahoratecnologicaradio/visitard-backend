// routes/rentals.routes.js — VisitaRD
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate } = require('../middleware/auth')

// GET /api/rentals — listar inmuebles públicos
router.get('/', async (req, res, next) => {
  try {
    const { city, type, min_price, max_price, furnished } = req.query
    let sql = `
      SELECT r.*, u.name AS owner_name, u.phone AS owner_phone, u.avatar AS owner_avatar,
        (SELECT AVG(rating) FROM rental_reviews WHERE rental_id = r.id) AS avg_rating,
        (SELECT COUNT(*) FROM rental_reviews WHERE rental_id = r.id) AS review_count
      FROM rentals r
      JOIN users u ON r.owner_id = u.id
      WHERE r.available = 1 AND r.verified = 1
    `
    const params = []
    if (city)      { sql += ' AND r.city LIKE ?';          params.push(`%${city}%`) }
    if (type)      { sql += ' AND r.type = ?';             params.push(type) }
    if (min_price) { sql += ' AND r.price_per_month >= ?'; params.push(min_price) }
    if (max_price) { sql += ' AND r.price_per_month <= ?'; params.push(max_price) }
    if (furnished !== undefined) { sql += ' AND r.furnished = ?'; params.push(furnished) }
    sql += ' ORDER BY r.created_at DESC'
    const [rows] = await db.query(sql, params)
    res.json({ success: true, data: rows })
  } catch (err) { next(err) }
})

// GET /api/rentals/my — mis inmuebles (propietario)
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*,
        (SELECT AVG(rating) FROM rental_reviews WHERE rental_id = r.id) AS avg_rating,
        (SELECT COUNT(*) FROM rental_reviews WHERE rental_id = r.id) AS review_count,
        (SELECT COUNT(*) FROM rental_requests WHERE rental_id = r.id AND status = 'pending') AS pending_requests
       FROM rentals r WHERE r.owner_id = ? ORDER BY r.created_at DESC`,
      [req.user.id]
    )
    res.json({ success: true, data: rows })
  } catch (err) { next(err) }
})

// GET /api/rentals/:id — detalle de inmueble
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, u.name AS owner_name, u.phone AS owner_phone, u.avatar AS owner_avatar,
        (SELECT AVG(rating) FROM rental_reviews WHERE rental_id = r.id) AS avg_rating,
        (SELECT COUNT(*) FROM rental_reviews WHERE rental_id = r.id) AS review_count
       FROM rentals r JOIN users u ON r.owner_id = u.id WHERE r.id = ?`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ success: false, message: 'No encontrado' })
    const [reviews] = await db.query(
      `SELECT rr.*, u.name AS reviewer_name, u.avatar AS reviewer_avatar
       FROM rental_reviews rr JOIN users u ON rr.reviewer_id = u.id
       WHERE rr.rental_id = ? ORDER BY rr.created_at DESC LIMIT 10`,
      [req.params.id]
    )
    const [requests] = await db.query(
      `SELECT rq.*, u.name AS requester_name, u.phone AS requester_phone, u.avatar AS requester_avatar,
        (SELECT AVG(rating) FROM rental_reviews WHERE reviewer_id = rq.requester_id) AS requester_rating
       FROM rental_requests rq JOIN users u ON rq.requester_id = u.id
       WHERE rq.rental_id = ? ORDER BY rq.created_at DESC`,
      [req.params.id]
    )
    res.json({ success: true, data: { ...rows[0], reviews, requests } })
  } catch (err) { next(err) }
})

// POST /api/rentals — crear inmueble
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { title, description, type, address, zone, city, lat, lng,
            price_per_month, deposit, bedrooms, bathrooms, area_m2,
            furnished, noisy_zone, amenities, photos, videos } = req.body
    if (!title || !price_per_month) {
      return res.status(400).json({ success: false, message: 'title y price_per_month son requeridos' })
    }
    const [result] = await db.query(
      `INSERT INTO rentals (owner_id, title, description, type, address, zone, city, lat, lng,
        price_per_month, deposit, bedrooms, bathrooms, area_m2, furnished, noisy_zone, amenities, photos, videos)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, title, description||null, type||'apartamento', address||null, zone||null, city||null,
       lat||null, lng||null, price_per_month, deposit||null, bedrooms||1, bathrooms||1, area_m2||null,
       furnished?1:0, noisy_zone?1:0, JSON.stringify(amenities||[]),
       JSON.stringify(photos||[]), JSON.stringify(videos||[])]
    )
    res.status(201).json({ success: true, rental_id: result.insertId })
  } catch (err) { next(err) }
})

// PATCH /api/rentals/:id — actualizar
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const { title, description, price_per_month, deposit, available, photos, videos } = req.body
    await db.query(
      `UPDATE rentals SET
        title           = COALESCE(?, title),
        description     = COALESCE(?, description),
        price_per_month = COALESCE(?, price_per_month),
        deposit         = COALESCE(?, deposit),
        available       = COALESCE(?, available),
        photos          = COALESCE(?, photos),
        videos          = COALESCE(?, videos)
       WHERE id = ? AND owner_id = ?`,
      [title, description, price_per_month, deposit, available,
       photos ? JSON.stringify(photos) : null,
       videos ? JSON.stringify(videos) : null,
       req.params.id, req.user.id]
    )
    res.json({ success: true })
  } catch (err) { next(err) }
})

// POST /api/rentals/:id/request — solicitar alquiler
router.post('/:id/request', authenticate, async (req, res, next) => {
  try {
    const { move_in_date, duration_months, message } = req.body
    await db.query(
      `INSERT INTO rental_requests (rental_id, requester_id, move_in_date, duration_months, message)
       VALUES (?,?,?,?,?)`,
      [req.params.id, req.user.id, move_in_date||null, duration_months||1, message||null]
    )
    res.status(201).json({ success: true, message: 'Solicitud enviada al propietario' })
  } catch (err) { next(err) }
})

// POST /api/rentals/:id/reviews — dejar reseña
router.post('/:id/reviews', authenticate, async (req, res, next) => {
  try {
    const { rating, comment } = req.body
    if (!rating) return res.status(400).json({ success: false, message: 'rating es requerido' })
    await db.query(
      `INSERT INTO rental_reviews (rental_id, reviewer_id, rating, comment) VALUES (?,?,?,?)`,
      [req.params.id, req.user.id, rating, comment||null]
    )
    res.status(201).json({ success: true })
  } catch (err) { next(err) }
})

// PATCH /api/rentals/requests/:id — aprobar/rechazar solicitud
router.patch('/requests/:id', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body
    await db.query('UPDATE rental_requests SET status = ? WHERE id = ?', [status, req.params.id])
    res.json({ success: true })
  } catch (err) { next(err) }
})

module.exports = router
