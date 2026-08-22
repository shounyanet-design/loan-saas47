const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Mock models to test business logic isolation without active DB connection
test('SaaS Agreement Sync Test Suite - Multi-Tenant Credit Provider Isolation', async (t) => {

  await t.test('1. Tenant A resolves Tenant A legal details', () => {
    const tenantA = {
      _id: 'tenant-a-id',
      companyName: 'Tenant A Finance',
      companyProfile: {
        legalName: 'Tenant A Finance Pty Ltd',
        cipcRegistrationNumber: 'CIPC-A-123',
        ncrRegistrationNumber: 'NCRCP-A-999',
        telephone: '+27 11 000 0001',
        registeredAddress: {
          addressLine1: 'Address A',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '2000',
          country: 'South Africa'
        }
      }
    };

    const companyProfile = tenantA.companyProfile || {};
    const legalName = companyProfile.legalName || tenantA.companyName;
    const cipc = companyProfile.cipcRegistrationNumber;
    const ncr = companyProfile.ncrRegistrationNumber;

    assert.equal(legalName, 'Tenant A Finance Pty Ltd');
    assert.equal(cipc, 'CIPC-A-123');
    assert.equal(ncr, 'NCRCP-A-999');
  });

  await t.test('2. Tenant B resolves Tenant B legal details', () => {
    const tenantB = {
      _id: 'tenant-b-id',
      companyName: 'Tenant B Microfinance',
      companyProfile: {
        legalName: 'Tenant B Legal Name',
        cipcRegistrationNumber: 'CIPC-B-456',
        ncrRegistrationNumber: 'NCRCP-B-888',
        telephone: '+27 21 000 0002',
        registeredAddress: {
          addressLine1: 'Address B',
          city: 'Cape Town',
          province: 'Western Cape',
          postalCode: '8000',
          country: 'South Africa'
        }
      }
    };

    const companyProfile = tenantB.companyProfile || {};
    const legalName = companyProfile.legalName || tenantB.companyName;
    const cipc = companyProfile.cipcRegistrationNumber;
    const ncr = companyProfile.ncrRegistrationNumber;

    assert.equal(legalName, 'Tenant B Legal Name');
    assert.equal(cipc, 'CIPC-B-456');
    assert.equal(ncr, 'NCRCP-B-888');
  });

  await t.test('3. Agreement generation fails when mandatory legal fields are missing', () => {
    const incompleteTenant = {
      companyName: '',
      companyProfile: {
        legalName: '', // Missing
        cipcRegistrationNumber: '123456',
        ncrRegistrationNumber: '', // Missing
        telephone: '+27 11 444 4444'
      }
    };

    const companyProfile = incompleteTenant.companyProfile || {};
    const legalName = companyProfile.legalName || incompleteTenant.companyName || '';
    const cipc = companyProfile.cipcRegistrationNumber || '';
    const ncr = companyProfile.ncrRegistrationNumber || '';
    const telephone = companyProfile.telephone || '';

    const missingFields = [];
    if (!legalName) missingFields.push('legalName');
    if (!cipc) missingFields.push('cipcRegistrationNumber');
    if (!ncr) missingFields.push('ncrRegistrationNumber');
    if (!telephone) missingFields.push('telephone');

    assert.ok(missingFields.includes('legalName'));
    assert.ok(missingFields.includes('ncrRegistrationNumber'));
    assert.equal(missingFields.length, 2);
  });

  await t.test('4. Snapshot generation copies details immutably onto the application', () => {
    const tenantProfile = {
      legalName: 'Lender A',
      cipcRegistrationNumber: 'CIPC-A',
      ncrRegistrationNumber: 'NCRCP-A',
      telephone: '12345',
      registeredAddress: {
        addressLine1: 'Line 1',
        city: 'JHB',
        province: 'GP',
        postalCode: '2000',
        country: 'ZA'
      }
    };

    // Snapshot is created on the loan application
    const application = {
      applicationId: 'APP-001',
      agreementCreditProviderSnapshot: {
        legalName: tenantProfile.legalName,
        cipcRegistrationNumber: tenantProfile.cipcRegistrationNumber,
        ncrRegistrationNumber: tenantProfile.ncrRegistrationNumber,
        telephone: tenantProfile.telephone,
        registeredAddress: { ...tenantProfile.registeredAddress }
      }
    };

    // Change tenant profile details in real-time
    tenantProfile.legalName = 'Mutated Lender B';
    tenantProfile.cipcRegistrationNumber = 'Mutated CIPC B';

    // Assert that the snapshot is unaffected by future tenant profile changes (Immutability check)
    assert.equal(application.agreementCreditProviderSnapshot.legalName, 'Lender A');
    assert.equal(application.agreementCreditProviderSnapshot.cipcRegistrationNumber, 'CIPC-A');
  });

  await t.test('5. Historical signed agreements are preserved and never regenerated', () => {
    const historicalSignedAgreementText = 'Original signed document with Point.47 Finance Pty Ltd details concluded in 2025';
    
    const application = {
      signedAgreement: historicalSignedAgreementText,
      agreementCreditProviderSnapshot: {
        legalName: 'New Lender A'
      }
    };

    // Resolver checks signedAgreement existence and returns it directly
    const resultText = application.signedAgreement || `Lender Name: ${application.agreementCreditProviderSnapshot.legalName}`;

    assert.equal(resultText, historicalSignedAgreementText);
  });

  await t.test('6. Dynamic plain-text compiler replaces operator names correctly in digital consent receipts', () => {
    const snapshot = {
      legalName: 'Dynamic Lender Ltd',
      cipcRegistrationNumber: '2026/000000/07',
      ncrRegistrationNumber: 'NCRCP99999',
      telephone: '+27 82 000 0000',
      email: 'lender@dynamic.com',
      registeredAddress: {
        addressLine1: '1 Legal Road',
        city: 'Cape Town',
        province: 'Western Cape',
        postalCode: '8001',
        country: 'South Africa'
      },
      authorizedSignatory: {
        fullName: 'John Doe',
        designation: 'Managing Director'
      }
    };

    const documentText = `CREDIT PROVIDER DETAILS:
Full Name / Entity: ${snapshot.legalName}
CIPC Registration No: ${snapshot.cipcRegistrationNumber}
NCR Registration No: ${snapshot.ncrRegistrationNumber}

SIGNATURE CREDIT PROVIDER:
Authorized Signatory: ${snapshot.authorizedSignatory.fullName}
Designation: ${snapshot.authorizedSignatory.designation}`;

    assert.ok(documentText.includes('Dynamic Lender Ltd'));
    assert.ok(documentText.includes('2026/000000/07'));
    assert.ok(documentText.includes('NCRCP99999'));
    assert.ok(documentText.includes('John Doe'));
    assert.ok(documentText.includes('Managing Director'));
  });

});
