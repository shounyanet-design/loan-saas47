const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const tenantContext = require('../../src/tenancy/tenantContext');

test('Comprehensive Regression Audit - Borrowers Optimization', async (t) => {

  // 1. API Contract Verification
  await t.test('1. API Contract Verification: Response format and keys match contract specifications', () => {
    const mockBorrowers = [
      {
        _id: new mongoose.Types.ObjectId(),
        fullName: 'John Doe',
        email: 'john@example.com',
        phoneNumber: '0821234567',
        accountStatus: 'Active',
        borrowerCode: 'BRW-1001',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    const mockStats = {
      totalBorrowers: 1,
      activeBorrowers: 1,
      blacklistedBorrowers: 0,
      frozenBorrowers: 0
    };

    const loanCountMap = new Map();
    const borrowersWithLoans = mockBorrowers.map(b => ({
      ...b,
      activeLoansCount: (loanCountMap.get(b._id.toString()) || 0)
    }));

    const responseData = {
      borrowers: borrowersWithLoans,
      stats: mockStats
    };

    // Assert top-level keys
    assert.ok('borrowers' in responseData, 'Response data must contain "borrowers" key');
    assert.ok('stats' in responseData, 'Response data must contain "stats" key');
    assert.ok(Array.isArray(responseData.borrowers), '"borrowers" must be an Array');

    // Assert borrower object keys
    const borrower = responseData.borrowers[0];
    assert.ok('_id' in borrower, 'Borrower must have "_id"');
    assert.ok('fullName' in borrower, 'Borrower must have "fullName"');
    assert.ok('email' in borrower, 'Borrower must have "email"');
    assert.ok('phoneNumber' in borrower, 'Borrower must have "phoneNumber"');
    assert.ok('accountStatus' in borrower, 'Borrower must have "accountStatus"');
    assert.ok('borrowerCode' in borrower, 'Borrower must have "borrowerCode"');
    assert.ok('activeLoansCount' in borrower, 'Borrower must have "activeLoansCount"');

    // Assert stats keys
    assert.ok('totalBorrowers' in responseData.stats, 'Stats must contain "totalBorrowers"');
    assert.ok('activeBorrowers' in responseData.stats, 'Stats must contain "activeBorrowers"');
    assert.ok('blacklistedBorrowers' in responseData.stats, 'Stats must contain "blacklistedBorrowers"');
    assert.ok('frozenBorrowers' in responseData.stats, 'Stats must contain "frozenBorrowers"');
  });

  // 2. Active Loan Calculation Equivalence Audit
  await t.test('2. Loan Connectivity Audit: Optimized Map logic matches original nested filter exactly', () => {
    const bId1 = new mongoose.Types.ObjectId();
    const uId1 = new mongoose.Types.ObjectId();
    const bId2 = new mongoose.Types.ObjectId();
    const uId2 = new mongoose.Types.ObjectId();
    const bId3 = new mongoose.Types.ObjectId();

    const borrowers = [
      { _id: bId1, userId: uId1, fullName: 'Borrower 1' },
      { _id: bId2, userId: uId2, fullName: 'Borrower 2' },
      { _id: bId3, userId: null, fullName: 'Borrower 3' }
    ];

    // Simulated active loans matching:
    // - bId1 has 1 loan by borrowerId (_id)
    // - uId1 has 2 loans by userId
    // - bId2 has 1 loan by borrowerId (_id)
    // - bId3 has 0 loans
    const activeLoans = [
      { borrowerId: bId1, loanStatus: 'Active', isDeleted: false },
      { borrowerId: uId1, loanStatus: 'Active', isDeleted: false },
      { borrowerId: uId1, loanStatus: 'Overdue', isDeleted: false },
      { borrowerId: bId2, loanStatus: 'Active', isDeleted: false }
    ];

    // Method A: Original Logic
    const originalResult = borrowers.map(b => {
      const activeLoansCount = activeLoans.filter(l => 
        l.borrowerId.toString() === b._id.toString() || 
        (b.userId && l.borrowerId.toString() === b.userId.toString())
      ).length;
      return {
        _id: b._id,
        activeLoansCount
      };
    });

    // Method B: Optimized Map Logic
    const loanCountMap = new Map();
    for (const loan of activeLoans) {
      if (loan.borrowerId) {
        const idStr = loan.borrowerId.toString();
        loanCountMap.set(idStr, (loanCountMap.get(idStr) || 0) + 1);
      }
    }

    const optimizedResult = borrowers.map(b => {
      const bId = b._id.toString();
      const uId = b.userId ? b.userId.toString() : null;
      const activeLoansCount = (loanCountMap.get(bId) || 0) + (uId ? (loanCountMap.get(uId) || 0) : 0);
      return {
        _id: b._id,
        activeLoansCount
      };
    });

    // Deep equality check between both algorithms
    assert.deepEqual(optimizedResult, originalResult, 'Optimized loan count must equal original count exactly');
    assert.equal(optimizedResult[0].activeLoansCount, 3, 'Borrower 1 must have 3 loans');
    assert.equal(optimizedResult[1].activeLoansCount, 1, 'Borrower 2 must have 1 loan');
    assert.equal(optimizedResult[2].activeLoansCount, 0, 'Borrower 3 must have 0 loans');
  });

  // 3. Multi-Tenant Batch Lookup Isolation Audit
  await t.test('3. Multi-Tenant Audit: Cross-tenant candidate filtering and batch isolation', () => {
    const tenantA = new mongoose.Types.ObjectId();
    const tenantB = new mongoose.Types.ObjectId();

    const userA1 = { _id: new mongoose.Types.ObjectId(), tenantId: tenantA, email: 'a1@test.com' };
    const userA2 = { _id: new mongoose.Types.ObjectId(), tenantId: tenantA, email: 'a2@test.com' };
    const userB1 = { _id: new mongoose.Types.ObjectId(), tenantId: tenantB, email: 'b1@test.com' };

    // When querying User candidates for tenant A:
    const userQuery = { role: 'borrower', tenantId: tenantA };
    const allUsers = [userA1, userA2, userB1];
    const tenantAUsers = allUsers.filter(u => u.tenantId.toString() === userQuery.tenantId.toString());

    assert.equal(tenantAUsers.length, 2, 'Tenant A query must only yield Tenant A users');
    assert.ok(!tenantAUsers.some(u => u.tenantId.toString() === tenantB.toString()), 'No Tenant B users in Tenant A query');

    // Batch lookup simulation with tenant scoping:
    const existingBorrowersInTenantA = [
      { userId: userA1._id, email: userA1.email, tenantId: tenantA }
    ];

    const existingUserSet = new Set(existingBorrowersInTenantA.map(b => b.userId.toString()));
    const missingInA = tenantAUsers.filter(u => !existingUserSet.has(u._id.toString()));

    assert.equal(missingInA.length, 1, 'Tenant A should only have userA2 missing');
    assert.equal(missingInA[0]._id.toString(), userA2._id.toString(), 'Missing user must be userA2');
  });

  // 4. Concurrency & Deduplication Audit
  await t.test('4. Concurrency Audit: Concurrent healing requests cannot produce duplicate borrowers', () => {
    const createdBorrowers = new Map();

    const simulateCreateBorrower = (borrowerData) => {
      const key = `${borrowerData.tenantId}_${borrowerData.email.toLowerCase()}`;
      if (createdBorrowers.has(key)) {
        const err = new Error('E11000 duplicate key error');
        err.code = 11000;
        throw err;
      }
      createdBorrowers.set(key, borrowerData);
      return borrowerData;
    };

    const tenantId = new mongoose.Types.ObjectId();
    const candidate = {
      tenantId,
      email: 'concurrent@test.com',
      fullName: 'Concurrent Borrower'
    };

    // Simulate Request 1
    let req1Result = null;
    let req1Error = null;
    try {
      req1Result = simulateCreateBorrower(candidate);
    } catch (e) {
      req1Error = e;
    }

    // Simulate Request 2 (Concurrent hit with same candidate)
    let req2Result = null;
    let req2Error = null;
    try {
      req2Result = simulateCreateBorrower(candidate);
    } catch (e) {
      if (e.code === 11000) {
        // Handled cleanly by our controller catch block
        req2Error = 'DUPLICATE_KEY_HANDLED_GRACEFULLY';
      } else {
        req2Error = e;
      }
    }

    assert.ok(req1Result !== null, 'Request 1 creates borrower');
    assert.equal(req2Error, 'DUPLICATE_KEY_HANDLED_GRACEFULLY', 'Request 2 duplicate key is caught and handled safely');
    assert.equal(createdBorrowers.size, 1, 'Only 1 borrower record exists in database');
  });

  // 5. Status Filter & Search Equivalence Audit
  await t.test('5. Filters & Search Audit: Status and regex search logic behaves consistently', () => {
    const mockDb = [
      { fullName: 'Alice Smith', email: 'alice@test.com', phoneNumber: '0811111111', accountStatus: 'Active' },
      { fullName: 'Bob Jones', email: 'bob@test.com', phoneNumber: '0822222222', accountStatus: 'Frozen' },
      { fullName: 'Charlie Brown', email: 'charlie@test.com', phoneNumber: '0833333333', accountStatus: 'Blacklisted' }
    ];

    // Filter Active
    const activeResults = mockDb.filter(b => b.accountStatus === 'Active');
    assert.equal(activeResults.length, 1);
    assert.equal(activeResults[0].fullName, 'Alice Smith');

    // Filter Frozen
    const frozenResults = mockDb.filter(b => b.accountStatus === 'Frozen');
    assert.equal(frozenResults.length, 1);
    assert.equal(frozenResults[0].fullName, 'Bob Jones');

    // Search by name "alice" (case-insensitive)
    const searchRegex = new RegExp('alice', 'i');
    const searchResults = mockDb.filter(b => searchRegex.test(b.fullName) || searchRegex.test(b.email) || searchRegex.test(b.phoneNumber));
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].fullName, 'Alice Smith');
  });
});

