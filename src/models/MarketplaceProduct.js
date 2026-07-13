const mongoose = require('mongoose');

/**
 * MarketplaceProduct — platform-global purchasable item.
 *
 * Pricing is embedded (covers the MarketplacePrice responsibility) with optional
 * volume tiers. `grants` describes what the buyer receives on fulfillment, e.g.
 *   { tokens: 1000 }                       → token pack
 *   { tokens: 5000, service: 'sms' }       → SMS pack (tokens earmarked for sms)
 *   { storageGB: 50 }                      → storage pack
 *   { feature: 'WALLET' }                  → premium feature unlock
 */
const tierSchema = new mongoose.Schema({ minQty: Number, unitPrice: Number }, { _id: false });

const marketplaceProductSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceCategory' },
    type: {
      type: String,
      enum: ['token_pack', 'storage_pack', 'sms_pack', 'ocr_pack', 'aml_pack', 'credit_pack', 'feature', 'subscription', 'addon'],
      required: true,
    },
    grants: { type: mongoose.Schema.Types.Mixed, default: {} },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'ZAR' },
    priceTiers: { type: [tierSchema], default: [] },
    bonusTokens: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active' },
    sortOrder: { type: Number, default: 0 },
    isPopular: { type: Boolean, default: false },
  },
  { timestamps: true }
);

marketplaceProductSchema.index({ status: 1, type: 1, sortOrder: 1 });

/** Effective unit price for a quantity, honoring volume tiers. */
marketplaceProductSchema.methods.unitPriceFor = function (qty) {
  let price = this.price;
  for (const tier of (this.priceTiers || []).slice().sort((a, b) => a.minQty - b.minQty)) {
    if (qty >= tier.minQty) price = tier.unitPrice;
  }
  return price;
};

module.exports = mongoose.model('MarketplaceProduct', marketplaceProductSchema);
