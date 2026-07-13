const express = require('express');
const router = express.Router();
const { submitPayment } = require('../../controllers/borrower/paymentController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const upload = require('../../middlewares/uploadMiddleware');

router.use(protect);
router.use(authorize('borrower'));

router.post('/submit', upload.single('receipt'), submitPayment);

module.exports = router;
