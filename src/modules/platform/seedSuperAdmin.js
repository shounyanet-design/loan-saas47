/**
 * Seed / ensure the initial Super Admin platform user.
 *
 *   node src/modules/platform/seedSuperAdmin.js
 *
 * Credentials come from env (with safe defaults for local dev):
 *   SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, SUPERADMIN_NAME
 *
 * Idempotent: if the email already exists it only resets the password when
 * SUPERADMIN_RESET_PASSWORD=true.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const mongoose = require('mongoose');
const PlatformUser = require('./models/PlatformUser');
const GlobalSettings = require('./models/GlobalSettings');

async function seedSuperAdmin() {
  const email = (process.env.SUPERADMIN_EMAIL || 'superadmin@point47.com').toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@123';
  const fullName = process.env.SUPERADMIN_NAME || 'Platform Owner';

  let user = await PlatformUser.findOne({ email });
  if (user) {
    if (process.env.SUPERADMIN_RESET_PASSWORD === 'true') {
      user.password = password;
      await user.save();
      console.log(`✅ Super Admin ${email} password reset.`);
    } else {
      console.log(`ℹ️  Super Admin ${email} already exists (no changes).`);
    }
  } else {
    user = await PlatformUser.create({ fullName, email, password });
    console.log(`✅ Super Admin created: ${email}`);
  }

  // Ensure platform global settings exist.
  await GlobalSettings.getSingleton();
  console.log('✅ Global settings ensured.');
  return user;
}

// Allow running standalone or importing the function.
if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ Connected to MongoDB (${mongoose.connection.name})`);
    await seedSuperAdmin();
    await mongoose.disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
}

module.exports = seedSuperAdmin;
