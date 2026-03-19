// routes/media.routes.js — VisitaRD
// Sube imágenes a Cloudinary y retorna la URL
const router     = require('express').Router()
const cloudinary = require('../config/cloudinary')
const upload     = require('../middleware/upload')
const { authenticate, authorize } = require('../middleware/auth')

// POST /api/media/upload
// Sube una imagen a Cloudinary
// Solo agencias y admins pueden subir
router.post(
  '/upload',
  authenticate,
  authorize('agency', 'admin'),
  upload.single('image'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No se recibió ninguna imagen' })
      }

      // Subir a Cloudinary desde buffer en memoria
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder:         'visitard/trips',
            transformation: [
              { width: 1200, height: 600, crop: 'fill', gravity: 'auto' },
              { quality: 'auto', fetch_format: 'auto' },
            ],
          },
          (error, result) => {
            if (error) reject(error)
            else resolve(result)
          }
        )
        stream.end(req.file.buffer)
      })

      res.json({
        success:   true,
        url:       result.secure_url,
        public_id: result.public_id,
        width:     result.width,
        height:    result.height,
      })
    } catch (err) {
      next(err)
    }
  }
)

// DELETE /api/media/:public_id — eliminar imagen de Cloudinary
router.delete('/:public_id(*)', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    await cloudinary.uploader.destroy(req.params.public_id)
    res.json({ success: true, message: 'Imagen eliminada' })
  } catch (err) {
    next(err)
  }
})

module.exports = router
