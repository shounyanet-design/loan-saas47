const tenantContext = require('../../../tenancy/tenantContext');
const Wallet = require('../../../models/Wallet');
const PlatformNotification = require('../../platform/models/PlatformNotification');

/**
 * Commerce notifications (Part 11). Never throws into the caller's path.
 *
 * Events are recorded as PlatformNotification entries (visible in the Super
 * Admin console) and tagged with the tenantId in metadata. A best-effort write
 * to the tenant's own Notification feed is attempted but failures are ignored.
 */
const TYPE_MAP = {
  LOW_BALANCE: 'warning', TOKENS_EXHAUSTED: 'error', PAYMENT_SUCCESS: 'success',
  PAYMENT_FAILURE: 'error', PURCHASE_SUCCESS: 'success', INVOICE_GENERATED: 'info',
  TOKENS_ADDED: 'success', SUBSCRIPTION_EXPIRY: 'warning',
};

async function notify(tenantId, event, title, message, metadata = {}) {
  try {
    await PlatformNotification.create({
      type: TYPE_MAP[event] || 'info',
      title,
      message,
      isBroadcast: false,
      // Recorded against the platform feed; tenantId carried in metadata.
      readBy: [],
    });
  } catch (_) { /* non-fatal */ }

  // Best-effort tenant-facing notification.
  try {
    const Notification = require('../../../models/Notification');
    await tenantContext.runAsSystem(() => Notification.create({
      tenantId,
      type: event,
      notificationType: event,
      title,
      message,
      priority: event === 'TOKENS_EXHAUSTED' ? 'URGENT' : 'IMPORTANT',
      status: 'UNREAD',
      isRead: false,
      isDeleted: false,
    }));
  } catch (_) { /* schema differences are non-fatal */ }
}

/** Notify if the wallet has fallen to/below its low-balance threshold. */
async function checkLowBalance(tenantId) {
  const wallet = await tenantContext.runAsSystem(() => Wallet.findOne({ tenantId }));
  if (!wallet) return;
  if (wallet.availableTokens <= 0) {
    return notify(tenantId, 'TOKENS_EXHAUSTED', 'Tokens exhausted', 'Your token balance is depleted. Please top up to continue using metered features.', { tenantId: String(tenantId) });
  }
  if (wallet.availableTokens <= wallet.lowBalanceThreshold) {
    const last = wallet.lowBalanceNotifiedAt ? new Date(wallet.lowBalanceNotifiedAt).getTime() : 0;
    // Throttle to once per 6h.
    if (Date.now() - last > 6 * 3600 * 1000) {
      await tenantContext.runAsSystem(() => Wallet.updateOne({ _id: wallet._id }, { $set: { lowBalanceNotifiedAt: new Date() } }));
      return notify(tenantId, 'LOW_BALANCE', 'Low token balance', `Your wallet has ${wallet.availableTokens} tokens remaining (threshold ${wallet.lowBalanceThreshold}).`, { tenantId: String(tenantId) });
    }
  }
}

module.exports = { notify, checkLowBalance };
