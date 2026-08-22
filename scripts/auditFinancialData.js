require('dotenv').config();
const mongoose = require('mongoose');

async function audit() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const app = await db.collection('loanapplications').findOne({ _id: new mongoose.Types.ObjectId('6a81e933527ec0956173109c') });
  console.log('=== LOAN APPLICATION ===');
  console.log(JSON.stringify(app, null, 2));

  const activeLoans = await db.collection('activeloans').find({ loanApplicationId: new mongoose.Types.ObjectId('6a81e933527ec0956173109c') }).toArray();
  console.log('=== ACTIVE LOANS (' + activeLoans.length + ') ===');
  console.log(JSON.stringify(activeLoans, null, 2));

  const activeLoanIds = activeLoans.map(l => l._id);
  const activeLoanStrIds = activeLoans.map(l => l._id.toString());

  const schedules = await db.collection('repaymentschedules').find({
    $or: [
      { loanId: { $in: activeLoanIds } },
      { loanId: { $in: activeLoanStrIds } },
      { loanApplicationId: new mongoose.Types.ObjectId('6a81e933527ec0956173109c') }
    ]
  }).toArray();
  console.log('=== REPAYMENT SCHEDULES (' + schedules.length + ') ===');
  console.log(JSON.stringify(schedules, null, 2));

  const payments = await db.collection('payments').find({
    $or: [
      { loanId: { $in: activeLoanIds } },
      { loanId: { $in: activeLoanStrIds } },
      { loanApplicationId: new mongoose.Types.ObjectId('6a81e933527ec0956173109c') },
      { activeLoanId: { $in: activeLoanIds } }
    ]
  }).toArray();
  console.log('=== PAYMENTS (' + payments.length + ') ===');
  console.log(JSON.stringify(payments, null, 2));

  await mongoose.disconnect();
}
audit().catch(console.error);
