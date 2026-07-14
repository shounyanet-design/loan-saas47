const mongoose = require('mongoose');

async function checkAdmin() {
  await mongoose.connect('mongodb+srv://AdminLoan:admin%40loan2026@loanmanagement.fwsl2hf.mongodb.net/loan_management?retryWrites=true&w=majority&appName=LoanManagement');
  const db = mongoose.connection.useDb('loan_management');
  
  // Platform users collection
  const platformUsers = db.collection('platformusers');
  const user = await platformUsers.findOne({ email: 'superadmin@point47.com' });
  
  console.log('User found:', user);
  
  if (user) {
    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare('SuperAdmin@123', user.password);
    console.log('Password matches SuperAdmin@123:', isMatch);
  }
  
  await mongoose.disconnect();
}

checkAdmin().catch(console.error);
