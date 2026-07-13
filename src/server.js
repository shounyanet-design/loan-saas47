const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables directly from main .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

// Sandbox testing mode warning for production environment
if (
  process.env.NODE_ENV === 'production' &&
  (
    process.env.DEV_ONLY_BYPASS_SEQUENTIAL_GATING === 'true' ||
    process.env.DEV_ONLY_BYPASS_NEXT_STEP === 'true'
  )
) {
  console.warn(
    '[SECURITY WARNING] Development sandbox bypass flags are enabled in a production environment (NODE_ENV=production).'
  );
}


// Validate BulkSMS environment configurations at startup
if (process.env.SMS_TEST_MODE !== 'true') {
  const missingVars = [];
  if (!process.env.BULKSMS_BASE_URL) missingVars.push('BULKSMS_BASE_URL');
  if (!process.env.SMS_AUTH_TOKEN && (!process.env.BULKSMS_TOKEN_ID || !process.env.BULKSMS_TOKEN_SECRET)) {
    missingVars.push('SMS_AUTH_TOKEN or (BULKSMS_TOKEN_ID and BULKSMS_TOKEN_SECRET)');
  }
  if (missingVars.length > 0) {
    const errorMsg = `[STARTUP ERROR] Missing BulkSMS configurations: ${missingVars.join(', ')}`;
    console.error(errorMsg);
    if (process.env.NODE_ENV === 'production') {
      throw new Error(errorMsg);
    }
  } else {
    console.log('✅ BulkSMS integration config validated.');
  }
} else {
  console.log('⚠️ BulkSMS running in TEST MODE (SMS_TEST_MODE = true). No actual messages will be sent.');
}

// Validate environment before booting (fails fast in production).
require('./config/validateEnv')();

// Initialize production error monitoring (Sentry/Better Stack/OTel — all optional
// and no-op unless configured). Registers uncaughtException/unhandledRejection.
require('./observability/errorMonitoring').initErrorMonitoring();

const connectDB = require('./config/db');
const app = require('./app');
const { initializeDatanamixAuth } = require('./services/datanamix/datanamixAuth.service');

// Connect to database
connectDB();

// Tenant integrity validation — runs once the DB connection is open. Warns (does
// NOT crash) if any tenant-scoped records are missing tenantId or no default
// tenant exists, pointing the operator to `npm run repair` / `npm run migrate`.
require('mongoose').connection.once('open', () => {
  require('./tenancy/tenantHealing').logTenantIntegrityWarnings();
});

const PORT = process.env.PORT || 5000;

const { initSocket } = require('./socket/socketServer');
const { initCronJobs } = require('./services/cronService');

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  console.log(`✅ ImageKit initialized`);
});

// Initialize Datanamix authentication asynchronously — non-blocking startup
initializeDatanamixAuth().catch((err) => {
  console.error('[Datanamix] Fatal auth bootstrap error:', err.message);
});

// Initialize Socket.IO
initSocket(server);
console.log(`📡 Socket.IO initialized`);

// Initialize Cron Jobs
initCronJobs();
console.log(`⏰ Cron Jobs initialized`);

// Milestone 2.4: platform scheduler + queue handlers (additive, safe).
try {
  require('./modules/ops/services/queueHandlers');
  require('./modules/ops/services/schedulerService').initScheduler();
  console.log('🗓️  Platform scheduler initialized');
} catch (err) {
  console.error('[Scheduler] init error:', err.message);
}

// Graceful shutdown (Part 10) — drain connections, close DB, then exit.
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down gracefully…`);
  server.close(() => console.log('✅ HTTP server closed'));
  try {
    const mongoose = require('mongoose');
    await mongoose.connection.close(false);
    console.log('✅ MongoDB connection closed');
  } catch (e) { console.error('Shutdown error:', e.message); }
  // Force-exit if connections linger.
  setTimeout(() => process.exit(0), 5000).unref();
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// NOTE: unhandledRejection & uncaughtException are now handled centrally by
// observability/errorMonitoring (registered above), which logs structured
// context and forwards to Sentry/Better Stack when configured.
