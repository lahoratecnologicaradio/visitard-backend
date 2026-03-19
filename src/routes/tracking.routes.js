// routes/tracking.routes.js
const router = require('express').Router();
const redis  = require('../config/redis');
const { authenticate } = require('../middleware/auth');

// GET /api/tracking/:trip_id — última posición conocida del bus
router.get('/:trip_id', authenticate, async (req, res, next) => {
  try {
    const loc = await redis.get(`trip:tracking:${req.params.trip_id}`);
    res.json({ success: true, data: loc ? JSON.parse(loc) : null });
  } catch (err) { next(err); }
});

module.exports = router;
