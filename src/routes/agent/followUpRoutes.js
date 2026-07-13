const express = require('express');
const router = express.Router();
const { createFollowUp, getFollowUpHistory } = require('../../controllers/agent/followUpController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');

router.use(protect);
router.use(authorize('agent'));

router.post('/', createFollowUp);
router.get('/:loanId', getFollowUpHistory);

module.exports = router;
