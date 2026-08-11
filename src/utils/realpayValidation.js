const Joi = require('joi');

/**
 * Validation schema for RealPay Webhook callbacks.
 * Enforces presence of essential reference and status fields.
 */
const realpayWebhookSchema = Joi.object({
  clientReference: Joi.string().trim().allow('').optional(),
  mandateId: Joi.string().trim().allow('').optional(),
  providerReference: Joi.string().trim().allow('').optional(),
  contractReference: Joi.string().trim().allow('').optional(),

  statusCode: Joi.string().trim().allow('').optional(),
  status: Joi.string().trim().allow('').optional(),
  code: Joi.string().trim().allow('').optional(),
  resultCode: Joi.string().trim().allow('').optional(),

  statusDescription: Joi.string().trim().allow('').optional(),
  message: Joi.string().trim().allow('').optional(),
  description: Joi.string().trim().allow('').optional(),

  merchantNumber: Joi.string().trim().allow('').optional(),
  product: Joi.string().trim().allow('').optional(),
  timestamp: Joi.string().trim().allow('').optional(),
  eventTimestamp: Joi.string().trim().allow('').optional(),
  signature: Joi.string().trim().allow('').optional(),
  mac: Joi.string().trim().allow('').optional(),
  eventType: Joi.string().trim().allow('').optional()
}).unknown(true).custom((value, helpers) => {
  const ref = value.clientReference || value.mandateId || value.providerReference || value.contractReference;
  const status = value.statusCode || value.status || value.code || value.resultCode;

  if (!ref || String(ref).trim() === '') {
    return helpers.message('Webhook callback payload must contain a valid clientReference or mandateId');
  }

  if (!status || String(status).trim() === '') {
    return helpers.message('Webhook callback payload must contain a valid statusCode or status');
  }

  return value;
}, 'RealPay Webhook validation');

module.exports = {
  realpayWebhookSchema
};
