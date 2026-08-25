const mongoose = require('mongoose');
const User = require('./src/models/User');
const Borrower = require('./src/models/Borrower');
const tenantContext = require('./src/tenancy/tenantContext');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  await tenantContext.runAsSystem(async () => {
    const u = await User.findById("6a8c237df3ecd0bd68b042dc");
    console.log(`User: ${u?.fullName} | role: ${u?.role}`);
    
    if (u) {
      const b = await Borrower.findOne({ userId: u._id });
      console.log(`Associated Borrower: ${b?._id} | kycStatus: ${b?.kycStatus} | kycResult: ${b?.kycResult ? 'Yes' : 'No'}`);
    }
  });
  process.exit(0);
}
run().catch(console.error);
