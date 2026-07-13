const express = require('express');
const router = express.Router();
const {
  createAgent,
  getAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
  getAgentClients,
  updateAgentCommission,
  suspendAgent,
  activateAgent,
  deactivateAgent,
} = require('../../controllers/admin/agentController');
const { protect } = require('../../middlewares/authMiddleware');
const { authorize } = require('../../middlewares/roleMiddleware');
const upload = require('../../middlewares/uploadMiddleware');

// All routes are protected and admin-only
router.use(protect);
router.use(authorize('admin'));

router.post('/create', upload.single('profilePhoto'), createAgent);
router.get('/', getAgents);
router.get('/:id', getAgentById);
router.put('/:id', upload.single('profilePhoto'), updateAgent);
router.delete('/:id', deleteAgent);

// Dynamic Actions
router.get('/:id/clients', getAgentClients);
router.put('/:id/commission', updateAgentCommission);
router.put('/:id/suspend', suspendAgent);
router.put('/:id/activate', activateAgent);
router.put('/:id/deactivate', deactivateAgent);

module.exports = router;
