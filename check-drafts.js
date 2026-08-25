const mongoose = require('mongoose');
const LoanApplication = require('./src/models/LoanApplication');
const tenantContext = require('./src/tenancy/tenantContext');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  await tenantContext.runAsSystem(async () => {
    const drafts = await LoanApplication.find({ status: 'Draft' }).sort({ createdAt: -1 }).limit(5);
    drafts.forEach(d => {
      console.log(`Draft ${d._id} | Created: ${d.createdAt} | KYC: ${d.kycVerification?.verificationStatus}`);
    });
  });
  process.exit(0);
}
run().catch(console.error);
