const axios = require('axios');

class Debi24Service {
  constructor(httpClient = axios) {
    this.httpClient = httpClient;
  }

  getConfig(customClientId = null) {
    const baseUrl = (process.env.DEBI24_API_URL || 'https://debi24-api-dev-1002931581108.africa-south1.run.app').replace(/\/+$/, '');
    const defaultClientId = (process.env.DEBI24_CLIENT_ID || 'pointfortyseven').trim();
    const clientId = (customClientId ? String(customClientId).trim() : defaultClientId) || defaultClientId;
    const apiKey = (process.env.DEBI24_API_KEY || '').trim();

    if (!apiKey) {
      throw new Error('DEBI24_API_KEY is not configured in environment variables');
    }

    return { baseUrl, clientId, apiKey };
  }

  /**
   * Map bank branch code or bank name string to Debi24/NuPay bank code
   */
  mapBankCode(bankName = '', branchCode = '') {
    const branch = String(branchCode || '').trim();

    // 1. Direct South African Universal Branch Code matching (Guaranteed accuracy)
    if (branch === '470010') return '10'; // Capitec Bank
    if (branch === '632005') return '16'; // ABSA Bank
    if (branch === '051001') return '1';  // Standard Bank
    if (branch === '250655' || branch === '250805') return '3'; // FNB / FirstRand
    if (branch === '198765') return '2';  // Nedbank
    if (branch === '410506') return '6';  // GroBank / Sasfin
    if (branch === '430000') return '7';  // African Bank
    if (branch === '450105') return '9';  // Mercantile Bank
    if (branch === '431010') return '19'; // Ubank
    if (branch === '462005') return '44'; // Bidvest Bank
    if (branch === '589000') return '55'; // Finbond Mutual Bank
    if (branch === '678910') return '61'; // TymeBank
    if (branch === '679000') return '63'; // Discovery Bank
    if (branch === '352000') return '67'; // Old Mutual Bank

    // 2. Fallback to bank name keywords
    const lower = String(bankName || '').toLowerCase();
    if (lower.includes('capitec')) return '10';
    if (lower.includes('absa')) return '16';
    if (lower.includes('standard') || lower.includes('sbsa')) return '1';
    if (lower.includes('nedbank') || lower.includes('ned')) return '2';
    if (lower.includes('fnb') || lower.includes('first national') || lower.includes('firstrand')) return '3';
    if (lower.includes('tyme')) return '61';
    if (lower.includes('discovery')) return '63';
    if (lower.includes('african')) return '7';
    if (lower.includes('grobank') || lower.includes('athens') || lower.includes('sasfin')) return '6';
    if (lower.includes('bidvest')) return '44';
    if (lower.includes('finbond')) return '55';
    if (lower.includes('ubank')) return '19';
    if (lower.includes('mercantile')) return '9';
    if (lower.includes('old mutual')) return '67';

    return '1'; // Default Standard Bank
  }

  /**
   * Format South African mobile number to e.g. +27823509883 (max 12 chars)
   */
  formatMobile(phone = '') {
    let cleaned = String(phone).replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '+27' + cleaned.substring(1);
    } else if (cleaned.startsWith('27') && !cleaned.startsWith('+27')) {
      cleaned = '+' + cleaned;
    } else if (!cleaned.startsWith('+')) {
      cleaned = '+27' + cleaned;
    }
    return cleaned.substring(0, 12);
  }

  /**
   * Build Debi24 Mandate creation payload from loan and bank records
   */
  buildMandatePayload(loan, bankRecord = null) {
    const verifiedAcc = (
      loan.bankVerification?.verifiedBankAccount ||
      bankRecord?.accountNumber ||
      '1234567890'
    ).replace(/\D/g, '');

    const verifiedBranch = (
      loan.bankVerification?.verifiedBranchCode ||
      bankRecord?.branchCode ||
      '051001'
    ).replace(/\D/g, '').padEnd(6, '0').substring(0, 6);

    const rawBankName = loan.bankVerification?.bankName || bankRecord?.bankName || '';
    const bankCode = this.mapBankCode(rawBankName, verifiedBranch);

    const rawAccType = String(loan.bankVerification?.verifiedAccountType || '').toLowerCase();
    const accountType = (rawAccType.includes('cheque') || rawAccType.includes('current') || rawAccType.includes('transmission'))
      ? 'cheque'
      : 'savings';

    const customerName = (loan.fullName || `${loan.firstName || ''} ${loan.lastName || ''}`.trim() || 'Client Name').substring(0, 35);
    const idNumber = (loan.idNumber || '9001015009087').replace(/\s+/g, '').substring(0, 33);
    const mobile = this.formatMobile(loan.phoneNumber || '+27823509883');
    const email = loan.emailAddress || 'customer@example.com';

    // Amount formatting
    const emiVal = Number(loan.estimatedMonthlyEMI || loan.adminDecision?.approvedAmount || 100).toFixed(2);
    const maxVal = (Number(emiVal) * 1.2).toFixed(2);

    // Collection day
    let collectionDay = 25;
    if (loan.repaymentDate) {
      collectionDay = new Date(loan.repaymentDate).getDate();
    } else if (loan.adminDecision?.approvedDate) {
      collectionDay = new Date(loan.adminDecision.approvedDate).getDate();
    }
    if (collectionDay > 30) collectionDay = 30;
    if (collectionDay < 1) collectionDay = 1;

    // Start Date: next strike date (e.g. tomorrow or collectionDay in current/next month)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 2); // default 2 days ahead
    const dateStr = startDate.toISOString().split('T')[0];
    const instalmentStartAt = `${dateStr}T00:00:00+02:00`;

    const applicationId = loan.applicationId || String(loan._id);
    const attemptSuffix = Date.now().toString().slice(-6);
    const mandateRef = `MAND-${applicationId}-${attemptSuffix}`.replace(/[^a-zA-Z0-9-_]/g, '').substring(0, 100);

    return {
      customer: {
        reference: `CUST-${applicationId}`.substring(0, 100),
        name: customerName,
        identification: {
          type: 'south_african_id',
          number: idNumber
        },
        mobile,
        email,
        bankAccount: {
          bankCode,
          branchCode: verifiedBranch,
          type: accountType,
          accountNumber: verifiedAcc,
          accountHolderName: customerName.substring(0, 50)
        }
      },
      mandate: {
        reference: mandateRef,
        type: 'fixed',
        transactionType: 'TT1R',
        frequencyCode: 'MNTH',
        collectionDay: Number(collectionDay),
        adjustmentCategory: 'N',
        trackingEnabled: false,
        instalmentStartAt,
        instalmentAmount: emiVal,
        maximumAmount: maxVal,
        numberOfInstalments: Math.min(Math.max(Number(loan.requestedDuration || 12), 1), 9999),
        entryClass: '0033' // Loan repayment
      }
    };
  }

  /**
   * Create mandate via Debi24 Bridge
   */
  async createMandate(loan, bankRecord = null, customIdempotencyKey = null, targetClientId = null) {
    const { baseUrl, clientId, apiKey } = this.getConfig(targetClientId);
    const payload = this.buildMandatePayload(loan, bankRecord);
    const idempotencyKey = (customIdempotencyKey || `mnd-${payload.mandate.reference}`).substring(0, 128);

    const url = `${baseUrl}/api/v1/clients/${clientId}/mandates`;

    try {
      const response = await this.httpClient.post(url, payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Idempotency-Key': idempotencyKey,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      });

      const data = response.data || {};

      // Normalize outcome
      const rawStatus = String(data.status || data.provider?.status || '').toUpperCase();
      let outcome = 'PENDING';
      if (rawStatus === 'ACCEPTED' || rawStatus === 'ACTIVE') outcome = 'ACCEPTED';
      else if (rawStatus === 'REJECTED' || rawStatus === 'FAILED') outcome = 'REJECTED';
      else outcome = 'PENDING';

      return {
        outcome,
        providerStatus: outcome === 'ACCEPTED' ? 'ACCEPTED' : outcome === 'REJECTED' ? 'REJECTED' : 'PENDING AUTH',
        resultCode: outcome === 'ACCEPTED' ? '900000' : '900001',
        mandateId: data.id || data.mandate?.reference || payload.mandate.reference,
        clientReference: payload.customer.reference,
        contractReference: payload.mandate.reference,
        providerTransactionId: data.provider?.transactionId || data.id,
        providerMessageId: data.traceId || '',
        effectiveDate: payload.mandate.instalmentStartAt,
        debi24ClientId: clientId,
        raw: data
      };
    } catch (error) {
      if (error.response?.data?.message) {
        let msg = error.response.data.message;
        if (error.response.data.fields && Array.isArray(error.response.data.fields)) {
          const fieldDetails = error.response.data.fields
            .map((f) => `${f.field}: ${f.message || 'invalid'}`)
            .join('; ');
          msg = `${msg} [${fieldDetails}]`;
        }
        const err = new Error(msg);
        err.statusCode = error.response.status || 400;
        err.code = error.response.data.code || 'DEBI24_ERROR';
        throw err;
      }
      throw error;
    }
  }

  /**
   * Refresh mandate status from NuPay via Debi24
   */
  async refreshMandate(mandateId, targetClientId = null) {
    const { baseUrl, clientId, apiKey } = this.getConfig(targetClientId);
    const url = `${baseUrl}/api/v1/clients/${clientId}/mandates/${mandateId}/refresh`;

    const response = await this.httpClient.post(url, {}, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });

    return response.data;
  }

  /**
   * Get mandate details by ID
   */
  async getMandate(mandateId, targetClientId = null) {
    const { baseUrl, clientId, apiKey } = this.getConfig(targetClientId);
    const url = `${baseUrl}/api/v1/clients/${clientId}/mandates/${mandateId}`;

    const response = await this.httpClient.get(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      timeout: 15000
    });

    return response.data;
  }
}

module.exports = new Debi24Service();
