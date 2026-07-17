const tenantContext = require('../../../tenancy/tenantContext');
const Invoice = require('../../../models/Invoice');
const CommercePayment = require('../../../models/CommercePayment');
const CreditNote = require('../../../models/CreditNote');

/** Document-number generator: PREFIX-YYYYMM-XXXXXX (collision-safe via unique index + retry). */
function genNumber(prefix) {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const rand = Math.floor(100000 + Math.abs(hashTime()) % 900000);
  return `${prefix}-${ym}-${rand}`;
}
// Deterministic-enough randomness without Math.random (sandbox-safe): mix hrtime.
function hashTime() {
  const [s, ns] = process.hrtime();
  return (s * 1e9 + ns) ^ (process.pid << 16);
}

async function createInvoice(tenantId, { type = 'marketplace', items = [], discount = 0, tax = 0, couponCode, orderId, status = 'pending', dueDate } = {}) {
  return tenantContext.runAsSystem(async () => {
    const subtotal = items.reduce((a, it) => a + (it.lineTotal != null ? it.lineTotal : it.unitPrice * (it.quantity || 1)), 0);
    const total = Math.max(0, subtotal - discount + tax);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [inv] = await Invoice.create([{
          tenantId, invoiceNumber: genNumber('INV'), type, items, subtotal, discount, tax, total,
          currency: items[0]?.currency || 'ZAR', status, orderId, couponCode,
          issuedAt: new Date(), dueDate: dueDate || new Date(Date.now() + 7 * 86400000),
        }]);
        return inv;
      } catch (e) {
        if (e.code === 11000 && attempt < 4) continue; // number clash — retry
        throw e;
      }
    }
  });
}

async function createPayment(tenantId, { invoiceId, orderId, amount, currency = 'ZAR', provider = 'manual', providerRef = '', status = 'pending', idempotencyKey } = {}) {
  return tenantContext.runAsSystem(async () => {
    const prior = idempotencyKey
      ? await CommercePayment.findOne({ idempotencyKey })
      : null;
    if (prior) return prior;
    return CommercePayment.create({
      tenantId, invoiceId, orderId, amount, currency, provider, providerRef, status,
      idempotencyKey, history: [{ status, note: 'created' }],
    });
  });
}

async function markInvoicePaid(tenantId, invoiceId, amount) {
  return tenantContext.runAsSystem(() => Invoice.findOneAndUpdate(
    { _id: invoiceId, tenantId },
    { $set: { status: 'paid', amountPaid: amount, paidAt: new Date() } },
    { returnDocument: 'after' }
  ));
}

async function transitionPayment(tenantId, paymentId, status, note) {
  return tenantContext.runAsSystem(() => CommercePayment.findOneAndUpdate(
    { _id: paymentId, tenantId },
    { $set: { status }, $push: { history: { status, note } } },
    { returnDocument: 'after' }
  ));
}

async function issueCreditNote(tenantId, { invoiceId, amount, reason, issuedBy }) {
  return tenantContext.runAsSystem(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [cn] = await CreditNote.create([{ tenantId, invoiceId, amount, reason, issuedBy, creditNoteNumber: genNumber('CN') }]);
        return cn;
      } catch (e) { if (e.code === 11000 && attempt < 4) continue; throw e; }
    }
  });
}

module.exports = { genNumber, createInvoice, createPayment, markInvoicePaid, transitionPayment, issueCreditNote };
