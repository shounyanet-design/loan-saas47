const mongoose = require('mongoose');

/** MarketplaceCategory — platform-global catalog grouping. */
const marketplaceCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MarketplaceCategory', marketplaceCategorySchema);
