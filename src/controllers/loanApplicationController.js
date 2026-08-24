const asyncHandler = require('express-async-handler');
const LoanApplication = require('../models/LoanApplication');
const ActiveLoan = require('../models/ActiveLoan');
const Notification = require('../models/Notification');
const Borrower = require('../models/Borrower');
const User = require('../models/User');
const RepaymentSchedule = require('../models/RepaymentSchedule');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { createNotification } = require('../utils/notificationHelper');
const BorrowerAlert = require('../models/BorrowerAlert');
const LoanActivity = require('../models/LoanActivity');
const { generateVerificationHash } = require('../utils/verificationHashEngine');
const VerificationLog = require('../models/VerificationLog');

/**
 * @desc    Get all loan applications with pagination, search, and filters
 * @route   GET /api/admin/loan-applications
 * @access  Private/Admin
 */
const getAllApplications = asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 10, 
    search = '', 
    status, 
    staffReviewer, 
    amlStatus,
    minAmount, 
    maxAmount,
    startDate,
    endDate
  } = req.query;

  console.log('--- GET ALL APPLICATIONS ---');
  console.log('req.query:', req.query);

  const query = {};

  // Search by borrower name, application ID, email, phone
  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { applicationId: { $regex: search, $options: 'i' } },
      { emailAddress: { $regex: search, $options: 'i' } },
      { phoneNumber: { $regex: search, $options: 'i' } },
    ];
  }

  // Filter by status
  if (status) {
    if (status === 'New') {
      query.status = { $in: ['New', 'Submitted'] };
    } else if (status === 'Under Review') {
      query.status = { $in: ['Under Review', 'Pending Review', 'Reviewed'] };
    } else if (status === 'Approved') {
      query.status = { $in: ['Approved', 'APPROVED', 'ACTIVE', 'READY_FOR_DISBURSEMENT', 'Ready for Disbursement', 'Disbursed'] };
    } else {
      query.status = status;
    }
  }

  // Filter by staff reviewer
  if (staffReviewer) {
    query['staffReview.staffName'] = { $regex: staffReviewer, $options: 'i' };
  }

  if (amlStatus === 'AML_CLEARED') {
    query['amlVerification.verificationStatus'] = 'CLEARED';
  } else if (amlStatus === 'MANUAL_REVIEW') {
    query['amlVerification.verificationStatus'] = 'MANUAL_REVIEW';
  } else if (amlStatus === 'BLOCKED') {
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { 'amlVerification.verificationStatus': { $in: ['AUTO_REJECT', 'HIGH_RISK'] } },
          { 'amlVerification.complianceDecision': 'AUTO_REJECT' },
          { 'amlVerification.isBlocked': true }
        ]
      }
    ];
  }

  // Filter by requested amount range
  if (minAmount || maxAmount) {
    query.requestedAmount = {};
    if (minAmount) query.requestedAmount.$gte = Number(minAmount);
    if (maxAmount) query.requestedAmount.$lte = Number(maxAmount);
  }

  // Filter by date range
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  console.log('Mongoose Query built:', JSON.stringify(query, null, 2));

  const skip = (page - 1) * limit;

  const applications = await LoanApplication.find(query)
    .populate('assignedReviewer', 'fullName email role')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await LoanApplication.countDocuments(query);

  // Batch-fetch borrower profiles so each row has a photo (avoids N+1 queries)
  const borrowerUserIds = applications.map(a => a.borrowerId).filter(Boolean);
  const borrowerProfiles = await Borrower.find({ userId: { $in: borrowerUserIds } })
    .select('userId fullName profilePhoto borrowerCode')
    .lean();
  const borrowerMap = {};
  borrowerProfiles.forEach(b => {
    if (b.userId) borrowerMap[b.userId.toString()] = b;
  });

  // Batch-fetch active loans for these applications
  const activeLoans = await ActiveLoan.find({
    loanApplicationId: { $in: applications.map(a => a._id) },
    isDeleted: false
  }).select('loanApplicationId').lean();
  const activeLoanIds = new Set(activeLoans.map(al => al.loanApplicationId.toString()));

  const responseData = applications.map(app => {
    const bp = borrowerMap[app.borrowerId?.toString()];
    const photoUrl = bp?.profilePhoto && bp.profilePhoto !== 'no-photo.jpg' ? bp.profilePhoto : null;
    return {
      _id: app._id,
      applicationId: app.applicationId,
      borrowerName: app.fullName,
      borrower: {
        fullName: app.fullName,
        profilePhoto: photoUrl ? { url: photoUrl } : null,
        borrowerId: bp?.borrowerCode || null,
      },
      requestedAmount: app.requestedAmount,
      requestedDuration: app.requestedDuration,
      loanDuration: app.requestedDuration,
      interestRate: app.interestRate,
      estimatedEMI: app.estimatedMonthlyEMI,
      // Prefer assignedReviewer (set at assignment time) over staffReview.staffName (set after review submission)
      staffReviewer: app.assignedReviewer
        ? { fullName: app.assignedReviewer.fullName, _id: app.assignedReviewer._id }
        : (app.staffReview?.staffName ? { fullName: app.staffReview.staffName } : null),
      assignedAt: app.assignedAt || null,
      status: app.status,
      amlVerification: app.amlVerification,
      hasActiveLoan: activeLoanIds.has(app._id.toString()),
      reviewStatus: app.reviewStatus === 'Pending' && app.staffReview?.recommendation && app.staffReview.recommendation !== 'Pending'
        ? (app.staffReview.recommendation.includes('Reject') ? 'Rejected Recommendation' : 'Recommendation Submitted')
        : app.reviewStatus,
      submittedDate: app.createdAt,
      // Full staff review details for admin visibility
      staffReview: app.staffReview?.verificationDate ? {
        recommendation: app.staffReview.recommendation,
        riskLevel: app.staffReview.riskLevel,
        staffName: app.staffReview.staffName,
        verificationDate: app.staffReview.verificationDate,
        verificationNotes: app.staffReview.verificationNotes,
      } : null,
    };
  });

  sendSuccess(res, 'Loan applications fetched successfully', {
    applications: responseData,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    }
  });
});

/**
 * @desc    Get loan application stats (counts by status)
 * @route   GET /api/admin/loan-applications/stats
 * @access  Private/Admin
 */
const getApplicationStats = asyncHandler(async (req, res) => {
  const stats = await LoanApplication.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const total = await LoanApplication.countDocuments();
  const [amlCleared, amlManualReview, amlBlocked] = await Promise.all([
    LoanApplication.countDocuments({ 'amlVerification.verificationStatus': 'CLEARED' }),
    LoanApplication.countDocuments({ 'amlVerification.verificationStatus': 'MANUAL_REVIEW' }),
    LoanApplication.countDocuments({
      $or: [
        { 'amlVerification.verificationStatus': { $in: ['AUTO_REJECT', 'HIGH_RISK'] } },
        { 'amlVerification.complianceDecision': 'AUTO_REJECT' },
        { 'amlVerification.isBlocked': true }
      ]
    })
  ]);

  const formattedStats = {
    All: total,
    New: 0,
    'Under Review': 0,
    Recommended: 0,
    Hold: 0,
    Approved: 0,
    Rejected: 0,
    amlCleared,
    amlManualReview,
    amlBlocked
  };

  stats.forEach(stat => {
    const status = stat._id;
    const count = stat.count;

    if (['New', 'Submitted'].includes(status)) {
      formattedStats.New += count;
    } else if (['Under Review', 'Pending Review', 'Reviewed'].includes(status)) {
      formattedStats['Under Review'] += count;
    } else if (['Approved', 'APPROVED', 'ACTIVE', 'READY_FOR_DISBURSEMENT', 'Ready for Disbursement', 'Disbursed'].includes(status)) {
      formattedStats.Approved += count;
    } else if (formattedStats[status] !== undefined) {
      formattedStats[status] += count;
    }
  });

  sendSuccess(res, 'Loan application stats fetched successfully', formattedStats);
});

const LoanEmployment = require('../models/LoanEmployment');
const LoanBanking = require('../models/LoanBanking');
const LoanDocument = require('../models/LoanDocument');

/**
 * @desc    Get single application details
 * @route   GET /api/admin/loan-applications/:id
 * @access  Private/Admin
 */
const getApplicationDetails = asyncHandler(async (req, res) => {
  // Load as a live Mongoose document (not .lean()) so we can mutate + save if hash mismatch
  const appDoc = await LoanApplication.findById(req.params.id);

  if (!appDoc) {
    return sendError(res, 'Loan application not found', 404);
  }

  // ── Verification Hash Guard ─────────────────────────────────────────────
  let verificationHashValid = true;
  if (appDoc.creditAssessment?.verificationHash) {
    const borrowerIdVal = appDoc.borrowerId;
    const borrowerDoc = await Borrower.findOne({
      $or: [{ _id: borrowerIdVal }, { userId: borrowerIdVal }]
    });
    const calculatedHash = generateVerificationHash(appDoc, borrowerDoc);
    if (calculatedHash !== appDoc.creditAssessment.verificationHash) {
      verificationHashValid = false;
      console.warn(`⚠️ [Verification Hash Mismatch] Application ${appDoc.applicationId || appDoc._id}: Stored hash does not match calculated hash. Flagging verificationHashValid=false without mutating stored records.`);
    }
  }

  // Use plain object from here for response construction
  const application = appDoc.toObject();

  // Fetch related data
  const employment = await LoanEmployment.findOne({ loanApplicationId: application._id }).lean();
  const banking = await LoanBanking.findOne({ loanApplicationId: application._id }).lean();
  const documents = await LoanDocument.find({ loanApplicationId: application._id }).lean();

  // Format documents array into an object for the frontend
  const formattedDocs = {};
  if (documents) {
    documents.forEach(doc => {
      const key = doc.documentType === 'ID Document' ? 'idProof' :
                  doc.documentType === 'Payslip' ? 'payslip' :
                  doc.documentType === 'Bank Statement' ? 'bankStatement' :
                  doc.documentType === 'Proof Of Address' ? 'addressProof' : null;
      if (key) {
        formattedDocs[key] = { url: doc.fileUrl, fileName: doc.fileName };
      }
    });
  }

  // Fetch borrower profile for photo and code
  const borrowerProfile = await Borrower.findOne({ userId: application.borrowerId })
    .select('fullName profilePhoto borrowerCode')
    .lean();

  const photoUrl = borrowerProfile?.profilePhoto && borrowerProfile.profilePhoto !== 'no-photo.jpg'
    ? borrowerProfile.profilePhoto
    : null;

  const activeLoanExists = await ActiveLoan.exists({ loanApplicationId: application._id, isDeleted: false });

  const realpayEnv = String(process.env.REALPAY_ENVIRONMENT || '').toUpperCase();
  const realpaySimEnabled = String(process.env.REALPAY_SIMULATION_ENABLED || '').toLowerCase() === 'true';
  const hasGenuineContractSeq = Boolean(
    application.realPayMandate?.contractSequence &&
    !String(application.realPayMandate.contractSequence).startsWith('RPM-') &&
    !String(application.realPayMandate.contractSequence).includes('LOCAL')
  );
  const realPaySimulationAvailable = realpayEnv === 'UAT' && realpaySimEnabled && hasGenuineContractSeq;

  const hasGenuineInstalmentSeq = Boolean(
    (application.realPayMandate?.instalmentSequence || application.realPaySimulation?.instalment?.instalmentSequence) &&
    String(application.realPayMandate?.instalmentSequence || application.realPaySimulation?.instalment?.instalmentSequence).trim() !== ''
  );
  const isMandateSimCompleted = Boolean(
    application.realPaySimulation?.mandate?.result === 'ACCEPTED' || application.realPayMandate?.status === 'ACCEPTED'
  );
  const instalmentSimulationAvailable = realPaySimulationAvailable && isMandateSimCompleted && hasGenuineInstalmentSeq;

  // Combine data and fix field name mismatches for frontend
  const fullApplication = {
    ...employment,
    ...banking,
    ...application, // Spread application last to preserve its _id, createdAt, etc.
    realPaySimulationAvailable,
    instalmentSimulationAvailable,
    yearsOfService: employment?.employmentDuration,
    accountHolder: banking?.accountHolderName,
    documents: formattedDocs,
    hasActiveLoan: !!activeLoanExists,
    borrower: {
      fullName: application.fullName,
      profilePhoto: photoUrl ? { url: photoUrl } : null,
      borrowerId: borrowerProfile?.borrowerCode || null,
    },
    reviewStatus: application.reviewStatus === 'Pending' && application.staffReview?.recommendation && application.staffReview.recommendation !== 'Pending'
      ? (application.staffReview.recommendation.includes('Reject') ? 'Rejected Recommendation' : 'Recommendation Submitted')
      : application.reviewStatus,
    consumerSearchExecuted: !!(application.creditAssessment?.enquiryResultId),
    creditReportFetched: !!(application.consumerCreditReport?.verificationStatus === 'Verified'),
    previousVerificationLoaded: !!(application.creditAssessment?.enquiryResultId || application.consumerCreditReport?.verificationStatus === 'Verified'),
    verificationLastRunAt: application.consumerCreditReport?.completedAt || application.creditAssessment?.completedAt || null,
    verificationHashValid
  };

  sendSuccess(res, 'Loan application details fetched successfully', fullApplication);
});

/**
 * @desc    Approve loan application and create active loan
 * @route   PUT /api/admin/loan-applications/:id/approve
 * @access  Private/Admin
 */
const approveApplication = asyncHandler(async (req, res) => {
  const { 
    adminNotes, 
    approvedAmount, 
    finalDuration, 
    interestOverride 
  } = req.body;

  let application = await LoanApplication.findById(req.params.id);

  if (!application) {
    return sendError(res, 'Loan application not found', 404);
  }

  // Compliance Guard: requirePdfBeforeApproval check
  const SystemSettings = require('../models/SystemSettings');
  const BureauReportArchive = require('../models/bureauReportArchive.model');
  const settings = (await SystemSettings.findOne()) || {};
  
  if (settings.requirePdfBeforeApproval) {
    const archiveExists = await BureauReportArchive.findOne({ applicationId: application._id });
    if (!archiveExists) {
      return sendError(res, 'Compliance Block: A verified credit bureau PDF report must be generated and archived in ImageKit compliance vault before this application can be approved.', 400);
    }
  }

  if (application.status === 'Approved') {
    // Check if active loan actually exists. If not, allow proceeding to fix partial state.
    const ActiveLoan = require('../models/ActiveLoan');
    const existingActive = await ActiveLoan.findOne({ loanApplicationId: application._id });
    if (existingActive) {
      return sendError(res, 'Application is already approved and active loan exists', 400);
    }
  }

  if (application.status === 'Rejected') {
    return sendError(res, 'Rejected applications cannot be approved', 400);
  }

  // --- Dynamic Centralized Rules Validation on Approval ---
  const { validateDBApplication } = require('../utils/loanValidationEngine');
  const validationResult = await validateDBApplication(application._id, {
    requestedLoanAmount: approvedAmount,
    requestedDuration: finalDuration
  });
  if (!validationResult.isValid) {
    return res.status(400).json({
      success: false,
      validationErrors: validationResult.errors
    });
  }

  // Business Rule: Must be reviewed/recommended by staff first
  if (application.status === 'Submitted') {
    return sendError(res, 'Please assign a reviewer and wait for staff recommendation before taking final decision', 400);
  }

  const mongoose = require('mongoose');
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Re-fetch inside session for consistency
    application = await LoanApplication.findById(req.params.id).session(session);

    if (!application) {
      await session.abortTransaction();
      session.endSession();
      return sendError(res, 'Loan application not found', 404);
    }

    // Update application status to AGREEMENT_PENDING_VERIFICATION
    application.status = 'AGREEMENT_PENDING_VERIFICATION';
    application.reviewStatus = 'Approved'; // Ensure it leaves the review queue
    application.staffReviewLocked = true;
    application.staffReviewCompleted = true;
    application.reviewLockedAt = new Date();

    const finalApprovedAmount = Number(approvedAmount || application.approvedAmount || application.requestedAmount);
    const finalApprovedDuration = Number(finalDuration || application.adminDecision?.finalDuration || application.requestedDuration);
    const finalInterestRate = (interestOverride !== undefined && interestOverride !== null && interestOverride !== '') 
      ? Number(interestOverride) 
      : Number(application.interestRate || 12.5);

    // Dynamic Authoritative Recalculation on Approval
    const settings = await SystemSettings.findOne().session(session);
    const activeProducts = settings?.loanProducts || [];
    const selectedProduct = activeProducts.find(p => p.name === application.loanType);

    const { calculateLoanFinances } = require('../services/loanFinancialCalculator');
    const approvedFinances = calculateLoanFinances({
      amount: finalApprovedAmount,
      duration: finalApprovedDuration,
      interestRate: finalInterestRate,
      interestType: selectedProduct?.interestType || application.financialSnapshot?.interestType || 'Reducing Balance',
      settings,
      selectedProduct
    });

    application.approvedAmount = finalApprovedAmount;
    application.requestedDuration = finalApprovedDuration;
    application.interestRate = approvedFinances.annualInterestRate;
    application.processingFee = approvedFinances.initiationFeeAmount;
    application.estimatedMonthlyEMI = approvedFinances.monthlyInstallmentAmount;
    application.totalRepayment = approvedFinances.totalRepaymentAmount;
    application.financialSnapshot = approvedFinances;
    application.agreementFinancialSnapshot = approvedFinances;

    application.adminDecision = {
      decision: 'Approved',
      adminNotes,
      approvedAmount: finalApprovedAmount,
      finalDuration: finalApprovedDuration,
      interestOverride: finalInterestRate,
      approvedBy: req.user._id,
      approvedDate: new Date(),
    };

    application.agreementGenerated = true;
    application.agreementGeneratedAt = new Date();
    application.agreementStatus = 'PENDING SIGNATURE';
    application.otpVerificationStatus = 'Pending';
    application.agreementDocumentUrl = `/api/agreement/document/${application._id}`;
    application.borrowerConsentVerified = false;

    application.statusHistory.push({
      status: 'AGREEMENT_PENDING_VERIFICATION',
      changedBy: req.user.fullName || req.user.name || 'Admin',
      notes: adminNotes || 'Loan application approved by admin. Digital agreement pending signature.',
    });

    await application.save({ session });

    // --- COMMIT TRANSACTION ---
    await session.commitTransaction();
    session.endSession();

    // Trigger OTP sending and notification
    try {
      const agreementSigningService = require('../modules/agreementSigning/services/agreementSigning.service');
      await agreementSigningService.sendAgreementOTP(application._id, req.user);

      const borrower = await Borrower.findById(application.borrowerId);
      if (borrower) {
        await createNotification({
          title: 'Digital Signature Consent Pending',
          message: `Your loan application ${application.applicationId} has been approved by admin. Please review and sign the agreement via secure OTP.`,
          notificationType: 'System Alert',
          priority: 'Important',
          receiverId: borrower._id,
          receiverRole: 'borrower',
          applicationId: application._id
        });

        // Create BorrowerAlert
        await BorrowerAlert.create({
          borrowerId: borrower._id,
          title: 'Agreement Signature Pending',
          message: `Your loan application of R ${application.requestedAmount} requires digital agreement signature. Secure OTP email has been sent.`,
          alertType: 'LOAN_APPROVED',
          priority: 'High'
        });

        // Socket notification for borrower
        const { getIO } = require('../socket/socketServer'); 
        const io = getIO();
        if (io && borrower.userId) {
          const borrowerUserId = borrower.userId.toString();
          io.to(borrowerUserId).emit('loan-updated', { 
            status: 'AGREEMENT_PENDING_VERIFICATION',
            message: 'Your loan agreement requires signature'
          });
          io.to(borrowerUserId).emit('dashboard-updated');
          io.to(borrowerUserId).emit('notification-created');
        }
      }
    } catch (notifErr) {
      console.error('Failed to trigger agreement OTP generation or notifications:', notifErr.message);
    }

    sendSuccess(res, 'Loan application approved. Secure OTP dispatched and agreement signature is pending.', { application });

  } catch (error) {
    // --- ROLLBACK TRANSACTION ---
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    console.error('CRITICAL APPROVAL ERROR:', error);
    return sendError(res, 'Approval failed: ' + error.message, 500);
  }
});

/**
 * @desc    Reject loan application
 * @route   PUT /api/admin/loan-applications/:id/reject
 * @access  Private/Admin
 */
const rejectApplication = asyncHandler(async (req, res) => {
  const { rejectionReason } = req.body;

  const application = await LoanApplication.findById(req.params.id);

  if (!application) {
    return sendError(res, 'Loan application not found', 404);
  }

  // Business Rule: Must be reviewed/recommended by staff first
  if (application.status === 'Submitted') {
    return sendError(res, 'Please assign a reviewer and wait for staff recommendation before taking final decision', 400);
  }

  application.status = 'Rejected';
  application.reviewStatus = 'Rejected';
  application.staffReviewLocked = true;
  application.staffReviewCompleted = true;
  application.reviewLockedAt = new Date();
  application.adminDecision = {
    decision: 'Rejected',
    rejectionReason,
    rejectedBy: req.user._id,
    rejectedDate: new Date(),
  };

  application.statusHistory.push({
    status: 'Rejected',
    changedBy: req.user.name || 'Admin',
    notes: rejectionReason || 'Loan application rejected by admin',
  });

  await application.save();

  // Notify Borrower & Create Admin Realtime Log
  const borrower = await Borrower.findById(application.borrowerId);
  if (borrower) {
    try {
      await createNotification({
        title: 'Approval Alert',
        message: `Loan application ${application.applicationId} has been REJECTED. Reason: ${rejectionReason || 'Policy mismatch'}`,
        notificationType: 'Approval Alert',
        priority: 'Important',
        receiverId: borrower._id,
        receiverRole: 'borrower',
        applicationId: application._id
      });

      // Create BorrowerAlert
      await BorrowerAlert.create({
        borrowerId: borrower._id,
        title: 'Application Rejected',
        message: `Your loan application ${application.applicationId} was rejected. Reason: ${rejectionReason || 'N/A'}`,
        alertType: 'REJECTION',
        priority: 'High'
      });

      // Socket notification
      const { getIO } = require('../socket/socketServer'); 
      const io = getIO();
      if (io && borrower.userId) {
        io.to(borrower.userId.toString()).emit('dashboard-updated');
        io.to(borrower.userId.toString()).emit('notification-created');
      }
    } catch (err) {}
  }

  sendSuccess(res, 'Loan application rejected', application);
});

/**
 * @desc    Put loan application on hold
 * @route   PUT /api/admin/loan-applications/:id/hold
 * @access  Private/Admin
 */
const holdApplication = asyncHandler(async (req, res) => {
  const { holdReason } = req.body;

  const application = await LoanApplication.findById(req.params.id);

  if (!application) {
    return sendError(res, 'Loan application not found', 404);
  }

  // Business Rule: Must be reviewed/recommended by staff first
  if (application.status === 'Submitted') {
    return sendError(res, 'Please assign a reviewer and wait for staff recommendation before taking final decision', 400);
  }

  application.status = 'Hold';
  application.reviewStatus = 'Hold';
  application.adminDecision = {
    decision: 'Hold',
    holdReason,
    holdBy: req.user._id,
    holdDate: new Date(),
  };

  application.statusHistory.push({
    status: 'Hold',
    changedBy: req.user.name || 'Admin',
    notes: holdReason || 'Loan application put on hold by admin',
  });

  await application.save();

  // Notify Borrower & Create Admin Realtime Log
  const borrower = await Borrower.findById(application.borrowerId);
  if (borrower) {
    try {
      await createNotification({
        title: 'Application Alert',
        message: `Loan application ${application.applicationId} has been placed ON HOLD.`,
        notificationType: 'System Alert',
        priority: 'Normal',
        receiverId: borrower._id,
        receiverRole: 'borrower',
        applicationId: application._id
      });

      // Create BorrowerAlert
      await BorrowerAlert.create({
        borrowerId: borrower._id,
        title: 'Application On Hold',
        message: `Your loan application ${application.applicationId} is currently on hold. Reason: ${holdReason || 'Review pending'}`,
        alertType: 'SYSTEM_ALERT',
        priority: 'Medium'
      });

      // Socket notification
      const { getIO } = require('../socket/socketServer'); 
      const io = getIO();
      if (io && borrower.userId) {
        io.to(borrower.userId.toString()).emit('dashboard-updated');
        io.to(borrower.userId.toString()).emit('notification-created');
      }
    } catch (err) {}
  }

  sendSuccess(res, 'Loan application put on hold', application);
});

/**
 * @desc    Update staff review / recommendation
 * @route   PUT /api/admin/loan-applications/:id/review
 * @access  Private/Admin
 */
const updateStaffReview = asyncHandler(async (req, res) => {
  const { 
    verificationNotes, 
    recommendation, 
    riskLevel 
  } = req.body;

  const application = await LoanApplication.findById(req.params.id);

  if (!application) {
    return sendError(res, 'Loan application not found', 404);
  }

  application.staffReview = {
    reviewedBy: req.user._id,
    staffName: req.user.name || 'Admin',
    verificationNotes,
    recommendation,
    riskLevel,
    verificationDate: new Date(),
  };

  // If staff recommends, update status to Recommended
  if (recommendation === 'Recommended') {
    application.status = 'Recommended';
  } else if (recommendation === 'Rejected') {
    application.status = 'Rejected';
  } else {
    application.status = 'Under Review';
  }

  application.statusHistory.push({
    status: application.status,
    changedBy: req.user.name || 'Admin',
    notes: `Staff review: ${recommendation}. ${verificationNotes || ''}`,
  });

  await application.save();

  sendSuccess(res, 'Staff review updated successfully', application);
});

/**
 * @desc    Assign staff reviewer to loan application
 * @route   POST /api/admin/loan-applications/assign-reviewer
 * @access  Private (Admin)
 */
const assignReviewer = asyncHandler(async (req, res) => {
  const { applicationId, staffId, notes } = req.body;

  if (!applicationId || !staffId) {
    return sendError(res, 'Application ID and Staff ID are required', 400);
  }

  // 1. Validations
  const application = await LoanApplication.findById(applicationId);
  if (!application) return sendError(res, 'Application Not Found', 404);

  if (['Approved', 'Rejected', 'Disbursed'].includes(application.status)) {
    return sendError(res, 'Application Already Closed', 400);
  }

  // Prevent duplicate assignment — block if reviewer already assigned
  if (application.assignedReviewer) {
    const existingStaff = await User.findById(application.assignedReviewer).select('fullName');
    return sendError(
      res,
      `Application already assigned to ${existingStaff?.fullName || 'a staff member'}. Cannot reassign without admin clearance.`,
      400
    );
  }

  const staffUser = await User.findById(staffId);
  if (!staffUser || staffUser.role !== 'staff') {
    return sendError(res, 'Invalid Staff Role', 400);
  }

  // 2. Atomic Update using Transaction
  const mongoose = require('mongoose');
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const LoanReview = require('../models/LoanReview');
    const LoanStatusHistory = require('../models/LoanStatusHistory');
    const Conversation = require('../models/Conversation');
    const { createNotification } = require('../utils/notificationHelper');

    // A. Update Application
    application.status = 'Under Review';
    application.assignedReviewer = staffId;
    application.assignedAt = new Date();
    application.assignedBy = req.user._id;
    
    // Reset staff review locks to allow new review inputs
    application.staffReviewLocked = false;
    application.staffReviewCompleted = false;
    application.reviewStage = 'REOPENED';
    
    await application.save({ session });

    // B. Create/Update LoanReview Task
    await LoanReview.findOneAndUpdate(
      { loanApplicationId: application._id },
      { 
        reviewerId: staffId,
        reviewerRole: 'staff',
        status: 'Pending',
        notes: notes || 'Assigned by Admin'
      },
      { upsert: true, session }
    );

    // C. Status History
    await LoanStatusHistory.create([{
      loanApplicationId: application._id,
      status: 'Under Review',
      notes: notes || `Reviewer assigned: ${staffUser.fullName}`,
      changedBy: req.user._id
    }], { session });

    // D. Notifications
    await createNotification({
      receiverId: staffId,
      receiverRole: 'staff',
      senderId: req.user._id,
      senderRole: 'admin',
      type: 'loan_review_assignment',
      title: 'New Loan Review Assigned',
      message: `A new application ${application.applicationId} requires your review.`,
      relatedId: application._id,
      relatedModel: 'LoanApplication',
      priority: 'important'
    });

    await createNotification({
      receiverId: application.borrowerId,
      receiverRole: 'borrower',
      senderId: req.user._id,
      senderRole: 'admin',
      type: 'application_under_review',
      title: 'Application Under Review',
      message: `Your loan application ${application.applicationId} is now under review.`,
      relatedId: application._id,
      relatedModel: 'LoanApplication'
    });

    // E. Each party gets their own direct 1:1 conversation with the borrower.
    // Do NOT add staff to the borrower-admin thread — that would create a group chat
    // and cause startConversation to return the wrong conversation for each party.

    await session.commitTransaction();
    session.endSession();

    // F. Socket Events (Post-Commit)
    const { getIO } = require('../socket/socketServer');
    const io = getIO();
    if (io) {
      io.emit('admin:loanAssigned', { applicationId: application._id, staffName: staffUser.fullName });
      io.to(staffId.toString()).emit('staff:newReviewTask', { applicationId: application._id });
      io.to(staffId.toString()).emit('review:assigned', { applicationId: application._id });
      io.to(application.borrowerId.toString()).emit('borrower:statusUpdated', { status: 'Under Review' });
      io.to(application.borrowerId.toString()).emit('dashboard:updated');
    }

    sendSuccess(res, 'Reviewer assigned successfully', { application });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});

const deleteApplication = asyncHandler(async (req, res) => {
  const application = await LoanApplication.findById(req.params.id);

  if (!application) {
    return sendError(res, 'Loan application not found', 404);
  }

  // Business Rule: Don't allow deleting applications if there is an active running loan
  const activeLoan = await ActiveLoan.findOne({ loanApplicationId: application._id, isDeleted: false });
  if (activeLoan) {
    return sendError(
      res,
      'This application has an associated active loan in running state. Please close and delete the active loan first.',
      400
    );
  }

  const mongoose = require('mongoose');
  const LoanEmployment = require('../models/LoanEmployment');
  const LoanBanking = require('../models/LoanBanking');
  const LoanDocument = require('../models/LoanDocument');
  const LoanReview = require('../models/LoanReview');
  const LoanStatusHistory = require('../models/LoanStatusHistory');
  const Notification = require('../models/Notification');
  const Conversation = require('../models/Conversation');
  const Message = require('../models/Message');

  let session = null;
  let useTransaction = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    useTransaction = true;
  } catch (_) {
    session = null;
    useTransaction = false;
  }

  try {
    const opts = useTransaction && session ? { session } : {};

    // 1. Cascade delete employment details
    await LoanEmployment.deleteMany({ loanApplicationId: application._id }, opts);

    // 2. Cascade delete banking details
    await LoanBanking.deleteMany({ loanApplicationId: application._id }, opts);

    // 3. Cascade delete documents
    await LoanDocument.deleteMany({ loanApplicationId: application._id }, opts);

    // 4. Cascade delete reviews
    await LoanReview.deleteMany({ loanApplicationId: application._id }, opts);

    // 5. Cascade delete status history
    await LoanStatusHistory.deleteMany({ loanApplicationId: application._id }, opts);

    // 6. Cascade delete notifications
    await Notification.deleteMany({ 
      $or: [
        { loanApplicationId: application._id },
        { relatedId: application._id }
      ]
    }, opts);

    // 7. Cascade delete conversations and messages
    const conversations = useTransaction && session
      ? await Conversation.find({ applicationId: application._id }).session(session)
      : await Conversation.find({ applicationId: application._id });

    const convIds = conversations.map(c => c._id);
    if (convIds.length > 0) {
      await Message.deleteMany({ conversationId: { $in: convIds } }, opts);
      await Conversation.deleteMany({ _id: { $in: convIds } }, opts);
    }

    // 8. Delete the application itself
    if (useTransaction && session) {
      await application.deleteOne({ session });
      await session.commitTransaction();
      session.endSession();
    } else {
      await LoanApplication.deleteOne({ _id: application._id });
    }

    // Emit real-time update to refresh dashboards
    try {
      const { getIO } = require('../socket/socketServer');
      const io = getIO();
      if (io) {
        io.emit('application:deleted', { applicationId: application._id });
        io.emit('dashboard:updated', { trigger: 'application_deletion' });
      }
    } catch (ioErr) {}

    return sendSuccess(res, 'Loan application and all linked records permanently deleted');
  } catch (err) {
    if (useTransaction && session) {
      try {
        if (session.inTransaction()) await session.abortTransaction();
        session.endSession();
      } catch (_) {}
    }
    console.error('Application deletion cascade error:', err);
    return sendError(res, 'Deletion failed: ' + err.message, 500);
  }
});

/**
 * @desc    Create loan application on behalf of borrower (Admin & Staff)
 * @route   POST /api/admin/loan-applications/create-on-behalf
 * @access  Private (Admin/Staff)
 */
const createApplicationOnBehalf = asyncHandler(async (req, res) => {
  const {
    draftApplicationId,
    borrowerId,
    personal,
    employment,
    banking,
    documents,
    confirmationAccepted,
    creditConsentAccepted,
    creditConsentAcceptedAt,
  } = req.body;

  if (!borrowerId) return sendError(res, 'Borrower ID is required', 400);
  if (!confirmationAccepted) return sendError(res, 'Please accept confirmation', 400);
  if (!creditConsentAccepted) return sendError(res, 'Credit check consent is required', 400);

  if (!personal || !employment || !banking) {
    return sendError(res, 'Missing required information blocks', 400);
  }

  // Retrieve existing draft application created during wizard verification steps
  let draft = null;
  if (draftApplicationId) {
    draft = await LoanApplication.findById(draftApplicationId);
  }
  if (!draft && borrowerId && personal.idNumber) {
    draft = await LoanApplication.findOne({
      borrowerId: borrowerId,
      idNumber: personal.idNumber,
      status: { $in: ['Draft', 'Pending Review', 'New', 'Submitted'] }
    }).sort({ createdAt: -1 });
  }

  // --- Dynamic Centralized Rules Validation ---
  const { getValidationRules } = require('../services/validationRules.service');
  const { validateLoanApplicationData } = require('../utils/loanValidationEngine');

  const rules = await getValidationRules();
  const validationResult = validateLoanApplicationData({
    dob: personal.dateOfBirth || personal.dob,
    monthlyIncome: employment.monthlyIncome,
    employmentDuration: employment.employmentDuration,
    requestedLoanAmount: banking.requestedLoanAmount,
    requestedDuration: banking.requestedDuration,
    employmentStatus: employment.employmentStatus,
    documents: documents || []
  }, rules);

  if (!validationResult.isValid) {
    return res.status(400).json({
      success: false,
      validationErrors: validationResult.errors
    });
  }

  // Unique ID Check — exclude the current draft being finalized as well as closed/settled/disbursed loans
  const duplicateQuery = { 
    idNumber: personal.idNumber, 
    status: { $nin: ['Rejected', 'Draft', 'Pending Review', 'Settled', 'Closed', 'COMPLETED', 'Disbursed', 'DISBURSED', 'SETTLED'] } 
  };
  if (draft) {
    duplicateQuery._id = { $ne: draft._id };
  }
  const existingApp = await LoanApplication.findOne(duplicateQuery);
  if (existingApp) {
    return sendError(res, 'An active application with this ID Number already exists', 400);
  }

  const SystemSettings = require('../models/SystemSettings');
  const LoanEmployment = require('../models/LoanEmployment');
  const LoanBanking = require('../models/LoanBanking');
  const LoanDocument = require('../models/LoanDocument');
  const LoanStatusHistory = require('../models/LoanStatusHistory');
  const LoanAssignment = require('../models/LoanAssignment');
  const Conversation = require('../models/Conversation');
  const Notification = require('../models/Notification');

  const settings = await SystemSettings.findOne();
  
  const amount = Number(banking.requestedLoanAmount);
  const duration = Number(banking.requestedDuration);
  const loanType = banking.loanType || 'Personal Loan';
  
  const defaultProducts = [
    { name: 'Personal Loan', code: 'PL-001', minAmount: 1000, maxAmount: 50000, minTenure: 3, maxTenure: 24, defaultInterestRate: 12.5, interestType: 'Reducing Balance', processingFeeEnabled: true, insuranceEnabled: true, vatEnabled: true },
    { name: 'Payday Loan', code: 'PD-002', minAmount: 500, maxAmount: 5000, minTenure: 1, maxTenure: 3, defaultInterestRate: 15.0, interestType: 'Flat Rate', processingFeeEnabled: true, insuranceEnabled: false, vatEnabled: true },
    { name: 'Business Loan', code: 'BL-003', minAmount: 10000, maxAmount: 250000, minTenure: 6, maxTenure: 60, defaultInterestRate: 10.5, interestType: 'Reducing Balance', processingFeeEnabled: true, insuranceEnabled: true, vatEnabled: true },
    { name: 'Debt Consolidation', code: 'DC-004', minAmount: 5000, maxAmount: 150000, minTenure: 12, maxTenure: 48, defaultInterestRate: 11.5, interestType: 'Reducing Balance', processingFeeEnabled: true, insuranceEnabled: true, vatEnabled: true },
    { name: 'Salary Advance', code: 'SA-005', minAmount: 200, maxAmount: 3000, minTenure: 1, maxTenure: 1, defaultInterestRate: 5.0, interestType: 'Flat Rate', processingFeeEnabled: false, insuranceEnabled: false, vatEnabled: true }
  ];
  
  const activeProducts = settings?.loanProducts || defaultProducts;
  const selectedProduct = activeProducts.find(p => p.name === loanType) || activeProducts[0];
  
  const { calculateLoanFinances } = require('../services/loanFinancialCalculator');
  const finances = calculateLoanFinances({
    amount,
    duration,
    interestRate: banking.interestRate || selectedProduct?.defaultInterestRate,
    interestType: selectedProduct?.interestType,
    settings,
    selectedProduct
  });

  const interestRate = finances.annualInterestRate;
  const processingFee = finances.initiationFeeAmount;
  const estimatedMonthlyEMI = finances.monthlyInstallmentAmount;
  const totalRepayment = finances.totalRepaymentAmount;

  // Compute credit-risk readiness fields
  const REQUIRED_DOC_TYPES = ['ID Document', 'Payslip', 'Bank Statement', 'Proof Of Address'];
  const submittedDocTypes = (documents || []).map(d => d.type);
  const allDocsPresent = REQUIRED_DOC_TYPES.every(t => submittedDocTypes.includes(t));

  const documentVerificationStatus = allDocsPresent ? 'Complete' : submittedDocTypes.length > 0 ? 'Incomplete' : 'Pending';
  const creditRiskReady = allDocsPresent && !!creditConsentAccepted;

  const aml = draft?.amlVerification || {};
  const amlStatus = aml.verificationStatus || 'NOT_STARTED';

  // Calculate final application audit status (Fix 3)
  let applicationAuditStatus = 'Incomplete';
  if (amlStatus === 'AUTO_REJECT' || amlStatus === 'HIGH_RISK' || aml.complianceDecision === 'AUTO_REJECT') {
    applicationAuditStatus = 'APPLICATION BLOCKED';
  } else if (amlStatus === 'MANUAL_REVIEW') {
    applicationAuditStatus = 'MANUAL COMPLIANCE REVIEW REQUIRED';
  } else if (amlStatus === 'CLEARED') {
    applicationAuditStatus = 'READY FOR REVIEW STAGE';
  } else {
    if (creditRiskReady) applicationAuditStatus = 'Ready For Review';
    else if (!allDocsPresent) applicationAuditStatus = 'Missing Documents';
    else if (!creditConsentAccepted) applicationAuditStatus = 'Credit Consent Missing';
  }

  const Borrower = require('../models/Borrower');
  const borrowerDoc = await Borrower.findById(borrowerId);

  // Identity Mismatch Gate
  const verifiedId = borrowerDoc?.kycVerifiedIdNumber || draft?.kycVerification?.extractedOCRData?.IDNumber || (draft?.kycVerification?.verificationStatus === 'Verified' ? draft.idNumber : null);
  if (verifiedId && verifiedId !== personal.idNumber) {
    return res.status(400).json({
      success: false,
      code: 'IDENTITY_MISMATCH',
      message: 'IDENTITY_MISMATCH: Borrower identity does not match the verified KYC record.'
    });
  }

  // --- START TRANSACTION ---
  const mongoose = require('mongoose');
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const appData = {
      borrowerId: borrowerId,
      fullName: personal.fullName,
      phoneNumber: personal.phoneNumber,
      emailAddress: personal.emailAddress,
      idNumber: personal.idNumber,
      dateOfBirth: personal.dateOfBirth,
      residentialAddress: personal.residentialAddress,
      requestedAmount: amount,
      requestedDuration: duration,
      repaymentDate: banking.repaymentDate ? new Date(banking.repaymentDate) : undefined,
      processingFee,
      interestRate,
      estimatedMonthlyEMI,
      totalRepayment,
      financialSnapshot: finances,
      agreementFinancialSnapshot: finances,
      status: 'Submitted',
      confirmationAccepted: true,
      submittedAt: new Date(),
      creditConsentAccepted: true,
      creditConsentAcceptedAt: creditConsentAcceptedAt ? new Date(creditConsentAcceptedAt) : new Date(),
      documentVerificationStatus,
      creditRiskReady,
      applicationAuditStatus,
    };

    // Auto-link reusable verified KYC if borrower is verified
    if (
      borrowerDoc &&
      borrowerDoc.kycStatus === 'VERIFIED' &&
      borrowerDoc.kycVerifiedIdNumber === personal.idNumber &&
      (!draft?.kycVerification || draft.kycVerification.verificationStatus !== 'Verified')
    ) {
      appData.kycVerification = {
        verificationStatus: 'Verified',
        responseStatusCode: 1,
        responseMessage: 'Previously Verified Client (Reused Verification Profile)',
        faceMatchScore: borrowerDoc.kycFaceMatchScore ?? 100,
        verificationReference: borrowerDoc.kycProviderReference || `REUSED-${borrowerDoc._id}`,
        verificationTimestamp: borrowerDoc.kycVerifiedAt || new Date(),
        fraudFlags: [],
        extractedOCRData: borrowerDoc.kycExtractedData || {},
        verifiedPhotoUrl: borrowerDoc.kycPhotoUrl,
        verifiedPhotoFileId: borrowerDoc.kycPhotoFileId,
        reportPdfUrl: borrowerDoc.kycReportPdfUrl,
        reportPdfPath: borrowerDoc.kycReportPdfPath,
        reportReference: borrowerDoc.kycReportReference || borrowerDoc.kycProviderReference,
        isReused: true,
        originalVerifiedAt: borrowerDoc.kycVerifiedAt || new Date(),
        reusedAt: new Date(),
        idNumberMatch: true,
        photoMatch: true,
        verificationSource: borrowerDoc.kycProvider || 'DATANAMIX',
        verificationProvider: borrowerDoc.kycProviderProduct || 'Profile Plus ID Photo Match',
        rawApiResponse: borrowerDoc.kycSnapshot || {},
      };
    }

    let application;
    if (draft) {
      // Preserve existing draft so we don't lose the KYC, bureau, phone, bank and AML results!
      Object.assign(draft, appData);
      application = await draft.save({ session });
    } else {
      // Fallback: create fresh application
      const [newApp] = await LoanApplication.create([appData], { session });
      application = newApp;
    }

    // 2. Create Related Records
    await LoanEmployment.create([{
      loanApplicationId: application._id,
      ...employment
    }], { session });

    await LoanBanking.create([{
      loanApplicationId: application._id,
      ...banking
    }], { session });

    if (documents && documents.length > 0) {
      const docRecords = documents.map(doc => ({
        loanApplicationId: application._id,
        documentType: doc.type,
        fileUrl: doc.fileUrl || doc.url || doc.fileURL || (doc.data && doc.data.url),
        fileId: doc.fileId || (doc.data && doc.data.fileId),
        fileName: doc.fileName || (doc.data && doc.data.fileName),
        fileSize: doc.fileSize || (doc.data && doc.data.fileSize)
      }));
      await LoanDocument.insertMany(docRecords, { session });
    }

    await LoanStatusHistory.create([{
      loanApplicationId: application._id,
      status: 'Submitted',
      notes: `Loan application submitted on behalf of borrower by ${req.user.role} ${req.user.fullName || req.user.name || ''}`,
      changedBy: req.user._id
    }], { session });

    // 3. Communications & Notifications
    const admin = await User.findOne({ role: 'admin' });
    
    let io;
    try { io = getIO(); } catch (e) {}

    // Find the borrower User account so we can get their userId
    const borrowerUser = await User.findById(borrowerId);

    if (admin && borrowerUser) {
      // Reuse existing borrower↔admin conversation to avoid duplicates
      let existingConv = await Conversation.findOne({
        participants: { $all: [borrowerId, admin._id] },
        isActive: true,
        isDeleted: false
      }).session(session);

      let conversation;
      if (existingConv) {
        await Conversation.findByIdAndUpdate(
          existingConv._id,
          { lastMessage: 'New loan application submitted', lastMessageAt: new Date() },
          { session }
        );
        conversation = [existingConv];
      } else {
        conversation = await Conversation.create([{
          participants: [borrowerId, admin._id],
          participantRoles: ['borrower', 'admin'],
          conversationType: 'Borrower',
          lastMessage: 'New loan application submitted',
          lastMessageAt: new Date()
        }], { session });
      }

      application.conversationId = conversation[0]._id;
      await application.save({ session });

      await Notification.create([{
        receiverId: admin._id,
        receiverRole: 'admin',
        senderId: req.user._id,
        senderRole: req.user.role,
        loanApplicationId: application._id,
        type: 'NewLoanRequest',
        title: 'New Loan Application',
        message: `New application ${application.applicationId} received from ${application.fullName} (Created by ${req.user.role})`,
        priority: 'IMPORTANT'
      }], { session });
    }

    // 4. Auto Assignment
    if (settings && settings.enableAutoAssignment) {
      const agents = await User.find({ role: 'agent', isActive: true });
      if (agents.length > 0) {
        const assignedAgent = agents[Math.floor(Math.random() * agents.length)];
        await LoanAssignment.create([{
          loanApplicationId: application._id,
          assignedAgentId: assignedAgent._id,
          assignmentType: 'Auto'
        }], { session });
      }

      const staffMembers = await User.find({ role: 'staff', isActive: true });
      if (staffMembers.length > 0) {
        const assignedStaff = staffMembers[Math.floor(Math.random() * staffMembers.length)];
        await LoanAssignment.findOneAndUpdate(
          { loanApplicationId: application._id },
          { assignedStaffId: assignedStaff._id },
          { upsert: true, session }
        );
      }
    }

    // --- COMMIT TRANSACTION ---
    await session.commitTransaction();
    session.endSession();

    // Trigger Real-time (After commit)
    if (io && admin) {
      io.to(admin._id.toString()).emit('newNotification', { 
        title: 'New Loan Application', 
        message: `New application: ${application.applicationId}` 
      });
      io.emit('loan-request:new', { applicationId: application._id });
    }

    sendSuccess(res, 'Application submitted successfully on behalf of borrower', { application });

  } catch (error) {
    // --- ROLLBACK TRANSACTION ---
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});

module.exports = {
  getApplicationStats,
  getAllApplications,
  getApplicationDetails,
  approveApplication,
  rejectApplication,
  holdApplication,
  updateStaffReview,
  assignReviewer,
  deleteApplication,
  createApplicationOnBehalf
};
