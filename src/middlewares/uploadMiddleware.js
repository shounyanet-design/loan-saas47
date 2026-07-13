const multer = require('multer');

// Multer storage configuration (memory storage for ImageKit)
const storage = multer.memoryStorage();

// Explicit allowed MIME types (covers selfie captures which may be image/webp)
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

// File filter for images and PDFs
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error(`Only images (jpg, jpeg, png, webp) and PDFs are allowed! Received: ${file.mimetype}`));
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: fileFilter,
});

module.exports = upload;
