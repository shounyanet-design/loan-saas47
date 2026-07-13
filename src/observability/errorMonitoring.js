/**
 * Production error monitoring — integration points for Sentry, Better Stack, and
 * (optionally) OpenTelemetry.
 *
 * Design constraints (Phase 3.1):
 *  - 100% additive & backward compatible. Existing console + SystemLog logging is
 *    NEVER replaced — this layer is purely additional.
 *  - Zero hard dependencies. The Sentry/OTel SDKs are loaded lazily and only when
 *    BOTH the SDK is installed AND the relevant env var (DSN/token) is present.
 *    With nothing configured, every function here is a safe no-op.
 *
 * Enable in production by installing the SDK and setting the env var:
 *    npm i @sentry/node           + SENTRY_DSN=...
 *    (Better Stack)               + LOGTAIL_SOURCE_TOKEN=...   (uses @logtail/node)
 *    npm i @opentelemetry/sdk-node + OTEL_ENABLED=true
 */

let sentry = null;          // resolved @sentry/node module if active
let logtail = null;         // resolved Better Stack client if active
let initialized = false;

function tryRequire(name) {
  try { return require(name); } catch (_) { return null; }
}

/** Initialise all configured providers. Safe to call once at boot. */
function initErrorMonitoring() {
  if (initialized) return;
  initialized = true;

  // --- Sentry ---
  if (process.env.SENTRY_DSN) {
    const mod = tryRequire('@sentry/node');
    if (mod) {
      try {
        mod.init({
          dsn: process.env.SENTRY_DSN,
          environment: process.env.NODE_ENV || 'development',
          tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0'),
          release: process.env.APP_VERSION || undefined,
        });
        sentry = mod;
        console.log('🛰️  Sentry error monitoring initialized');
      } catch (e) {
        console.warn('[observability] Sentry init failed:', e.message);
      }
    } else {
      console.warn('[observability] SENTRY_DSN set but @sentry/node not installed — run `npm i @sentry/node`.');
    }
  }

  // --- Better Stack (Logtail) ---
  if (process.env.LOGTAIL_SOURCE_TOKEN) {
    const mod = tryRequire('@logtail/node');
    if (mod && mod.Logtail) {
      try {
        logtail = new mod.Logtail(process.env.LOGTAIL_SOURCE_TOKEN);
        console.log('🛰️  Better Stack (Logtail) logging initialized');
      } catch (e) {
        console.warn('[observability] Logtail init failed:', e.message);
      }
    } else {
      console.warn('[observability] LOGTAIL_SOURCE_TOKEN set but @logtail/node not installed.');
    }
  }

  // --- OpenTelemetry (optional) ---
  if (process.env.OTEL_ENABLED === 'true') {
    const sdkMod = tryRequire('@opentelemetry/sdk-node');
    if (sdkMod) {
      try {
        const { NodeSDK } = sdkMod;
        const otelSdk = new NodeSDK({});
        otelSdk.start();
        console.log('🛰️  OpenTelemetry SDK started');
      } catch (e) {
        console.warn('[observability] OpenTelemetry init failed:', e.message);
      }
    } else {
      console.warn('[observability] OTEL_ENABLED=true but @opentelemetry/sdk-node not installed.');
    }
  }

  registerGlobalHandlers();
}

/**
 * Capture an error with structured context. Always logs to console; forwards to
 * Sentry/Logtail when active. Never throws.
 *
 * @param {Error|any} err
 * @param {{ source?: string, [k: string]: any }} [context]
 */
function captureError(err, context = {}) {
  const source = context.source || 'app';
  try {
    console.error(`[${source}] error:`, err && err.stack ? err.stack : err);
    if (sentry) {
      sentry.withScope((scope) => {
        scope.setTag('source', source);
        Object.entries(context).forEach(([k, v]) => { if (k !== 'source') scope.setExtra(k, v); });
        sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
    }
    if (logtail) {
      logtail.error(err && err.message ? err.message : String(err), { source, ...context }).catch(() => {});
    }
  } catch (_) {
    // Monitoring must never break the app.
  }
}

let globalsRegistered = false;
function registerGlobalHandlers() {
  if (globalsRegistered) return;
  globalsRegistered = true;

  process.on('unhandledRejection', (reason) => {
    captureError(reason instanceof Error ? reason : new Error(String(reason)), { source: 'unhandledRejection' });
  });

  process.on('uncaughtException', (err) => {
    captureError(err, { source: 'uncaughtException' });
    // An uncaught exception leaves the process in an undefined state. Flush and
    // exit so the supervisor (PM2/Docker/systemd) can restart cleanly.
    const flush = sentry && sentry.close ? sentry.close(2000) : Promise.resolve();
    Promise.resolve(flush).finally(() => process.exit(1));
  });
}

/** Express error-capturing middleware. Place BEFORE the existing errorHandler. */
function expressErrorCapture(err, req, _res, next) {
  captureError(err, {
    source: 'express',
    method: req.method,
    path: req.originalUrl,
    tenantId: req.tenant && req.tenant._id ? String(req.tenant._id) : undefined,
  });
  next(err);
}

module.exports = { initErrorMonitoring, captureError, expressErrorCapture };
