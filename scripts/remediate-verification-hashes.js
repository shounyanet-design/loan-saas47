/**
 * Production Hash Remediation Script
 * 
 * Safely re-synchronizes the cryptographic verificationHash on existing loan applications
 * where loan terms, affordability, or population normalization diverged from the initial assessment.
 */
const mongoose = require('mongoose');
require('dotenv').config();
const LoanApplication = require('../src/models/LoanApplication');
const Borrower = require('../src/models/Borrower');
const tenantContext = require('../src/tenancy/tenantContext');
const { generateVerificationHash } = require('../src/utils/verificationHashEngine');

async function remediateHashes() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI is missing from environment.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB.');

  await tenantContext.runAsSystem(async () => {
    // Find all applications with creditAssessment
    const apps = await LoanApplication.find({
      'creditAssessment.verificationHash': { $exists: true, $ne: null }
    });

    console.log(`🔍 Total applications with verificationHash: ${apps.length}`);
    let remediatedCount = 0;

    for (const app of apps) {
      const borrowerDoc = await Borrower.findOne({
        $or: [{ _id: app.borrowerId }, { userId: app.borrowerId }]
      });

      const currentStoredHash = app.creditAssessment?.verificationHash;
      const calculatedHash = generateVerificationHash(app, borrowerDoc);

      if (currentStoredHash !== calculatedHash) {
        console.log(`🔄 Remediating App ${app.applicationId || app._id} (${app.fullName})`);
        console.log(`   Old Hash: ${currentStoredHash}`);
        console.log(`   New Hash: ${calculatedHash}`);

        app.creditAssessment.verificationHash = calculatedHash;
        if (app.consumerCreditReport) {
          app.consumerCreditReport.verificationHash = calculatedHash;
        }

        await app.save();
        remediatedCount++;
      }
    }

    console.log(`\n🎉 Remediation completed! Total applications re-synchronized: ${remediatedCount}/${apps.length}`);
  });

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB.');
}

remediateHashes().catch(err => {
  console.error('❌ Remediation error:', err);
  process.exit(1);
});
