const express = require('express');
const router = express.Router();
const { getDashboardData } = require('../../controllers/staff/dashboardController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

// All routes are protected and restricted to staff
router.use(protect);
router.use(authorize('staff'));

router.get('/', getDashboardData);

module.exports = router;
