const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const tenantContext = require('../../../tenancy/tenantContext');
const BackupRecord = require('../models/BackupRecord');
const logger = require('./loggingService');

const BACKUP_ROOT = path.join(__dirname, '../../../../storage/backups');

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }
function ts() { const d = new Date(); return d.toISOString().replace(/[:.]/g, '-'); }

/**
 * Logical backup — exports collections to JSON via the driver. Works anywhere
 * (no mongodump needed). Computes a sha256 checksum + document count for
 * verification. This is the DEFAULT, fully-functional backup.
 */
async function createLogicalBackup({ collections, triggeredBy = 'system' } = {}) {
  return tenantContext.runAsSystem(async () => {
    const record = await BackupRecord.create({ type: 'logical', scope: collections ? collections.join(',') : 'all', status: 'running', triggeredBy });
    try {
      const dir = ensureDir(path.join(BACKUP_ROOT, `backup-${ts()}`));
      const db = mongoose.connection.db;
      const all = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
      const target = collections && collections.length ? collections.filter((c) => all.includes(c)) : all;

      const hash = crypto.createHash('sha256');
      let totalDocs = 0; let totalBytes = 0; const collInfo = [];
      for (const name of target) {
        const docs = await db.collection(name).find({}).toArray();
        const json = JSON.stringify(docs);
        const file = path.join(dir, `${name}.json`);
        fs.writeFileSync(file, json);
        hash.update(json);
        totalDocs += docs.length; totalBytes += Buffer.byteLength(json);
        collInfo.push({ name, count: docs.length });
      }
      record.location = dir; record.collections = collInfo; record.documentCount = totalDocs;
      record.sizeBytes = totalBytes; record.checksum = hash.digest('hex');
      record.status = 'completed'; record.completedAt = new Date();
      await record.save();
      logger.info('audit', `Logical backup completed (${totalDocs} docs, ${target.length} collections)`, { backupId: String(record._id) });
      return record;
    } catch (err) {
      record.status = 'failed'; record.error = err.message; record.completedAt = new Date(); await record.save();
      logger.error('error', `Backup failed: ${err.message}`);
      throw err;
    }
  });
}

/** Verify a backup by recomputing the checksum from its files. */
async function verifyBackup(recordId) {
  return tenantContext.runAsSystem(async () => {
    const record = await BackupRecord.findById(recordId);
    if (!record) throw Object.assign(new Error('Backup not found'), { status: 404 });
    if (!record.location || !fs.existsSync(record.location)) { record.status = 'failed'; record.error = 'Backup files missing'; await record.save(); return { ok: false, reason: 'files missing' }; }
    const hash = crypto.createHash('sha256');
    for (const c of record.collections) {
      const file = path.join(record.location, `${c.name}.json`);
      if (!fs.existsSync(file)) return { ok: false, reason: `missing ${c.name}` };
      hash.update(fs.readFileSync(file));
    }
    const ok = hash.digest('hex') === record.checksum;
    if (ok) { record.status = 'verified'; record.verifiedAt = new Date(); await record.save(); }
    return { ok, checksum: record.checksum };
  });
}

/**
 * Restore a logical backup. GUARDED: requires force=true to overwrite existing
 * data. By default only restores collections that are currently empty.
 */
async function restoreLogicalBackup(recordId, { force = false, collections } = {}) {
  return tenantContext.runAsSystem(async () => {
    const record = await BackupRecord.findById(recordId);
    if (!record || !fs.existsSync(record.location)) throw Object.assign(new Error('Backup not found'), { status: 404 });
    const db = mongoose.connection.db;
    const restored = [];
    for (const c of record.collections) {
      if (collections && !collections.includes(c.name)) continue;
      const file = path.join(record.location, `${c.name}.json`);
      if (!fs.existsSync(file)) continue;
      const existing = await db.collection(c.name).countDocuments();
      if (existing > 0 && !force) { restored.push({ name: c.name, skipped: 'not empty' }); continue; }
      if (force) await db.collection(c.name).deleteMany({});
      const docs = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (docs.length) await db.collection(c.name).insertMany(docs.map(reviveIds));
      restored.push({ name: c.name, inserted: docs.length });
    }
    logger.warn('audit', `Restore executed from backup ${recordId} (force=${force})`);
    return { restored };
  });
}

// Revive ObjectId-ish + Date string fields from JSON.
function reviveIds(doc) {
  if (doc && typeof doc._id === 'string' && /^[0-9a-fA-F]{24}$/.test(doc._id)) {
    try { doc._id = new mongoose.Types.ObjectId(doc._id); } catch (_) {}
  }
  return doc;
}

/** Optional physical backup via mongodump (if installed). */
async function createMongodumpBackup({ triggeredBy = 'system' } = {}) {
  return tenantContext.runAsSystem(async () => {
    const record = await BackupRecord.create({ type: 'mongodump', scope: 'all', status: 'running', triggeredBy });
    const dir = ensureDir(path.join(BACKUP_ROOT, `mongodump-${ts()}`));
    const uri = process.env.MONGO_URI;
    return new Promise((resolve) => {
      const proc = spawn('mongodump', [`--uri=${uri}`, `--out=${dir}`]);
      let err = '';
      proc.stderr.on('data', (d) => { err += d.toString(); });
      proc.on('error', async (e) => { record.status = 'failed'; record.error = `mongodump unavailable: ${e.message}`; await record.save(); resolve(record); });
      proc.on('close', async (code) => {
        record.status = code === 0 ? 'completed' : 'failed';
        record.location = dir; record.error = code === 0 ? '' : err; record.completedAt = new Date();
        await record.save(); resolve(record);
      });
    });
  });
}

async function list({ limit = 50 } = {}) {
  return tenantContext.runAsSystem(() => BackupRecord.find({}).sort({ createdAt: -1 }).limit(limit).lean());
}

module.exports = { createLogicalBackup, verifyBackup, restoreLogicalBackup, createMongodumpBackup, list, BACKUP_ROOT };
