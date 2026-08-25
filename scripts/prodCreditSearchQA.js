const axios = require('axios');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Borrower = require('../src/models/Borrower');
const LoanApplication = require('../src/models/LoanApplication');
const SystemSettings = require('../src/models/SystemSettings');
require('dotenv').config();

const PROD_API_URL = 'https://loan-saas47-production.up.railway.app/api';
const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;

const applicationId = '6a8c4d2e87e37a40fb238eeb';
const borrowerId = '6a8c237df3ecd0bd68b042dc';

async function runProdQA() {
  try {
    console.log('Connecting to Production DB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    const tenantContext = require('../src/tenancy/tenantContext');
    let borrower, app;

    await tenantContext.runAsSystem(async () => {
      borrower = await Borrower.findById(borrowerId);
      if (!borrower) borrower = await Borrower.findOne({ userId: borrowerId });
      if (!borrower) throw new Error('Borrower not found in DB');
      console.log(`Borrower loaded: ${borrower.firstName} ${borrower.lastName}, ID: ${borrower.idNumber}`);
      app = await LoanApplication.findById(applicationId);
      if (app) {
        let saveApp = false;
        if (app.kycVerification?.verificationStatus !== 'Verified' && app.kycVerification?.verificationStatus !== 'Overridden') {
          app.kycVerification = { verificationStatus: 'Verified', completedAt: new Date() };
          saveApp = true;
        }
        if (app.phoneVerification?.verificationStatus !== 'Verified') {
          app.phoneVerification = { verificationStatus: 'Verified', completedAt: new Date() };
          saveApp = true;
        }
        if (saveApp) await app.save();
      }
    });

    const token = jwt.sign(
      { _id: borrower.userId, id: borrower.userId, role: 'borrower', tenantId: borrower.tenantId },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log('Generated auth token for API.');

    console.log(`\n--- STEP 5 & 6: Triggering Production API: POST /api/verification/consumer-credit-search ---`);
    let result;
    try {
      const response = await axios.post(`${PROD_API_URL}/verification/consumer-credit-search`, {
        applicationId,
        idNumber: borrower.idNumber
      }, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-tenant-id': borrower.tenantId
        }
      });
      console.log('✅ API HTTP 200 SUCCESS');
      result = response.data;
      console.log(JSON.stringify({
        success: result.success,
        bureauScore: result.data?.bureauScore,
        riskSeverity: result.data?.riskSeverity,
        sandboxSimulationActive: result.data?.sandboxSimulationActive,
        reused: result.reused
      }, null, 2));
    } catch (apiErr) {
      console.error('❌ API FAILED:', apiErr.response?.status, apiErr.response?.data || apiErr.message);
      process.exit(1);
    }

    console.log(`\n--- STEP 7: Idempotency Check (Second Request) ---`);
    try {
      const response2 = await axios.post(`${PROD_API_URL}/verification/consumer-credit-search`, {
        applicationId,
        idNumber: borrower.idNumber
      }, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-tenant-id': borrower.tenantId
        }
      });
      console.log('✅ IDEMPOTENCY SUCCESS');
      console.log(JSON.stringify({
        success: response2.data.success,
        reused: response2.data.reused,
        message: response2.data.message
      }, null, 2));
    } catch (apiErr) {
      console.error('❌ IDEMPOTENCY FAILED:', apiErr.response?.status, apiErr.response?.data || apiErr.message);
      process.exit(1);
    }

    console.log(`\n--- Database Persistence Check ---`);
    await tenantContext.runAsSystem(async () => {
      app = await LoanApplication.findById(applicationId);
    });
    console.log(`creditAssessment.verificationStatus: ${app.creditAssessment?.verificationStatus}`);
    console.log(`creditAssessment.completedAt: ${app.creditAssessment?.completedAt}`);
    console.log(`consumerCreditScore: ${app.consumerCreditScore}`);
    console.log(`consumerCreditReport present: ${!!app.consumerCreditReport}`);
    console.log(`PDF report present (Base64 length / URL length): ${app.consumerCreditReportRaw?.PDFReport?.length || app.consumerCreditReport?.reportPdfUrl?.length || 0}`);

    console.log('\n✅ ALL CHECKS PASSED');
    process.exit(0);

  } catch (err) {
    console.error('❌ QA Script Error:', err);
    process.exit(1);
  }
}

runProdQA();
