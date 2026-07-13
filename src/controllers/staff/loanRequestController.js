const mongoose = require('mongoose');
const LoanApplication = require('../../models/LoanApplication');
const LoanEmployment = require('../../models/LoanEmployment');
const LoanBanking = require('../../models/LoanBanking');
const LoanDocument = require('../../models/LoanDocument');
const Borrower = require('../../models/Borrower');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { getIO } = require('../../socket/socketServer');
const { createNotification } = require('../../utils/notificationHelper');
const { generateVerificationHash } = require('../../utils/verificationHashEngine');
const VerificationLog = require('../../models/VerificationLog');

/**
 * @desc    Get Staff Loan Request Stats Summary
 * @route   GET /api/staff/loan-requests/overview
 */
const getLoanRequestOverview = asyncHandler(async (req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const newRequests = await LoanApplication.countDocuments({ 
    status: { $in: ['New', 'Submitted'] } 
  });
  const pendingReviews = await LoanApplication.countDocuments({ 
    $or: [
      { status: { $in: ['Pending Review', 'Under Review', 'Pending'] } },
      { assignedReviewer: req.user._id }
    ]
  });
  const pendingDocVerification = await LoanApplication.countDocuments({ 
    $or: [
      { uploadedDocsStatus: 'Pending' },
      { status: 'Pending Verification' }
    ]
  });
  const reviewedToday = await LoanApplication.countDocuments({
    'staffReview.reviewedBy': req.user._id,
    'staffReview.verificationDate': { $gte: startOfToday, $lte: endOfToday }
  });

  sendSuccess(res, 'Overview loaded successfully', {
    newRequests,
    pendingReviews,
    pendingDocVerification,
    reviewedToday
  });
});

/**
 * @desc    Get Paginated & Filtered Loan Request Queue
 * @route   GET /api/staff/loan-requests
 */
const getLoanRequests = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = {};

  // Search filters: Borrower Name, Phone, Application ID
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    query.$or = [
      { fullName: searchRegex },
      { phoneNumber: searchRegex },
      { applicationId: searchRegex }
    ];
  }

  // Field-level filters
  if (req.query.status) {
    query.status = req.query.status;
  }
  if (req.query.loanType) {
    query.loanPurpose = req.query.loanType;
  }

  const total = await LoanApplication.countDocuments(query);
  const apps = await LoanApplication.find(query)
    .populate('borrowerId', 'profilePhoto')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const formatted = apps.map(app => ({
    _id: app._id,
    applicationId: app.applicationId,
    borrowerId: app.borrowerId?._id || null,
    borrowerName: app.fullName,
    borrowerPhone: app.phoneNumber,
    borrowerPhoto: app.borrowerId?.profilePhoto || 'no-photo.jpg',
    loanType: app.loanType || 'General',
    requestedAmount: app.requestedAmount,
    uploadedDocsStatus: app.uploadedDocsStatus || 'Pending',
    reviewStatus: app.reviewStatus === 'Pending' && app.staffReview?.recommendation && app.staffReview.recommendation !== 'Pending'
      ? (app.staffReview.recommendation.includes('Reject') ? 'Rejected Recommendation' : 'Recommendation Submitted')
      : app.reviewStatus,
    applicationStatus: app.status,        // kept for reference
    staffReview: app.staffReview?.verificationDate ? {
      recommendation: app.staffReview.recommendation,
      riskLevel: app.staffReview.riskLevel,
      verificationNotes: app.staffReview.verificationNotes,
      submittedAt: app.staffReview.verificationDate,
    } : null,
    submittedDate: app.createdAt,
    staffReviewLocked: app.staffReviewLocked || false,
    staffReviewCompleted: app.staffReviewCompleted || false,
    reviewSubmittedAt: app.reviewSubmittedAt || null,
    reviewStage: app.reviewStage || 'PENDING'
  }));

  sendSuccess(res, 'Queue fetched successfully', {
    data: formatted,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  });
});

/**
 * @desc    Get Full Details of Single Loan Application
 * @route   GET /api/staff/loan-requests/:id
 */
const getLoanRequestById = asyncHandler(async (req, res) => {
  const app = await LoanApplication.findById(req.params.id)
    .populate('borrowerId');

  if (!app) {
    return sendError(res, 'Loan application not found', 404);
  }

  let verificationHashValid = true;
  if (app.creditAssessment?.verificationHash) {
    const borrowerIdVal = app.borrowerId?._id || app.borrowerId;
    const borrower = await Borrower.findOne({
      $or: [
        { _id: borrowerIdVal },
        { userId: borrowerIdVal }
      ]
    });
    const calculatedHash = generateVerificationHash(app, borrower);
    if (calculatedHash !== app.creditAssessment.verificationHash) {
      verificationHashValid = false;

      // Invalidate existing credit/bureau assessment in DB
      app.creditAssessment = {
        verificationStatus: 'Pending',
        enquiryId: null,
        enquiryResultId: null,
        matchedConsumers: [],
        reportReference: null,
        reportDate: null,
        searchSuccess: false,
        responseCode: null,
        underwritingDecision: null,
        riskSeverity: null,
        eligibilityStatus: null,
        workflowRoute: null,
        completedAt: null,
        verificationHash: null
      };

      app.consumerCreditScore = null;
      app.consumerRiskCategory = null;
      app.consumerDebtSummary = {
        totalOutstandingDebt: null,
        totalMonthlyInstallment: null,
        totalArrearsAmount: null,
        totalAdverseAmount: null,
        judgementCount: 0,
        courtNoticeCount: 0,
        defaultListingCount: 0,
        highestMonthsInArrears: 0,
        activeAccountsCount: 0,
        propertyOwnershipCount: 0
      };
      app.fraudIndicators = {
        safpsListed: false,
        deceasedStatus: false,
        debtReviewStatus: false,
        homeAffairsVerified: false
      };
      app.affordabilityOutcome = {};
      app.underwritingDecision = null;
      app.workflowRoute = null;
      app.bureauRecommendation = null;
      app.bureauReportFetchedAt = null;

      app.consumerCreditReport = {
        verificationStatus: 'Pending',
        completedAt: null,
        reportReference: null,
        reportDate: null,
        enquiryId: null,
        enquiryResultId: null,
        scoring: {},
        debtSummary: {},
        fraudIndicators: {},
        underwriting: {
          level: null,
          riskCategory: null,
          reasons: []
        },
        consumerDetails: {},
        accountSummary: [],
        adverseInformation: {
          judgments: [],
          defaults: [],
          sequestration: [],
          adminOrders: [],
          rehabilitation: []
        },
        properties: [],
        directorships: [],
        addressHistory: [],
        contactHistory: [],
        emailHistory: [],
        employmentHistory: [],
        enquiryHistory: [],
        monthlyPaymentHistory: [],
        pdfReport: null,
        rawResponse: null,
        verificationHash: null
      };

      app.consumerCreditReportRaw = null;

      await app.save();

      // Write 'HASH_INVALIDATION' log
      try {
        await VerificationLog.create({
          borrowerId: borrower?._id || borrowerIdVal,
          applicationId: app._id,
          verificationType: 'HASH_INVALIDATION',
          status: 'SUCCESS',
          initiatedBy: req.user?._id || borrowerIdVal,
          requestPayload: {
            reason: 'Financial details or applicant data mismatch with bureau hash'
          }
        });
      } catch (logErr) {
        console.error('⚠️ [Audit Log Error]: Failed to write HASH_INVALIDATION log:', logErr.message);
      }
    }
  }

  const [employment, banking, docs] = await Promise.all([
    LoanEmployment.findOne({ loanApplicationId: app._id }),
    LoanBanking.findOne({ loanApplicationId: app._id }),
    LoanDocument.find({ loanApplicationId: app._id })
  ]);

  // Format deep breakdown response
  const result = {
    _id: app._id,
    applicationId: app.applicationId,
    status: app.status,
    uploadedDocsStatus: app.uploadedDocsStatus,
    documentVerification: app.documentVerification || {},
    
    staffReviewLocked: app.staffReviewLocked || false,
    staffReviewCompleted: app.staffReviewCompleted || false,
    reviewSubmittedAt: app.reviewSubmittedAt || null,
    reviewStage: app.reviewStage || 'PENDING',
    staffReview: app.staffReview?.verificationDate ? {
      recommendation: app.staffReview.recommendation,
      riskLevel: app.staffReview.riskLevel || 'N/A',
      verificationNotes: app.staffReview.verificationNotes,
      staffName: app.staffReview.staffName,
      submittedAt: app.staffReview.verificationDate
    } : null,

    borrower: {
      fullName: app.fullName || app.borrowerId?.fullName || 'N/A',
      email: app.emailAddress || app.borrowerId?.email || 'N/A',
      phone: app.phoneNumber || app.borrowerId?.phoneNumber || 'N/A',
      gender: app.borrowerId?.gender || 'N/A',
      dob: app.dateOfBirth || app.borrowerId?.dateOfBirth || null,
      address: app.residentialAddress || app.borrowerId?.physicalAddress || 'N/A',
      profilePhoto: app.borrowerId?.profilePhoto || 'no-photo.jpg'
    },

    employment: {
      employerName: employment?.employerName || 'N/A',
      occupation: employment?.occupation || 'N/A', 
      monthlyIncome: employment?.monthlyIncome || 0,
      yearsOfService: employment?.employmentDuration || 0
    },

    loanDetails: {
      loanType: app.loanType || 'General',
      requestedAmount: app.requestedAmount || banking?.requestedLoanAmount,
      loanDuration: app.requestedDuration || banking?.requestedDuration,
      estimatedEMI: app.estimatedMonthlyEMI || 0
    },

    affordability: {
      monthlyIncome: employment?.monthlyIncome || 0,
      monthlyExpenses: employment?.monthlyExpenses || 0,
      affordabilityStatus: 'High' 
    },

    documents: {
      idDocument: docs.find(d => ['ID Document', 'ID Front'].includes(d.documentType))?.fileUrl || null,
      payslip: docs.find(d => d.documentType === 'Payslip')?.fileUrl || null,
      bankStatement: docs.find(d => d.documentType === 'Bank Statement')?.fileUrl || null,
      proofOfAddress: docs.find(d => d.documentType === 'Proof Of Address')?.fileUrl || null
    },

    staffNotes: {
      reviewNotes: app.staffReview?.verificationNotes || '',
      verificationNotes: app.staffReview?.verificationNotes || ''
    },
    creditAssessment: app.creditAssessment,
    consumerCreditScore: app.consumerCreditScore,
    consumerRiskCategory: app.consumerRiskCategory,
    consumerDebtSummary: app.consumerDebtSummary,
    fraudIndicators: app.fraudIndicators,
    affordabilityOutcome: app.affordabilityOutcome,
    underwritingDecision: app.underwritingDecision,
    workflowRoute: app.workflowRoute,
    consumerCreditReportRaw: app.consumerCreditReportRaw,
    consumerCreditReport: app.consumerCreditReport,
    consumerSearchExecuted: !!(app.creditAssessment?.enquiryResultId),
    creditReportFetched: !!(app.consumerCreditReport?.verificationStatus === 'Verified'),
    previousVerificationLoaded: !!(app.creditAssessment?.enquiryResultId || app.consumerCreditReport?.verificationStatus === 'Verified'),
    verificationLastRunAt: app.consumerCreditReport?.completedAt || app.creditAssessment?.completedAt || null,
    verificationHashValid: verificationHashValid
  };

  sendSuccess(res, 'Application details hydrated', result);
});

/**
 * @desc    Verify granular uploaded documents
 * @route   PUT /api/staff/loan-requests/:id/verify-documents
 */
const verifyDocuments = asyncHandler(async (req, res) => {
  const { documentType, verificationStatus, verificationNotes } = req.body;

  if (!documentType || !verificationStatus) {
    return sendError(res, 'Document type and verification status are required', 400);
  }

  const app = await LoanApplication.findById(req.params.id);
  if (!app) {
    return sendError(res, 'Application not found', 404);
  }

  // Prevent changing document verification on locked reviews
  const isLocked = app.staffReviewLocked || 
    ['Approved', 'APPROVED', 'Active', 'ACTIVE', 'Ready for Disbursement', 'READY_FOR_DISBURSEMENT', 'Agreement Signed', 'AGREEMENT_SIGNED', 'OTP_VERIFIED', 'OTP Verified', 'Reviewed', 'AGREEMENT_PENDING_VERIFICATION'].includes(app.status);
  if (isLocked) {
    return sendError(res, 'This review has already been finalized and locked', 400);
  }

  // Initialize document container if missing
  if (!app.documentVerification) {
    app.documentVerification = {
      idProofStatus: 'Pending',
      payslipStatus: 'Pending',
      bankStatementStatus: 'Pending',
      proofOfAddressStatus: 'Pending'
    };
  }

  // Map standard readable types to internal fields
  const typeMap = {
    'ID Document': 'idProof',
    'Payslip': 'payslip',
    'Bank Statement': 'bankStatement',
    'Proof of Address': 'proofOfAddress'
  };

  const mappedPrefix = typeMap[documentType];
  if (!mappedPrefix) {
    return sendError(res, 'Unsupported document type', 400);
  }

  // Set individual fields
  app.documentVerification[`${mappedPrefix}Status`] = verificationStatus;
  if (verificationNotes !== undefined) {
    app.documentVerification[`${mappedPrefix}Notes`] = verificationNotes;
  }

  // Automatically push application workflow state to "Pending Verification"
  if (app.status === 'New') {
    app.status = 'Pending Verification';
  }

  // Calculate aggregated upload status
  const v = app.documentVerification;
  const allApproved = 
    v.idProofStatus === 'Approved' && 
    v.payslipStatus === 'Approved' && 
    v.bankStatementStatus === 'Approved' && 
    v.proofOfAddressStatus === 'Approved';

  if (allApproved) {
    app.uploadedDocsStatus = 'Complete';
  } else {
    app.uploadedDocsStatus = 'Pending';
  }

  await app.save();

  // Emit realtime broadcasts
  try {
    const io = getIO();
    io.emit('loan-request:updated', { applicationId: app.applicationId, status: app.status });
    io.emit('document:verified', { applicationId: app.applicationId, type: documentType, status: verificationStatus });
    io.emit('dashboard:updated', { trigger: 'verification' });
  } catch (err) {}

  sendSuccess(res, 'Document assessment committed successfully', app);
});

/**
 * @desc    Submit Staff credit review and recommendations
 * @route   PUT /api/staff/loan-requests/:id/review
 */
const submitReview = asyncHandler(async (req, res) => {
  const { recommendation, reviewNotes } = req.body;

  if (!recommendation) {
    return sendError(res, 'Recommendation selection is mandatory', 400);
  }

  const app = await LoanApplication.findById(req.params.id);
  if (!app) {
    return sendError(res, 'Application not found', 404);
  }

  // Prevent duplicate submissions on locked reviews
  const isLocked = app.staffReviewLocked || 
    ['Approved', 'APPROVED', 'Active', 'ACTIVE', 'Ready for Disbursement', 'READY_FOR_DISBURSEMENT', 'Agreement Signed', 'AGREEMENT_SIGNED', 'OTP_VERIFIED', 'OTP Verified', 'Reviewed', 'AGREEMENT_PENDING_VERIFICATION'].includes(app.status);
  if (isLocked) {
    return sendError(res, 'This review has already been finalized and locked', 400);
  }

  // --- Dynamic Centralized Rules Validation on Approval Recommendation ---
  if (recommendation === 'Recommend Approval' || recommendation === 'Approved') {
    const { validateDBApplication } = require('../../utils/loanValidationEngine');
    const validationResult = await validateDBApplication(app._id);
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        validationErrors: validationResult.errors
      });
    }
  }

  // Apply Staff review payloads
  app.staffReview = {
    reviewedBy: req.user._id,
    staffName: req.user.fullName,
    verificationNotes: reviewNotes || '',
    recommendation: recommendation,
    verificationDate: new Date()
  };

  // Update application status to Reviewed
  app.status = 'Reviewed';
  
  // Set explicit review status for tracking
  if (recommendation.includes('Recommend') || recommendation === 'Recommended') {
    app.reviewStatus = 'Recommendation Submitted';
  } else if (recommendation === 'Rejected' || recommendation.includes('Rejection')) {
    app.reviewStatus = 'Rejected Recommendation';
  } else {
    app.reviewStatus = 'Reviewed';
  }

  // Lock review permanently
  app.staffReviewLocked = true;
  app.staffReviewCompleted = true;
  app.reviewSubmittedAt = new Date();
  app.reviewStage = 'FINALIZED';
  
  await app.save();

  // Create Global Admin Notifications
  try {
    await createNotification({
      title: 'Loan Application Reviewed',
      message: `Staff member ${req.user.fullName} submitted an assessment for application ${app.applicationId}. Status recommendation: ${recommendation}`,
      notificationType: 'Loan Application Recommendation',
      priority: 'Normal',
      borrowerId: app.borrowerId
    });
  } catch (notifErr) {}

  // Emit Socket messages
  try {
    const io = getIO();
    io.emit('review:submitted', { applicationId: app.applicationId, recommendation });
    io.emit('loan-request:updated', { applicationId: app.applicationId, status: 'Reviewed' });
    io.emit('dashboard:updated', { trigger: 'review_submission' });
  } catch (err) {}

  sendSuccess(res, 'Staff credit assessment submitted', app);
});

/**
 * @desc    Fetch historical review queue processed by Logged-In Staff
 * @route   GET /api/staff/loan-requests/review-history
 */
const getReviewHistory = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = {
    'staffReview.reviewedBy': req.user._id,
    status: 'Reviewed'
  };

  const total = await LoanApplication.countDocuments(query);
  const apps = await LoanApplication.find(query)
    .populate('borrowerId')
    .sort({ 'staffReview.verificationDate': -1 })
    .skip(skip)
    .limit(limit);

  const formatted = apps.map(app => ({
    _id: app._id,
    applicationId: app.applicationId,
    borrowerName: app.fullName,
    loanType: app.loanPurpose || 'General',
    requestedAmount: app.requestedAmount,
    recommendation: app.staffReview?.recommendation,
    processedDate: app.staffReview?.verificationDate
  }));

  sendSuccess(res, 'Review history hydrated', {
    data: formatted,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  });
});

module.exports = {
  getLoanRequestOverview,
  getLoanRequests,
  getLoanRequestById,
  verifyDocuments,
  submitReview,
  getReviewHistory
};
