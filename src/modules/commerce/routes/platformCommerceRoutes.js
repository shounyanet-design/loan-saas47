const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middlewares/superAdminMiddleware');
const c = require('../controllers/platformCommerceController');

// Mounted INSIDE the platform router (already authed as SUPER_ADMIN, SYSTEM mode).

// Token pricing
router.get('/pricing', requirePermission('MANAGE_API_PRICING'), c.listPricing);
router.put('/pricing/:service', requirePermission('MANAGE_API_PRICING'), c.upsertPricing);

// Marketplace catalog
router.get('/marketplace/categories', requirePermission('MANAGE_MARKETPLACE'), c.listCategories);
router.post('/marketplace/categories', requirePermission('MANAGE_MARKETPLACE'), c.createCategory);
router.get('/marketplace/products', requirePermission('MANAGE_MARKETPLACE'), c.listProducts);
router.post('/marketplace/products', requirePermission('MANAGE_MARKETPLACE'), c.createProduct);
router.put('/marketplace/products/:id', requirePermission('MANAGE_MARKETPLACE'), c.updateProduct);
router.delete('/marketplace/products/:id', requirePermission('MANAGE_MARKETPLACE'), c.deleteProduct);
router.get('/marketplace/coupons', requirePermission('MANAGE_MARKETPLACE'), c.listCoupons);
router.post('/marketplace/coupons', requirePermission('MANAGE_MARKETPLACE'), c.createCoupon);

// Wallet
router.get('/wallets', requirePermission('MANAGE_WALLET'), c.walletOverview);
router.get('/wallets/:tenantId', requirePermission('MANAGE_WALLET'), c.getTenantWallet);
router.post('/wallets/:tenantId/adjust', requirePermission('MANAGE_WALLET'), c.adjustWallet);

// Orders / invoices / payments
router.get('/orders', requirePermission('MANAGE_BILLING'), c.listOrders);
router.get('/invoices', requirePermission('MANAGE_BILLING'), c.listInvoices);
router.get('/payments', requirePermission('MANAGE_BILLING'), c.listPayments);
router.post('/payments/:paymentId/confirm', requirePermission('MANAGE_BILLING'), c.confirmPayment);

// Revenue / commerce analytics (distinct path from the M2.1 platform /analytics).
router.get('/revenue', requirePermission('VIEW_ANALYTICS'), c.analytics);

module.exports = router;
