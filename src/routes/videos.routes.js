// routes/videos.routes.js — VisitaRD
const router = require('express').Router()
const db     = require('../config/db')
const { authenticate, authorize } = require('../middleware/auth')

// Extraer ID de YouTube de cualquier formato de URL
function getYouTubeId(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
    /youtube\.com\/shorts\/([^?]+)/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

// Extraer ID de TikTok
function getTikTokId(url) {
  const m = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/)
  return m ? m[1] : null
}

// GET /api/videos — videos públicos para el home
router.get('/', async (_req, res, next) => {
  try {
    const [videos] = await db.query(
      `SELECT v.id, v.url, v.title, v.thumbnail,
              a.name AS agency_name, a.rating AS agency_rating
       FROM trip_videos v
       JOIN agencies a ON v.agency_id = a.id
       ORDER BY v.created_at DESC
       LIMIT 12`
    )

    // Enriquecer con datos del video
    const enriched = videos.map(v => {
      const ytId = getYouTubeId(v.url)
      const ttId = getTikTokId(v.url)
      return {
        ...v,
        platform:  ytId ? 'youtube' : ttId ? 'tiktok' : 'other',
        video_id:  ytId || ttId || null,
        embed_url: ytId
          ? `https://www.youtube.com/embed/${ytId}?autoplay=0&rel=0`
          : v.url,
        thumbnail: v.thumbnail || (ytId
          ? `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`
          : null),
      }
    })

    res.json({ success: true, data: enriched })
  } catch (err) { next(err) }
})

// POST /api/videos — subir video (agencias y admin)
router.post('/', authenticate, authorize('agency', 'admin'), async (req, res, next) => {
  try {
    const { url, title } = req.body
    if (!url || !title) {
      return res.status(400).json({ success: false, message: 'url y title son requeridos' })
    }

    const [agRows] = await db.query(
      'SELECT id FROM agencies WHERE user_id = ?', [req.user.id]
    )
    if (!agRows.length) {
      return res.status(403).json({ success: false, message: 'Agencia no encontrada' })
    }

    await db.query(
      'INSERT INTO trip_videos (agency_id, url, title) VALUES (?, ?, ?)',
      [agRows[0].id, url, title]
    )

    res.status(201).json({ success: true, message: 'Video agregado' })
  } catch (err) { next(err) }
})

// DELETE /api/videos/:id — solo admin
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM trip_videos WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) { next(err) }
})

module.exports = router
