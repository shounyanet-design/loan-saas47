const express = require('express');
const router = express.Router();
const { 
  createBorrower, 
  getAllBorrowers, 
  getBorrowerById, 
  updateBorrower, 
  freezeBorrower, 
  blacklistBorrower, 
  deleteBorrower 
} = require('../controllers/borrowerController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const { enforceLimit } = require('../modules/saas/services/limitService');

// All routes are protected and for admin/staff
router.use(protect);
router.use(authorize('admin', 'staff'));

router.get('/', getAllBorrowers);
// enforceLimit blocks creation once the tenant's plan "Max Borrowers" is reached
// (no-op for grandfathered/unlimited plans).
router.post('/create', enforceLimit('borrowers'), upload.single('profilePhoto'), createBorrower);
router.get('/:id', getBorrowerById);
router.put('/:id', upload.single('profilePhoto'), updateBorrower);
router.patch('/:id/freeze', freezeBorrower);
router.patch('/:id/blacklist', blacklistBorrower);
router.delete('/:id', deleteBorrower);

module.exports = router;
