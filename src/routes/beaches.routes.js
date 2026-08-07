// ============================================================
// beaches.routes.js — CaribGo · CRUD + Congestión IA + Check-ins
// Endpoints completos: playas, fotos, congestión, check-ins
// ============================================================

const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const pool = require('../config/db');

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
// CRUD: PLAYAS
// ════════════════════════════════════════════════════════════

// GET /api/beaches - Obtener todas las playas con congestión actual
router.get('/', async (req, res, next) => {
  try {
    const [beaches] = await pool.query(`
      SELECT 
        b.id,
        b.name,
        b.type,
        b.description,
        b.capacity,
        b.lat,
        b.lng,
        b.photos,
        COALESCE(bp.predicted_congestion, 0) as current_congestion,
        COALESCE(bp.level, 'green') as level,
        COALESCE(bp.predicted_users, 0) as predicted_users,
        b.created_at,
        b.updated_at
      FROM beaches b
      LEFT JOIN beach_predictions bp ON b.id = bp.beach_id 
        AND bp.prediction_hour = (
          SELECT MAX(prediction_hour) FROM beach_predictions 
          WHERE beach_id = b.id AND prediction_hour <= NOW()
        )
      ORDER BY b.name ASC
    `);

    // Parsear JSON de fotos
    const beachesWithPhotos = beaches.map(beach => ({
      ...beach,
      photos: beach.photos ? JSON.parse(beach.photos) : [],
    }));

    res.json({
      success: true,
      data: beachesWithPhotos,
      total: beachesWithPhotos.length,
    });
  } catch (error) {
    console.error('Error GET /beaches:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/beaches/:id - Obtener playa por ID (próximas 24h)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Info de la playa
    const [beaches] = await pool.query(
      'SELECT * FROM beaches WHERE id = ?',
      [id]
    );

    if (beaches.length === 0) {
      return res.status(404).json({ success: false, error: 'Playa no encontrada' });
    }

    const beach = {
      ...beaches[0],
      photos: beaches[0].photos ? JSON.parse(beaches[0].photos) : [],
    };

    // Predicciones próximas 24h
    const [predictions] = await pool.query(`
      SELECT 
        prediction_hour,
        predicted_congestion,
        predicted_users,
        level
      FROM beach_predictions
      WHERE beach_id = ?
        AND prediction_hour >= NOW()
        AND prediction_hour <= DATE_ADD(NOW(), INTERVAL 24 HOUR)
      ORDER BY prediction_hour ASC
    `, [id]);

    // Mejor hora para visitar
    const [bestTime] = await pool.query(`
      SELECT 
        prediction_hour,
        predicted_congestion,
        predicted_users
      FROM beach_predictions
      WHERE beach_id = ?
        AND prediction_hour >= NOW()
        AND prediction_hour <= DATE_ADD(NOW(), INTERVAL 24 HOUR)
      ORDER BY predicted_congestion ASC
      LIMIT 1
    `, [id]);

    res.json({
      success: true,
      data: {
        beach,
        current: predictions[0] || {},
        hourly_forecast: predictions,
        best_time: bestTime[0] || null,
        recommendation: generateRecommendation(predictions[0]),
      },
    });
  } catch (error) {
    console.error('Error GET /beaches/:id:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/beaches - Crear nueva playa
router.post('/', async (req, res, next) => {
  try {
    const { name, type, description, capacity, lat, lng, photos } = req.body;

    if (!name || !type) {
      return res.status(400).json({
        success: false,
        error: 'Nombre y tipo son requeridos',
      });
    }

    const photosJSON = photos ? JSON.stringify(photos) : null;

    const [result] = await pool.query(
      `INSERT INTO beaches (name, type, description, capacity, lat, lng, photos)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, type, description || null, capacity || null, lat || null, lng || null, photosJSON]
    );

    const beach = {
      id: result.insertId,
      name,
      type,
      description: description || null,
      capacity: capacity || null,
      lat: lat || null,
      lng: lng || null,
      photos: photos || [],
    };

    res.status(201).json({
      success: true,
      data: beach,
      message: 'Playa creada exitosamente',
    });
  } catch (error) {
    console.error('Error POST /beaches:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/beaches/:id - Actualizar playa
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, type, description, capacity, lat, lng, photos } = req.body;

    // Verificar que existe
    const [existing] = await pool.query(
      'SELECT * FROM beaches WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Playa no encontrada' });
    }

    const photosJSON = photos ? JSON.stringify(photos) : null;

    await pool.query(
      `UPDATE beaches 
       SET name = ?, type = ?, description = ?, capacity = ?, lat = ?, lng = ?, photos = ?, updated_at = NOW()
       WHERE id = ?`,
      [name || existing[0].name, type || existing[0].type, description, capacity, lat, lng, photosJSON, id]
    );

    const [updated] = await pool.query(
      'SELECT * FROM beaches WHERE id = ?',
      [id]
    );

    const beach = {
      ...updated[0],
      photos: updated[0].photos ? JSON.parse(updated[0].photos) : [],
    };

    res.json({
      success: true,
      data: beach,
      message: 'Playa actualizada exitosamente',
    });
  } catch (error) {
    console.error('Error PUT /beaches/:id:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/beaches/:id - Eliminar playa
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      'DELETE FROM beaches WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Playa no encontrada' });
    }

    res.json({
      success: true,
      message: 'Playa eliminada exitosamente',
    });
  } catch (error) {
    console.error('Error DELETE /beaches/:id:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// FOTOS: UPLOAD A CLOUDINARY
// ════════════════════════════════════════════════════════════

// POST /api/beaches/upload-photo - Subir foto a Cloudinary
router.post('/upload-photo', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se envió archivo' });
    }

    // Subir a Cloudinary
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'caribgo/beaches',
        resource_type: 'auto',
      },
      async (error, result) => {
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
    console.error('Error POST /upload-photo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/beaches/:beach_id/photos - Upload base64 a Cloudinary
router.post('/:beach_id/photos/upload', async (req, res, next) => {
  try {
    const { beach_id } = req.params;
    const { image_base64 } = req.body;

    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'image_base64 requerido' });
    }

    // Subir a Cloudinary
    const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${image_base64}`, {
      folder: `caribgo/beaches/${beach_id}`,
    });

    // Guardar URL en BD
    const [beach] = await pool.query('SELECT photos FROM beaches WHERE id = ?', [beach_id]);
    let photos = beach[0]?.photos ? JSON.parse(beach[0].photos) : [];
    photos.push(result.secure_url);

    await pool.query('UPDATE beaches SET photos = ? WHERE id = ?', [
      JSON.stringify(photos),
      beach_id,
    ]);

    res.json({ success: true, url: result.secure_url });
  } catch (error) {
    console.error('Error POST /photos/upload:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// CHECK-INS: REGISTRAR VISITAS
// ════════════════════════════════════════════════════════════

// POST /api/beaches/checkin - Registrar check-in (usuario visita playa)
router.post('/checkin', async (req, res, next) => {
  try {
    const { user_id, beach_id, stay_duration } = req.body;

    if (!user_id || !beach_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id y beach_id son requeridos',
      });
    }

    // Verificar playa existe
    const [beach] = await pool.query('SELECT id FROM beaches WHERE id = ?', [beach_id]);
    if (beach.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Playa no encontrada',
      });
    }

    // Insertar check-in
    await pool.query(
      'INSERT INTO beach_checkins (user_id, beach_id, stay_duration, checkin_time) VALUES (?, ?, ?, NOW())',
      [user_id, beach_id, stay_duration || null]
    );

    res.json({
      success: true,
      message: 'Check-in registrado exitosamente',
    });
  } catch (error) {
    console.error('Error POST /checkin:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// BÚSQUEDAS: PLAYAS MENOS CONCURRIDAS
// ════════════════════════════════════════════════════════════

// GET /api/beaches/search/least-crowded - Playas menos concurridas AHORA
router.get('/search/least-crowded', async (req, res, next) => {
  try {
    const [beaches] = await pool.query(`
      SELECT 
        b.id,
        b.name,
        b.type,
        b.lat,
        b.lng,
        b.capacity,
        COALESCE(bp.predicted_congestion, 0) as congestion,
        COALESCE(bp.level, 'green') as level,
        COALESCE(bp.predicted_users, 0) as predicted_users
      FROM beaches b
      LEFT JOIN beach_predictions bp ON b.id = bp.beach_id 
        AND bp.prediction_hour = (
          SELECT MAX(prediction_hour) FROM beach_predictions 
          WHERE beach_id = b.id AND prediction_hour <= NOW()
        )
      ORDER BY congestion ASC
      LIMIT 5
    `);

    res.json({
      success: true,
      data: beaches,
    });
  } catch (error) {
    console.error('Error GET /search/least-crowded:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// ESTADÍSTICAS: VISITANTES Y CONGESTIÓN
// ════════════════════════════════════════════════════════════

// GET /api/beaches/:beach_id/stats - Estadísticas (últimos 30 días)
router.get('/:beach_id/stats', async (req, res, next) => {
  try {
    const { beach_id } = req.params;

    const [stats] = await pool.query(`
      SELECT 
        HOUR(checkin_time) as hour,
        COUNT(*) as visitor_count,
        AVG(COALESCE(stay_duration, 120)) as avg_stay_minutes
      FROM beach_checkins
      WHERE beach_id = ?
        AND checkin_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY HOUR(checkin_time)
      ORDER BY hour ASC
    `, [beach_id]);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error GET /stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════

/**
 * Generar recomendación basada en nivel de congestión
 */
function generateRecommendation(prediction) {
  if (!prediction) return null;

  switch (prediction.level) {
    case 'green':
      return '🟢 Poco concurrido - Excelente momento para visitar';
    case 'yellow':
      return '🟡 Moderadamente lleno - Espera 2-3 horas para menos gente';
    case 'red':
      return '🔴 Muy concurrido - Recomendamos otro momento o día';
    default:
      return null;
  }
}

module.exports = router;
