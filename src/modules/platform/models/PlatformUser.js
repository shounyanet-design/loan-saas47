const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * PlatformUser
 * ------------
 * A platform-level operator (Super Admin). PLATFORM collection — NOT tenant
 * scoped, so it deliberately does NOT use the tenant plugin. Platform users
 * have no tenantId and authenticate through the separate Super Admin auth path.
 */
const PERMISSIONS = [
  'MANAGE_TENANTS',
  'VIEW_ANALYTICS',
  'MANAGE_SUBSCRIPTION_PLANS',
  'MANAGE_MARKETPLACE',
  'MANAGE_BILLING',
  'MANAGE_WALLET',
  'MANAGE_FEATURE_FLAGS',
  'MANAGE_API_PRICING',
  'MANAGE_GLOBAL_SETTINGS',
  'MANAGE_SUPPORT_TICKETS',
  'MANAGE_AUDIT_LOGS',
  'MANAGE_NOTIFICATIONS',
  'MANAGE_PLATFORM_USERS',
];

const platformUserSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: [true, 'Full name is required'], trim: true },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please add a valid email'],
    },
    password: { type: String, required: [true, 'Password is required'], minlength: 8, select: false },
    role: { type: String, enum: ['SUPER_ADMIN'], default: 'SUPER_ADMIN' },
    permissions: { type: [String], enum: PERMISSIONS, default: PERMISSIONS },
    isActive: { type: Boolean, default: true },
    profilePhoto: { type: String, default: '' },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

platformUserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

platformUserSchema.methods.matchPassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

platformUserSchema.statics.PERMISSIONS = PERMISSIONS;

module.exports = mongoose.model('PlatformUser', platformUserSchema);
