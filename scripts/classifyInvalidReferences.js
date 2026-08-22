/*
 * scripts/classifyInvalidReferences.js
 *
 * Reads the latest legacy_financial_reference_audit JSON report, extracts all
 * records with category "INVALID_REFERENCE", counts them per collection, and
 * writes a concise markdown summary. All DB access is read‑only and wrapped in
 * tenantContext.runAsSystem() to satisfy the tenantPlugin requirements.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const tenantContext = require('../src/tenancy/tenantContext');

// Load models (only needed if we later attempt resolution – omitted for now)
// const Payment = require('../src/models/Payment');
// const RepaymentSchedule = require('../src/models/RepaymentSchedule');
// const ActiveLoan = require('../src/models/ActiveLoan');
// const LoanApplication = require('../src/models/LoanApplication');
// const TenantSubscription = require('../src/models/TenantSubscription');

const REPORTS_DIR = path.join(__dirname, '..', 'audit_reports');
const AUDIT_GLOB = 'legacy_financial_reference_audit_*.json';

function findLatestAuditFile() {
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.match(/^legacy_financial_reference_audit_.*\.json$/));
  if (files.length === 0) return null;
  // Sort lexicographically – timestamps in filename ensure order
  files.sort();
  return path.join(REPORTS_DIR, files[files.length - 1]);
}

// Load Mongoose models for resolution
const Payment = require('../src/models/Payment');
const RepaymentSchedule = require('../src/models/RepaymentSchedule');
const ActiveLoan = require('../src/models/ActiveLoan');
const LoanApplication = require('../src/models/LoanApplication');
const Tenant = require('../src/models/Tenant');

async function main() {
  const auditPath = findLatestAuditFile();
  if (!auditPath) {
    console.error('No audit JSON file found.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Mongo URI not configured.');
    process.exit(1);
  }

  // Connect read‑only (no writes performed)
  await mongoose.connect(mongoUri, {});

  const raw = fs.readFileSync(auditPath, 'utf8');
  const audit = JSON.parse(raw);

  // Filter INVALID_REFERENCE records
  const invalidRecords = audit.records.filter(r => r.category === 'INVALID_REFERENCE');

  // Containers for detailed results
  const results = [];
  const patternCounts = {};
  let tenantMismatchCount = 0;
  let liveServicingImpactCount = 0;

  await tenantContext.runAsSystem(async () => {

// Regex patterns to classify loanId formats
const patterns = [
  { name: 'P47_CODE', regex: /^P47-\d+$/ },
  { name: 'LAPP_CODE', regex: /^LAPP-\d+$/ },
  { name: 'UUID', regex: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/ },
  { name: 'NUMERIC', regex: /^\d+$/ },
  { name: 'OBJECTID', regex: /^[0-9a-fA-F]{24}$/ },
  { name: 'EMPTY', regex: /^$/ },
  { name: 'MALFORMED_OBJECTID', regex: /^[0-9a-fA-F]{24}$/ },
  { name: 'LEGACY_EXT', regex: /^ext-[A-Za-z0-9]+$/ }
];

function detectPattern(val) {
  for (const p of patterns) {
    if (p.regex.test(val)) return p.name;
  }
  return 'OTHER';
}

for (const rec of invalidRecords) {
  const { collection, recordId, tenantId, details } = rec;

  // Retrieve actual record to obtain precise loanId
  let doc = null;
  if (collection === 'Payment') {
    doc = await Payment.findById(recordId).lean();
  } else if (collection === 'RepaymentSchedule') {
    doc = await RepaymentSchedule.findById(recordId).lean();
  }

  const loanIdRaw = doc && doc.loanId ? String(doc.loanId) : (details && details.match(/loanId\s*[:=]\s*([\w-]+)/i) ? details.match(/loanId\s*[:=]\s*([\w-]+)/i)[1] : '');
  const pattern = detectPattern(loanIdRaw);
  patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;

  const tenant = await Tenant.findById(tenantId).lean();
  const isTenantActive = tenant && tenant.status === 'active';
  const isTestOrSeed = false; // No explicit flags

  let classification = 'UNRESOLVED_HISTORICAL_RECORD';
  let tenantMismatch = false;
  let affectsLive = false;
  let queryEligibility = 'NOT_INCLUDED_BY_CURRENT_QUERY';

  if (loanIdRaw) {
    const active = await ActiveLoan.findOne({ $or: [{ _id: loanIdRaw }, { loanCode: loanIdRaw }] }).lean();
    if (active) {
      classification = 'RESOLVABLE_TO_ACTIVELOAN';
      tenantMismatch = String(active.tenantId) !== String(tenantId);
      if (['Active', 'Overdue'].includes(active.loanStatus)) {
        affectsLive = true;
        queryEligibility = 'ACTUALLY_INCLUDED_IN_LIVE_QUERY';
      }
    } else {
      const app = await LoanApplication.findOne({ $or: [{ _id: loanIdRaw }, { applicationId: loanIdRaw }] }).lean();
      if (app) {
        const hasActive = await ActiveLoan.findOne({ loanApplicationId: app._id }).lean();
        if (!hasActive && (!app.disbursementStatus || app.disbursementStatus !== 'DISBURSED')) {
          classification = 'HISTORICAL_PRE_DISBURSEMENT_RECORD';
        } else {
          classification = 'RESOLVABLE_TO_LOANAPPLICATION';
        }
        tenantMismatch = String(app.tenantId) !== String(tenantId);
      } else {
        // No parent ActiveLoan or LoanApplication exists
        // Current production queries (servicing, dashboard, due payments, etc.) select by active loan relationship
        classification = 'UNRESOLVED_HISTORICAL_RECORD';
        affectsLive = false;
        queryEligibility = 'NOT_INCLUDED_BY_CURRENT_QUERY';
      }
    }
  } else {
    classification = 'UNRESOLVED_HISTORICAL_RECORD';
    affectsLive = false;
    queryEligibility = 'NOT_INCLUDED_BY_CURRENT_QUERY';
  }

  if (!isTenantActive) classification = 'INACTIVE_TENANT_HISTORY';
  if (isTestOrSeed) classification = 'TEST_OR_SEED_RECORD';

  if (tenantMismatch) tenantMismatchCount++;
  if (affectsLive) liveServicingImpactCount++;

  results.push({ collection, recordId, tenantId, loanIdRaw, pattern, classification, tenantMismatch, affectsLive, queryEligibility });
}
  });

// Aggregate counts per collection
const byCollection = invalidRecords.reduce((acc, r) => {
  acc[r.collection] = (acc[r.collection] || 0) + 1;
  return acc;
}, {});

// Classification counts
const classificationCounts = results.reduce((acc, r) => {
  acc[r.classification] = (acc[r.classification] || 0) + 1;
  return acc;
}, {});

// Build markdown report
const lines = [];
lines.push('# INVALID_REFERENCE Classification Summary');
lines.push('');
lines.push(`Generated at: ${new Date().toISOString()}`);
lines.push('');
lines.push(`Total INVALID_REFERENCE records: ${invalidRecords.length}`);
lines.push('');
lines.push('## Breakdown by collection');
lines.push('| Collection | Count |');
lines.push('|---|---|');
for (const [col, cnt] of Object.entries(byCollection)) {
  lines.push(`| ${col} | ${cnt} |`);
}
lines.push('');
lines.push('## Classification breakdown');
lines.push('| Classification | Count |');
lines.push('|---|---|');
for (const [cls, cnt] of Object.entries(classificationCounts)) {
  lines.push(`| ${cls} | ${cnt} |`);
}
lines.push('');
lines.push('## Reference pattern breakdown');
lines.push('| Pattern | Count |');
lines.push('|---|---|');
for (const [pat, cnt] of Object.entries(patternCounts)) {
  lines.push(`| ${pat} | ${cnt} |`);
}

const outPath = path.join(REPORTS_DIR, 'INVALID_FINANCIAL_REFERENCE_CLASSIFICATION.md');
fs.writeFileSync(outPath, lines.join('\n'));

// Write detailed JSON for runtime verification
const summaryJson = {
  totalInvalid: invalidRecords.length,
  byCollection,
  classificationCounts,
  patternCounts,
  tenantMismatchCount,
  liveServicingImpactCount,
  detailed: results
};
const jsonPath = path.join(REPORTS_DIR, 'invalid_reference_classification.json');
fs.writeFileSync(jsonPath, JSON.stringify(summaryJson, null, 2));

  console.log('Classification completed.');
  console.log(`Markdown report: ${outPath}`);
  console.log(`JSON summary: ${jsonPath}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error during classification:', err);
  process.exit(1);
});
