// routes/ai.routes.js — VisitaRD
// Identificación de lugares con OpenAI Vision + recomendaciones
const router  = require('express').Router();
const OpenAI  = require('openai');
const db      = require('../config/db');
const { authenticate } = require('../middleware/auth');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ════════════════════════════════════════════════════════════
// POST /api/ai/identify-place
// Body: { image_base64, lat, lng }
// Identifica un lugar dominicano a partir de una foto
// ════════════════════════════════════════════════════════════
router.post('/identify-place', authenticate, async (req, res, next) => {
  try {
    const { image_base64, lat, lng } = req.body;

    if (!image_base64) {
      return res.status(400).json({ success: false, message: 'image_base64 requerida' });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Eres un experto en turismo de República Dominicana.
Cuando recibas una imagen, identifica:
1. El nombre del lugar (si es reconocible)
2. La categoría: playa | montaña | ciudad | parque | gastronomía | cultural | aventura
3. Una descripción turística breve en español (2-3 oraciones)
4. Una descripción en inglés (2-3 oraciones)
5. Tags relevantes para turismo (array de strings)
6. Si reconoces el destino específico en RD, mencionarlo
Responde SOLO en JSON con esta estructura exacta:
{ "name": "", "category": "", "description_es": "", "description_en": "", "tags": [], "confidence": 0.0-1.0 }`,
        },
        {
          role: 'user',
          content: [
            {
              type:      'image_url',
              image_url: { url: `data:image/jpeg;base64,${image_base64}` },
            },
            {
              type: 'text',
              text: `Coordenadas aproximadas: lat=${lat}, lng=${lng}. Identifica este lugar de República Dominicana.`,
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    const raw     = response.choices[0].message.content;
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const result  = JSON.parse(cleaned);

    // Buscar viajes disponibles cercanos al lugar identificado
    let nearbyTrips = [];
    if (lat && lng) {
      const [trips] = await db.query(
        `SELECT id, title, origin, destination, departure_at, price, seats_available
         FROM trips
         WHERE status = 'scheduled'
           AND seats_available > 0
           AND departure_at > NOW()
           AND (destination LIKE ? OR destination LIKE ?)
         LIMIT 5`,
        [`%${result.name?.split(' ')[0] || ''}%`, `%${result.tags?.[0] || ''}%`]
      );
      nearbyTrips = trips;
    }

    res.json({
      success: true,
      data: {
        ...result,
        coordinates: { lat, lng },
        nearby_trips: nearbyTrips,
      },
    });
  } catch (err) {
    // Si falla el parse de JSON de OpenAI, respuesta genérica
    if (err instanceof SyntaxError) {
      return res.status(422).json({
        success: false,
        message: 'No se pudo identificar el lugar. Intenta con una foto más clara.',
      });
    }
    next(err);
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/ai/recommendations — viajes recomendados por historial
// ════════════════════════════════════════════════════════════
router.get('/recommendations', authenticate, async (req, res, next) => {
  try {
    // Obtener historial de destinos del usuario
    const [history] = await db.query(
      `SELECT t.destination, t.title
       FROM bookings b
       JOIN trips t ON b.trip_id = t.id
       WHERE b.user_id = ? AND b.status = 'confirmed'
       ORDER BY b.created_at DESC LIMIT 10`,
      [req.user.id]
    );

    let recommendedIds = [];

    if (history.length === 0) {
      // Sin historial → recomendar los más populares por reservas
      const [popular] = await db.query(
        `SELECT t.id FROM trips t
         JOIN bookings b ON t.id = b.trip_id
         WHERE t.status = 'scheduled' AND t.seats_available > 0 AND t.departure_at > NOW()
         GROUP BY t.id ORDER BY COUNT(b.id) DESC LIMIT 5`
      );
      recommendedIds = popular.map(r => r.id);
    } else {
      // Con historial → buscar destinos similares
      const destinations = [...new Set(history.map(h => h.destination))];
      const placeholders = destinations.map(() => '?').join(',');
      const [similar] = await db.query(
        `SELECT id FROM trips
         WHERE destination IN (${placeholders})
           AND status = 'scheduled'
           AND seats_available > 0
           AND departure_at > NOW()
         LIMIT 5`,
        destinations
      );
      recommendedIds = similar.map(r => r.id);
    }

    if (recommendedIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const placeholders = recommendedIds.map(() => '?').join(',');
    const [trips] = await db.query(
      `SELECT t.*, a.name AS agency_name, a.rating AS agency_rating, a.logo AS agency_logo
       FROM trips t
       JOIN agencies a ON t.agency_id = a.id
       WHERE t.id IN (${placeholders})`,
      recommendedIds
    );

    res.json({ success: true, data: trips });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
