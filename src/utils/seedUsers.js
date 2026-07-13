const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const connectDB = require('../config/db');
const tenantContext = require('../tenancy/tenantContext');

// Load env vars
dotenv.config({ path: './.env' });

const users = [
  {
    fullName: 'Admin User',
    email: 'admin@lms.com',
    password: 'admin123',
    phone: '1234567890',
    role: 'admin'
  },
  {
    fullName: 'Staff User',
    email: 'staff@lms.com',
    password: 'staff123',
    phone: '1234567891',
    role: 'staff'
  },
  {
    fullName: 'Agent User',
    email: 'agent@lms.com',
    password: 'agent123',
    phone: '1234567892',
    role: 'agent'
  },
  {
    fullName: 'Borrower User',
    email: 'borrower@lms.com',
    password: 'borrower123',
    phone: '1234567893',
    role: 'borrower'
  }
];

const seedUsers = async () => {
  try {
    await connectDB();

    // Multi-tenant safety: resolve the default tenant and run all creation
    // inside its context so the tenant plugin stamps tenantId on every seeded
    // user. Without this, seeded users would have no tenantId and 403 on login.
    const defaultTenant = await tenantContext.runAsSystem(() =>
      Tenant.findOne({ isDefault: true })
    );
    if (!defaultTenant) {
      console.error('❌ No default tenant found. Run `npm run migrate` first (creates the default tenant), then re-run the seeder.');
      process.exit(1);
    }

    await tenantContext.runWithTenant(defaultTenant._id, async () => {
      for (const u of users) {
        const userExists = await User.findOne({ email: u.email });
        if (userExists) {
          console.log(`User ${u.email} already exists, updating password...`);
          userExists.password = u.password;
          // Backfill tenantId on a pre-existing tenant-less seed user.
          if (!userExists.tenantId) userExists.tenantId = defaultTenant._id;
          await userExists.save();
        } else {
          await User.create(u); // plugin stamps tenantId from the active context
          console.log(`User ${u.email} created (tenant ${defaultTenant._id}).`);
        }
      }
    });

    console.log('✅ All users seeded successfully');
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

seedUsers();
