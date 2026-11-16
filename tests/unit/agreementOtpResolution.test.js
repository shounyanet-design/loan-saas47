const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Mock AgreementOTP model
const AgreementOTP = require('../../src/modules/agreementSigning/models/AgreementOTP');
const { verifyOTP } = require('../../src/modules/agreementSigning/services/otpVerification.service');

test('Agreement OTP Resolution & Verification Suite', async (t) => {
  await t.test('1. verifyOTP successfully finds active OTP by loanApplicationId even if borrowerId differs', async () => {
    const loanAppId = new mongoose.Types.ObjectId();
    const userBorrowerId = new mongoose.Types.ObjectId();
    const profileBorrowerId = new mongoose.Types.ObjectId();

    // Mock findOne to simulate matching query
    const originalFindOne = AgreementOTP.findOne;
    let queryUsed = null;

    AgreementOTP.findOne = function (filter) {
      queryUsed = filter;
      return {
        sort: function () {
          return Promise.resolve({
            otpCode: '123456',
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            attempts: 0,
            retryCount: 0,
            verified: false,
            save: async function () {
              this.verified = true;
              return this;
            }
          });
        }
      };
    };

    try {
      const result = await verifyOTP(profileBorrowerId, loanAppId, '123456');
      assert.equal(result, true);
      assert.equal(queryUsed.loanApplicationId.toString(), loanAppId.toString());
      assert.equal(queryUsed.verified, false);
      assert.ok(queryUsed.$or);
    } finally {
      AgreementOTP.findOne = originalFindOne;
    }
  });

  await t.test('2. verifyOTP correctly rejects expired OTP', async () => {
    const loanAppId = new mongoose.Types.ObjectId();
    const borrowerId = new mongoose.Types.ObjectId();

    const originalFindOne = AgreementOTP.findOne;
    AgreementOTP.findOne = function () {
      return {
        sort: function () {
          return Promise.resolve({
            otpCode: '123456',
            expiresAt: new Date(Date.now() - 1000), // Expired
            attempts: 0,
            retryCount: 0,
            verified: false,
            save: async () => {}
          });
        }
      };
    };

    try {
      await assert.rejects(
        async () => {
          await verifyOTP(borrowerId, loanAppId, '123456');
        },
        {
          message: 'OTP has expired. Please request a new OTP.'
        }
      );
    } finally {
      AgreementOTP.findOne = originalFindOne;
    }
  });

  await t.test('3. verifyOTP increments attempt count and throws on incorrect OTP', async () => {
    const loanAppId = new mongoose.Types.ObjectId();
    const borrowerId = new mongoose.Types.ObjectId();

    const originalFindOne = AgreementOTP.findOne;
    let savedDoc = null;
    AgreementOTP.findOne = function () {
      return {
        sort: function () {
          savedDoc = {
            otpCode: '123456',
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            attempts: 0,
            retryCount: 0,
            verified: false,
            save: async function () { return this; }
          };
          return Promise.resolve(savedDoc);
        }
      };
    };

    try {
      await assert.rejects(
        async () => {
          await verifyOTP(borrowerId, loanAppId, '999999');
        },
        {
          message: 'Incorrect OTP code. 4 attempts remaining.'
        }
      );
      assert.equal(savedDoc.attempts, 1);
    } finally {
      AgreementOTP.findOne = originalFindOne;
    }
  });
});
