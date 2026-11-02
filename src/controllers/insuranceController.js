const groupsRUsService = require('../services/groupsRUsInsuranceService');
const LoanApplication = require('../models/LoanApplication');
const SystemSettings = require('../models/SystemSettings');

class InsuranceController {
  /**
   * Real-time API-driven calculation endpoint
   * POST /api/insurance/quote
   */
  async getLiveQuote(req, res) {
    try {
      const {
        loanAmount,
        durationMonths,
        repaymentCycle,
        selectVoluntaryLife,
        funeralPlanId,
        borrower,
        beneficiary
      } = req.body;

      const quote = await groupsRUsService.calculateQuote({
        loanAmount: Number(loanAmount || 0),
        durationMonths: Number(durationMonths || 12),
        repaymentCycle: repaymentCycle || 'Monthly',
        selectVoluntaryLife: Boolean(selectVoluntaryLife),
        funeralPlanId: funeralPlanId || 'gold',
        borrower: borrower || {},
        beneficiary: beneficiary || {}
      });

      return res.status(200).json({
        success: true,
        message: 'Live insurance quote calculated successfully',
        data: quote
      });
    } catch (error) {
      console.error('[InsuranceController] getLiveQuote error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to calculate insurance quote',
        error: error.message
      });
    }
  }

  /**
   * Health and Branch authorization check
   * GET /api/insurance/rules
   */
  async getRules(req, res) {
    try {
      const { branchCode } = req.query;
      const rules = await groupsRUsService.getRules(branchCode);
      return res.status(200).json({
        success: true,
        data: rules
      });
    } catch (error) {
      console.error('[InsuranceController] getRules error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to query broker rules',
        error: error.message
      });
    }
  }

  /**
   * Submit FAIS Due Diligence compliance responses
   * POST /api/insurance/due-diligence
   */
  async submitDueDiligence(req, res) {
    try {
      const { applicationId, clientIdNumber, dueResponsesData, isDPIP, dpipCategory, sourceOfWealth, riskRating, isFPPO } = req.body;

      const result = await groupsRUsService.uploadDueDiligence({
        clientIdNumber,
        dueResponsesData,
        isDPIP,
        dpipCategory,
        sourceOfWealth,
        riskRating,
        isFPPO
      });

      if (applicationId) {
        await LoanApplication.findByIdAndUpdate(applicationId, {
          $set: {
            'insurance.dueDiligenceCompleted': true,
            'insurance.ratingQuestions': dueResponsesData
          }
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Due diligence uploaded successfully',
        data: result
      });
    } catch (error) {
      console.error('[InsuranceController] submitDueDiligence error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload due diligence',
        error: error.message
      });
    }
  }

  /**
   * Activate Policy upon Loan Disbursement
   * POST /api/insurance/activate/:applicationId
   */
  async activatePolicy(req, res) {
    try {
      const { applicationId } = req.params;
      const application = await LoanApplication.findById(applicationId);

      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Loan application not found'
        });
      }

      const clientIdNumber = application.personal?.idNumber || application.borrowerId?.idNumber || '8501015009087';
      const loanRefNumber = application.applicationId || application.loanId || application._id.toString();
      const hasVoluntaryLife = Boolean(application.insurance?.isFuneralBenefitIncluded);

      const activation = await groupsRUsService.activatePolicy({
        clientIdNumber,
        loanRefNumber,
        hasVoluntaryLife
      });

      if (activation && activation.policyNumber) {
        application.insurance = application.insurance || {};
        application.insurance.policyNumber = activation.policyNumber;
        application.insurance.certificatePdfUrl = activation.docUrl;
        application.insurance.policyStatus = 'ACTIVE';
        application.insurance.activatedAt = new Date();
        await application.save();
      }

      return res.status(200).json({
        success: true,
        message: 'Insurance policy successfully bound and activated',
        data: activation
      });
    } catch (error) {
      console.error('[InsuranceController] activatePolicy error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to activate insurance policy',
        error: error.message
      });
    }
  }

  /**
   * Cancel Policy upon loan decline or cancellation
   * POST /api/insurance/cancel/:applicationId
   */
  async cancelPolicy(req, res) {
    try {
      const { applicationId } = req.params;
      const application = await LoanApplication.findById(applicationId);

      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Loan application not found'
        });
      }

      const clientIdNumber = application.personal?.idNumber || '8501015009087';
      const policyRefNumber = application.insurance?.policyNumber || application.applicationId;

      const cancellation = await groupsRUsService.cancelPolicy({
        clientIdNumber,
        policyRefNumber
      });

      application.insurance = application.insurance || {};
      application.insurance.policyStatus = 'CANCELLED';
      application.insurance.cancelledAt = new Date();
      await application.save();

      return res.status(200).json({
        success: true,
        message: 'Insurance policy successfully voided',
        data: cancellation
      });
    } catch (error) {
      console.error('[InsuranceController] cancelPolicy error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to cancel insurance policy',
        error: error.message
      });
    }
  }
}

module.exports = new InsuranceController();

