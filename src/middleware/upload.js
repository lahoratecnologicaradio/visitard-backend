// middleware/upload.js — VisitaRD
// Multer en memoria para pasar a Cloudinary sin guardar en disco
const multer = require('multer')

const storage = multer.memoryStorage()

const fileFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true)
  } else {
    cb(new Error('Solo se permiten imágenes'), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máximo
})

module.exports = upload
