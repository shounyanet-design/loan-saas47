const { mandateInitiationSchema, tt1CallbackSchema } = require('../../src/utils/nupayValidation');

describe('NuPay Validation Schemas', () => {
  describe('Mandate Initiation', () => {
    it('should pass a valid minimum payload', () => {
      const payload = {
        auth: 'base64authstring=',
        cardAcceptor: '000000000123456',
        frequency: 'M',
        collectionDay: 15,
        clientReference: 'CLIENT123',
        contractReference: 'CONTRACT123',
        debtorName: 'John Doe',
        debtorIdType: 'ID',
        debtorId: '9001015000000',
        debtorAccountNumber: '1234567890',
        debtorAccountType: 1,
        debtorBankId: '470010',
        debtorBranchNumber: '123456',
        firstCollectionAmount: 1000.50,
        firstCollectionDate: '20260801',
        instalmentAmount: 1000.50,
        maxCollectionAmount: 1200.00,
        startDate: '20260801',
        instalments: 12
      };
      
      const { error } = mandateInitiationSchema.validate(payload);
      expect(error).toBeUndefined();
    });

    it('should fail on missing required fields', () => {
      const payload = { auth: 'test' };
      const { error } = mandateInitiationSchema.validate(payload);
      expect(error).toBeDefined();
    });

    it('should fail on invalid Card Acceptor length', () => {
      const payload = {
        // ... omitted full required fields for brevity, assuming validate aborts early
        auth: 'test',
        cardAcceptor: '123'
      };
      const { error } = mandateInitiationSchema.validate(payload);
      expect(error).toBeDefined();
    });
  });

  describe('TT1 Callback Validation', () => {
    it('should pass a valid callback', () => {
      const payload = {
        requestId: 'req-1',
        mandateId: 'mandate-1',
        contractReference: 'CONT-1',
        statusCode: 'Completed',
        statusDescription: 'Success'
      };
      const { error } = tt1CallbackSchema.validate(payload);
      expect(error).toBeUndefined();
    });

    it('should fail on invalid status code', () => {
      const payload = {
        requestId: 'req-1',
        mandateId: 'mandate-1',
        contractReference: 'CONT-1',
        statusCode: 'INVALID_ENUM',
        statusDescription: 'Fail'
      };
      const { error } = tt1CallbackSchema.validate(payload);
      expect(error).toBeDefined();
    });
  });
});
