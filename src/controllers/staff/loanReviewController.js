const mongoose = require('mongoose');
const LoanApplication = require('../../models/LoanApplication');
const LoanEmployment = require('../../models/LoanEmployment');
const LoanBanking = require('../../models/LoanBanking');
const LoanDocument = require('../../models/LoanDocument');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { getIO } = require('../../socket/socketServer');
const { createNotification } = require('../../utils/notificationHelper');

/**
 * @desc    Get Loan Review Overview Counts
 * @route   GET /api/staff/loan-review/overview
 */
const getLoanReviewOverview = asyncHandler(async (req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  // 1. Applications assigned for staff review
  const applicationsUnderReview = await LoanApplication.countDocuments({
    reviewStatus: 'Pending Review',
    status: { $in: ['Pending Review', 'New', 'Pending Verification'] }
  });

  // 2. Already recommended to admin
  const recommendationsSubmitted = await LoanApplication.countDocuments({
    reviewStatus: 'Recommendation Submitted'
  });

  // 3. Waiting for admin final decision
  const pendingDecisions = await LoanApplication.countDocuments({
    status: 'Reviewed'
  });

  // 4. Reviews completed today by current staff session
  const reviewsCompletedToday = await LoanApplication.countDocuments({
    reviewStatus: { $in: ['Recommendation Submitted', 'Rejected Recommendation'] },
    updatedAt: { $gte: startOfToday, $lte: endOfToday }
  });

  sendSuccess(res, 'Review metrics loaded successfully', {
    applicationsUnderReview,
    recommendationsSubmitted,
    pendingDecisions,
    reviewsCompletedToday
  });
});

/**
 * @desc    Get All Loan Reviews (Paginated & Filtered)
 * @route   GET /api/staff/loan-review
 */
const getLoanReviews = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = {};

  // Standard Search: Name, Phone, Application ID
  if (req.query.search) {
    const regex = new RegExp(req.query.search, 'i');
    query.$or = [
      { fullName: regex },
      { phoneNumber: regex },
      { applicationId: regex }
    ];
  }

  // Filters
  if (req.query.reviewStatus) {
    query.reviewStatus = req.query.reviewStatus;
  }
  if (req.query.loanType) {
    query.loanPurpose = req.query.loanType;
  }

  const total = await LoanApplication.countDocuments(query);
  const apps = await LoanApplication.find(query)
    .populate('borrowerId', 'profilePhoto')
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit);

  const formatted = apps.map(app => ({
    applicationId: app.applicationId,
    _id: app._id,
    borrowerId: app.borrowerId?._id || null,
    borrowerName: app.fullName,
    borrowerPhone: app.phoneNumber,
    borrowerPhoto: app.borrowerId?.profilePhoto || app.borrowerPhoto || 'no-photo.jpg',
    loanType: app.loanType || 'General',
    requestedAmount: app.requestedAmount,
    affordabilityStatus: (app.staffReview?.riskLevel && app.staffReview.riskLevel !== 'N/A') ? app.staffReview.riskLevel : 'Pending',
    reviewStatus: app.reviewStatus === 'Pending' && app.staffReview?.recommendation && app.staffReview.recommendation !== 'Pending'
      ? (app.staffReview.recommendation.includes('Reject') ? 'Rejected Recommendation' : 'Recommendation Submitted')
      : app.reviewStatus,
    applicationStatus: app.status,
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

  sendSuccess(res, 'Loan reviews fetched successfully', {
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
 * @desc    Get Deep Single Review Details
 * @route   GET /api/staff/loan-review/:id
 */
const getLoanReviewById = asyncHandler(async (req, res) => {
  const app = await LoanApplication.findById(req.params.id).populate('borrowerId');
  if (!app) {
    return sendError(res, 'Loan review dossier not found', 404);
  }

  const [employment, banking, docs] = await Promise.all([
    LoanEmployment.findOne({ loanApplicationId: app._id }),
    LoanBanking.findOne({ loanApplicationId: app._id }),
    LoanDocument.find({ loanApplicationId: app._id })
  ]);

  const responseData = {
    _id: app._id,
    applicationId: app.applicationId,
    status: app.status,
    reviewStatus: app.reviewStatus,
    staffReviewLocked: app.staffReviewLocked || false,
    staffReviewCompleted: app.staffReviewCompleted || false,
    reviewSubmittedAt: app.reviewSubmittedAt || null,
    reviewStage: app.reviewStage || 'PENDING',
    
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
      estimatedEMI: app.estimatedMonthlyEMI || 0,
      affordabilityStatus: app.status === 'Approved' ? 'High' : 'Pending'
    },

    documents: {
      idDocument: docs.find(d => ['ID Document', 'ID Front'].includes(d.documentType))?.fileUrl || null,
      payslip: docs.find(d => d.documentType === 'Payslip')?.fileUrl || null,
      bankStatement: docs.find(d => d.documentType === 'Bank Statement')?.fileUrl || null,
      proofOfAddress: docs.find(d => d.documentType === 'Proof Of Address')?.fileUrl || null
    },
    notes: {
      internalReviewNotes: app.internalReviewNotes || '',
      recommendationNotes: app.recommendationNotes || '',
      adminComments: app.adminDecision?.adminNotes || app.adminComments || ''
    },

    // Full staff review submission — used by Review Summary modal
    staffReview: app.staffReview?.verificationDate ? {
      recommendation: app.staffReview.recommendation,
      riskLevel: app.staffReview.riskLevel,
      verificationNotes: app.staffReview.verificationNotes,
      staffName: app.staffReview.staffName,
      submittedAt: app.staffReview.verificationDate,
    } : null,

    // Per-document verification findings
    documentVerification: {
      idProof:       { status: app.documentVerification?.idProofStatus       || 'Pending', notes: app.documentVerification?.idProofNotes       || '' },
      payslip:       { status: app.documentVerification?.payslipStatus       || 'Pending', notes: app.documentVerification?.payslipNotes       || '' },
      bankStatement: { status: app.documentVerification?.bankStatementStatus || 'Pending', notes: app.documentVerification?.bankStatementNotes || '' },
      proofOfAddress:{ status: app.documentVerification?.proofOfAddressStatus|| 'Pending', notes: app.documentVerification?.proofOfAddressNotes|| '' },
    },

    // Admin final decision for showing outcome to staff
    adminDecision: {
      decision:   app.adminDecision?.decision   || 'Pending',
      adminNotes: app.adminDecision?.adminNotes || '',
      decidedAt:  app.adminDecision?.approvedDate || app.adminDecision?.rejectedDate || app.adminDecision?.holdDate || null,
    },
    applicationStatus: app.status,
  };

  sendSuccess(res, 'Review details loaded', responseData);
});

/**
 * @desc    Recommend Approval to Admin
 * @route   PUT /api/staff/loan-review/:id/recommend-approval
 */
const recommendApproval = asyncHandler(async (req, res) => {
  const { recommendationNotes, riskLevel, verificationNotes } = req.body;
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

  // State transition
  app.reviewStatus = 'Recommendation Submitted';
  app.status = 'Reviewed';
  app.recommendationNotes = recommendationNotes || verificationNotes || '';

  // Full staff audit stamp with risk + verification details
  app.staffReview = {
    reviewedBy: req.user._id,
    staffName: req.user.fullName,
    recommendation: 'RECOMMENDED_APPROVAL',
    riskLevel: riskLevel || 'Low',
    verificationNotes: verificationNotes || recommendationNotes || '',
    verificationDate: new Date()
  };

  // Lock review permanently
  app.staffReviewLocked = true;
  app.staffReviewCompleted = true;
  app.reviewSubmittedAt = new Date();
  app.reviewStage = 'FINALIZED';

  await app.save();

  // Admin notification (existing pattern preserved)
  try {
    await createNotification({
      title: 'Loan Review Completed — Approval Recommended',
      message: `${req.user.fullName} reviewed Application ${app.applicationId} and recommends APPROVAL. Risk: ${riskLevel || 'Low'}.`,
      notificationType: 'Approval Alert',
      receiverRole: 'admin',
      priority: 'High',
      borrowerId: app.borrowerId
    });
  } catch (err) {}

  // Borrower notification — customer-safe message only
  try {
    await createNotification({
      receiverId: app.borrowerId,
      receiverRole: 'borrower',
      senderId: req.user._id,
      senderRole: 'staff',
      type: 'ReviewCompleted',
      title: 'Application Review Completed',
      message: 'Your loan application has been reviewed by our team. A final decision will be communicated to you shortly.',
      priority: 'High',
      loanApplicationId: app._id
    });
  } catch (err) {}

  // Socket events — keep existing + add new targeted events
  try {
    const io = getIO();
    io.emit('recommendation:submitted', { applicationId: app.applicationId, status: 'Recommendation Submitted' });
    io.emit('review:updated', { applicationId: app.applicationId, trigger: 'recommended' });
    io.emit('dashboard:update', { trigger: 'review_process' });
    // New targeted events
    io.emit('review-submitted', { applicationId: app.applicationId, recommendation: 'Recommended', reviewerName: req.user.fullName });
    io.emit('admin-review-alert', { applicationId: app.applicationId, recommendation: 'Recommended', reviewerName: req.user.fullName, riskLevel: riskLevel || 'Low' });
    io.to(app.borrowerId.toString()).emit('borrower-review-status-updated', { applicationId: app.applicationId, status: 'Review Completed' });
  } catch (ioErr) {}

  sendSuccess(res, 'Approval recommendation logged to workflow', app);
});

/**
 * @desc    Recommend Rejection to Admin
 * @route   PUT /api/staff/loan-review/:id/recommend-rejection
 */
const recommendRejection = asyncHandler(async (req, res) => {
  const { rejectionReason, notes, riskLevel, verificationNotes } = req.body;
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

  // State transition
  app.reviewStatus = 'Rejected Recommendation';
  app.status = 'Reviewed';
  app.rejectionReason = rejectionReason || 'General Affordability Issue';
  app.recommendationNotes = notes || verificationNotes || '';

  // Full staff audit stamp with risk + verification details
  app.staffReview = {
    reviewedBy: req.user._id,
    staffName: req.user.fullName,
    recommendation: 'RECOMMENDED_REJECTION',
    riskLevel: riskLevel || 'High',
    verificationNotes: verificationNotes || notes || '',
    verificationDate: new Date()
  };

  // Lock review permanently
  app.staffReviewLocked = true;
  app.staffReviewCompleted = true;
  app.reviewSubmittedAt = new Date();
  app.reviewStage = 'FINALIZED';

  await app.save();

  // Admin notification (existing pattern preserved)
  try {
    await createNotification({
      title: 'Loan Review Completed — Rejection Recommended',
      message: `${req.user.fullName} reviewed Application ${app.applicationId} and recommends REJECTION. Reason: ${rejectionReason || 'N/A'}. Risk: ${riskLevel || 'High'}.`,
      notificationType: 'System Alert',
      receiverRole: 'admin',
      priority: 'High',
      borrowerId: app.borrowerId
    });
  } catch (err) {}

  // Borrower notification — customer-safe, no internal recommendation details
  try {
    await createNotification({
      receiverId: app.borrowerId,
      receiverRole: 'borrower',
      senderId: req.user._id,
      senderRole: 'staff',
      type: 'ReviewCompleted',
      title: 'Application Review Completed',
      message: 'Your loan application has been reviewed by our team. We will be in touch with the outcome shortly.',
      priority: 'High',
      loanApplicationId: app._id
    });
  } catch (err) {}

  // Socket events — keep existing + add new targeted events
  try {
    const io = getIO();
    io.emit('recommendation:rejected', { applicationId: app.applicationId, reason: rejectionReason });
    io.emit('review:updated', { applicationId: app.applicationId, trigger: 'rejected_rec' });
    io.emit('dashboard:update', { trigger: 'review_process' });
    // New targeted events
    io.emit('review-submitted', { applicationId: app.applicationId, recommendation: 'Rejected', reviewerName: req.user.fullName });
    io.emit('admin-review-alert', { applicationId: app.applicationId, recommendation: 'Rejected', reviewerName: req.user.fullName, riskLevel: riskLevel || 'High' });
    io.to(app.borrowerId.toString()).emit('borrower-review-status-updated', { applicationId: app.applicationId, status: 'Review Completed' });
  } catch (ioErr) {}

  sendSuccess(res, 'Rejection recommendation submitted successfully', app);
});

/**
 * @desc    Request additional/updated documents
 * @route   PUT /api/staff/loan-review/:id/request-documents
 */
const requestDocuments = asyncHandler(async (req, res) => {
  const { documentType, message } = req.body;
  if (!documentType) {
    return sendError(res, 'Specific document type target is required', 400);
  }

  const app = await LoanApplication.findById(req.params.id);
  if (!app) {
    return sendError(res, 'Application not found', 404);
  }

  // Prevent requesting documents on locked reviews
  const isLocked = app.staffReviewLocked || 
    ['Approved', 'APPROVED', 'Active', 'ACTIVE', 'Ready for Disbursement', 'READY_FOR_DISBURSEMENT', 'Agreement Signed', 'AGREEMENT_SIGNED', 'OTP_VERIFIED', 'OTP Verified', 'Reviewed', 'AGREEMENT_PENDING_VERIFICATION'].includes(app.status);
  if (isLocked) {
    return sendError(res, 'This review has already been finalized and locked', 400);
  }

  // Map standard document identifier to nested schema trackers
  const typeMap = {
    'ID Document': 'idProof',
    'Payslip': 'payslip',
    'Bank Statement': 'bankStatement',
    'Proof of Address': 'proofOfAddress'
  };

  const mappedKey = typeMap[documentType];
  if (mappedKey && app.documentVerification) {
    app.documentVerification[`${mappedKey}Status`] = 'Reupload Requested';
    app.documentVerification[`${mappedKey}Notes`] = message || 'Requires updated file.';
  }

  app.uploadedDocsStatus = 'Missing';
  app.status = 'Pending Verification'; // Push back into verification phase
  app.reviewStatus = 'Pending Review'; 
  app.internalReviewNotes = (app.internalReviewNotes || '') + `\n[System Request]: Staff requested ${documentType}. Message: ${message}`;

  await app.save();

  // Create Real-Time notification for the BORROWER
  try {
    await createNotification({
      title: 'Action Required: Document Re-upload',
      message: `We encountered an issue with your ${documentType}. Staff message: "${message}". Please re-upload promptly to continue.`,
      notificationType: 'Shield Alert',
      priority: 'Critical',
      borrowerId: app.borrowerId,
      receiverRole: 'borrower'
    });
  } catch (err) {}

  // Socket Broadcast
  try {
    const io = getIO();
    io.emit('documents:requested', { applicationId: app.applicationId, doc: documentType });
    io.emit('review:updated', { applicationId: app.applicationId, trigger: 'docs_requested' });
  } catch (ioErr) {}

  sendSuccess(res, 'Document request dispatch committed successfully', app);
});

/**
 * @desc    Review History API
 * @route   GET /api/staff/loan-review/history
 */
const getReviewHistory = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = {
    reviewStatus: { $in: ['Recommendation Submitted', 'Rejected Recommendation'] }
  };

  const total = await LoanApplication.countDocuments(query);
  const apps = await LoanApplication.find(query)
    .populate('borrowerId')
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit);

  const formatted = apps.map(app => ({
    applicationId: app.applicationId,
    _id: app._id,
    borrowerName: app.fullName,
    loanType: app.loanPurpose || 'General',
    requestedAmount: app.requestedAmount,
    reviewStatus: app.reviewStatus,
    recommendationDate: app.updatedAt
  }));

  sendSuccess(res, 'History database retrieved', {
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
  getLoanReviewOverview,
  getLoanReviews,
  getLoanReviewById,
  recommendApproval,
  recommendRejection,
  requestDocuments,
  getReviewHistory
};
