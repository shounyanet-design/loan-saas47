/**
 * Migration 003 — Convert global-unique indexes to tenant-scoped, and build
 * the new tenant-prefixed performance indexes.
 *
 * Mechanism: `Model.syncIndexes()` reconciles the collection's indexes to the
 * current schema definition. It DROPS indexes that are no longer declared
 * (e.g. the old single-field `email_1` unique) and CREATES the ones now
 * declared (e.g. `tenantId_1_email_1` unique, and the partial compound
 * uniques). This is the idempotent, native way to perform the conversion.
 *
 * SAFETY:
 *  - Idempotent / retry-safe: re-running reports no changes once converted.
 *  - Data-preserving: only indexes change; documents are untouched.
 *  - Pre-req: run AFTER 002 (every doc must already have a tenantId, otherwise
 *    a tenant-scoped unique build could behave unexpectedly).
 *  - Within a single tenant, values that were globally unique remain unique, so
 *    the new unique indexes build without conflict.
 *
 * ROLLBACK (`down`): drops the new compound unique indexes. It does NOT restore
 * the old GLOBAL unique indexes automatically, because global uniqueness is
 * unsafe once more than one tenant exists. Restore manually if truly needed.
 */

const mongoose = require('mongoose');
const loadAllModels = require('./_loadModels');

// Compound unique indexes introduced by this migration (for targeted rollback).
const NEW_UNIQUE_INDEXES = {
  User: ['tenantId_1_email_1'],
  Borrower: ['tenantId_1_email_1', 'tenantId_1_idNumber_1', 'tenantId_1_borrowerCode_1'],
  Staff: ['tenantId_1_email_1', 'tenantId_1_phoneNumber_1', 'tenantId_1_idNumber_1', 'tenantId_1_employeeId_1'],
  Agent: ['tenantId_1_email_1', 'tenantId_1_phoneNumber_1', 'tenantId_1_idNumber_1', 'tenantId_1_employeeId_1'],
  LoanApplication: ['tenantId_1_applicationId_1'],
  ActiveLoan: ['tenantId_1_loanCode_1'],
  Payment: ['tenantId_1_transactionId_1'],
  Notification: ['tenantId_1_notificationId_1'],
  Commission: ['tenantId_1_commissionCode_1'],
};

async function up() {
  loadAllModels();

  const summary = [];
  for (const name of Object.keys(mongoose.models)) {
    const Model = mongoose.models[name];
    try {
      // syncIndexes returns the list of dropped index names.
      const dropped = await Model.syncIndexes();
      summary.push({ model: name, dropped: Array.isArray(dropped) ? dropped.join(', ') : '' });
    } catch (err) {
      // A failure here usually means existing data violates a new unique index.
      summary.push({ model: name, dropped: `ERROR: ${err.message}` });
      throw err; // fail the migration loudly; do not leave a half-applied state silently
    }
  }
  console.table(summary);
  console.log('  [003] Index conversion complete (syncIndexes reconciled all models to schema).');
  return summary;
}

async function down() {
  loadAllModels();
  console.warn('  [003] down(): dropping NEW compound unique indexes only. Global uniqueness is NOT restored (unsafe in multi-tenant).');
  for (const [name, indexes] of Object.entries(NEW_UNIQUE_INDEXES)) {
    const Model = mongoose.models[name];
    if (!Model) continue;
    for (const idx of indexes) {
      try {
        await Model.collection.dropIndex(idx);
        console.log(`    dropped ${name}.${idx}`);
      } catch (err) {
        if (!/index not found/i.test(err.message)) throw err;
      }
    }
  }
}

module.exports = { up, down };
