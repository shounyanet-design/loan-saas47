const realpayClient = require('./realpayClient');
const realpayAuthService = require('./realpayAuth.service');
const {
  RealPayConfigurationError,
  RealPaySimulationNotAllowedError
} = require('../../errors/realpayErrors');

class RealPaySimulationService {
  /**
   * Verify active environment is UAT.
   */
  async ensureUatEnvironment(tenantId = null) {
    const creds = await realpayAuthService.getCredentials(tenantId);
    const env = String(creds.environment || process.env.REALPAY_ENVIRONMENT || 'UAT').toUpperCase();
    if (env === 'PRODUCTION') {
      throw new RealPaySimulationNotAllowedError();
    }
    return creds;
  }

  /**
   * Simulate Mandate Result (UAT Only)
   * PUT /rpi/rpws/maintain/simulate/mandate/ABSADC?BeneficiaryUser=23118&Version=v1
   */
  async simulateMandate(opts = {}, tenantId = null) {
    const creds = await this.ensureUatEnvironment(tenantId);
    const product = creds.product || 'ABSADC';
    const merchantNumber = creds.merchantNumber || '23118';

    const { contractSequence, statusCode = 'S', result = 'AAUT' } = opts;

    if (!contractSequence) {
      throw new RealPayConfigurationError(
        'SIMULATION REQUIRES SUCCESSFUL MANDATE CREATION: ContractSequence is missing'
      );
    }

    const validStatusCodes = new Set(['S', 'F', 'R', 'P']);
    const validResults = new Set(['AAUT', 'AREJ', 'APEN', 'AEXP']);

    const cleanStatusCode = String(statusCode).toUpperCase();
    const cleanResult = String(result).toUpperCase();

    if (!validStatusCodes.has(cleanStatusCode)) {
      throw new RealPayConfigurationError(
        `Invalid MandateInitiateStatusCode "${statusCode}". Allowed values: S, F, R, P`
      );
    }
    if (!validResults.has(cleanResult)) {
      throw new RealPayConfigurationError(
        `Invalid MandateInitiateResult "${result}". Allowed values: AAUT, AREJ, APEN, AEXP`
      );
    }

    const payload = {
      MandateSimulatePutRequest: [
        {
          ContractSequence: String(contractSequence),
          MandateInitiateStatusCode: cleanStatusCode,
          MandateInitiateResult: cleanResult
        }
      ]
    };

    if (process.env.NODE_ENV !== 'test') {
      console.log('[RealPay UAT Simulation]', {
        type: 'MANDATE',
        contractSequenceConfigured: Boolean(contractSequence),
        product,
        merchantNumber,
        statusCode: cleanStatusCode,
        result: cleanResult
      });
    }

    const responseData = await realpayClient.put(
      `/maintain/simulate/mandate/${product}?BeneficiaryUser=${merchantNumber}&Version=v1`,
      payload,
      tenantId
    );

    const putResp = responseData?.MandateSimulatePutResponse?.[0] || responseData?.[0] || responseData || {};
    const successItem = putResp?.Successful?.[0];
    const isSuccess = Boolean(successItem || responseData?.APIResponse?.Status === 'SUCCESS' || responseData?.success);

    const failures = [];
    if (putResp?.Failed?.length > 0) {
      for (const item of putResp.Failed) {
        const list = item.Failures || item.failures || [item];
        for (const f of list) {
          failures.push({
            code: String(f.FailureCode || f.code || 'FAILED').trim(),
            description: String(f.FailureDescription || f.description || f.message || '').trim()
          });
        }
      }
    }

    return {
      provider: 'REALPAY',
      environment: 'UAT',
      operation: 'simulateMandate',
      outcome: isSuccess ? 'ACCEPTED' : 'REJECTED',
      contractSequence,
      statusCode: isSuccess ? '00' : (failures[0]?.code || 'SIMULATION_FAILED'),
      statusDescription: isSuccess ? 'Mandate simulation executed successfully' : (failures[0]?.description || 'Mandate simulation rejected'),
      providerFailures: failures,
      receivedAt: new Date().toISOString(),
      rawResponse: responseData
    };
  }

  /**
   * Simulate Instalment Collection Result (UAT Only)
   * PUT /rpi/rpws/maintain/simulate/instalment/ABSADC?BeneficiaryUser=23118&Version=v1
   */
  async simulateInstalment(opts = {}, tenantId = null) {
    const creds = await this.ensureUatEnvironment(tenantId);
    const product = creds.product || 'ABSADC';
    const merchantNumber = creds.merchantNumber || '23118';

    const { contractSequence, statusCode = 'S', result = 'SUCC' } = opts;

    if (!contractSequence) {
      throw new RealPayConfigurationError(
        'SIMULATION REQUIRES SUCCESSFUL MANDATE CREATION: ContractSequence is missing'
      );
    }

    const validStatusCodes = new Set(['S', 'F', 'R', 'P']);
    const validResults = new Set(['SUCC', 'FAIL', 'REJT', 'PEND']);

    const cleanStatusCode = String(statusCode).toUpperCase();
    const cleanResult = String(result).toUpperCase();

    if (!validStatusCodes.has(cleanStatusCode)) {
      throw new RealPayConfigurationError(
        `Invalid InstalmentStatusCode "${statusCode}". Allowed values: S, F, R, P`
      );
    }
    if (!validResults.has(cleanResult)) {
      throw new RealPayConfigurationError(
        `Invalid InstalmentResult "${result}". Allowed values: SUCC, FAIL, REJT, PEND`
      );
    }

    const payload = {
      InstalmentSimulatePutRequest: [
        {
          ContractSequence: String(contractSequence),
          InstalmentStatusCode: cleanStatusCode,
          InstalmentResult: cleanResult
        }
      ]
    };

    if (process.env.NODE_ENV !== 'test') {
      console.log('[RealPay UAT Simulation]', {
        type: 'INSTALMENT',
        contractSequenceConfigured: Boolean(contractSequence),
        product,
        merchantNumber,
        statusCode: cleanStatusCode,
        result: cleanResult
      });
    }

    const responseData = await realpayClient.put(
      `/maintain/simulate/instalment/${product}?BeneficiaryUser=${merchantNumber}&Version=v1`,
      payload,
      tenantId
    );

    const putResp = responseData?.InstalmentSimulatePutResponse?.[0] || responseData?.[0] || responseData || {};
    const successItem = putResp?.Successful?.[0];
    const isSuccess = Boolean(successItem || responseData?.APIResponse?.Status === 'SUCCESS' || responseData?.success);

    const failures = [];
    if (putResp?.Failed?.length > 0) {
      for (const item of putResp.Failed) {
        const list = item.Failures || item.failures || [item];
        for (const f of list) {
          failures.push({
            code: String(f.FailureCode || f.code || 'FAILED').trim(),
            description: String(f.FailureDescription || f.description || f.message || '').trim()
          });
        }
      }
    }

    return {
      provider: 'REALPAY',
      environment: 'UAT',
      operation: 'simulateInstalment',
      outcome: isSuccess ? 'ACCEPTED' : 'REJECTED',
      contractSequence,
      statusCode: isSuccess ? '00' : (failures[0]?.code || 'SIMULATION_FAILED'),
      statusDescription: isSuccess ? 'Instalment simulation executed successfully' : (failures[0]?.description || 'Instalment simulation rejected'),
      providerFailures: failures,
      receivedAt: new Date().toISOString(),
      rawResponse: responseData
    };
  }
}

module.exports = new RealPaySimulationService();
