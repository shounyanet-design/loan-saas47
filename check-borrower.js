const mongoose = require('mongoose');
const Borrower = require('./src/models/Borrower');
const tenantContext = require('./src/tenancy/tenantContext');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  await tenantContext.runAsSystem(async () => {
    const b = await Borrower.findById("6a8c237df3ecd0bd68b042dc");
    console.log(`Borrower: ${b?.fullName} | kycStatus: ${b?.kycStatus} | kycResult: ${b?.kycResult ? 'Yes' : 'No'}`);
  });
  process.exit(0);
}
run().catch(console.error);
