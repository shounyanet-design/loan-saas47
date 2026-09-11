const crypto = require('crypto');
const Borrower = require('../../models/Borrower');
const tenantContext = require('../../tenancy/tenantContext');
const { getPayfastConfig, generateSignature } = require('../commerce/services/payfastService');

class PayFastTokenizationService {
  /**
   * Generate an isolated PayFast card tokenization request payload for a borrower.
   * This authorizes the card for future fallback recovery without recurring fixed billing.
   * NEVER asks for, accepts, or stores raw card numbers or CVV.
   */
  async createBorrowerCardAuthorizationRequest(tenantId, borrowerId, opts = {}) {
    if (!tenantId || !borrowerId) {
      throw new Error('tenantId and borrowerId are required to initiate card authorization');
    }

    const borrower = await Borrower.findOne({ _id: borrowerId, tenantId });
    if (!borrower) {
      throw new Error(`Borrower ${borrowerId} not found for tenant ${tenantId}`);
    }

    const cfg = getPayfastConfig();
    const mPaymentId = `AUTH-${borrower._id}-${Date.now()}`;

    const returnUrl = opts.returnUrl || `${cfg.returnUrl}?type=loan_tokenization&borrowerId=${borrower._id}`;
    const cancelUrl = opts.cancelUrl || `${cfg.cancelUrl}?type=loan_tokenization&borrowerId=${borrower._id}`;

    // PayFast subscription_type: 2 represents Ad-Hoc Tokenization agreement
    const payload = {
      merchant_id: cfg.merchantId,
      merchant_key: cfg.merchantKey,
      return_url: returnUrl,
      cancel_url: cancelUrl,
      notify_url: cfg.notifyUrl,
      name_first: (borrower.fullName || 'Borrower').split(' ')[0] || 'Borrower',
      name_last: (borrower.fullName || 'Borrower').split(' ').slice(1).join(' ') || 'Account',
      email_address: borrower.email || 'borrower@point47.co.za',
      cell_number: borrower.phoneNumber || '+27820000000',
      m_payment_id: mPaymentId,
      amount: '0.00',
      item_name: 'Card Authorization - Loan Collection Fallback',
      item_description: 'Point.47 Loan Collection Card Tokenization Agreement',
      subscription_type: '2', // 2 = Ad-Hoc Tokenization
      cycles: '0',
      frequency: '0',
      custom_str1: String(tenantId),
      custom_str2: 'LOAN_TOKENIZATION',
      custom_str3: String(borrower._id),
      custom_str4: mPaymentId
    };

    if (cfg.passphrase && cfg.passphrase.trim() !== '') {
      payload.signature = generateSignature(payload, cfg.passphrase);
    }

    // Set borrower status to PENDING
    borrower.collectionProfile = borrower.collectionProfile || {};
    borrower.collectionProfile.tokenStatus = 'PENDING';
    borrower.collectionProfile.authorizationStatus = 'PENDING';
    await borrower.save();

    console.log(`[PAYFAST_TOKENIZATION_INITIATED] Borrower ${borrower._id} card authorization initiated (PaymentId: ${mPaymentId})`);

    return {
      actionUrl: cfg.baseUrl,
      payload,
      mPaymentId,
      borrowerId: borrower._id,
      tokenStatus: 'PENDING'
    };
  }

  /**
   * Handle PayFast ITN notification for borrower card tokenization.
   * Stores ONLY the token reference. NEVER stores raw card details.
   */
  async handleTokenizationCallback(body = {}) {
    const tenantId = body.custom_str1;
    const borrowerId = body.custom_str3;
    const paymentStatus = body.payment_status;
    const token = body.token || body.token_id || body.subscription_id || body.pf_payment_id;

    if (!tenantId || !borrowerId) {
      console.warn('[PAYFAST_TOKENIZATION_CALLBACK] Missing tenantId or borrowerId in callback', {
        custom_str1: tenantId,
        custom_str3: borrowerId
      });
      return { success: false, reason: 'MISSING_CALLBACK_METADATA' };
    }

    return tenantContext.runWithTenant(tenantId, async () => {
      const borrower = await Borrower.findOne({ _id: borrowerId, tenantId });
      if (!borrower) {
        console.warn(`[PAYFAST_TOKENIZATION_CALLBACK] Borrower ${borrowerId} not found for tenant ${tenantId}`);
        return { success: false, reason: 'BORROWER_NOT_FOUND' };
      }

      borrower.collectionProfile = borrower.collectionProfile || {};

      if (paymentStatus === 'COMPLETE' && token) {
        borrower.collectionProfile.payfastTokenReference = String(token).trim();
        borrower.collectionProfile.tokenStatus = 'ACTIVE';
        borrower.collectionProfile.authorizationStatus = 'ACTIVE';
        borrower.collectionProfile.authorizedAt = new Date();
        await borrower.save();

        const maskedToken = `${token.substring(0, 4)}****${token.substring(Math.max(0, token.length - 4))}`;
        console.log(`[PAYFAST_TOKENIZATION_ACTIVE] Borrower ${borrower._id} card authorized successfully with token ${maskedToken}`);

        return {
          success: true,
          borrowerId: borrower._id,
          tokenStatus: 'ACTIVE',
          authorizedAt: borrower.collectionProfile.authorizedAt
        };
      } else {
        borrower.collectionProfile.tokenStatus = 'FAILED';
        borrower.collectionProfile.authorizationStatus = 'FAILED';
        await borrower.save();

        console.warn(`[PAYFAST_TOKENIZATION_FAILED] Borrower ${borrower._id} card authorization failed (Status: ${paymentStatus})`);

        return {
          success: false,
          borrowerId: borrower._id,
          tokenStatus: 'FAILED',
          reason: body.comment || `Tokenization returned status ${paymentStatus}`
        };
      }
    });
  }
}

module.exports = new PayFastTokenizationService();
