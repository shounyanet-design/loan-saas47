const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const axios = require('axios');
const ImageKit = require('../config/imagekit');
const compliancePdfGenerator = require('../utils/compliancePdfGenerator');

/**
 * Report Document Service
 * Centralized, multi-tiered document resolver ensuring 100% resilient PDF streaming
 * across ephemeral container environments (Railway), multi-tenant instances, and local dev.
 */

/**
 * Uploads a document buffer to ImageKit persistent cloud storage
 * @param {Buffer} buffer - File buffer
 * @param {string} fileName - File name with extension
 * @param {string} folderPath - ImageKit folder path
 * @returns {Promise<{url: string, fileId: string}|null>}
 */
async function uploadReportToImageKit(buffer, fileName, folderPath) {
  try {
    if (!process.env.IMAGEKIT_PUBLIC_KEY || !process.env.IMAGEKIT_PRIVATE_KEY) {
      return null;
    }
    const response = await ImageKit.upload({
      file: buffer,
      fileName,
      folder: folderPath,
    });
    return {
      url: response.url,
      fileId: response.fileId,
    };
  } catch (err) {
    console.warn(`[REPORT STORAGE] ImageKit upload skipped or failed: ${err.message}`);
    return null;
  }
}

/**
 * Resolves an authoritative AML Screening PDF Buffer
 * Order of Resolution:
 * 1. ImageKit Cloud Storage (if available)
 * 2. Local Container Disk (if available)
 * 3. Dynamic Snapshot Reconstruction via stored MongoDB metadata
 *
 * @param {Object} app - LoanApplication document or plain object
 * @returns {Promise<Buffer|null>}
 */
async function resolveAmlReportPdf(app) {
  if (!app) return null;
  const aml = app.compliance?.aml || app.amlVerification;
  if (!aml) return null;

  const appId = (app._id || app.applicationId || 'unknown').toString();

  // 1. Try ImageKit Cloud URL if previously archived
  if (aml.imagekitUrl) {
    try {
      const response = await axios.get(aml.imagekitUrl, { responseType: 'arraybuffer', timeout: 10000 });
      if (response.data && response.data.length > 0) {
        return Buffer.from(response.data);
      }
    } catch (err) {
      console.warn(`[REPORT STORAGE] ImageKit fetch for AML failed, falling back: ${err.message}`);
    }
  }

  // 2. Try Local File on Disk
  if (aml.pdfPath) {
    try {
      const localPath = path.isAbsolute(aml.pdfPath)
        ? aml.pdfPath
        : path.join(__dirname, '..', '..', aml.pdfPath);

      if (fsSync.existsSync(localPath)) {
        const fileBuf = await fs.readFile(localPath);
        if (fileBuf && fileBuf.length > 0) {
          return fileBuf;
        }
      }
    } catch (err) {
      console.warn(`[REPORT STORAGE] Local disk read for AML failed, falling back: ${err.message}`);
    }
  }

  // 3. Dynamic Self-Healing Reconstruction from Structured DB Snapshot
  try {
    const generatedPdfBuffer = await compliancePdfGenerator.generateAmlReportPdf(app);

    // Asynchronously archive to ImageKit to ensure future persistence
    const version = aml.version || 1;
    const folder = `/compliance-reports/${appId}/aml/v${version}`;
    uploadReportToImageKit(generatedPdfBuffer, 'report.pdf', folder).then(uploadRes => {
      if (uploadRes && app.save) {
        if (app.compliance?.aml) {
          app.compliance.aml.imagekitUrl = uploadRes.url;
          app.compliance.aml.imagekitFileId = uploadRes.fileId;
        }
        app.save().catch(saveErr => console.warn(`[REPORT STORAGE] Could not persist AML ImageKit URL: ${saveErr.message}`));
      }
    }).catch(() => {});

    return generatedPdfBuffer;
  } catch (err) {
    console.error(`[REPORT STORAGE] Dynamic AML generation failed: ${err.message}`);
    return null;
  }
}

/**
 * Resolves an authoritative Bank AVS Report PDF Buffer
 * Order of Resolution:
 * 1. ImageKit Cloud Storage (if available)
 * 2. Local Container Disk (if available)
 * 3. Dynamic Snapshot Reconstruction via stored MongoDB metadata
 *
 * @param {Object} app - LoanApplication document or plain object
 * @returns {Promise<Buffer|null>}
 */
async function resolveBankReportPdf(app) {
  if (!app) return null;
  const bank = app.bankVerification;
  if (!bank) return null;

  const appId = (app._id || app.applicationId || 'unknown').toString();

  // 1. Try ImageKit Cloud URL if previously archived
  if (bank.imagekitUrl) {
    try {
      const response = await axios.get(bank.imagekitUrl, { responseType: 'arraybuffer', timeout: 10000 });
      if (response.data && response.data.length > 0) {
        return Buffer.from(response.data);
      }
    } catch (err) {
      console.warn(`[REPORT STORAGE] ImageKit fetch for Bank AVS failed, falling back: ${err.message}`);
    }
  }

  // 2. Try Local File on Disk
  if (bank.pdfReportPath) {
    try {
      const localPath = path.isAbsolute(bank.pdfReportPath)
        ? bank.pdfReportPath
        : path.join(__dirname, '..', '..', bank.pdfReportPath);

      if (fsSync.existsSync(localPath)) {
        const fileBuf = await fs.readFile(localPath);
        if (fileBuf && fileBuf.length > 0) {
          return fileBuf;
        }
      }
    } catch (err) {
      console.warn(`[REPORT STORAGE] Local disk read for Bank AVS failed, falling back: ${err.message}`);
    }
  }

  // 3. Dynamic Self-Healing Reconstruction from Structured DB Snapshot
  try {
    const generatedPdfBuffer = await compliancePdfGenerator.generateBankAvsReportPdf(app);

    // Asynchronously archive to ImageKit to ensure future persistence
    const version = bank.verificationVersion || 1;
    const folder = `/compliance-reports/${appId}/bank-avs/v${version}`;
    uploadReportToImageKit(generatedPdfBuffer, 'report.pdf', folder).then(uploadRes => {
      if (uploadRes && app.save) {
        app.bankVerification.imagekitUrl = uploadRes.url;
        app.bankVerification.imagekitFileId = uploadRes.fileId;
        app.save().catch(saveErr => console.warn(`[REPORT STORAGE] Could not persist Bank AVS ImageKit URL: ${saveErr.message}`));
      }
    }).catch(() => {});

    return generatedPdfBuffer;
  } catch (err) {
    console.error(`[REPORT STORAGE] Dynamic Bank AVS generation failed: ${err.message}`);
    return null;
  }
}

/**
 * Resolves an authoritative KYC & Biometric Verification PDF Buffer
 * Order of Resolution:
 * 1. ImageKit Cloud Storage (if available)
 * 2. Local Container Disk (if available)
 * 3. Dynamic Snapshot Reconstruction via stored MongoDB metadata
 *
 * @param {Object} app - LoanApplication document or plain object
 * @returns {Promise<Buffer|null>}
 */
async function resolveKycReportPdf(app) {
  if (!app) return null;
  const kyc = app.kycVerification;
  if (!kyc) return null;

  const appId = (app._id || app.applicationId || 'unknown').toString();

  // 1. Try ImageKit Cloud URL if previously archived
  if (kyc.reportPdfUrl) {
    try {
      const response = await axios.get(kyc.reportPdfUrl, { responseType: 'arraybuffer', timeout: 10000 });
      if (response.data && response.data.length > 0) {
        return Buffer.from(response.data);
      }
    } catch (err) {
      console.warn(`[REPORT STORAGE] ImageKit fetch for KYC failed, falling back: ${err.message}`);
    }
  }

  // 2. Try Local File on Disk
  if (kyc.reportPdfPath) {
    try {
      const localPath = path.isAbsolute(kyc.reportPdfPath)
        ? kyc.reportPdfPath
        : path.join(__dirname, '..', '..', kyc.reportPdfPath);

      if (fsSync.existsSync(localPath)) {
        const fileBuf = await fs.readFile(localPath);
        if (fileBuf && fileBuf.length > 0) {
          return fileBuf;
        }
      }
    } catch (err) {
      console.warn(`[REPORT STORAGE] Local disk read for KYC failed, falling back: ${err.message}`);
    }
  }

  // 3. Dynamic Self-Healing Reconstruction from Structured DB Snapshot
  try {
    const generatedPdfBuffer = await compliancePdfGenerator.generateKycReportPdf(app);

    // Asynchronously archive to ImageKit to ensure future persistence
    const folder = `/compliance-reports/${appId}/kyc`;
    uploadReportToImageKit(generatedPdfBuffer, 'kyc_report.pdf', folder).then(uploadRes => {
      if (uploadRes && app.save) {
        if (app.kycVerification) {
          app.kycVerification.reportPdfUrl = uploadRes.url;
          app.kycVerification.reportPdfFileId = uploadRes.fileId;
        }
        app.save().catch(saveErr => console.warn(`[REPORT STORAGE] Could not persist KYC ImageKit URL: ${saveErr.message}`));
      }
    }).catch(() => {});

    return generatedPdfBuffer;
  } catch (err) {
    console.error(`[REPORT STORAGE] Dynamic KYC generation failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  uploadReportToImageKit,
  resolveAmlReportPdf,
  resolveBankReportPdf,
  resolveKycReportPdf,
};
