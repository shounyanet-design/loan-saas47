const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NUPAY_USERNAME = 'user';
process.env.NUPAY_PASSWORD = 'pass';
process.env.NUPAY_CARD_ACCEPTOR = '25500019087';
process.env.NUPAY_BASE_URL = 'https://btm.nupay.co.za';
process.env.NUPAY_ENABLED = 'true';
process.env.NUPAY_TT1_CALLBACK_URL = 'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback';
process.env.NUPAY_CARD_ACCEPTOR_EMAIL = 'Info@chanainvestments.co.za';

const {
  mandateInitiationSchema,
  tt1RegistrationSchema,
  tt1CallbackSchema
} = require('../../src/utils/nupayValidation');
const {
  NuPayInvalidResponseError,
  NuPayTimeoutError,
  NuPayConfigurationError,
  formatCardAcceptor
} = require('../../src/errors/nupayErrors');
const serviceExport = require('../../src/services/nupayService');
const NuPayService = serviceExport.NuPayService;

function validMandate() {
  return {
    frequency: 'MNTH',
    collectionDay: '25',
    clientReference: 'CLIENT-1',
    contractReference: 'CONTRACT1',
    debtorName: 'Test Customer',
    debtorIdType: '2',
    debtorId: '9001015009087',
    debtorAccountNumber: '1234567890',
    debtorAccountType: '01',
    debtorBankId: '1',
    debtorBranchNumber: '051001',
    debtorIdUltimate: '',
    debtorPhoneNumber: '+27-823509883',
    debtorEmail: 'test@example.com',
    debtorAuthenticationRequired: '0230',
    firstCollectionAmount: '',
    firstCollectionDate: '',
    instalmentAmount: '10.00',
    maxCollectionAmount: '10.00',
    adjustmentCategory: 'N',
    adjustmentAmount: '',
    adjustmentRate: '',
    startDate: '2026-08-01',
    dateAdjustmentRule: 'Y',
    debitValueTypeId: '1',
    instalments: 1,
    trackingIndicator: '00',
    mac: '',
    authenticationType: 'REAL TIME',
    entryClass: '0033',
    loadType: '1',
    nonWarehouseMandate: '0',
    smsOptIn: 'N',
    employerCode: '',
    insuranceModelID: '',
    insuranceAmount: ''
  };
}

test('formatCardAcceptor formats 11-digit raw merchant number to 15 digits', () => {
  assert.equal(formatCardAcceptor('25500019087'), '000025500019087');
});

test('formatCardAcceptor leaves valid 15-digit number unchanged', () => {
  assert.equal(formatCardAcceptor('000025500019087'), '000025500019087');
});

test('formatCardAcceptor rejects 16-digit invalid number', () => {
  assert.throws(
    () => formatCardAcceptor('0000025500019087'),
    NuPayConfigurationError
  );
});

test('formatCardAcceptor handles values with leading/trailing spaces', () => {
  assert.equal(formatCardAcceptor('  25500019087  '), '000025500019087');
});

test('formatCardAcceptor strips literal quotes around merchant number', () => {
  assert.equal(formatCardAcceptor('"25500019087"'), '000025500019087');
  assert.equal(formatCardAcceptor("'25500019087'"), '000025500019087');
});

test('formatCardAcceptor throws on null, undefined, number input, or letters', () => {
  assert.throws(() => formatCardAcceptor(null), NuPayConfigurationError);
  assert.throws(() => formatCardAcceptor(undefined), NuPayConfigurationError);
  assert.throws(() => formatCardAcceptor(25500019087), NuPayConfigurationError);
  assert.throws(() => formatCardAcceptor('25500019087A'), NuPayConfigurationError);
});

test('mandate schema accepts R10 controlled-test payload', () => {
  const { error } = mandateInitiationSchema.validate(validMandate());
  assert.equal(error, undefined);
});

test('mandate schema rejects max amount above FIXED 1.5 limit', () => {
  const payload = validMandate();
  payload.maxCollectionAmount = '20.00';
  const { error } = mandateInitiationSchema.validate(payload);
  assert.ok(error);
});

test('TT1 registration schema requires HTTPS URL', () => {
  const invalidResult = tt1RegistrationSchema.validate({
    endpointUrl: 'http://example.com/callback',
    registrationStatus: 'Register',
    cardAcceptorEmail: 'merchant@example.com'
  });
  assert.ok(invalidResult.error);
});

test('TT1 registration schema requires valid email', () => {
  const invalidResult = tt1RegistrationSchema.validate({
    endpointUrl: 'https://example.com/callback',
    registrationStatus: 'Register',
    cardAcceptorEmail: 'invalid-email'
  });
  assert.ok(invalidResult.error);
});

test('TT1 registration schema rejects unknown fields', () => {
  const invalidResult = tt1RegistrationSchema.validate({
    endpointUrl: 'https://example.com/callback',
    registrationStatus: 'Register',
    cardAcceptorEmail: 'merchant@example.com',
    auth: 'secret'
  });
  assert.ok(invalidResult.error);
});

test('TT1 registration requires HTTPS and valid status', () => {
  assert.equal(tt1RegistrationSchema.validate({
    endpointUrl: 'https://example.com/api/v1/nupay/tt1/callback',
    registrationStatus: 'Register',
    cardAcceptorEmail: 'ops@example.com'
  }).error, undefined);
});

test('TT1 callback requires six-digit result code', () => {
  const { error } = tt1CallbackSchema.validate({
    requestId: '1',
    clientEndPointIp: 'https://example.com/callback',
    supportMail: 'ops@example.com',
    mandateId: 'MID1',
    contractReference: 'CONTRACT1',
    statusCode: '900000',
    statusDescription: 'Transaction Successful'
  });
  assert.equal(error, undefined);
});

test('service sends official mandate endpoint and normalizes accepted response', async () => {
  let captured;
  const fakeClient = {
    post: async (url, body, config) => {
      captured = { url, body, config };
      return {
        status: 200,
        data: {
          referenceNumbers: {
            mandateRequestTranId: 'T1',
            nedbankMessageId: 'M1',
            clientReference: 'CLIENT-1',
            mandateID: 'MID1',
            contractReference: 'CONTRACT1'
          },
          Channel: 'NEDCOR MQ',
          Status: 'Accepted',
          ResultCode: '900000',
          Date: '2026-07-31T12:00:00'
        }
      };
    }
  };

  const service = new NuPayService(fakeClient);
  const result = await service.initiateMandate(validMandate());

  assert.equal(captured.url, 'https://btm.nupay.co.za/wsDebiCheck/mandate_initiation');
  assert.equal(captured.body.cardAcceptor, '000025500019087');
  assert.equal(captured.body.auth, Buffer.from('user:pass').toString('base64'));
  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(result.mandateId, 'MID1');
});

test('service treats Pending Auth as pending and No Response as unknown', () => {
  const service = new NuPayService({ post: async () => {} });
  const base = {
    referenceNumbers: {
      mandateRequestTranId: 'T1',
      clientReference: 'C1',
      mandateID: 'M1',
      contractReference: 'R1'
    },
    ResultCode: '900099',
    Date: '2026-07-31T12:00:00'
  };

  assert.equal(service.normalizeMandateResponse({ ...base, Status: 'Pending Auth' }, 'x').outcome, 'PENDING');
  assert.equal(service.normalizeMandateResponse({ ...base, Status: 'No Response' }, 'x').outcome, 'UNKNOWN');
});

test('TT1 registration responseCode 500000 normalizes to ACCEPTED', () => {
  const service = new NuPayService({});

  const result = service.normalizeRegistrationResponse(
    {
      responseCode: '500000',
      responseMessage: 'Success'
    },
    {
      endpointUrl:
        'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback',
      registrationStatus: 'Register'
    }
  );

  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(result.resultCode, '500000');
  assert.equal(result.message, 'Success');
});

test('TT1 registration non-500000 code normalizes to REJECTED', () => {
  const service = new NuPayService({});

  const result = service.normalizeRegistrationResponse(
    {
      responseCode: '500002',
      responseMessage: 'Invalid Inputs'
    },
    {
      endpointUrl:
        'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback',
      registrationStatus: 'Register'
    }
  );

  assert.equal(result.outcome, 'REJECTED');
});

test('TT1 registration sends to exact endpoint with 15-digit cardAcceptor, Base64 auth, and returns ACCEPTED', async () => {
  let captured;
  const fakeClient = {
    post: async (url, body, config) => {
      captured = { url, body, config };
      return {
        status: 200,
        data: {
          responseCode: '500000',
          responseMessage: 'Success'
        }
      };
    }
  };

  const service = new NuPayService(fakeClient);
  const result = await service.registerTT1Endpoint({
    endpointUrl: 'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback',
    registrationStatus: 'Register',
    cardAcceptorEmail: 'Info@chanainvestments.co.za'
  });

  assert.equal(captured.url, 'https://btm.nupay.co.za/wsDebiCheck/register_endpoint');
  assert.equal(captured.body.auth, Buffer.from('user:pass').toString('base64'));
  assert.equal(captured.body.cardAcceptor, '000025500019087');
  assert.equal(captured.body.endpointUrl, 'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback');
  assert.equal(captured.body.registrationStatus, 'Register');
  assert.equal(captured.body.cardAcceptorEmail, 'Info@chanainvestments.co.za');
  assert.equal(result.outcome, 'ACCEPTED');
  assert.equal(result.resultCode, '500000');
  assert.equal(result.endpointUrl, 'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback');
  assert.equal(result.registrationStatus, 'Register');
});

test('TT1 registration provider rejection normalizes to REJECTED', async () => {
  const fakeClient = {
    post: async () => ({
      status: 200,
      data: {
        responseCode: '900001',
        responseMessage: 'Invalid merchant email'
      }
    })
  };

  const service = new NuPayService(fakeClient);
  const result = await service.registerTT1Endpoint({
    endpointUrl: 'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback',
    registrationStatus: 'Register',
    cardAcceptorEmail: 'Info@chanainvestments.co.za'
  });

  assert.equal(result.outcome, 'REJECTED');
  assert.equal(result.resultCode, '900001');
});

test('TT1 registration malformed response throws NuPayInvalidResponseError', async () => {
  const fakeClient = {
    post: async () => ({
      status: 200,
      data: { invalid: 'payload' }
    })
  };

  const service = new NuPayService(fakeClient);
  await assert.rejects(
    async () => {
      await service.registerTT1Endpoint({
        endpointUrl: 'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback',
        registrationStatus: 'Register',
        cardAcceptorEmail: 'Info@chanainvestments.co.za'
      });
    },
    NuPayInvalidResponseError
  );
});

test('TT1 registration timeout throws NuPayTimeoutError', async () => {
  const fakeClient = {
    post: async () => {
      const err = new Error('Timeout');
      err.code = 'ETIMEDOUT';
      throw err;
    }
  };

  const service = new NuPayService(fakeClient);
  await assert.rejects(
    async () => {
      await service.registerTT1Endpoint({
        endpointUrl: 'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback',
        registrationStatus: 'Register',
        cardAcceptorEmail: 'Info@chanainvestments.co.za'
      });
    },
    NuPayTimeoutError
  );
});

test('TT1 registration fails before HTTP request if callback URL is missing', async () => {
  let callCount = 0;
  const fakeClient = {
    post: async () => {
      callCount++;
      return { status: 200, data: {} };
    }
  };

  const savedUrl = process.env.NUPAY_TT1_CALLBACK_URL;
  delete process.env.NUPAY_TT1_CALLBACK_URL;

  const service = new NuPayService(fakeClient);
  await assert.rejects(
    async () => {
      await service.registerTT1Endpoint({
        cardAcceptorEmail: 'Info@chanainvestments.co.za'
      });
    },
    NuPayConfigurationError
  );

  assert.equal(callCount, 0, 'Zero HTTP requests should be made when callback URL is missing');
  process.env.NUPAY_TT1_CALLBACK_URL = savedUrl;
});

test('TT1 registration fails before HTTP request if email is missing', async () => {
  let callCount = 0;
  const fakeClient = {
    post: async () => {
      callCount++;
      return { status: 200, data: {} };
    }
  };

  const savedEmail = process.env.NUPAY_CARD_ACCEPTOR_EMAIL;
  delete process.env.NUPAY_CARD_ACCEPTOR_EMAIL;

  const service = new NuPayService(fakeClient);
  await assert.rejects(
    async () => {
      await service.registerTT1Endpoint({
        endpointUrl: 'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback'
      });
    },
    NuPayConfigurationError
  );

  assert.equal(callCount, 0, 'Zero HTTP requests should be made when email is missing');
  process.env.NUPAY_CARD_ACCEPTOR_EMAIL = savedEmail;
});

test('TT1 registration accepts Deregister status', async () => {
  let captured;
  const fakeClient = {
    post: async (url, body) => {
      captured = body;
      return {
        status: 200,
        data: {
          responseCode: '500000',
          responseMessage: 'Success'
        }
      };
    }
  };

  const service = new NuPayService(fakeClient);
  const result = await service.registerTT1Endpoint({
    endpointUrl: 'https://loan-saas47-production.up.railway.app/api/v1/nupay/tt1/callback',
    registrationStatus: 'Deregister',
    cardAcceptorEmail: 'Info@chanainvestments.co.za'
  });

  assert.equal(captured.registrationStatus, 'Deregister');
  assert.equal(result.outcome, 'ACCEPTED');
});
