const mongoose = require('mongoose');

/**
 * ApiPricing — configurable token economics per shared API/service.
 * PLATFORM-level (global catalog), managed by Super Admin. No hardcoded costs.
 *
 *   tokenCost     — tokens deducted from a tenant wallet per unit
 *   providerCost  — what the provider charges the platform (currency) per unit
 *   sellingPrice  — currency value the platform assigns per unit (for billing)
 *   margin        — derived (sellingPrice - providerCost), stored for reporting
 */
const apiPricingSchema = new mongoose.Schema(
  {
    service: { type: String, required: true, unique: true }, // 'ocr','aml','credit_bureau','facetec','sms','email','phone_verification','api'
    label: { type: String, default: '' },
    tokenCost: { type: Number, default: 1, min: 0 },
    providerCost: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'ZAR' },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

apiPricingSchema.virtual('margin').get(function () {
  return Number((this.sellingPrice - this.providerCost).toFixed(4));
});
apiPricingSchema.set('toJSON', { virtuals: true });
apiPricingSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ApiPricing', apiPricingSchema);
