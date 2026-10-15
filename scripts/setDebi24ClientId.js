require('dotenv').config();
const mongoose = require('mongoose');

async function updateTenants() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is missing');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const tenants = await db.collection('tenants').find({}).toArray();
  console.log(`Found ${tenants.length} tenants in database:`);

  for (const t of tenants) {
    console.log(`- ID: ${t._id}, Name: "${t.companyName}", Code: "${t.companyCode}", Current debi24ClientId: "${t.debi24ClientId || ''}"`);
    
    let targetClientId = null;
    const lowerName = String(t.companyName || '').toLowerCase();
    const lowerCode = String(t.companyCode || '').toLowerCase();

    if (lowerName.includes('chana') || lowerCode.includes('chana')) {
      targetClientId = 'Chana-Investment';
    } else if (lowerName.includes('dimeva') || lowerCode.includes('dimeva')) {
      targetClientId = 'Dimeva';
    } else if (lowerName.includes('point47') || lowerCode.includes('point47') || t.isDefault) {
      targetClientId = 'pointfortyseven';
    }

    if (targetClientId) {
      await db.collection('tenants').updateOne(
        { _id: t._id },
        { $set: { debi24ClientId: targetClientId } }
      );
      console.log(`  -> UPDATED debi24ClientId to "${targetClientId}"`);
    }
  }

  const updatedTenants = await db.collection('tenants').find({}).toArray();
  console.log('\nFinal Tenant Configuration:');
  for (const t of updatedTenants) {
    console.log(`Tenant: "${t.companyName}" (${t.companyCode}) => debi24ClientId: "${t.debi24ClientId}"`);
  }

  await mongoose.disconnect();
}

updateTenants().catch((err) => {
  console.error('Error updating tenants:', err);
  process.exit(1);
});
