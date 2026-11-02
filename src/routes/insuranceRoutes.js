const express = require('express');
const router = express.Router();
const insuranceController = require('../controllers/insuranceController');

// Real-time API-driven calculation engine endpoint (Open to authenticated borrower/staff/admin flows)
router.post('/quote', (req, res) => insuranceController.getLiveQuote(req, res));

// Health / Rules check
router.get('/rules', (req, res) => insuranceController.getRules(req, res));

// Compliance FAIS Due Diligence Questionnaire
router.post('/due-diligence', (req, res) => insuranceController.submitDueDiligence(req, res));

// Lifecycle Policy Activation
router.post('/activate/:applicationId', (req, res) => insuranceController.activatePolicy(req, res));

// Lifecycle Policy Cancellation
router.post('/cancel/:applicationId', (req, res) => insuranceController.cancelPolicy(req, res));

module.exports = router;

