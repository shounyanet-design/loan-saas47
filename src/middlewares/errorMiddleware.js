const { sendError } = require('../utils/responseHandler');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log to console for dev
  console.error('ERROR STACK:', err.stack);
  console.error('ERROR MESSAGE:', err.message);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = `Resource not found with id of ${err.value}`;
    return sendError(res, message, 404);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists. Please use another value.`;
    return sendError(res, message, 400);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((val) => val.message);
    return sendError(res, message, 400);
  }

  // Multer Error
  if (err.message === 'Only images (jpg, jpeg, png) and PDFs are allowed!' || err.name === 'MulterError') {
    return sendError(res, err.message, 400);
  }

  sendError(res, error.message || 'Server Error', error.statusCode || 500);
};

module.exports = errorHandler;
