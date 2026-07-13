const ActiveLoan = require('../../models/ActiveLoan');
const RepaymentSchedule = require('../../models/RepaymentSchedule');
const LoanActivity = require('../../models/LoanActivity');
const LoanApplication = require('../../models/LoanApplication');
const Borrower = require('../../models/Borrower');
const SystemSettings = require('../../models/SystemSettings');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');

/**
 * @desc    Get system eligibility settings for borrower
 * @route   GET /api/borrower/eligibility-settings
 * @access  Private/Borrower
 */
exports.getEligibilitySettings = asyncHandler(async (req, res) => {
  let settings = await SystemSettings.findOne();
  
  if (!settings) {
    settings = await SystemSettings.create({});
  }

  sendSuccess(res, 'Eligibility settings fetched', settings);
});

/**
 * @desc    Get all active loans for the logged-in borrower
 * @route   GET /api/borrower/my-loans
 * @access  Private/Borrower
 */
exports.getMyLoans = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // 1. Try to find the borrower document
  const borrower = await Borrower.findOne({ userId });
  
  // Define search ID (Profile ID if exists, otherwise User ID)
  const profileId = borrower ? borrower._id : null;

  // 2. Fetch active loans for this borrower
  // We search for loans where borrowerId matches either the profile _id OR the userId
  // (Handling data inconsistency where some loans are linked to User ID)
  const activeLoans = await ActiveLoan.find({ 
    $or: [
      { borrowerId: profileId },
      { borrowerId: userId }
    ],
    isDeleted: false 
  }).sort({ createdAt: -1 });

  // 3. Calculate summary metrics
  let totalRemainingBalance = 0;
  let totalPenalties = 0;
  let nextEmi = null;

  const formattedLoans = await Promise.all(activeLoans.map(async (loan) => {
    totalRemainingBalance += loan.remainingBalance;
    totalPenalties += loan.penaltyAmount;

    // Check if migration is needed for this loan
    let scheduleCount = await RepaymentSchedule.countDocuments({ loanId: loan._id });
    if (scheduleCount === 0 && loan.repaymentSchedule && loan.repaymentSchedule.length > 0) {
      const migrationData = loan.repaymentSchedule.map(emi => ({
        loanId: loan._id,
        borrowerId: loan.borrowerId,
        emiNumber: emi.installmentNumber,
        dueDate: emi.dueDate,
        amount: emi.emiAmount,
        status: emi.paymentStatus === 'Paid' ? 'Paid' : (emi.paymentStatus === 'Overdue' ? 'Overdue' : 'Pending'),
        paidAt: emi.paidDate || null,
        penaltyAmount: emi.lateFee || 0
      }));
      await RepaymentSchedule.insertMany(migrationData);
    }

    // Find next unpaid EMI
    const nextUnpaidEmi = await RepaymentSchedule.findOne({
      loanId: loan._id,
      status: { $in: ['Pending', 'Overdue'] }
    }).sort({ dueDate: 1 });

    if (nextUnpaidEmi && (!nextEmi || nextUnpaidEmi.dueDate < nextEmi.dueDate)) {
      nextEmi = nextUnpaidEmi;
    }

    const totalPaid = loan.approvedAmount - loan.remainingBalance;
    const progress = loan.approvedAmount > 0 
      ? Math.round((totalPaid / loan.approvedAmount) * 100) 
      : 0;

    // Fetch associated LoanApplication if metadata is missing
    let fullName = loan.fullName;
    let emailAddress = loan.emailAddress;
    let phoneNumber = loan.phoneNumber;
    let idNumber = loan.idNumber;
    let applicationId = loan.applicationId;
    let agreementSignedAt = loan.agreementSignedAt;
    let agreementStatus = loan.agreementStatus;
    let agreementGeneratedAt = loan.agreementGeneratedAt;
    let verificationIp = loan.verificationIp;
    let verificationUserAgent = loan.verificationUserAgent;
    let processingFee = loan.processingFee;
    let agreementDocumentUrl = loan.agreementDocumentUrl;

    if (!fullName || !applicationId) {
      const appRecord = await LoanApplication.findById(loan.loanApplicationId);
      if (appRecord) {
        fullName = fullName || appRecord.fullName;
        emailAddress = emailAddress || appRecord.emailAddress;
        phoneNumber = phoneNumber || appRecord.phoneNumber;
        idNumber = idNumber || appRecord.idNumber;
        applicationId = applicationId || appRecord.applicationId;
        agreementSignedAt = agreementSignedAt || appRecord.agreementSignedAt;
        agreementStatus = agreementStatus || appRecord.agreementStatus;
        agreementGeneratedAt = agreementGeneratedAt || appRecord.agreementGeneratedAt;
        verificationIp = verificationIp || appRecord.verificationIp;
        verificationUserAgent = verificationUserAgent || appRecord.verificationUserAgent;
        processingFee = processingFee || appRecord.processingFee;
        agreementDocumentUrl = agreementDocumentUrl || appRecord.agreementDocumentUrl;
      }
    }

    return {
      _id: loan._id,
      loanCode: loan.loanCode,
      loanType: loan.loanType,
      approvedAmount: loan.approvedAmount,
      remainingBalance: loan.remainingBalance,
      interestRate: loan.interestRate,
      loanDurationMonths: loan.loanDurationMonths,
      nextDueDate: loan.nextDueDate,
      loanStatus: loan.loanStatus,
      progress,
      
      // Borrower Details & Agreement Metadata
      fullName,
      emailAddress,
      phoneNumber,
      idNumber,
      applicationId,
      agreementSignedAt,
      agreementStatus,
      agreementGeneratedAt,
      verificationIp,
      verificationUserAgent,
      processingFee,
      agreementDocumentUrl
    };
  }));

  const APPROVAL_RECS  = ['Recommended', 'Recommended for Approval', 'Recommend Approval'];
  const REJECTION_RECS = ['Rejected', 'Rejected Recommendation', 'Recommended for Rejection', 'Recommend Rejection'];

  // Builds customer-safe review info — never exposes internal risk level or staff notes
  const buildReviewInfo = (app) => {
    const rec = app.staffReview?.recommendation;
    const reviewDone = app.staffReview?.verificationDate && rec && rec !== 'Pending';
    if (!reviewDone) return null;

    const base = {
      reviewCompleted: true,
      reviewedAt: app.staffReview.verificationDate,
      reviewerDisplay: 'Loan Review Team',
    };

    // Final admin decisions take display priority over staff recommendation
    if (app.status === 'Approved') {
      return { ...base, outcome: 'success', title: 'Application Approved',
        message: 'Congratulations! Your loan application has been approved. You will be contacted shortly.' };
    }
    if (app.status === 'Rejected') {
      return { ...base, outcome: 'error', title: 'Application Not Approved',
        message: app.rejectionReason
          ? `Your application was not approved. Reason: ${app.rejectionReason}.`
          : 'Your application was not approved after review. Please contact support for details.' };
    }
    if (app.status === 'Hold') {
      return { ...base, outcome: 'warning', title: 'Application On Hold',
        message: 'Your application is currently on hold. Our team may reach out for additional documents or information.' };
    }

    // Still in 'Reviewed' state — admin hasn't made final call yet
    if (APPROVAL_RECS.includes(rec)) {
      return { ...base, outcome: 'success', title: 'Review Completed',
        message: 'Your application documents have been reviewed and verified by our team. A final approval decision will be communicated to you shortly.' };
    }
    if (REJECTION_RECS.includes(rec)) {
      return { ...base, outcome: 'warning', title: 'Additional Assessment Required',
        message: app.rejectionReason
          ? `Your application requires further assessment. Noted concern: ${app.rejectionReason}.`
          : 'Your application is under final assessment by our team. We will contact you with the outcome.' };
    }

    return { ...base, outcome: 'info', title: 'Review Completed',
      message: 'Your application review has been completed. Awaiting final decision from our team.' };
  };

  // 4. Fetch loan applications (submitted but not yet active loans)
  const loanApplications = await LoanApplication.find({
    borrowerId: userId,
    status: { $nin: ['Draft'] }
  })
    .select('applicationId requestedAmount requestedDuration status reviewStatus rejectionReason submittedAt loanType estimatedMonthlyEMI staffReview fullName phoneNumber emailAddress idNumber interestRate approvedAmount processingFee totalRepayment agreementGeneratedAt agreementSignedAt agreementStatus borrowerConsentVerified verificationIp verificationUserAgent')
    .sort({ createdAt: -1 });

  // 5. Fetch recent activities
  const activities = await LoanActivity.find({
    $or: [
      { borrowerId: profileId },
      { borrowerId: userId }
    ]
  }).sort({ createdAt: -1 }).limit(10);

  // Build customer-safe application summaries
  const safeApplications = loanApplications.map(app => ({
    _id: app._id,
    applicationId: app.applicationId,
    requestedAmount: app.requestedAmount,
    requestedDuration: app.requestedDuration,
    status: app.status,
    reviewStatus: app.reviewStatus,
    submittedAt: app.submittedAt,
    loanType: app.loanType,
    estimatedMonthlyEMI: app.estimatedMonthlyEMI,
    reviewInfo: buildReviewInfo(app),
    fullName: app.fullName,
    phoneNumber: app.phoneNumber,
    emailAddress: app.emailAddress,
    idNumber: app.idNumber,
    interestRate: app.interestRate,
    approvedAmount: app.approvedAmount,
    processingFee: app.processingFee,
    totalRepayment: app.totalRepayment,
    agreementGeneratedAt: app.agreementGeneratedAt,
    agreementSignedAt: app.agreementSignedAt,
    agreementStatus: app.agreementStatus,
    borrowerConsentVerified: app.borrowerConsentVerified,
    verificationIp: app.verificationIp,
    verificationUserAgent: app.verificationUserAgent,
  }));

  sendSuccess(res, 'My loans retrieved successfully', {
    activeLoans: formattedLoans,
    loanApplications: safeApplications,
    remainingBalance: totalRemainingBalance,
    nextEmi,
    totalPenalties,
    activities
  });
});

/**
 * @desc    Get EMI schedule for a specific loan
 * @route   GET /api/borrower/emi-schedule/:loanId
 * @access  Private/Borrower
 */
exports.getEmiSchedule = asyncHandler(async (req, res) => {
  const { loanId } = req.params;
  const userId = req.user._id;

  // 1. Try to find borrower profile
  const borrower = await Borrower.findOne({ userId });
  const profileId = borrower ? borrower._id : null;

  // 2. Verify ownership (check both profileId and userId)
  const loan = await ActiveLoan.findOne({ 
    _id: loanId, 
    $or: [
      { borrowerId: profileId },
      { borrowerId: userId }
    ],
    isDeleted: false 
  });

  if (!loan) {
    return sendError(res, 'Loan not found or access denied', 404);
  }

  // 2. Fetch schedule
  const schedule = await RepaymentSchedule.find({ loanId }).sort({ emiNumber: 1 });

  // 3. Calculate summary for modal
  const totalRepayment = schedule.reduce((acc, curr) => acc + curr.amount, 0);
  const totalPaid = schedule.filter(s => s.status === 'Paid').reduce((acc, curr) => acc + curr.amount, 0);
  
  sendSuccess(res, 'EMI schedule retrieved successfully', {
    loan: {
      loanCode: loan.loanCode,
      loanType: loan.loanType,
      approvedAmount: loan.approvedAmount,
      remainingBalance: loan.remainingBalance,
      totalRepayment,
      totalPaid
    },
    schedule
  });
});

/**
 * @desc    Download loan statement
 * @route   POST /api/borrower/download-loan-statement
 * @access  Private/Borrower
 */
exports.downloadStatement = asyncHandler(async (req, res) => {
  const { loanId, format } = req.body;
  const userId = req.user._id;

  // 1. Try to find borrower profile
  const borrower = await Borrower.findOne({ userId });
  const profileId = borrower ? borrower._id : null;

  // 2. Verify ownership
  const loan = await ActiveLoan.findOne({ 
    _id: loanId, 
    $or: [
      { borrowerId: profileId },
      { borrowerId: userId }
    ]
  });

  if (!loan) {
    return sendError(res, 'Loan not found', 404);
  }

  // In a real implementation, generate PDF/CSV/Excel
  // For now, return success with a mock URL or message
  sendSuccess(res, `Loan statement (${format}) generation started. It will be available shortly.`);
});
