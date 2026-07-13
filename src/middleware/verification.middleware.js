/**
 * Verification Pre-flight Middleware
 * Ensures borrower consent is captured and necessary payloads are present before initiating Datanamix checks.
 */

const LoanApplication = require('../models/LoanApplication');

/**
 * Middleware ensuring explicit borrower consent has been recorded
 */
const requireConsent = async (req, res, next) => {
  const { applicationId } = req.body;

  if (!applicationId) {
    return res.status(400).json({
      success: false,
      message: 'Validation Failure: applicationId is required to check consent credentials.'
    });
  }

  try {
    const application = await LoanApplication.findById(applicationId);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Resource Failure: Target LoanApplication record not found.'
      });
    }

    // Verify explicit bureau credit consent has been logged
    if (!application.creditConsentAccepted) {
      return res.status(400).json({
        success: false,
        message: 'Compliance Failure: Borrower must grant credit check consent before requesting a bureau lookup.'
      });
    }

    req.loanApplication = application;
    next();
  } catch (error) {
    console.error('❌ [Consent Verification Middleware Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal Error: Could not check consent records.'
    });
  }
};

/**
 * Middleware validating that required personal profile fields are populated before contacting Datanamix IDV/Phone/AHV endpoints
 */
const validateProfileData = (requiredFields = []) => {
  return (req, res, next) => {
    const data = req.body;
    const missing = [];

    requiredFields.forEach(field => {
      if (!data[field]) {
        missing.push(field);
      }
    });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Validation Failure: Missing fields required for API verification: ${missing.join(', ')}`
      });
    }

    next();
  };
};

module.exports = {
  requireConsent,
  validateProfileData
};
