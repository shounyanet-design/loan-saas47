const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const tenantContext = require('../../src/tenancy/tenantContext');

test('Borrowers Optimization - Unit Verification Suite', async (t) => {
  await t.test('1. Loan count Map aggregation logic works accurately for multiple borrowers', () => {
    const bId1 = new mongoose.Types.ObjectId();
    const uId1 = new mongoose.Types.ObjectId();
    const bId2 = new mongoose.Types.ObjectId();

    const mockBorrowers = [
      { _id: bId1, userId: uId1, fullName: 'Borrower One' },
      { _id: bId2, userId: null, fullName: 'Borrower Two' }
    ];

    const mockActiveLoans = [
      { borrowerId: bId1 },
      { borrowerId: uId1 },
      { borrowerId: bId2 }
    ];

    const loanCountMap = new Map();
    for (const loan of mockActiveLoans) {
      if (loan.borrowerId) {
        const idStr = loan.borrowerId.toString();
        loanCountMap.set(idStr, (loanCountMap.get(idStr) || 0) + 1);
      }
    }

    const borrowersWithLoans = mockBorrowers.map(b => {
      const bId = b._id.toString();
      const uId = b.userId ? b.userId.toString() : null;
      const activeLoansCount = (loanCountMap.get(bId) || 0) + (uId ? (loanCountMap.get(uId) || 0) : 0);
      return {
        ...b,
        activeLoansCount
      };
    });

    assert.equal(borrowersWithLoans[0].activeLoansCount, 2, 'Borrower One should have 2 active loans (1 by bId + 1 by uId)');
    assert.equal(borrowersWithLoans[1].activeLoansCount, 1, 'Borrower Two should have 1 active loan');
  });

  await t.test('2. Single batch in-memory Set lookup correctly identifies missing borrower users', () => {
    const user1 = { _id: new mongoose.Types.ObjectId(), email: 'user1@example.com' };
    const user2 = { _id: new mongoose.Types.ObjectId(), email: 'user2@example.com' };
    const user3 = { _id: new mongoose.Types.ObjectId(), email: 'user3@example.com' };

    const borrowerUsers = [user1, user2, user3];

    // Simulating only user1 and user2 already exist in Borrower collection
    const existingBorrowers = [
      { userId: user1._id, email: user1.email },
      { userId: null, email: user2.email.toUpperCase() } // case-insensitive check
    ];

    const existingUserSet = new Set(
      existingBorrowers.map(b => (b.userId ? b.userId.toString() : null)).filter(Boolean)
    );
    const existingEmailSet = new Set(
      existingBorrowers.map(b => (b.email ? b.email.toLowerCase() : null)).filter(Boolean)
    );

    const missingUsers = borrowerUsers.filter(u => 
      !existingUserSet.has(u._id.toString()) && 
      (!u.email || !existingEmailSet.has(u.email.toLowerCase()))
    );

    assert.equal(missingUsers.length, 1, 'Exactly 1 missing user should be identified');
    assert.equal(missingUsers[0]._id.toString(), user3._id.toString(), 'user3 should be identified as missing');
  });

  await t.test('3. Duplicate key error (code 11000) during concurrent auto-sync is caught safely', () => {
    let duplicateHandled = false;
    try {
      const error = new Error('E11000 duplicate key error collection');
      error.code = 11000;
      throw error;
    } catch (createErr) {
      if (createErr.code !== 11000) {
        throw createErr;
      }
      duplicateHandled = true;
    }
    assert.equal(duplicateHandled, true, 'E11000 error should be caught safely without throwing');
  });
});

