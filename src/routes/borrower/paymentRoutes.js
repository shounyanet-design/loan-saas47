const express = require('express');
const router = express.Router();
const { submitPayment } = require('../../controllers/borrower/paymentController');
const { protect } = require('../../middlewares/authMiddleware');
const { tenantMiddleware } = require('../../middlewares/tenantMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const upload = require('../../middlewares/uploadMiddleware');

router.use(protect);
router.use(tenantMiddleware);
router.use(authorize('borrower'));

router.post('/submit', upload.single('receipt'), tenantMiddleware, submitPayment);

module.exports = router;
