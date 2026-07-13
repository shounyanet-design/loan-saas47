const mongoose = require('mongoose');

/**
 * OnboardingSession — drives the resumable tenant onboarding wizard.
 * PLATFORM-level: it exists BEFORE a tenant is created, so it is NOT
 * tenant-scoped. Keyed by a public sessionId; resumes from `currentStep`.
 */
const STEPS = ['company', 'verify_email', 'select_plan', 'create_tenant', 'create_admin', 'assign_subscription', 'create_wallet', 'seed_data', 'branding', 'ready'];

const onboardingSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    companyName: { type: String },
    currentStep: { type: String, enum: STEPS, default: 'company' },
    completedSteps: { type: [String], default: [] },
    status: { type: String, enum: ['in_progress', 'completed', 'abandoned'], default: 'in_progress' },
    emailVerified: { type: Boolean, default: false },
    verifyToken: { type: String },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // accumulated wizard input
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' }, // set after create_tenant
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan' },
    adminUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

onboardingSessionSchema.statics.STEPS = STEPS;
module.exports = mongoose.model('OnboardingSession', onboardingSessionSchema);
