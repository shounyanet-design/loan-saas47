const path = require('path');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const LoanApplication = require('../models/LoanApplication');
const LoanEmployment = require('../models/LoanEmployment');
const LoanBanking = require('../models/LoanBanking');
const LoanDocument = require('../models/LoanDocument');
const LoanStatusHistory = require('../models/LoanStatusHistory');
const LoanAssignment = require('../models/LoanAssignment');
const SystemSettings = require('../models/SystemSettings');
const Notification = require('../models/Notification');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { getIO } = require('../socket/socketServer');
const imagekit = require('../config/imagekit');

// @desc    Get Loan Estimate
// @route   GET /api/borrower/apply-loan/estimate
// @access  Protected
// @desc    Get Loan Estimate
// @route   GET /api/borrower/apply-loan/estimate
// @access  Protected
exports.getLoanEstimate = asyncHandler(async (req, res, next) => {
  const { amount, duration, loanType = 'Personal Loan' } = req.query;

  if (!amount || !duration) return sendError(res, 'Amount and duration required', 400);

  const settings = await SystemSettings.findOne();
  
  // Calculate dynamic parameters using central rules engine
  const pAmount = Number(amount) || 0;
  const pDuration = Number(duration) || 12;
  
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
    amount: pAmount,
    duration: pDuration,
    interestRate: selectedProduct?.defaultInterestRate,
    interestType: selectedProduct?.interestType,
    settings,
    selectedProduct
  });

  sendSuccess(res, 'Loan estimate generated', {
    requestedAmount: finances.principalAmount,
    processingFee: finances.initiationFeeAmount,
    interestRate: finances.annualInterestRate,
    estimatedMonthlyEMI: finances.monthlyInstallmentAmount,
    totalRepayment: finances.totalRepaymentAmount,
    duration: finances.durationMonths,
    creditLifeInsurance: finances.insuranceAmount,
    vatOnFees: finances.vatAmount,
    monthlyServiceFee: finances.totalServiceFeeAmount,
    pureInterestAmount: finances.pureInterestAmount,
    totalCostOfCredit: finances.totalCostOfCreditAmount,
    financialSnapshot: finances
  });
});

// @desc    Document Upload (To ImageKit only, no DB entry yet)
// @route   POST /api/borrower/apply-loan/upload
// @access  Protected
exports.uploadOnly = asyncHandler(async (req, res, next) => {
  if (!req.file) return sendError(res, 'No file uploaded', 400);

  // Upload to ImageKit
  const uploadResponse = await imagekit.upload({
    file: req.file.buffer,
    fileName: `temp-${req.user._id}-${Date.now()}${path.extname(req.file.originalname)}`,
    folder: `/loans/temp/${req.user._id}`
  });

  sendSuccess(res, 'File uploaded to ImageKit', { 
    url: uploadResponse.url, 
    fileId: uploadResponse.fileId,
    fileName: req.file.originalname,
    fileSize: req.file.size
  });
});

// @desc    Create minimal Draft LoanApplication before verification steps begin
// @route   POST /api/borrower/apply-loan/create-draft
// @access  Protected
exports.createDraftApplication = asyncHandler(async (req, res, next) => {
  const { idNumber, fullName, phoneNumber, emailAddress, dateOfBirth, residentialAddress, borrowerId } = req.body;

  if (!idNumber) return sendError(res, 'idNumber is required', 400);

  const targetBorrowerId = (req.user?.role === 'admin' || req.user?.role === 'staff') && borrowerId
    ? borrowerId
    : req.user._id;

  // Return existing draft for this borrower + idNumber without creating a duplicate
  const existing = await LoanApplication.findOne({
    borrowerId: targetBorrowerId,
    idNumber,
    status: 'Draft',
  });

  if (existing) {
    console.log(`[APPLICATION] Using existing draft: ${existing._id}`);
    return sendSuccess(res, 'Existing draft found', {
      applicationId: existing._id,
      applicationRef: existing.applicationId,
    });
  }

  // Block if there is already a live pending application
  const conflict = await LoanApplication.findOne({
    idNumber,
    status: { $nin: ['Rejected', 'Draft', 'Settled', 'Closed', 'COMPLETED', 'Disbursed', 'DISBURSED', 'SETTLED'] },
  });
  if (conflict) {
    return sendError(res, 'An active application with this ID Number already exists', 400);
  }

  let initialKycVerification = undefined;
  
  // Inherit reusable KYC profile if it exists
  const Borrower = require('../models/Borrower');
  const borrowerRecord = await Borrower.findOne({ _id: targetBorrowerId, idNumber });
  if (borrowerRecord && borrowerRecord.kycStatus === 'VERIFIED') {
    initialKycVerification = {
      verificationStatus: 'Verified',
      responseStatusCode: 1,
      responseMessage: 'Previously Verified Client (Reused Verification Profile)',
      faceMatchScore: borrowerRecord.kycFaceMatchScore ?? 100,
      verificationReference: borrowerRecord.kycProviderReference || `REUSED-${borrowerRecord._id}`,
      verificationTimestamp: borrowerRecord.kycVerifiedAt || new Date(),
      fraudFlags: [],
      extractedOCRData: borrowerRecord.kycExtractedData || {},
      verifiedPhotoUrl: borrowerRecord.kycPhotoUrl,
      verifiedPhotoFileId: borrowerRecord.kycPhotoFileId,
      reportPdfUrl: borrowerRecord.kycReportPdfUrl,
      reportPdfPath: borrowerRecord.kycReportPdfPath,
      reportReference: borrowerRecord.kycReportReference || borrowerRecord.kycProviderReference,
      isReused: true,
      originalVerifiedAt: borrowerRecord.kycVerifiedAt || new Date(),
      reusedAt: new Date(),
      idNumberMatch: true,
      photoMatch: true,
      verifiedBy: targetBorrowerId,
      verificationSource: borrowerRecord.kycProvider || 'DATANAMIX',
      verificationProvider: borrowerRecord.kycProviderProduct || 'Profile Plus ID Photo Match',
      rawApiResponse: borrowerRecord.kycSnapshot || {},
    };
  }

  const draft = await LoanApplication.create({
    borrowerId:          targetBorrowerId,
    fullName:            fullName            || 'Draft',
    idNumber,
    phoneNumber:         phoneNumber         || '0000000000',
    emailAddress:        emailAddress        || (targetBorrowerId === req.user?._id ? req.user?.email : undefined) || 'draft@pending.com',
    dateOfBirth:         dateOfBirth         ? new Date(dateOfBirth) : new Date('1990-01-01'),
    residentialAddress:  residentialAddress  || 'Draft Address',
    status:              'Draft',
    kycVerification:     initialKycVerification
  });

  console.log(`[APPLICATION] Draft created: ${draft._id}`);
  return sendSuccess(res, 'Draft application created', {
    applicationId: draft._id,
    applicationRef: draft.applicationId,
  });
});

// @desc    Submit Complete Loan Application (Atomic Transaction)
// @route   POST /api/borrower/apply-loan/submit-full
// @access  Protected
exports.submitFullApplication = asyncHandler(async (req, res, next) => {
  const {
    personal,
    employment,
    banking,
    documents,
    confirmationAccepted,
    creditConsentAccepted,
    creditConsentAcceptedAt,
  } = req.body;

  if (!confirmationAccepted) return sendError(res, 'Please accept confirmation', 400);
  if (!creditConsentAccepted) return sendError(res, 'Credit check consent is required', 400);

  if (!personal || !employment || !banking) {
    return sendError(res, 'Missing required information blocks', 400);
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
    console.error('[SUBMIT FULL VALIDATION FAILED] errors:', validationResult.errors);
    return res.status(400).json({
      success: false,
      validationErrors: validationResult.errors
    });
  }

  // South Africa Phone Format
  const saPhoneRegex = /^0\d{9}$/;
  if (!saPhoneRegex.test(personal.phoneNumber)) {
    return sendError(res, 'Invalid South Africa phone format', 400);
  }

  // Unique ID Check — exclude Draft, Settled and Disbursed statuses
  const existingApp = await LoanApplication.findOne({
    idNumber: personal.idNumber,
    status: { $nin: ['Rejected', 'Draft', 'Settled', 'Closed', 'COMPLETED', 'Disbursed', 'DISBURSED', 'SETTLED'] },
  });
  if (existingApp) {
    return sendError(res, 'An active application with this ID Number already exists', 400);
  }

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

  // Retrieve the existing draft application for compliance checks & preservation
  const draft = await LoanApplication.findOne({ borrowerId: req.user._id, idNumber: personal.idNumber, status: 'Draft' });
  const aml = draft?.amlVerification || {};
  const amlStatus = aml.verificationStatus || 'NOT_STARTED';

  // DEV-ONLY sandbox testing mode bypass check
  const { isDevelopmentSandboxBypassEnabled } = require('../utils/devSandboxBypass');
  const isDevBypass = isDevelopmentSandboxBypassEnabled();

  // If DEV TESTING MODE is false (Production compliance rules must be enforced)
  if (!isDevBypass) {
    const isAutoReject = amlStatus === 'AUTO_REJECT' || aml.complianceDecision === 'AUTO_REJECT';
    const isHighRisk = amlStatus === 'HIGH_RISK';
    const isOfacMatch = aml.ofacMatch === true;
    const isSdnMatch = (aml.matchedEntities || []).some(entity =>
      /SDN/i.test([entity.source, entity.program, entity.listName].filter(Boolean).join(' '))
    );
    const isTerrorMatch = aml.terrorMatch === true;

    if (isAutoReject || isHighRisk || isOfacMatch || isSdnMatch || isTerrorMatch) {
      return sendError(res, 'Application blocked due to compliance restrictions.', 403);
    }
  }

  const Borrower = require('../models/Borrower');
  let borrowerProfile = await Borrower.findOne({ idNumber: personal.idNumber });
  if (!borrowerProfile && req.user._id) {
    borrowerProfile = await Borrower.findOne({ userId: req.user._id });
  }

  // Identity Mismatch Gate
  const verifiedId = borrowerProfile?.kycVerifiedIdNumber || draft?.kycVerification?.extractedOCRData?.IDNumber || (draft?.kycVerification?.verificationStatus === 'Verified' ? draft.idNumber : null);
  if (verifiedId && verifiedId !== personal.idNumber) {
    return res.status(400).json({
      success: false,
      code: 'IDENTITY_MISMATCH',
      message: 'IDENTITY_MISMATCH: Borrower identity does not match the verified KYC record.'
    });
  }

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

  // --- START TRANSACTION ---
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const appData = {
      borrowerId: req.user._id,
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
      borrowerProfile &&
      borrowerProfile.kycStatus === 'VERIFIED' &&
      borrowerProfile.kycVerifiedIdNumber === personal.idNumber &&
      (!draft?.kycVerification || draft.kycVerification.verificationStatus !== 'Verified')
    ) {
      appData.kycVerification = {
        verificationStatus: 'Verified',
        responseStatusCode: 1,
        responseMessage: 'Previously Verified Client (Reused Verification Profile)',
        faceMatchScore: borrowerProfile.kycFaceMatchScore ?? 100,
        verificationReference: borrowerProfile.kycProviderReference || `REUSED-${borrowerProfile._id}`,
        verificationTimestamp: borrowerProfile.kycVerifiedAt || new Date(),
        fraudFlags: [],
        extractedOCRData: borrowerProfile.kycExtractedData || {},
        verifiedPhotoUrl: borrowerProfile.kycPhotoUrl,
        verifiedPhotoFileId: borrowerProfile.kycPhotoFileId,
        reportPdfUrl: borrowerProfile.kycReportPdfUrl,
        reportPdfPath: borrowerProfile.kycReportPdfPath,
        reportReference: borrowerProfile.kycReportReference || borrowerProfile.kycProviderReference,
        isReused: true,
        originalVerifiedAt: borrowerProfile.kycVerifiedAt || new Date(),
        reusedAt: new Date(),
        idNumberMatch: true,
        photoMatch: true,
        verificationSource: borrowerProfile.kycProvider || 'DATANAMIX',
        verificationProvider: borrowerProfile.kycProviderProduct || 'Profile Plus ID Photo Match',
        rawApiResponse: borrowerProfile.kycSnapshot || {},
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
      notes: 'Loan application submitted by borrower (Full)',
      changedBy: req.user._id
    }], { session });

    // 3. Communications & Notifications
    const admin = await User.findOne({ role: 'admin' });
    
    let io;
    try { io = getIO(); } catch (e) {}

    if (admin) {
      // Reuse existing borrower↔admin conversation to avoid duplicates
      let existingConv = await Conversation.findOne({
        participants: { $all: [req.user._id, admin._id] },
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
          participants: [req.user._id, admin._id],
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
        senderRole: 'borrower',
        loanApplicationId: application._id,
        type: 'NewLoanRequest',
        title: 'New Loan Application',
        message: `New application ${application.applicationId} received from ${application.fullName}`,
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
    }

    sendSuccess(res, 'Application submitted successfully', { application });

  } catch (error) {
    // --- ROLLBACK TRANSACTION ---
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});

// @desc    Get Application Status
// @route   GET /api/borrower/apply-loan/status/:applicationId
// @access  Protected
exports.getApplicationStatus = asyncHandler(async (req, res, next) => {
  const application = await LoanApplication.findById(req.params.applicationId);
  if (!application) return sendError(res, 'Application not found', 404);
  const history = await LoanStatusHistory.find({ loanApplicationId: application._id }).sort({ createdAt: 1 });
  sendSuccess(res, 'Application status retrieved', {
    currentStatus: application.status,
    timeline: history
  });
});

// @desc    Persist document immediately
// @route   POST /api/borrower/apply-loan/persist-document
// @access  Protected
exports.persistDocument = asyncHandler(async (req, res, next) => {
  const { applicationId, type, url, fileId, fileName, fileSize } = req.body;
  if (!applicationId || !type || !url) {
    return sendError(res, 'applicationId, type, and url are required', 400);
  }

  // Remove existing document of same type for this application
  await LoanDocument.deleteMany({ loanApplicationId: applicationId, documentType: type });

  const doc = await LoanDocument.create({
    loanApplicationId: applicationId,
    documentType: type,
    fileUrl: url,
    fileId,
    fileName,
    fileSize
  });

  sendSuccess(res, 'Document persisted successfully', doc);
});
