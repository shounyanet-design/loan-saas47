const mongoose = require('mongoose');

/**
 * MarketplaceCoupon — platform-global discount code. Covers both the "coupon"
 * and "discount" responsibilities (percentage or fixed amount).
 */
const marketplaceCouponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    discountType: { type: String, enum: ['percent', 'fixed'], required: true },
    value: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'ZAR' },
    maxRedemptions: { type: Number, default: 0 }, // 0 = unlimited
    redemptions: { type: Number, default: 0 },
    perTenantLimit: { type: Number, default: 1 },
    minOrderAmount: { type: Number, default: 0 },
    appliesToTypes: { type: [String], default: [] }, // empty = all product types
    startsAt: { type: Date },
    expiresAt: { type: Date },
    status: { type: String, enum: ['active', 'inactive', 'expired'], default: 'active' },
  },
  { timestamps: true }
);

/** Validate + compute discount for an order amount. Returns {ok, discount, reason}. */
marketplaceCouponSchema.methods.evaluate = function (amount, productType, tenantRedemptions = 0) {
  const now = Date.now();
  if (this.status !== 'active') return { ok: false, discount: 0, reason: 'Coupon inactive' };
  if (this.startsAt && now < new Date(this.startsAt).getTime()) return { ok: false, discount: 0, reason: 'Coupon not yet active' };
  if (this.expiresAt && now > new Date(this.expiresAt).getTime()) return { ok: false, discount: 0, reason: 'Coupon expired' };
  if (this.maxRedemptions > 0 && this.redemptions >= this.maxRedemptions) return { ok: false, discount: 0, reason: 'Coupon fully redeemed' };
  if (this.perTenantLimit > 0 && tenantRedemptions >= this.perTenantLimit) return { ok: false, discount: 0, reason: 'Coupon already used' };
  if (this.minOrderAmount && amount < this.minOrderAmount) return { ok: false, discount: 0, reason: `Minimum order ${this.minOrderAmount}` };
  if (this.appliesToTypes.length && productType && !this.appliesToTypes.includes(productType)) return { ok: false, discount: 0, reason: 'Coupon not applicable to this product' };
  const discount = this.discountType === 'percent'
    ? Number((amount * (this.value / 100)).toFixed(2))
    : Math.min(this.value, amount);
  return { ok: true, discount, reason: 'OK' };
};

module.exports = mongoose.model('MarketplaceCoupon', marketplaceCouponSchema);
