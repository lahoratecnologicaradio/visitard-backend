// routes/admin.routes.js
const router = require('express').Router();
const db     = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

// Todas las rutas admin requieren rol admin
router.use(authenticate, authorize('admin'));

// GET /api/admin/dashboard — métricas generales
router.get('/dashboard', async (_req, res, next) => {
  try {
    const [[users]]    = await db.query('SELECT COUNT(*) AS total FROM users');
    const [[trips]]    = await db.query('SELECT COUNT(*) AS total FROM trips');
    const [[bookings]] = await db.query("SELECT COUNT(*) AS total FROM bookings WHERE status = 'confirmed'");
    const [[revenue]]  = await db.query("SELECT COALESCE(SUM(total_price),0) AS total FROM bookings WHERE status = 'confirmed'");
    const [activeTrips] = await db.query(
      "SELECT id, title, origin, destination, status, departure_at FROM trips WHERE status IN ('boarding','in_progress')"
    );

    res.json({
      success: true,
      data: {
        total_users:    users.total,
        total_trips:    trips.total,
        total_bookings: bookings.total,
        total_revenue:  revenue.total,
        active_trips:   activeTrips,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, role } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let sql    = 'SELECT id, name, email, role, verified, created_at, last_login FROM users';
    const args = [];
    if (role) { sql += ' WHERE role = ?'; args.push(role); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    args.push(parseInt(limit), offset);
    const [users] = await db.query(sql, args);
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
});

// PATCH /api/admin/users/:id/verify — verificar agencia
router.patch('/users/:id/verify', async (req, res, next) => {
  try {
    await db.query('UPDATE users SET verified = 1 WHERE id = ?', [req.params.id]);
    await db.query('UPDATE agencies SET verified = 1 WHERE user_id = ?', [req.params.id]);
    res.json({ success: true, message: 'Usuario verificado' });
  } catch (err) { next(err); }
});

// DELETE /api/admin/trips/:id — eliminar viaje
router.delete('/trips/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM trips WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Viaje eliminado' });
  } catch (err) { next(err); }
});

// PATCH /api/admin/agencies/:userId
router.patch('/agencies/:userId', async (req, res, next) => {
  try {
    const { description, commission_rate, ruc } = req.body
    await db.query(
      `UPDATE agencies SET
         description     = COALESCE(?, description),
         commission_rate = COALESCE(?, commission_rate),
         ruc             = COALESCE(?, ruc)
       WHERE user_id = ?`,
      [description, commission_rate, ruc, req.params.userId]
    )
    res.json({ success: true })
  } catch (err) { next(err) }
})

// GET /api/admin/agencies
router.get('/agencies', async (_req, res, next) => {
  try {
    const [agencies] = await db.query(
      `SELECT a.*, u.email AS user_email, u.name AS user_name, u.phone
       FROM agencies a
       JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC`
    )
    res.json({ success: true, data: agencies })
  } catch (err) { next(err) }
})

module.exports = router;
