// ============================================================
// routes/auth.routes.js — VisitaRD
// POST /api/auth/register
// POST /api/auth/login
// GET  /api/auth/me
// POST /api/auth/refresh
// ============================================================

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');
const { authenticate } = require('../middleware/auth');

// ── Helper: generar JWT ───────────────────────────────────────
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
}

// ════════════════════════════════════════════════════════════
// POST /api/auth/register
// Roles disponibles: tourist | agency | driver
// ════════════════════════════════════════════════════════════
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone, role = 'tourist' } = req.body;

    // Validación básica
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, email y contraseña son requeridos',
      });
    }

    // No se pueden registrar admins por esta ruta
    if (role === 'admin') {
      return res.status(403).json({ success: false, message: 'Rol no permitido' });
    }

    // Verificar email único
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()]
    );
    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: 'Este email ya está registrado',
      });
    }

    // Hash de contraseña
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insertar usuario
    const [result] = await db.query(
      `INSERT INTO users (name, email, password, phone, role)
       VALUES (?, ?, ?, ?, ?)`,
      [name, email.toLowerCase(), hashedPassword, phone || null, role]
    );

    const userId = result.insertId;

    // Si es agencia, crear registro en tabla agencies
    if (role === 'agency') {
      await db.query(
        'INSERT INTO agencies (user_id, name) VALUES (?, ?)',
        [userId, name]
      );
    }

    const token = generateToken({ id: userId, email, role, name });

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      token,
      user: { id: userId, name, email, role },
    });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/auth/login
// ════════════════════════════════════════════════════════════
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos',
      });
    }

    // Buscar usuario
    const [rows] = await db.query(
      'SELECT id, name, email, password, role, avatar, phone, verified FROM users WHERE email = ?',
      [email.toLowerCase()]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: 'Email o contraseña incorrectos',
      });
    }

    const user = rows[0];

    // Verificar contraseña
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Email o contraseña incorrectos',
      });
    }

    const token = generateToken(user);

    // Actualizar last_login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    res.json({
      success: true,
      token,
      user: {
        id:       user.id,
        name:     user.name,
        email:    user.email,
        role:     user.role,
        avatar:   user.avatar,
        phone:    user.phone,
        verified: Boolean(user.verified),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/auth/me  — requiere token
// ════════════════════════════════════════════════════════════
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role, avatar, phone, verified, rating, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    res.json({ success: true, user: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════
// PATCH /api/auth/profile — actualizar perfil
// ════════════════════════════════════════════════════════════
router.patch('/profile', authenticate, async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    await db.query(
      'UPDATE users SET name = ?, phone = ? WHERE id = ?',
      [name, phone, req.user.id]
    );
    res.json({ success: true, message: 'Perfil actualizado' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
