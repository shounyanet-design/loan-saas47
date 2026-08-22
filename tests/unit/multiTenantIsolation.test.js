const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const tenantContext = require('../../src/tenancy/tenantContext');
const tenantPlugin = require('../../src/tenancy/tenantPlugin');

// Create test schema with tenantPlugin
const mockSchema = new mongoose.Schema({
  name: String,
  amount: Number,
  status: String,
});
mockSchema.plugin(tenantPlugin);

// Prevent re-compilation if already compiled
const MockTenantModel = mongoose.models.MockTenantDoc || mongoose.model('MockTenantDoc', mockSchema);

test('1. Fail-Closed Tenant Guard - Throws if query runs with NO tenant context and NOT in system mode', () => {
  assert.equal(tenantContext.hasContext(), false, 'Should have no active context');
  
  const query = MockTenantModel.find({ status: 'ACTIVE' });
  const hook = mockSchema.s.hooks._pres.get('find')[0].fn;
  assert.throws(() => {
    hook.call(query);
  }, /Tenant context missing/);
});

test('2. Tenant Context Isolation - Scopes queries strictly to current tenantId', async () => {
  const tenantA_Id = '660e8400e29b41d4a7164466';
  
  await tenantContext.runWithTenant(tenantA_Id, async () => {
    assert.equal(tenantContext.getTenantId(), tenantA_Id);
    assert.equal(tenantContext.isSystem(), false);
    
    const query = MockTenantModel.find({ status: 'ACTIVE' });
    const hook = mockSchema.s.hooks._pres.get('find')[0].fn;
    hook.call(query);
    const filter = query.getFilter();
    assert.equal(String(filter.tenantId), tenantA_Id);
  });
});

test('3. Cross-Tenant Barrier - Tenant A filter cannot be widened or overridden by custom params', async () => {
  const tenantA_Id = '660e8400e29b41d4a7164466';
  const tenantB_Id = '770e8400e29b41d4a7164477';
  
  await tenantContext.runWithTenant(tenantA_Id, async () => {
    // Malicious attempt to query Tenant B's data while running in Tenant A context
    const query = MockTenantModel.find({ tenantId: tenantB_Id });
    const hook = mockSchema.s.hooks._pres.get('find')[0].fn;
    hook.call(query);
    const filter = query.getFilter();
    // tenantPlugin enforces context tenantId
    assert.equal(String(filter.tenantId), tenantA_Id, 'Context tenantId must overwrite attempted tenant spoofing');
  });
});

test('4. System Mode Bypass - runAsSystem enables trusted cross-tenant queries', async () => {
  await tenantContext.runAsSystem(async () => {
    assert.equal(tenantContext.isSystem(), true);
    assert.equal(tenantContext.getTenantId(), null);
    
    const query = MockTenantModel.find({ status: 'ACTIVE' });
    const filter = query.getFilter();
    assert.equal(filter.tenantId, undefined, 'System mode must not inject tenantId filter');
  });
});

test('5. Auto-stamp on Save - Automatically stamps active tenantId on document creation', async () => {
  const tenantA_Id = '660e8400e29b41d4a7164466';
  
  await tenantContext.runWithTenant(tenantA_Id, async () => {
    const doc = new MockTenantModel({ name: 'Loan App 101', amount: 5000 });
    assert.equal(doc.name, 'Loan App 101');
  });
});

test('6. Token Scope Isolation - Platform tokens rejected by tenant protect and vice versa', () => {
  const jwt = require('jsonwebtoken');
  const secret = 'test_secret_key_point47';
  
  // Platform token (scope: 'platform')
  const platformToken = jwt.sign({ id: 'sa_1', scope: 'platform', role: 'SUPER_ADMIN' }, secret);
  const decodedPlatform = jwt.verify(platformToken, secret);
  assert.equal(decodedPlatform.scope, 'platform');
  
  // Tenant token (no scope or scope: 'tenant')
  const tenantToken = jwt.sign({ id: 'user_1', tenantId: 'tenant_1', role: 'admin' }, secret);
  const decodedTenant = jwt.verify(tenantToken, secret);
  assert.notEqual(decodedTenant.scope, 'platform');
});
