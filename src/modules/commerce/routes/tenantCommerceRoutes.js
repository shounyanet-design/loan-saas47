const express = require('express');
const router = express.Router();
const { protect } = require('../../../middlewares/authMiddleware');
const { authorize } = require('../../../middlewares/roleMiddleware');
const validateSubscription = require('../../../middlewares/validateSubscription');
const c = require('../controllers/tenantCommerceController');

// Tenant admin self-service commerce. Tenant context via `protect`.
// Commerce (marketplace, wallet, orders, invoices) must always be accessible
// so tenants can top up tokens and manage billing regardless of subscription state.
router.use(protect, authorize('admin'));

// Wallet
router.get('/wallet', c.getWallet);
router.get('/wallet/transactions', c.walletTransactions);

// Marketplace + checkout
router.get('/marketplace/products', c.listProducts);
router.post('/marketplace/checkout', c.checkout);
router.post('/marketplace/buy-tokens', c.buyTokens);

// History
router.get('/orders', c.myOrders);
router.get('/invoices', c.myInvoices);
router.get('/payments', c.myPayments);
router.get('/purchases', c.myPurchases);

module.exports = router;
