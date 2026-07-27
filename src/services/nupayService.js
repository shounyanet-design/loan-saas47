const axios = require('axios');
const crypto = require('crypto');
const tenantContext = require('../tenancy/tenantContext');
const credentialService = require('../modules/saas/services/credentialService');

class NuPayService {
  getCurrentDateTime() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  async getCredentials(tenantId) {
    const activeTenantId = tenantId || tenantContext.getTenantId();
    if (!activeTenantId) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Tenant context is missing. Cannot process NuPay request in production.');
      }
      // Dev mode fallback
      return {
        username: process.env.WEBFIN_USERNAME,
        password: process.env.WEBFIN_PASSWORD,
        appName: process.env.WEBFIN_APP_NAME || 'IMS',
        apiUrl: process.env.WEBFIN_BASE_URL || 'https://bacqofs.webfin.co.za/api/app/IMS/webfinApi',
        cardAcceptor: process.env.NUPAY_CARD_ACCEPTOR || '25500019087',
        mode: 'production'
      };
    }

    // Try webfin first
    let resolved = await credentialService.resolve(activeTenantId, 'webfin');
    
    // If not configured, try nupay provider
    if (resolved.source === 'env') {
      const resolvedNupay = await credentialService.resolve(activeTenantId, 'nupay');
      if (resolvedNupay.source === 'tenant') {
        resolved = resolvedNupay;
      }
    }

    if (process.env.NODE_ENV === 'production' && resolved.source === 'env') {
      throw new Error('NuPay/Webfin credentials are not configured for this tenant in production.');
    }

    const creds = resolved.credentials || {};
    
    // Determine API URL based on configuration or mode
    const apiUrl = resolved.mode === 'sandbox'
      ? (creds.baseUrl || creds.apiEndpoint || process.env.WEBFIN_UAT_URL || 'https://bacqofs-uat.webfin.co.za/api/app/LMS/webfinApi')
      : (creds.baseUrl || creds.apiEndpoint || process.env.WEBFIN_BASE_URL || 'https://bacqofs.webfin.co.za/api/app/IMS/webfinApi');

    return {
      username: creds.username || process.env.WEBFIN_USERNAME,
      password: creds.password || process.env.WEBFIN_PASSWORD,
      appName: creds.appName || process.env.WEBFIN_APP_NAME || 'IMS',
      apiUrl: apiUrl,
      cardAcceptor: creds.cardAcceptor || process.env.NUPAY_CARD_ACCEPTOR || '25500019087',
      mode: resolved.mode || 'production'
    };
  }

  async makeRequest(action, dataObject, tenantId = null) {
    const creds = await this.getCredentials(tenantId);
    const dataStr = JSON.stringify(dataObject);
    const currentDateTime = this.getCurrentDateTime();
    
    const hashInput = `${dataStr}${currentDateTime}`;
    const hash = crypto
      .createHmac('sha256', creds.password)
      .update(hashInput)
      .digest('hex'); // lowercase hex digest matching Postman screenshot

    const payload = {
      username: creds.username,
      action: action,
      appName: creds.mode === 'sandbox' ? 'Debug' : (creds.appName || 'IMS'),
      hash: hash,
      data: dataStr,
      currentDateTime: currentDateTime
    };

    // Redact credentials/signature from logs.
    console.log(`[Webfin API Request] Action: ${action} to ${creds.apiUrl}`, JSON.stringify({
      ...payload,
      username: '[REDACTED]',
      hash: '[REDACTED]',
    }));

    try {
      const response = await axios.post(creds.apiUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000 // 30 seconds timeout to account for cross-continental latency
      });

      console.log(`[Webfin Raw Response] Action: ${action}`, JSON.stringify(response.data));

      let resData = response.data || {};
      
      // Parse Webfin inner responseJson string or object if present
      if (resData && typeof resData.responseJson === 'string') {
        try {
          const rawJson = resData.responseJson.trim();
          let jsonString = rawJson;
          if (rawJson.startsWith('{') || rawJson.startsWith('[')) {
            // Convert single-quoted JSON properties to standard JSON format
            jsonString = rawJson.replace(/'/g, '"');
          }
          const parsedInner = JSON.parse(jsonString);
          resData = { ...resData, ...parsedInner };
        } catch (e) {
          console.warn(`[Webfin API Parse Warning] Could not parse responseJson:`, e.message);
        }
      } else if (resData && resData.responseJson && typeof resData.responseJson === 'object') {
        resData = { ...resData, ...resData.responseJson };
      }

      console.log(`[Webfin Parsed Response] Action: ${action}`, JSON.stringify(resData));

      // Check for explicit error in raw or parsed response
      const apiError = resData.error || resData.Error || resData.errorMessage || resData.ErrorMessage || resData.resultMessage;
      if (apiError && typeof apiError === 'string' && (apiError.toLowerCase().includes('fail') || apiError.toLowerCase().includes('error') || apiError.toLowerCase().includes('invalid'))) {
        throw new Error(`Webfin action failed: ${apiError}`);
      }
      if (resData.error && typeof resData.error === 'object') {
        throw new Error(resData.error.message || `Webfin action failed: ${action}`);
      }

      // Extract real reference and status from Webfin response
      const provided = resData.reference || resData.Reference || resData.mandateReference || resData.ContractReference || resData.referenceNo;
      const synthetic = !provided;
      const reference = provided
        || 'WEBFIN-SYN-' + crypto.createHash('sha256').update(`${action}|${dataStr}`).digest('hex').slice(0, 12).toUpperCase();

      const status = resData.status || resData.Status || resData.mandateStatus || 'Pending Authentication';

      return {
        success: true,
        reference,
        referenceSynthetic: synthetic,
        status: status,
        rawWebfinResponse: resData,
        message: resData.message || resData.Message || `Successfully executed ${action} via Webfin Gateway`
      };
    } catch (error) {
      console.error(`[Webfin API Error] Action: ${action}`, error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || `Webfin service communication failed for ${action}`);
    }
  }

  async initiateMandate(appDetails) {
    const creds = await this.getCredentials(appDetails.tenantId);
    
    // Map South African bank name string to 6-digit routing code if needed
    const BANK_CODE_MAP = {
      capitec: '470010',
      absa: '632005',
      fnb: '250655',
      'first national bank': '250655',
      'standard bank': '051001',
      nedbank: '198765',
      tymebank: '678910',
      tyme: '678910',
      discovery: '679000',
      'african bank': '430000',
      bidvest: '462005',
      investec: '580105',
    };
    
    const rawBank = appDetails.bankVerification?.bankName || appDetails.bankName || appDetails.bankVerification?.bankCode;
    let resolvedBankId = '470010';
    if (rawBank) {
      const str = String(rawBank).trim();
      if (/^\d{6}$/.test(str)) {
        resolvedBankId = str;
      } else {
        const lower = str.toLowerCase();
        for (const [key, code] of Object.entries(BANK_CODE_MAP)) {
          if (lower.includes(key)) {
            resolvedBankId = code;
            break;
          }
        }
      }
    }

    const resolvedBranch = appDetails.bankVerification?.branchCode || resolvedBankId;

    const payload = {
      cardAcceptor: creds.cardAcceptor,
      debtorAccountNumber: appDetails.bankVerification?.accountNumber || appDetails.accountNumber,
      debtorBankId: resolvedBankId,
      debtorBranchNumber: resolvedBranch,
      instalmentAmount: appDetails.estimatedMonthlyEMI || appDetails.approvedAmount,
      frequency: 'MNTH',
      debtorAuthenticationRequired: '0230', // Real-Time authentication
      contractReference: appDetails.applicationId || String(appDetails._id)
    };

    return await this.makeRequest('initiateMandate', payload, appDetails.tenantId);
  }

  async maintainInstalment(params) {
    return await this.makeRequest('maintainInstalment', params, params.tenantId);
  }

  async rescheduleInstalment(params) {
    return await this.makeRequest('rescheduleInstalment', params, params.tenantId);
  }

  async cancelInstalment(params) {
    return await this.makeRequest('cancelInstalment', params, params.tenantId);
  }

  async recallInstalment(params) {
    return await this.makeRequest('recallInstalment', params, params.tenantId);
  }
}

module.exports = new NuPayService();
