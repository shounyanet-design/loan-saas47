const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middlewares/errorMiddleware');
const sanitizeMongo = require('./middlewares/sanitizeMongo');
const { securityHeaders } = require('./middlewares/securityMiddleware');
const { expressErrorCapture } = require('./observability/errorMonitoring');
const { httpMetricsMiddleware } = require('./observability/metrics');
const metricsRoutes = require('./observability/metricsRoutes');

// Route files
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminAgentRoutes = require('./routes/admin/agentRoutes');
const agentMyClientsRoutes = require('./routes/agent/myClientsRoutes');
const agentEarningsRoutes = require('./routes/agent/earningsRoutes');
const adminBorrowerRoutes = require('./routes/adminBorrowerRoutes');
const borrowerDashboardRoutes = require('./routes/borrowerRoutes');
const staffRoutes = require('./routes/staffRoutes');
const repaymentRoutes = require('./routes/repaymentRoutes');
const agentRoutes = require('./routes/agentRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const loanApplicationRoutes = require('./routes/loanApplicationRoutes');
const activeLoanRoutes = require('./routes/admin/activeLoanRoutes');
const paymentRoutes = require('./routes/admin/paymentRoutes');
const duePaymentRoutes = require('./routes/admin/duePaymentRoutes');
const nupayRoutes = require('./routes/admin/nupayRoutes');
const reportRoutes = require('./routes/admin/reportRoutes');
const communicationRoutes = require('./routes/admin/communicationRoutes');
const settingsRoutes = require('./routes/admin/settingsRoutes');
const notificationRoutes = require('./routes/admin/notificationRoutes');
const navbarNotificationRoutes = require('./routes/admin/navbarNotificationRoutes');
const adminProfileRoutes = require('./routes/admin/profileRoutes');
const adminDashboardRoutes = require('./routes/admin/dashboardRoutes');
const staffLoanRequestRoutes = require('./routes/staff/loanRequestRoutes');
const staffLoanReviewRoutes = require('./routes/staff/loanReviewRoutes');
const staffPaymentVerificationRoutes = require('./routes/staff/paymentVerificationRoutes');
const staffCommunicationRoutes = require('./routes/staff/communicationRoutes');
const staffProfileRoutes = require('./routes/staff/profileRoutes');
const staffNotificationRoutes = require('./routes/staff/notificationRoutes');
const staffDashboardRoutes = require('./routes/staff/dashboardRoutes');
const borrowerPaymentRoutes = require('./routes/borrower/paymentRoutes');
const agentCommunicationRoutes = require('./routes/agent/communicationRoutes');
const agentNotificationRoutes = require('./routes/agent/notificationRoutes');
const agentProfileRoutes = require('./routes/agent/profileRoutes');
const agentDashboardRoutes = require('./routes/agent/dashboardRoutes');
const agentFollowUpRoutes = require('./routes/agent/followUpRoutes');
const borrowerApplyLoanRoutes = require('./routes/borrowerLoanRoutes');
const verificationRoutes = require('./routes/verification.routes');
const agreementRoutes = require('./modules/agreementSigning/routes/agreementSigning.routes');
const validationRoutes = require('./routes/validationRoutes');
const platformRoutes = require('./modules/platform/routes');
const tenantSaasRoutes = require('./modules/saas/routes/tenantSaasRoutes');
const publicSaasRoutes = require('./modules/saas/routes/publicRoutes');
const tenantCommerceRoutes = require('./modules/commerce/routes/tenantCommerceRoutes');
const healthRoutes = require('./modules/ops/routes/healthRoutes');
const onboardingRoutes = require('./modules/ops/routes/onboardingRoutes');
const tenantOpsRoutes = require('./modules/ops/routes/tenantOpsRoutes');
require('./modules/ops/services/queueHandlers'); // register queue handlers on boot
// Milestone 2.5 — commercial customer-facing layer.
const publicCustomerRoutes = require('./modules/customer/routes/publicCustomerRoutes');
const docsRoutes = require('./modules/customer/routes/docsRoutes');
const customerRoutes = require('./modules/customer/routes/customerRoutes');
const app = express();
// Trust the reverse proxy (NGINX/Railway) so req.ip and rate-limit keys use the
// real client IP from X-Forwarded-For rather than the proxy address.
app.set('trust proxy', 1);
// Gzip responses — high value given large JSON / base64 PDF payloads.
app.use(compression());
// Record request latency/count for Prometheus (additive, no behavioural change).
app.use(httpMetricsMiddleware);
// Body parser — 10 MB limit supports base64 image payloads from KYC flows
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Strip Mongo operator keys ($/.) from request bodies — NoSQL-injection guard.
app.use(sanitizeMongo);
// Cookie parser
app.use(cookieParser());
// HTTP request logging — concise in dev, combined access logs to stdout in prod.
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// Set security headers
app.use(helmet());
app.use(securityHeaders);
// Enable CORS. Backward compatible: with no CORS_ORIGINS set, all origins are
// allowed (legacy behaviour). Set CORS_ORIGINS to a comma-separated allow-list
// in production to lock it down.
const corsAllowList = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (!corsAllowList.length) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[CORS] No CORS_ORIGINS set — all origins are allowed. Set CORS_ORIGINS in production.');
  }
  app.use(cors({ 
    credentials: true,
    origin: (origin, callback) => callback(null, true)
  }));
} else {
  app.use(cors({
    credentials: true,
    origin(origin, cb) {
      // Allow same-origin/non-browser (no Origin header) and allow-listed origins.
      if (!origin || corsAllowList.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
  }));
}
// Global rate limiting (broad) — protects every route from flooding.
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 mins
  max: 2000, // Increased scale to support rapid real-time message flows and dashboard syncing
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: 'Too many requests from this IP, please try again after 10 minutes'
});
app.use(limiter);
// Stricter limiter for authentication endpoints — credential-stuffing defence.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 30, // generous enough for legitimate retries, low enough to blunt brute force
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: 'Too many authentication attempts, please try again later',
});
app.use('/api/auth', authLimiter);
// Mount routers
app.use('/api/auth', authRoutes);
app.use('/api/admin/borrowers', adminBorrowerRoutes);
app.use('/api/admin/agents', adminAgentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/staff', staffRoutes);
app.use('/api/admin/loan-applications', loanApplicationRoutes);
app.use('/api/admin/active-loans', activeLoanRoutes);
app.use('/api/admin/payments', paymentRoutes);
app.use('/api/admin/due-payments', duePaymentRoutes);
const nupayRoutesApi = require('./routes/nupayRoutes');
app.use('/api/v1/nupay', nupayRoutesApi);
app.use('/api/admin/nupay', nupayRoutes);

app.use('/api/admin/reports', reportRoutes);
app.use('/api/admin/communications', communicationRoutes);
app.use('/api/admin/settings', settingsRoutes);
app.use('/api/admin/notifications', notificationRoutes);
app.use('/api/admin/navbar-notifications', navbarNotificationRoutes);
app.use('/api/admin/profile', adminProfileRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/staff/loan-requests', staffLoanRequestRoutes);
app.use('/api/staff/loan-review', staffLoanReviewRoutes);
app.use('/api/staff/payment-verification', staffPaymentVerificationRoutes);
app.use('/api/staff/communications', staffCommunicationRoutes);
app.use('/api/staff/profile', staffProfileRoutes);
app.use('/api/staff/notifications', staffNotificationRoutes);
app.use('/api/staff/dashboard', staffDashboardRoutes);
app.use('/api/borrower/payments', borrowerPaymentRoutes);
app.use('/api/borrower/communications', require('./routes/borrower/communicationRoutes'));
app.use('/api/borrower/apply-loan', borrowerApplyLoanRoutes);
app.use('/api/borrower', borrowerDashboardRoutes);

app.use('/api/agent/my-clients', agentMyClientsRoutes);
app.use('/api/agent/earnings', agentEarningsRoutes);
app.use('/api/agent/communications', agentCommunicationRoutes);
app.use('/api/agent/notifications', agentNotificationRoutes);
app.use('/api/agent/profile', agentProfileRoutes);
app.use('/api/agent/dashboard', agentDashboardRoutes);
app.use('/api/agent/follow-ups', agentFollowUpRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/repayments', repaymentRoutes);


app.use('/api/verification', verificationRoutes);
app.use('/api/agreement', agreementRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/validation-rules', validationRoutes);

// Super Admin (SaaS Platform) layer — fully separate from tenant LMS routes.
// Milestone 2.2 SaaS platform routes are merged inside this router.
app.use('/api/platform', platformRoutes);
// SaaS Core Services (Milestone 2.2): tenant self-service + public catalog.
app.use('/api/tenant', tenantSaasRoutes);
app.use('/api/public', publicSaasRoutes);
// SaaS Commerce (Milestone 2.3): tenant wallet / marketplace / billing.
app.use('/api/commerce', tenantCommerceRoutes);
// Enterprise Ops (Milestone 2.4): public health + onboarding, tenant self-ops.
app.use('/api/health', healthRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/ops', tenantOpsRoutes);
// Commercial layer (Milestone 2.5): public KB/status/announcements, dev docs, customer portal.
app.use('/api/public', publicCustomerRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/customer', customerRoutes);

// Prometheus metrics scrape endpoint (additive).
app.use('/metrics', metricsRoutes);

// Base route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Point.47 LMS API' });
});

// Capture errors to monitoring (Sentry/Better Stack) BEFORE the existing
// response formatter — does not alter the client-facing error response.
app.use(expressErrorCapture);

// Error handler
app.use(errorHandler);

module.exports = app;
