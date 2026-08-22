// scripts/auditLegacyFinancialReferences.js
// POINT.47 – READ‑ONLY LEGACY FINANCIAL REFERENCE AUDIT
// Generates a JSON & Markdown report classifying Payment and RepaymentSchedule records.
// No mutations are performed. All queries respect tenant isolation.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Load model definitions so mongoose.model registers them
require(path.join(__dirname, '..', 'src', 'models', 'Payment'));
require(path.join(__dirname, '..', 'src', 'models', 'RepaymentSchedule'));
require(path.join(__dirname, '..', 'src', 'models', 'ActiveLoan'));
require(path.join(__dirname, '..', 'src', 'models', 'LoanApplication'));
require(path.join(__dirname, '..', 'src', 'models', 'TenantSubscription'));

// Re‑use the existing DB connection helper
const connectDB = require('../src/config/db');
const tenantContext = require('../src/tenancy/tenantContext');
// Models (registered globally via mongoose.model)
const Payment = mongoose.model('Payment');
const RepaymentSchedule = mongoose.model('RepaymentSchedule');
const ActiveLoan = mongoose.model('ActiveLoan');
const LoanApplication = mongoose.model('LoanApplication');
const TenantSubscription = mongoose.model('TenantSubscription');

/** Helper: safe ObjectId conversion */
function toObjectId(id) {
  if (!id) return null;
  try {
    return mongoose.Types.ObjectId(id);
  } catch (_) {
    return null;
  }
}

/** Resolve the authoritative loan for a record.
 *  Returns an object { category, activeLoan, loanApplication, notes }
 */
async function resolveLoanRelationship(record) {
  // Short‑circuit for soft‑deleted records – they are still audited but flagged.
  const isDeleted = Boolean(record.isDeleted);

  // 1️⃣ Direct loanId reference (current authoritative path)
  if (record.loanId) {
    const loanById = await ActiveLoan.findOne({ _id: record.loanId }).lean();
    if (loanById) {
      return { category: isDeleted ? 'DELETED_OR_HISTORICAL_RECORD' : 'CURRENT_ACTIVELOAN_REFERENCE', activeLoan: loanById, notes: 'Found via loanId' };
    }
  }

  // 2️⃣ Legacy loanCode reference (some historic records store loanCode only)
  if (record.loanCode) {
    const loanByCode = await ActiveLoan.findOne({ loanCode: record.loanCode }).lean();
    if (loanByCode) {
      return { category: isDeleted ? 'DELETED_OR_HISTORICAL_RECORD' : 'LEGACY_ACTIVELOAN_REFERENCE', activeLoan: loanByCode, notes: 'Found via loanCode' };
    }
  }

  // 3️⃣ Some legacy schemas store loanApplicationId directly on the record
  if (record.loanApplicationId) {
    const app = await LoanApplication.findOne({ _id: record.loanApplicationId }).lean();
    if (app) {
      return { category: isDeleted ? 'DELETED_OR_HISTORICAL_RECORD' : 'LOANAPPLICATION_PAYMENT_HISTORY', loanApplication: app, notes: 'Found via loanApplicationId' };
    }
  }

  // 4️⃣ No match – true orphan or invalid reference
  if (record.loanId && !toObjectId(record.loanId)) {
    return { category: 'INVALID_REFERENCE', notes: 'loanId is not a valid ObjectId' };
  }

  return { category: isDeleted ? 'DELETED_OR_HISTORICAL_RECORD' : 'TRUE_ORPHAN', notes: 'No matching ActiveLoan or LoanApplication' };
}

/** Main audit routine */
async function runAudit() {
  await connectDB(); // establishes mongoose connection using MONGO_URI

  const report = {
    generatedAt: new Date().toISOString(),
    tenantCount: 0,
    records: [] // each entry conforms to the schema described in the implementation plan
  };

  // -----------------------------------------------------
  // Discover all tenant IDs – the system stores them in TenantSubscription
  // -----------------------------------------------------
  await tenantContext.runAsSystem(async () => {
    const tenantSubs = await TenantSubscription.find({}).select('tenantId').lean();
    const tenantIds = tenantSubs.map(t => String(t.tenantId)).filter(Boolean);
    report.tenantCount = tenantIds.length;

    for (const tenantId of tenantIds) {
      // All queries are tenant‑scoped – the tenantPlugin adds `tenantId` automatically.
      const paymentCursor = Payment.find({ tenantId }).lean().cursor();
      for await (const payment of paymentCursor) {
        const resolution = await resolveLoanRelationship(payment);
        report.records.push({
          collection: 'Payment',
          recordId: String(payment._id),
          tenantId,
          category: resolution.category,
          details: resolution.notes,
          linkedActiveLoanId: resolution.activeLoan ? String(resolution.activeLoan._id) : null,
          linkedLoanApplicationId: resolution.loanApplication ? String(resolution.loanApplication._id) : null
        });
      }

      const scheduleCursor = RepaymentSchedule.find({ tenantId }).lean().cursor();
      for await (const schedule of scheduleCursor) {
        const resolution = await resolveLoanRelationship(schedule);
        report.records.push({
          collection: 'RepaymentSchedule',
          recordId: String(schedule._id),
          tenantId,
          category: resolution.category,
          details: resolution.notes,
          linkedActiveLoanId: resolution.activeLoan ? String(resolution.activeLoan._id) : null,
          linkedLoanApplicationId: resolution.loanApplication ? String(resolution.loanApplication._id) : null
        });
      }
    }
  });
  // -----------------------------------------------------
  // Persist reports – JSON + Markdown
  // -----------------------------------------------------
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = path.join(__dirname, '..', 'audit_reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const jsonPath = path.join(reportsDir, `legacy_financial_reference_audit_${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  // Build a simple markdown summary
  const categoryCounts = report.records.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {});

  let md = `# Legacy Financial Reference Audit Report\n\n`;
  md += `*Generated*: ${report.generatedAt}\n*Tenants examined*: ${report.tenantCount}\n\n`;
  md += `## Summary by Category\n\n| Category | Count | Sample Record ID |\n|---|---|---|\n`;
  for (const [cat, count] of Object.entries(categoryCounts)) {
    const sample = report.records.find(r => r.category === cat);
    md += `| ${cat} | ${count} | ${sample ? sample.recordId : 'N/A'} |\n`;
  }
  md += `\n---\n*All records are listed in the accompanying JSON file.*\n`;

  const mdPath = path.join(reportsDir, `legacy_financial_reference_audit_${timestamp}.md`);
  fs.writeFileSync(mdPath, md, 'utf8');

  console.log('✅ Audit completed. Reports written to', reportsDir);
  console.log('   JSON:', jsonPath);
  console.log('   Markdown:', mdPath);

  await mongoose.disconnect();
}

runAudit().catch(err => {
  console.error('❌ Audit failed:', err);
  process.exit(1);
});
