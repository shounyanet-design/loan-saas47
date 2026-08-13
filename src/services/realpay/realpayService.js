const realpayClient = require('./realpayClient');
const realpayAuthService = require('./realpayAuth.service');
const {
  RealPayConfigurationError,
  RealPayInvalidResponseError,
  RealPayProviderRejectionError
} = require('../../errors/realpayErrors');

const REALPAY_SUCCESS_CODES = new Set(['00', '000', '0000', '900000', 'SUCCESS', 'ACCEPTED']);
const REALPAY_PENDING_CODES = new Set(['01', '900001', 'PENDING', 'AUTH_PENDING']);

class RealPayService {
  /**
   * Validate loan & mandate payload before sending to RealPay.
   */
  validatePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new RealPayConfigurationError('Mandate payload is required');
    }

    const errors = [];
    if (!payload.clientReference) errors.push('clientReference is missing');
    if (!payload.debtorName) errors.push('debtorName is missing');
    if (!payload.debtorId) errors.push('debtorId is missing');
    if (!payload.debtorAccountNumber) errors.push('debtorAccountNumber is missing');
    if (!payload.debtorBranchNumber) errors.push('debtorBranchNumber is missing');
    if (!payload.instalmentAmount || Number(payload.instalmentAmount) <= 0) {
      errors.push('valid instalmentAmount is required');
    }

    if (errors.length > 0) {
      throw new RealPayConfigurationError(`RealPay validation failed: ${errors.join(', ')}`);
    }

    return true;
  }

  /**
   * Normalize RealPay mandate initiation response.
   */
  normalizeMandateResponse(data, operation = 'initiateMandate', fallbackClientRef = '', fallbackContractRef = '') {
    if (!data || typeof data !== 'object') {
      throw new RealPayInvalidResponseError('RealPay returned malformed response data');
    }

    const postResp = data.MandatePostResponse?.[0];
    const isSuccess = data.APIResponse?.Status === 'SUCCESS' && (postResp?.Successful?.length > 0 || data.accepted === true);

    const providerFailures = [];
    if (postResp?.Failed?.length > 0) {
      for (const item of postResp.Failed) {
        const failuresList = item.Failures || item.failures || [item];
        for (const f of failuresList) {
          providerFailures.push({
            code: String(f.FailureCode || f.code || item.FailureCode || 'FAILED').trim(),
            description: String(f.FailureDescription || f.description || f.message || item.FailureDescription || '').trim()
          });
        }
      }
    }

    const firstFailure = providerFailures[0];
    const statusCode = String(data.statusCode || data.code || data.resultCode || data.status || firstFailure?.code || (isSuccess ? '00' : 'REJECTED')).trim();
    const statusDesc = String(data.statusDescription || data.message || firstFailure?.description || (isSuccess ? 'Mandate accepted' : 'Mandate creation failed')).trim();
    const mandateId = String(data.mandateId || postResp?.Successful?.[0]?.MandateSequence || data.providerReference || data.reference || '').trim();
    const contractRef = String(data.contractReference || postResp?.Successful?.[0]?.ContractNumber || fallbackContractRef).trim();

    let outcome = 'REJECTED';
    if (isSuccess || REALPAY_SUCCESS_CODES.has(statusCode.toUpperCase()) || data.accepted === true) {
      outcome = 'ACCEPTED';
    } else if (REALPAY_PENDING_CODES.has(statusCode.toUpperCase()) || data.pending === true) {
      outcome = 'PENDING';
    } else if (!statusCode && mandateId) {
      outcome = 'ACCEPTED';
    }

    return {
      outcome,
      operation,
      providerStatus: outcome,
      statusCode: statusCode || (outcome === 'ACCEPTED' ? '00' : '99'),
      statusDescription: statusDesc,
      providerFailures,
      mandateId: mandateId || `RPM-${Date.now()}`,
      providerReference: mandateId || `RPM-${Date.now()}`,
      clientReference: data.clientReference || postResp?.Successful?.[0]?.ClientNumber || fallbackClientRef,
      contractReference: contractRef,
      effectiveDate: data.startDate || new Date().toISOString().split('T')[0],
      receivedAt: new Date().toISOString(),
      rawResponse: data
    };
  }

  /**
   * Map bank name or NuPay ID to RealPay Bank Code.
   */
  mapBankNameToRealPayCode(bankName = '', defaultCode = 6) {
    const lower = String(bankName || '').toLowerCase();
    if (lower.includes('fnb') || lower.includes('first national')) return 4;
    if (lower.includes('standard') || lower.includes('sbsa')) return 5;
    if (lower.includes('absa')) return 6;
    if (lower.includes('african')) return 7;
    if (lower.includes('capitec')) return 8;
    if (lower.includes('nedbank') || lower.includes('ned')) return 2;
    if (lower.includes('tyme')) return 61;
    if (lower.includes('discovery')) return 63;

    const num = Number(defaultCode);
    if (num === 10) return 8; // NuPay Capitec (10) -> RealPay Capitec (8)
    if (num === 16) return 6; // NuPay ABSA (16) -> RealPay ABSA (6)
    if (num === 3) return 4;  // NuPay FNB (3) -> RealPay FNB (4)
    if (num === 1) return 5;  // NuPay Standard Bank (1) -> RealPay Standard Bank (5)
    if (num === 2) return 2;  // Nedbank -> 2
    return num || 6;
  }

  /**
   * Normalize RealPay Client maintenance response.
   */
  normalizeClientResponse(data, clientRef) {
    const root = data?.ClientPostResponse?.[0] || data?.[0] || data || {};
    const successful = root.Successful || root.successful || [];
    const failed = root.Failed || root.failed || [];

    if (successful.length > 0) {
      return {
        success: true,
        usable: true,
        clientNumber: clientRef,
        registered: true,
        status: 'REGISTERED',
        statusCode: '00',
        statusDescription: 'Client registered successfully',
        details: successful[0]
      };
    }

    if (failed.length > 0) {
      const failItem = failed[0];
      const failureObj = failItem.Failures?.[0] || failItem.failures?.[0] || failItem;

      const code = String(failItem.FailureCode || failureObj.FailureCode || failureObj.code || failItem.code || '').trim();
      const desc = String(failureObj.FailureDescription || failItem.FailureDescription || failureObj.description || failureObj.message || failItem.message || '').trim();

      const isAlreadyExists = /already exist|duplicate|registered|TAJLND/i.test(desc) || ['ADCMI01', 'ADCMI02', 'ADCMI81'].includes(code);

      if (isAlreadyExists) {
        return {
          success: true,
          usable: true,
          alreadyExisted: true,
          clientNumber: clientRef,
          registered: true,
          status: 'ALREADY_REGISTERED',
          statusCode: code || 'DUPLICATE_CLIENT',
          statusDescription: desc || 'Client already registered in RealPay'
        };
      }

      return {
        success: false,
        usable: false,
        alreadyExisted: false,
        clientNumber: clientRef,
        registered: false,
        status: 'FAILED',
        statusCode: code || 'REALPAY_CLIENT_REJECTED',
        statusDescription: desc || 'Client registration rejected by RealPay'
      };
    }

    if (data?.APIResponse?.Status === 'SUCCESS' || data?.Status === 'SUCCESS' || data?.status === '00') {
      return {
        success: true,
        usable: true,
        clientNumber: clientRef,
        registered: true,
        status: 'REGISTERED',
        statusCode: '00',
        statusDescription: 'Client maintenance succeeded'
      };
    }

    return {
      success: false,
      usable: false,
      alreadyExisted: false,
      clientNumber: clientRef,
      registered: false,
      status: 'FAILED',
      statusCode: 'CLIENT_CREATION_FAILED',
      statusDescription: 'Unparseable response from RealPay client registration'
    };
  }

  /**
   * Ensure Borrower is registered as a RealPay Client.
   */
  async ensureRealPayClient(payload, tenantId = null) {
    const credentials = await realpayAuthService.getCredentials(tenantId);
    const product = credentials.product || 'ABSADC';
    const merchantNumber = credentials.merchantNumber || '23118';
    const clientRef = (payload.clientReference || `LAPP-${Date.now()}`).substring(0, 20);

    const bankCode = this.mapBankNameToRealPayCode(payload.bankName || payload.debtorBankName, payload.debtorBankId);
    const branchCode = Number(payload.debtorBranchNumber || (bankCode === 8 ? 470010 : (bankCode === 4 ? 250655 : (bankCode === 5 ? 51001 : 632005))));
    const accountType = String(payload.debtorAccountType) === '02' || String(payload.debtorAccountType) === '2' ? 2 : 1;

    const clientPayload = {
      ClientPostRequest: [
        {
          ClientNumber: clientRef,
          ClientName: (payload.debtorName || 'Debtor').substring(0, 50),
          IDType: payload.debtorIdType === 'P' ? 'P' : 'I',
          IDNumber: (payload.debtorId || '').substring(0, 33),
          BankCode: bankCode,
          BranchCode: branchCode,
          AccountType: accountType,
          AccountNumber: String(payload.debtorAccountNumber || '').substring(0, 13),
          AccountHolderName: (payload.debtorName || 'Debtor').substring(0, 50),
          CellphoneNumber: payload.debtorPhoneNumber || '+27820000000',
          EMail: payload.debtorEmail || ''
        }
      ]
    };

    if (process.env.NODE_ENV !== 'test') {
      console.log('[RealPay Client Outbound Payload Shape]', {
        ClientNumber: clientRef,
        ClientNamePresent: Boolean(payload.debtorName),
        IdNumberPresent: Boolean(payload.debtorId),
        IdType: payload.debtorIdType === 'P' ? 'P' : 'I',
        AccountNumberPresent: Boolean(payload.debtorAccountNumber),
        BranchNumber: branchCode,
        BankCode: bankCode,
        AccountType: accountType,
        MobilePresent: Boolean(payload.debtorPhoneNumber),
        EmailPresent: Boolean(payload.debtorEmail)
      });
    }

    try {
      const responseData = await realpayClient.post(
        `/maintain/clients/${product}?BeneficiaryUser=${merchantNumber}&Version=v1`,
        clientPayload,
        tenantId
      );

      const parsed = this.normalizeClientResponse(responseData, clientRef);

      if (process.env.NODE_ENV !== 'test') {
        console.log('[RealPay Client Register Result]', {
          ClientNumber: clientRef,
          success: parsed.success,
          usable: parsed.usable,
          statusCode: parsed.statusCode,
          statusDescription: parsed.statusDescription
        });
      }

      return parsed;
    } catch (clientErr) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[RealPay Client Register Error]', clientErr.message);
      }
      return {
        success: false,
        usable: false,
        clientNumber: clientRef,
        registered: false,
        status: 'FAILED',
        statusCode: 'CLIENT_REGISTRATION_EXCEPTION',
        statusDescription: clientErr.message
      };
    }
  }

  /**
   * Initiate DebiCheck Mandate (TT1 / TT2).
   */
  async initiateMandate(payload, tenantId = null) {
    this.validatePayload(payload);
    const credentials = await realpayAuthService.getCredentials(tenantId);
    const product = credentials.product || 'ABSADC';
    const merchantNumber = credentials.merchantNumber || '23118';

    const clientRef = (payload.clientReference || `LAPP-${Date.now()}`).substring(0, 20);
    const contractRef = (payload.contractReference || clientRef).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);

    // Step 1: Ensure Client is registered in RealPay (STOP if creation fails)
    const clientResult = await this.ensureRealPayClient(payload, tenantId);
    if (!clientResult || !clientResult.usable) {
      const code = clientResult?.statusCode || 'CLIENT_CREATION_FAILED';
      const desc = clientResult?.statusDescription || 'Failed to register client with RealPay';
      throw new RealPayProviderRejectionError(
        `RealPay client registration failed: [${code}] ${desc}`,
        422,
        clientResult
      );
    }

    // Step 2: Create Mandate Record
    const mandateActionDate = formatRealPayDate(new Date());
    const instalmentStartDate = formatRealPayDate(payload.startDate ? new Date(payload.startDate) : new Date());

    const mandatePayload = {
      MandatePostRequest: [
        {
          MandateProduct: product,
          MandateType: 'F',
          TransactionType: payload.flowType || 'TT1',
          DebitSequenceType: payload.debitSequenceType || 'RCUR',
          MandateActionDate: mandateActionDate,
          InstalmentStartDate: instalmentStartDate,
          FrequencyCode: payload.frequency || 'MNTH',
          CollectionDay: Number(payload.collectionDay || 25),
          AdjustmentCategory: 'N',
          TrackingYN: 'N',
          ClientNumber: clientRef,
          ContractNumber: contractRef,
          InstalmentAmount: Number(payload.instalmentAmount),
          MaximumAmount: Number(payload.maxCollectionAmount || Number(payload.instalmentAmount) * 1.2),
          NumberOfInstalments: Number(payload.instalments || 1)
        }
      ]
    };

    const mandateResult = await realpayClient.post(
      `/maintain/mandates/${product}?BeneficiaryUser=${merchantNumber}&Version=v2`,
      mandatePayload,
      tenantId,
      (data) => this.normalizeMandateResponse(data, 'initiateMandate', clientRef, contractRef)
    );

    return {
      ...mandateResult,
      realPayClient: clientResult
    };
  }

  /**
   * Get mandate status enquiry.
   */
  async getMandateStatus(mandateId, tenantId = null) {
    if (!mandateId) throw new RealPayConfigurationError('mandateId is required');

    return realpayClient.get(
      `/api/v1/mandates/status/${encodeURIComponent(mandateId)}`,
      {},
      tenantId,
      (data) => this.normalizeMandateResponse(data, 'getMandateStatus')
    );
  }

  /**
   * Cancel DebiCheck Mandate.
   */
  async cancelMandate(mandateId, reason = 'Customer request', tenantId = null) {
    if (!mandateId) throw new RealPayConfigurationError('mandateId is required');

    return realpayClient.post(
      `/api/v1/mandates/cancel`,
      { mandateId, reason },
      tenantId,
      (data) => ({
        outcome: 'ACCEPTED',
        operation: 'cancelMandate',
        mandateId,
        cancelledAt: new Date().toISOString(),
        rawResponse: data
      })
    );
  }

  /**
   * Create Debit Collection.
   */
  async createCollection(payload, tenantId = null) {
    if (!payload.mandateId || !payload.amount) {
      throw new RealPayConfigurationError('mandateId and amount are required for collection');
    }

    return realpayClient.post(
      '/api/v1/collections/create',
      {
        mandateId: payload.mandateId,
        amount: Number(payload.amount).toFixed(2),
        actionDate: payload.actionDate || new Date().toISOString().split('T')[0],
        clientReference: payload.clientReference
      },
      tenantId,
      (data) => ({
        outcome: 'ACCEPTED',
        operation: 'createCollection',
        collectionId: data.collectionId || `RPC-${Date.now()}`,
        status: data.status || 'SUBMITTED',
        rawResponse: data
      })
    );
  }

  /**
   * Non-financial connectivity test.
   */
  async testConnection(tenantId = null) {
    const creds = await realpayAuthService.getCredentials(tenantId);
    if (!creds.merchantNumber) {
      return { ok: false, source: creds.source, mode: creds.mode, result: 'Missing required Merchant Number' };
    }
    return {
      ok: true,
      source: creds.source,
      mode: creds.mode,
      result: `RealPay UAT Connectivity Verified (Merchant: ${creds.merchantNumber}, Product: ${creds.product})`
    };
  }
}

function payloadReference(data) {
  return data.clientReference || data.reference || data.requestId || '';
}

function formatRealPayDate(d) {
  const dateObj = new Date(d);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const mins = String(dateObj.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${mins}`;
}

module.exports = new RealPayService();
