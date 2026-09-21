const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mandateInitiationSchema, tt1CallbackSchema } = require('../../src/utils/nupayValidation');

describe('NuPay Validation Schemas', () => {
  describe('Mandate Initiation', () => {
    it('should pass a valid minimum payload', () => {
      const payload = {
        cardAcceptor: '000000000123456',
        frequency: 'MNTH',
        collectionDay: '15',
        clientReference: 'CLIENT123',
        contractReference: 'CONTRACT123',
        debtorName: 'John Doe',
        debtorIdType: '2',
        debtorId: '9001015000000',
        debtorAccountNumber: '1234567890',
        debtorAccountType: '01',
        debtorBankId: '1',
        debtorBranchNumber: '123456',
        debtorPhoneNumber: '+27-820001111',
        debtorAuthenticationRequired: '0230',
        firstCollectionAmount: '1000.50',
        firstCollectionDate: '2026-08-01',
        instalmentAmount: '1000.50',
        maxCollectionAmount: '1000.50',
        adjustmentCategory: 'N',
        startDate: '2026-08-01',
        dateAdjustmentRule: 'Y',
        debitValueTypeId: '1',
        instalments: 12,
        trackingIndicator: '00',
        authenticationType: 'REAL TIME',
        entryClass: '0021'
      };
      
      const { error } = mandateInitiationSchema.validate(payload);
      assert.strictEqual(error, undefined);
    });

    it('should fail on missing required fields', () => {
      const payload = { frequency: 'MNTH' };
      const { error } = mandateInitiationSchema.validate(payload);
      assert.notStrictEqual(error, undefined);
    });

    it('should fail on invalid Card Acceptor length', () => {
      const payload = {
        cardAcceptor: '123'
      };
      const { error } = mandateInitiationSchema.validate(payload);
      assert.notStrictEqual(error, undefined);
    });
  });

  describe('TT1 Callback Validation', () => {
    it('should pass a valid callback', () => {
      const payload = {
        requestId: 'req-123',
        clientEndPointIp: '127.0.0.1',
        supportMail: 'support@example.com',
        mandateId: 'mand-123',
        contractReference: 'cont-123',
        statusCode: '900000',
        statusDescription: 'Accepted'
      };
      const { error } = tt1CallbackSchema.validate(payload);
      assert.strictEqual(error, undefined);
    });

    it('should fail on invalid status code', () => {
      const payload = {
        requestId: 'req-123',
        statusCode: 'INVALID'
      };
      const { error } = tt1CallbackSchema.validate(payload);
      assert.notStrictEqual(error, undefined);
    });
  });
});
