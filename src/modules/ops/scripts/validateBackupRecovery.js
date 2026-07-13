#!/usr/bin/env node
/**
 * Backup → Recovery validation (Phase 3.1).
 *
 * Exercises the full disaster-recovery cycle and produces a verification report:
 *   1. CREATE   — logical backup of the live DB (backupService.createLogicalBackup)
 *   2. CHECKSUM — recompute sha256 over the backup files (verifyBackup)
 *   3. RESTORE  — restore each collection into a SANDBOX copy ("_recovery_test_<name>")
 *                 so production data is NEVER touched
 *   4. INTEGRITY— compare restored document counts against the backup manifest
 *   5. ROLLBACK — drop the sandbox collections (clean up)
 *
 * A JSON report is written to storage/backups/recovery-report-<ts>.json.
 *
 * Run:  node src/modules/ops/scripts/validateBackupRecovery.js
 *       (requires MONGO_URI; connects, validates, disconnects, exits 0/1)
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const backupService = require('../services/backupService');

const SANDBOX_PREFIX = '_recovery_test_';

async function main() {
  const report = { startedAt: new Date().toISOString(), steps: {}, ok: false };
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('MONGO_URI not set'); process.exit(1); }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  try {
    // 1. CREATE
    const backup = await backupService.createLogicalBackup({ triggeredBy: 'recovery-validation' });
    report.steps.create = { ok: backup.status === 'completed', backupId: String(backup._id), documentCount: backup.documentCount, collections: backup.collections.length };

    // 2. CHECKSUM
    const verify = await backupService.verifyBackup(backup._id);
    report.steps.checksum = { ok: verify.ok, checksum: verify.checksum };
    if (!verify.ok) throw new Error('Checksum verification failed');

    // 3. RESTORE into sandbox + 4. INTEGRITY
    const integrity = [];
    let restoreOk = true;
    for (const c of backup.collections) {
      const file = path.join(backup.location, `${c.name}.json`);
      if (!fs.existsSync(file)) { integrity.push({ name: c.name, ok: false, reason: 'file missing' }); restoreOk = false; continue; }
      const docs = JSON.parse(fs.readFileSync(file, 'utf8'));
      const sandbox = SANDBOX_PREFIX + c.name;
      await db.collection(sandbox).deleteMany({});
      if (docs.length) {
        await db.collection(sandbox).insertMany(docs.map((d) => {
          if (d && typeof d._id === 'string' && /^[0-9a-fA-F]{24}$/.test(d._id)) {
            try { d._id = new mongoose.Types.ObjectId(d._id); } catch (_) {}
          }
          return d;
        }));
      }
      const restoredCount = await db.collection(sandbox).countDocuments();
      const ok = restoredCount === c.count;
      if (!ok) restoreOk = false;
      integrity.push({ name: c.name, expected: c.count, restored: restoredCount, ok });
    }
    report.steps.restore = { ok: restoreOk, collections: integrity };

    // 5. ROLLBACK (drop sandbox collections)
    let dropped = 0;
    for (const c of backup.collections) {
      try { await db.collection(SANDBOX_PREFIX + c.name).drop(); dropped++; } catch (_) { /* may not exist */ }
    }
    report.steps.rollback = { ok: true, droppedSandboxCollections: dropped };

    report.ok = report.steps.create.ok && report.steps.checksum.ok && restoreOk;
  } catch (err) {
    report.error = err.message;
    report.ok = false;
  } finally {
    report.finishedAt = new Date().toISOString();
    const out = path.join(backupService.BACKUP_ROOT, `recovery-report-${report.startedAt.replace(/[:.]/g, '-')}.json`);
    try { fs.mkdirSync(backupService.BACKUP_ROOT, { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2)); } catch (_) {}
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nReport written to: ${out}`);
    await mongoose.disconnect();
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
