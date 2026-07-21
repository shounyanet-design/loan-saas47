const multer = require('multer');
const tenantContext = require('../tenancy/tenantContext');

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

const rawUpload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: fileFilter,
});

/**
 * Wraps Multer methods so that when Busboy completes async parsing,
 * the tenantContext is automatically restored before running downstream controllers.
 */
function wrapMulterWithTenant(multerInstance) {
  const wrapMethod = (methodName) => {
    return (...args) => {
      const middleware = multerInstance[methodName](...args);
      return (req, res, next) => {
        const tenantId = req.tenantId || (req.user && req.user.tenantId);
        const wasSystem = tenantContext.isSystem();

        middleware(req, res, (err) => {
          if (err) return next(err);
          const currentTenantId = req.tenantId || (req.user && req.user.tenantId) || tenantId;
          if (currentTenantId) {
            return tenantContext.runWithTenant(currentTenantId, () => next());
          }
          if (wasSystem) {
            return tenantContext.runAsSystem(() => next());
          }
          return next();
        });
      };
    };
  };

  return {
    single: wrapMethod('single'),
    array: wrapMethod('array'),
    fields: wrapMethod('fields'),
    any: wrapMethod('any'),
    none: wrapMethod('none'),
  };
}

const upload = wrapMulterWithTenant(rawUpload);

module.exports = upload;
