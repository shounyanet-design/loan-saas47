const test = require('node:test');
const assert = require('node:assert/strict');
const debi24Service = require('../../src/services/debi24Service');

test('debi24Service maps bank codes accurately', () => {
  assert.equal(debi24Service.mapBankCode('Standard Bank of South Africa'), '1');
  assert.equal(debi24Service.mapBankCode('Nedbank'), '2');
  assert.equal(debi24Service.mapBankCode('First National Bank (FNB)'), '3');
  assert.equal(debi24Service.mapBankCode('Capitec Bank'), '10');
  assert.equal(debi24Service.mapBankCode('ABSA Bank'), '16');

  // Test branch code override even if bank name is empty
  assert.equal(debi24Service.mapBankCode('', '470010'), '10');
  assert.equal(debi24Service.mapBankCode('', '632005'), '16');
  assert.equal(debi24Service.mapBankCode('', '051001'), '1');
  assert.equal(debi24Service.mapBankCode('', '250655'), '3');
});

test('debi24Service formats South African phone numbers correctly', () => {
  assert.equal(debi24Service.formatMobile('0823509883'), '+27823509883');
  assert.equal(debi24Service.formatMobile('+27 82 350 9883'), '+27823509883');
  assert.equal(debi24Service.formatMobile('27823509883'), '+27823509883');
});

test('debi24Service builds a valid Debi24 mandate payload', () => {
  const fakeLoan = {
    _id: '64f1234567890abcdef12345',
    applicationId: 'LAPP-1049',
    fullName: 'Test Borrower',
    idNumber: '9001015009087',
    phoneNumber: '0823509883',
    emailAddress: 'borrower@test.co.za',
    estimatedMonthlyEMI: 350,
    requestedDuration: 6,
    bankVerification: {
      bankName: 'Capitec Bank',
      verifiedBankAccount: '1234567890',
      verifiedBranchCode: '470010',
      verifiedAccountType: 'savings'
    }
  };

  const payload = debi24Service.buildMandatePayload(fakeLoan);

  assert.equal(payload.customer.reference, 'CUST-LAPP-1049');
  assert.equal(payload.customer.name, 'Test Borrower');
  assert.equal(payload.customer.identification.number, '9001015009087');
  assert.equal(payload.customer.mobile, '+27823509883');
  assert.equal(payload.customer.bankAccount.bankCode, '10');
  assert.equal(payload.customer.bankAccount.branchCode, '470010');
  assert.equal(payload.customer.bankAccount.type, 'savings');
  assert.ok(payload.mandate.reference.startsWith('MAND-LAPP-1049'));
  assert.equal(payload.mandate.entryClass, '0033');
  assert.equal(payload.mandate.instalmentAmount, '350.00');
  assert.equal(payload.mandate.numberOfInstalments, 6);
});
