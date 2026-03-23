// routes/ai.routes.js — VisitaRD AI powered by Claude
const router = require('express').Router()
const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `Eres VisitaRD AI, el asistente turístico oficial de la República Dominicana. 

SOBRE TI:
- Eres amigable, conocedor y orgulloso de la cultura dominicana
- Hablas español principalmente, pero cambias al inglés si el usuario escribe en inglés
- Usas emojis ocasionalmente para ser más expresivo 🌴🐋🏖️
- Eres conciso pero completo en tus respuestas

CONOCES ESTOS DESTINOS DE RD:
- Samaná: ballenas jorobadas (enero-marzo), Cascada El Limón, Las Terrenas, Los Haitises
- Punta Cana: playas Bávaro y Arena Gorda, Cap Cana, Parque Nacional del Este
- Jarabacoa: rafting en río Yaque del Norte, Cascada Jimenoa, senderismo en Pico Duarte
- Barahona: larimar, Bahía de las Águilas, Lago Enriquillo, flamencos
- Zona Colonial: primer asentamiento europeo de América, UNESCO, Calle Las Damas
- Puerto Plata: teleférico Pico Isabel de Torres, playa Dorada, Fort San Felipe
- La Romana: Casa de Campo, Altos de Chavón, Bayahibe y Isla Saona

SERVICIOS QUE OFRECE VISITARD:
- Viajes en bus con tracking GPS en tiempo real
- Guías turísticos certificados
- Alojamientos (hoteles, hostales, villas, B&Bs)
- Restaurantes y gastronomía dominicana
- Buses disponibles para tours
- Inmuebles en alquiler
- Transporte público (Metro SD, Teleférico Puerto Plata, Caribe Tours, etc.)

GASTRONOMÍA DOMINICANA QUE CONOCES:
- La Bandera (arroz, habichuelas, carne)
- Sancocho, mangú con los tres golpes
- Tostones, chicharrón, pasteles en hoja
- Mamajuana, morir soñando, jugo de chinola

NUNCA:
- Inventes información falsa sobre RD
- Des precios exactos (pueden cambiar)
- Hagas reservas directamente (diriges al usuario a la plataforma)

SIEMPRE:
- Recomienda usar VisitaRD para reservar viajes y servicios
- Menciona la sección correcta de la plataforma según la necesidad
- Pregunta por preferencias para personalizar recomendaciones`

// POST /api/ai/chat — conversación con VisitaRD AI
router.post('/chat', async (req, res, next) => {
  try {
    const { messages, language } = req.body

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'messages es requerido' })
    }

    // Limitar historial a últimos 10 mensajes para controlar costos
    const recentMessages = messages.slice(-10).map(m => ({
      role:    m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content).slice(0, 2000), // max 2000 chars por mensaje
    }))

    const response = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 1024,
      system:     SYSTEM_PROMPT + (language === 'en' ? '\n\nThe user prefers English. Respond in English.' : ''),
      messages:   recentMessages,
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''

    res.json({
      success:  true,
      message:  text,
      tokens:   response.usage?.output_tokens || 0,
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/ai/identify-place — identificar lugar por foto
router.post('/identify-place', async (req, res, next) => {
  try {
    const { image_url, image_base64 } = req.body

    if (!image_url && !image_base64) {
      return res.status(400).json({ success: false, message: 'image_url o image_base64 es requerido' })
    }

    const imageContent = image_url ? {
      type:   'image',
      source: { type: 'url', url: image_url },
    } : {
      type:   'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: image_base64 },
    }

    const response = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          imageContent,
          {
            type: 'text',
            text: `Analiza esta imagen y dime:
1. ¿Qué lugar de la República Dominicana es este? (si lo es)
2. ¿Qué actividades se pueden hacer ahí?
3. ¿Cuál es la mejor época para visitarlo?
4. ¿Cómo llegar desde Santo Domingo?

Responde en formato JSON con los campos: lugar, descripcion, actividades (array), mejor_epoca, como_llegar, es_rd (boolean).
Si no es un lugar de RD, igual responde con is_rd: false y describe lo que ves.`
          }
        ],
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
    let data = {}
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) data = JSON.parse(jsonMatch[0])
    } catch { data = { descripcion: text } }

    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

// POST /api/ai/itinerary — generar itinerario personalizado
router.post('/itinerary', async (req, res, next) => {
  try {
    const { days, interests, budget, origin, group_size } = req.body

    const response = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 2048,
      system:     SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Genera un itinerario de viaje para República Dominicana con estos parámetros:
- Días: ${days || 7}
- Intereses: ${interests || 'playas, naturaleza, cultura'}
- Presupuesto: ${budget || 'moderado'}
- Origen del viajero: ${origin || 'Santo Domingo'}
- Tamaño del grupo: ${group_size || 2} personas

Responde en JSON con este formato:
{
  "titulo": "nombre del itinerario",
  "descripcion": "resumen del viaje",
  "dias": [
    {
      "dia": 1,
      "titulo": "nombre del día",
      "destino": "lugar principal",
      "actividades": ["actividad 1", "actividad 2"],
      "alojamiento": "tipo de alojamiento sugerido",
      "comidas": ["desayuno sugerido", "almuerzo", "cena"],
      "transporte": "cómo moverse ese día",
      "costo_estimado": "rango en USD"
    }
  ],
  "presupuesto_total": "rango total en USD",
  "consejos": ["consejo 1", "consejo 2"],
  "mejor_epoca": "época recomendada"
}`
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
    let data = {}
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) data = JSON.parse(jsonMatch[0])
    } catch { data = { error: 'No se pudo generar el itinerario' } }

    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

// POST /api/ai/translate — traducir texto ES/EN
router.post('/translate', async (req, res, next) => {
  try {
    const { text, target_language } = req.body
    if (!text) return res.status(400).json({ success: false, message: 'text es requerido' })

    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Translate this text to ${target_language === 'en' ? 'English' : 'Spanish'}. 
Return ONLY the translation, nothing else:

${text}`
      }],
    })

    const translation = response.content[0]?.type === 'text' ? response.content[0].text : text
    res.json({ success: true, translation })
  } catch (err) {
    next(err)
  }
})

module.exports = router
