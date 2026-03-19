// routes/places.routes.js
const router = require('express').Router();
const db     = require('../config/db');
const redis  = require('../config/redis');

// GET /api/places/popular — lugares más visitados con cache Redis
router.get('/popular', async (req, res, next) => {
  try {
    const cached = await redis.get('places:popular');
    if (cached) return res.json({ success: true, data: JSON.parse(cached), cached: true });

    const [places] = await db.query(
      `SELECT id, name, description, lat, lng, category, visits_count, ai_tags, photos
       FROM places ORDER BY visits_count DESC LIMIT 20`
    );
    await redis.set('places:popular', JSON.stringify(places), { EX: 3600 });
    res.json({ success: true, data: places });
  } catch (err) { next(err); }
});

// GET /api/places/:id
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM places WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Lugar no encontrado' });
    await db.query('UPDATE places SET visits_count = visits_count + 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
