// ============================================================
// settings.routes.js — CaribGo · Rutas de Configuración Frontend
// Carousel, banners, contenido visible en el sitio web
// ============================================================

const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { pool } = require('../config/db');

const router = express.Router();

// ════════════════════════════════════════════════════════════
// CONFIGURACIÓN MULTER + CLOUDINARY
// ════════════════════════════════════════════════════════════

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'));
    }
  },
});

// ════════════════════════════════════════════════════════════
// CAROUSEL
// ════════════════════════════════════════════════════════════

// GET /api/settings/carousel - Obtener todos los slides
router.get('/carousel', async (req, res, next) => {
  try {
    const [slides] = await pool.query(`
      SELECT id, image, title, description, highlight, created_at, updated_at
      FROM carousel_slides
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      data: slides,
    });
  } catch (error) {
    console.error('Error GET /carousel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/settings/carousel/upload - Upload imagen a Cloudinary
router.post('/carousel/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se envió archivo' });
    }

    // Subir a Cloudinary
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'caribgo/carousel',
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) {
          console.error('Error Cloudinary:', error);
          return res.status(500).json({ success: false, error: 'Error al subir foto' });
        }

        res.json({
          success: true,
          url: result.secure_url,
          public_id: result.public_id,
        });
      }
    );

    uploadStream.end(req.file.buffer);
  } catch (error) {
    console.error('Error POST /carousel/upload:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/settings/carousel/slide - Guardar nuevo slide
router.post('/carousel/slide', async (req, res, next) => {
  try {
    const { id, image, title, description, highlight } = req.body;

    if (!image || !title) {
      return res.status(400).json({
        success: false,
        error: 'Imagen y título son requeridos',
      });
    }

    // Insertar en BD
    const [result] = await pool.query(
      `INSERT INTO carousel_slides (id, image, title, description, highlight, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [id, image, title, description || '', highlight || 'default']
    );

    res.status(201).json({
      success: true,
      data: {
        id,
        image,
        title,
        description,
        highlight,
      },
    });
  } catch (error) {
    console.error('Error POST /carousel/slide:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/settings/carousel/:slideId - Actualizar slide
router.put('/carousel/:slideId', async (req, res, next) => {
  try {
    const { slideId } = req.params;
    const { image, title, description, highlight } = req.body;

    await pool.query(
      `UPDATE carousel_slides
       SET image = ?, title = ?, description = ?, highlight = ?, updated_at = NOW()
       WHERE id = ?`,
      [image, title, description || '', highlight || 'default', slideId]
    );

    res.json({
      success: true,
      message: 'Slide actualizado',
    });
  } catch (error) {
    console.error('Error PUT /carousel/:slideId:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/settings/carousel/:slideId - Eliminar slide
router.delete('/carousel/:slideId', async (req, res, next) => {
  try {
    const { slideId } = req.params;

    const [result] = await pool.query(
      'DELETE FROM carousel_slides WHERE id = ?',
      [slideId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Slide no encontrado' });
    }

    res.json({
      success: true,
      message: 'Slide eliminado',
    });
  } catch (error) {
    console.error('Error DELETE /carousel/:slideId:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
