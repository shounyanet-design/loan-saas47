/**
 * Migration runner.
 *
 *   node src/migrations/run.js
 *
 * Connects to MongoDB, runs the SaaS-foundation migrations in order inside a
 * SYSTEM (tenant-bypass) context, then disconnects. All migrations are
 * idempotent, so this is safe to run repeatedly.
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');
const tenantContext = require('../tenancy/tenantContext');

const MIGRATIONS = [
  { name: '001-create-default-tenant', mod: require('./001-create-default-tenant') },
  { name: '002-backfill-tenantId', mod: require('./002-backfill-tenantId') },
  { name: '003-convert-unique-indexes', mod: require('./003-convert-unique-indexes') },
  { name: '004-seed-subscription-plans', mod: require('./004-seed-subscription-plans') },
  { name: '005-subscribe-existing-tenants', mod: require('./005-subscribe-existing-tenants') },
  { name: '006-create-wallets', mod: require('./006-create-wallets') },
  { name: '007-seed-api-pricing', mod: require('./007-seed-api-pricing') },
  { name: '008-seed-marketplace', mod: require('./008-seed-marketplace') },
  { name: '009-seed-knowledge-base', mod: require('./009-seed-knowledge-base') },
];

// Direction: `node run.js` (up, default) or `node run.js down`.
const direction = (process.argv[2] || 'up').toLowerCase();

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set');
  }
  if (!['up', 'down'].includes(direction)) {
    throw new Error(`Unknown direction "${direction}". Use "up" or "down".`);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB (${mongoose.connection.name}) — direction: ${direction}`);

  // Migrations are trusted cross-tenant operations -> run in SYSTEM mode.
  // down() runs in reverse order.
  const order = direction === 'up' ? MIGRATIONS : [...MIGRATIONS].reverse();
  await tenantContext.runAsSystem(async () => {
    for (let i = 0; i < order.length; i++) {
      const { name, mod } = order[i];
      const fn = mod[direction];
      if (typeof fn !== 'function') {
        console.log(`\n⏭  ${name}: no ${direction}() — skipping.`);
        continue;
      }
      console.log(`\n▶ ${direction} ${name} (${i + 1}/${order.length}) ...`);
      await fn();
    }
  });

  console.log(`\n✅ All migrations (${direction}) complete.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n❌ Migration failed:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
