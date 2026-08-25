const mongoose = require('mongoose');
const LoanApplication = require('./src/models/LoanApplication');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const latestApp = await LoanApplication.findOne({}).sort({ createdAt: -1 });
  console.log(JSON.stringify(latestApp.kycVerification, null, 2));
  process.exit(0);
}
run().catch(console.error);
