require('dotenv').config();
const mongoose = require('mongoose');

async function runAudit() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const activeLoans = await db.collection('activeloans').find({}).toArray();
  console.log(`=== TOTAL ACTIVELOAN DOCUMENTS IN MONGO: ${activeLoans.length} ===\n`);

  for (let i = 0; i < activeLoans.length; i++) {
    const al = activeLoans[i];
    const app = await db.collection('loanapplications').findOne({ _id: al.loanApplicationId });
    const schedules = await db.collection('repaymentschedules').find({ loanId: al._id }).toArray();
    const payments = await db.collection('payments').find({ loanId: al._id, isDeleted: false }).toArray();

    console.log(`--- ROW #${i + 1} ---`);
    console.log(`ActiveLoan ID:       ${al._id}`);
    console.log(`Tenant ID:           ${al.tenantId}`);
    console.log(`Loan Code:           ${al.loanCode || 'N/A'}`);
    console.log(`Borrower Name:       ${al.borrowerName || al.fullName}`);
    console.log(`Loan Status:         ${al.loanStatus}`);
    console.log(`Disbursement Status: ${al.disbursementStatus}`);
    console.log(`Approved Amount:     R ${al.approvedAmount}`);
    console.log(`Remaining Balance:   R ${al.remainingBalance}`);
    console.log(`Duration (Months):   ${al.loanDurationMonths}`);
    console.log(`Originating App ID:  ${app ? app.applicationId : 'NOT FOUND'} (Mongo ID: ${al.loanApplicationId})`);
    console.log(`App Status:          ${app ? app.status : 'N/A'}`);
    console.log(`Schedule Count:      ${schedules.length}`);
    console.log(`Verified Payments:   ${payments.filter(p => p.paymentStatus === 'Verified').length}`);
    console.log(`Created At:          ${al.createdAt}`);
    console.log(`Why it exists:       ${al.notes || 'Created during disbursement lifecycle'}\n`);
  }

  await mongoose.disconnect();
}

runAudit().catch(console.error);
