// routes/ai.flyer.js â€” CaribGo Â· ExtracciÃ³n de datos de flyer con Claude Vision
const express  = require('express')
const router   = express.Router()
const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// POST /api/ai/extract-flyer
// Body: { imageUrl: string }
router.post('/extract-flyer', async (req, res) => {
  try {
    const { imageUrl } = req.body
    if (!imageUrl) return res.status(400).json({ success: false, message: 'imageUrl requerida' })

    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: imageUrl },
          },
          {
            type: 'text',
            text: `Analiza este flyer de tour turÃ­stico dominicano y extrae los datos.
Responde SOLO con JSON vÃ¡lido sin texto adicional ni backticks:
{
  "title": "nombre completo del tour",
  "origin": "ciudad/lugar de salida",
  "destination": "destino principal",
  "price": 0,
  "seats": 40,
  "departure_at": "YYYY-MM-DDTHH:MM",
  "description": "descripcion breve del tour en 1-2 oraciones",
  "includes": "Transporte, Desayuno, Almuerzo, separados por coma",
  "bus_plate": "",
  "origin_lat": 0,
  "origin_lng": 0,
  "dest_lat": 0,
  "dest_lng": 0
}

Reglas:
- price: solo el numero del precio adulto en RD$ sin simbolos
- seats: cupos disponibles, si no especifica usa 40
- departure_at: formato exacto YYYY-MM-DDTHH:MM, si no hay aÃ±o usar 2026
- includes: lista de lo que incluye separado por comas
- Para coordenadas de Santo Domingo usa lat:18.4884 lng:-69.9229
- Para coordenadas de Samana usa lat:19.2065 lng:-69.3360
- Para coordenadas de Jarabacoa usa lat:19.1179 lng:-70.6581
- Para coordenadas de Punta Cana usa lat:18.5601 lng:-68.3725
- Para coordenadas de Barahona usa lat:18.2078 lng:-71.0988`,
          }
        ],
      }],
    })

    const text  = message.content[0].type === 'text' ? message.content[0].text : '{}'
    const clean = text.replace(/```json|```/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      return res.status(422).json({ success: false, message: 'No se pudo parsear la respuesta de Claude', raw: clean })
    }

    res.json({ success: true, data: parsed })
  } catch (err) {
    console.error('extract-flyer error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router

