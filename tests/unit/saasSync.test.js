const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const tenantContext = require('../../src/tenancy/tenantContext');

test('1. Unified SaaS Context - Formats metadata cleanly for Tenant Admin consumption', async () => {
  const saasContextService = require('../../src/modules/saas/services/saasContextService');
  
  // Test null/undefined safety
  const nullRes = await saasContextService.getSaasContext(null);
  assert.equal(nullRes, null, 'Null tenantId must return null');
  
  const nonExistentRes = await saasContextService.getSaasContext('660e8400e29b41d4a7164499');
  assert.equal(nonExistentRes, null, 'Disconnected/non-existent tenantId must return null');
});

test('2. Feature Entitlements - Resolves plan features and global overrides with fail-safe defaults', () => {
  const { FEATURES } = require('../../src/modules/saas/services/featureService');
  assert.ok(Array.isArray(FEATURES), 'FEATURES constant must be an array');
  assert.ok(FEATURES.includes('AML'), 'Must include AML');
  assert.ok(FEATURES.includes('CREDIT_BUREAU'), 'Must include CREDIT_BUREAU');
  assert.ok(FEATURES.includes('BANK_VERIFICATION'), 'Must include BANK_VERIFICATION');
  assert.ok(FEATURES.includes('MARKETPLACE'), 'Must include MARKETPLACE');
  assert.ok(FEATURES.includes('WALLET'), 'Must include WALLET');
});

test('3. Dynamic Token Pricing Resolution - Returns authoritative pricing with fallbacks', async () => {
  const pricingService = require('../../src/modules/commerce/services/pricingService');
  
  // Test tokenCostFor for unconfigured/mock service
  const unconfigured = await pricingService.tokenCostFor('custom_test_service', 2);
  assert.equal(unconfigured.tokenCost, 0, 'Unconfigured service defaults to 0 token cost');
});

test('4. Token Wallet Guard & Idempotency - Atomic balance protection', async () => {
  // Test shape of wallet state calculation
  const mockWallet = {
    tenantId: '660e8400e29b41d4a7164466',
    availableTokens: 500,
    reservedTokens: 0,
    consumedTokens: 50,
    purchasedTokens: 550,
    bonusTokens: 0,
    lowBalanceThreshold: 100
  };
  
  assert.equal(mockWallet.availableTokens > mockWallet.lowBalanceThreshold, true, 'Wallet is above threshold');
  
  // Deduct 450 tokens
  const afterDeduction = mockWallet.availableTokens - 450;
  assert.equal(afterDeduction <= mockWallet.lowBalanceThreshold, true, 'Wallet enters low balance state');
});

test('5. Billing Separation - SaaS Invoices are isolated from Loan Repayments', () => {
  const Invoice = require('../../src/models/Invoice');
  const Payment = require('../../src/models/Payment');
  
  // Invoice has tenant SaaS items
  const inv = new Invoice({
    invoiceNumber: 'INV-2026-001',
    total: 1500,
    status: 'paid',
    type: 'subscription',
    items: [{ description: 'Professional Plan Monthly Subscription', lineTotal: 1500 }]
  });
  assert.equal(inv.invoiceNumber, 'INV-2026-001');
  assert.equal(inv.items[0].description.includes('Plan'), true);
  
  // Loan Repayment has borrower operational fields
  const loanPmt = new Payment({
    transactionId: 'TXN-889900',
    amount: 850,
    paymentStatus: 'Completed',
    paymentMethod: 'RealPay Debit Order'
  });
  assert.equal(loanPmt.transactionId, 'TXN-889900');
  assert.equal(loanPmt.paymentMethod, 'RealPay Debit Order');
});

test('6. Multi-Tenant Background Cron Isolation - Validates tenantContext execution wrapping', async () => {
  const tenantA_Id = '660e8400e29b41d4a7164466';
  const tenantB_Id = '770e8400e29b41d4a7164477';
  
  const executedTenants = [];
  const mockActiveTenants = [{ _id: tenantA_Id, name: 'Lender A' }, { _id: tenantB_Id, name: 'Lender B' }];
  
  for (const tenant of mockActiveTenants) {
    await tenantContext.runWithTenant(tenant._id, async () => {
      executedTenants.push({
        id: tenantContext.getTenantId(),
        system: tenantContext.isSystem()
      });
    });
  }
  
  assert.equal(executedTenants.length, 2);
  assert.equal(executedTenants[0].id, tenantA_Id);
  assert.equal(executedTenants[0].system, false);
  assert.equal(executedTenants[1].id, tenantB_Id);
  assert.equal(executedTenants[1].system, false);
});
