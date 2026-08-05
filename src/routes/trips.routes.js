// ============================================================
// routes/trips.routes.js - CaribGo
// CRUD de viajes + busqueda tipo Uber con mapa
// ============================================================

const router = require('express').Router();
const db     = require('../config/db');
const redis  = require('../config/redis');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/trips - listar viajes disponibles
router.get('/', async (req, res, next) => {
  try {
    const {
      origin,
      destination,
      date,
      page   = 1,
      limit  = 20,
      status = 'scheduled',
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `
      SELECT
        t.id, t.title, t.origin, t.destination,
        t.origin_lat, t.origin_lng, t.dest_lat, t.dest_lng,
        t.departure_at, t.seats, t.seats_available,
        t.price, t.status, t.bus_plate, t.currency,
        t.image_url, t.description, t.includes,
        a.name   AS agency_name,
        a.logo   AS agency_logo,
        a.rating AS agency_rating,
        u.avatar AS agency_avatar
      FROM trips t
      JOIN agencies a ON t.agency_id = a.id
      JOIN users u    ON a.user_id   = u.id
      WHERE t.status = ?
        AND t.departure_at > NOW()
        AND t.seats_available > 0
    `;

    const params = [status];

    if (origin) {
      sql += ' AND t.origin LIKE ?';
      params.push(`%${origin}%`);
    }
    if (destination) {
      sql += ' AND t.destination LIKE ?';
      params.push(`%${destination}%`);
    }
    if (date) {
      sql += ' AND DATE(t.departure_at) = ?';
      params.push(date);
    }

    sql += ' ORDER BY t.departure_at ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [trips] = await db.query(sql, params);

    const tripsWithLocation = await Promise.all(
      trips.map(async (trip) => {
        let current_location = null;
        try {
          const loc = await Promise.race([
            redis.get(`trip:tracking:${trip.id}`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))
          ]);
          current_location = loc ? JSON.parse(loc) : null;
        } catch {
          current_location = null;
        }
        return { ...trip, current_location };
      })
    );

    res.json({ success: true, data: tripsWithLocation, page: parseInt(page) });
  } catch (err) {
    next(err);
  }
});

// GET /api/trips/:id - detalle de un viaje
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT
         t.*,
         a.name AS agency_name, a.logo AS agency_logo,
         a.rating AS agency_rating, a.description AS agency_description,
         u.phone AS agency_phone
       FROM trips t
       JOIN agencies a ON t.agency_id = a.id
       JOIN users u    ON a.user_id   = u.id
       WHERE t.id = ?`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Viaje no encontrado' });
    }

    const trip = rows[0];

    const loc = await redis.get(`trip:tracking:${trip.id}`);
    trip.current_location = loc ? JSON.parse(loc) : null;

    const [reviews] = await db.query(
      `SELECT r.rating, r.comment, u.name AS reviewer_name, u.avatar, r.created_at
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.target_id = ? AND r.target_type = 'agency'
       ORDER BY r.created_at DESC LIMIT 5`,
      [trip.agency_id]
    );

    trip.recent_reviews = reviews;

    res.json({ success: true, data: trip });
  } catch (err) {
    next(err);
  }
});

// POST /api/trips - crear viaje (agencias y admin)
router.post('/', authenticate, authorize('agency', 'admin'), async (req, res, next) => {
  try {
    const {
      title, description, image_url, includes,
      origin, destination,
      origin_lat, origin_lng,
      dest_lat, dest_lng,
      departure_at, seats, price,
      bus_plate, agency_id: bodyAgencyId,
    } = req.body;

    if (!title || !origin || !destination || !departure_at || !seats || !price) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos: title, origin, destination, departure_at, seats, price',
      });
    }

    let agency_id = bodyAgencyId;

    // Si no viene agency_id en el body (agencia logueada), buscarlo
    if (!agency_id) {
      const [agRows] = await db.query(
        'SELECT id FROM agencies WHERE user_id = ?',
        [req.user.id]
      );
      if (!agRows.length) {
        return res.status(403).json({ success: false, message: 'Cuenta de agencia no encontrada' });
      }
      agency_id = agRows[0].id;
    }

    const includesVal = includes
      ? (Array.isArray(includes) ? JSON.stringify(includes) : includes)
      : null;

    const [result] = await db.query(
      `INSERT INTO trips
         (agency_id, title, description, image_url, includes,
          origin, destination,
          origin_lat, origin_lng, dest_lat, dest_lng,
          departure_at, seats, seats_available, price, bus_plate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agency_id, title, description || null, image_url || null, includesVal,
        origin, destination,
        origin_lat || null, origin_lng || null,
        dest_lat   || null, dest_lng   || null,
        departure_at, seats, seats, price,
        bus_plate || null,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Viaje publicado exitosamente',
      trip_id: result.insertId,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/trips/:id - actualizar viaje
router.patch('/:id', authenticate, authorize('agency', 'admin'), async (req, res, next) => {
  try {
    const {
      title, description, price, seats, departure_at,
      status, bus_plate, image_url, includes, currency,
      origin, destination: dest,
      origin_lat, origin_lng, dest_lat, dest_lng,
    } = req.body;

    const includesVal = includes
      ? (Array.isArray(includes) ? JSON.stringify(includes) : includes)
      : null;

    await db.query(
      `UPDATE trips SET
         title        = COALESCE(?, title),
         image_url    = COALESCE(?, image_url),
         description  = COALESCE(?, description),
         includes     = COALESCE(?, includes),
         origin       = COALESCE(?, origin),
         destination  = COALESCE(?, destination),
         origin_lat   = COALESCE(?, origin_lat),
         origin_lng   = COALESCE(?, origin_lng),
         dest_lat     = COALESCE(?, dest_lat),
         dest_lng     = COALESCE(?, dest_lng),
         price        = COALESCE(?, price),
         seats        = COALESCE(?, seats),
         departure_at = COALESCE(?, departure_at),
         status       = COALESCE(?, status),
         bus_plate    = COALESCE(?, bus_plate),
         currency     = COALESCE(?, currency),
         updated_at   = NOW()
       WHERE id = ?`,
      [
        title, image_url, description, includesVal,
        origin, dest,
        origin_lat || null, origin_lng || null,
        dest_lat   || null, dest_lng   || null,
        price, seats, departure_at, status, bus_plate, currency || 'DOP', currency || 'DOP', currency || 'DOP',
        req.params.id,
      ]
    );

    res.json({ success: true, message: 'Viaje actualizado' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/trips/:id - solo admin
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM trips WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Viaje eliminado' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;




