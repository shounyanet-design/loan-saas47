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
        apiUrl: process.env.WEBFIN_UAT_URL || 'https://bacqofs-uat.webfin.co.za/api/app/LMS/webfinApi',
        cardAcceptor: process.env.NUPAY_CARD_ACCEPTOR || '000005500000010',
        mode: 'sandbox'
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
    const apiUrl = resolved.mode === 'production'
      ? (creds.baseUrl || creds.apiEndpoint || process.env.WEBFIN_BASE_URL || 'https://bacqofs.webfin.co.za/api/app/IMS/webfinApi')
      : (creds.baseUrl || creds.apiEndpoint || process.env.WEBFIN_UAT_URL || 'https://bacqofs-uat.webfin.co.za/api/app/LMS/webfinApi');

    return {
      username: creds.username || process.env.WEBFIN_USERNAME,
      password: creds.password || process.env.WEBFIN_PASSWORD,
      appName: creds.appName || process.env.WEBFIN_APP_NAME || 'IMS',
      apiUrl: apiUrl,
      cardAcceptor: creds.cardAcceptor || process.env.NUPAY_CARD_ACCEPTOR || '000005500000010',
      mode: resolved.mode
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
      appName: creds.mode === 'production' ? creds.appName : 'Debug',
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

      console.log(`[Webfin API Response] Action: ${action}`, JSON.stringify(response.data));

      // Standardize response output for the controller
      if (response.data && response.data.error) {
        throw new Error(response.data.error.message || `Webfin action failed: ${action}`);
      }

      // When the gateway omits a reference we must NOT fabricate a random one —
      // a random value masks failures and breaks idempotent replay. Derive a
      // DETERMINISTIC synthetic reference from the exact request so the same
      // request always yields the same reference, and flag it for reconciliation.
      const provided = response.data && response.data.reference;
      const synthetic = !provided;
      const reference = provided
        || 'WEBFIN-SYN-' + crypto.createHash('sha256').update(`${action}|${dataStr}`).digest('hex').slice(0, 12).toUpperCase();

      return {
        success: true,
        reference,
        referenceSynthetic: synthetic,
        status: response.data.status || 'Pending Authentication',
        message: response.data.message || `Successfully executed ${action} via Webfin Gateway`
      };
    } catch (error) {
      console.error(`[Webfin API Error] Action: ${action}`, error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || `Webfin service communication failed for ${action}`);
    }
  }

  async initiateMandate(appDetails) {
    const creds = await this.getCredentials(appDetails.tenantId);
    const payload = {
      cardAcceptor: creds.cardAcceptor,
      debtorAccountNumber: appDetails.bankVerification?.accountNumber || appDetails.accountNumber,
      debtorBankId: appDetails.bankVerification?.bankName || appDetails.bankName,
      debtorBranchNumber: appDetails.bankVerification?.branchCode || '250655',
      instalmentAmount: appDetails.estimatedMonthlyEMI || appDetails.approvedAmount,
      frequency: 'MNTH',
      debtorAuthenticationRequired: '0230', // Real-Time authentication
      contractReference: appDetails.applicationId || appDetails._id
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
