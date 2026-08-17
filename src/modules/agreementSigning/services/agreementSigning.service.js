const LoanApplication = require('../../../models/LoanApplication');
const Borrower = require('../../../models/Borrower');
const User = require('../../../models/User');
const { generateAndSaveOTP } = require('./otpGenerator.service');
const { verifyOTP } = require('./otpVerification.service');
const { sendOtpEmail } = require('../../../integrations/emailjs/emailjs.service');
const { sendOtpSms } = require('../../../integrations/sms/sms.service');
const { createNotification } = require('../../../utils/notificationHelper');
const BorrowerAlert = require('../../../models/BorrowerAlert');
const LoanActivity = require('../../../models/LoanActivity');
const { getIO } = require('../../../socket/socketServer');
const tokenService = require('../../../modules/commerce/services/tokenService');

/**
 * Generate Loan Agreement
 */
const generateAgreement = async (loanId, adminId) => {
  const application = await LoanApplication.findById(loanId);
  if (!application) {
    throw new Error('Loan application not found');
  }

  if (
    application.status !== 'Approved' && 
    application.status !== 'Agreement Pending' && 
    application.status !== 'AGREEMENT_PENDING_VERIFICATION'
  ) {
    throw new Error('Agreements can only be generated for Approved loans.');
  }

  const staffUser = await User.findById(adminId);
  const staffName = staffUser ? (staffUser.fullName || staffUser.name) : 'Admin';

  // Update application status and agreement metadata
  application.status = 'AGREEMENT_PENDING_VERIFICATION';
  
  // Set custom properties if not already set, since we want to store agreement data
  application.agreementGenerated = true;
  application.agreementGeneratedAt = new Date();
  application.agreementStatus = 'PENDING SIGNATURE';
  application.otpVerificationStatus = 'Pending';
  application.agreementDocumentUrl = `/api/agreement/document/${application._id}`;
  
  application.statusHistory.push({
    status: 'AGREEMENT_PENDING_VERIFICATION',
    changedBy: staffName,
    notes: 'Digital loan agreement generated and ready for borrower signature.',
  });

  await application.save();

  // Create notifications and socket alerts
  try {
    const borrower = await Borrower.findOne({ userId: application.borrowerId });
    if (borrower) {
      await createNotification({
        title: 'Agreement Ready',
        message: `Your loan agreement for application ${application.applicationId} has been generated. Please review and sign.`,
        notificationType: 'System Alert',
        priority: 'Important',
        receiverId: borrower._id,
        receiverRole: 'borrower',
        applicationId: application._id
      });

      // Socket notification
      const io = getIO();
      if (io && borrower.userId) {
        io.to(borrower.userId.toString()).emit('loan-updated', {
          status: 'AGREEMENT_PENDING_VERIFICATION',
          message: 'Your loan agreement is ready to be signed.'
        });
        io.to(borrower.userId.toString()).emit('dashboard-updated');
      }
    }
  } catch (err) {
    console.error('Failed to notify borrower of agreement generation:', err.message);
  }

  return application;
};

/**
 * Send OTP for agreement signing
 */
const sendAgreementOTP = async (loanApplicationId, requestUser) => {
  const application = await LoanApplication.findById(loanApplicationId);
  if (!application) {
    throw new Error('Loan application not found');
  }

  if (
    application.status !== 'Agreement Pending' && 
    application.status !== 'AGREEMENT_PENDING_VERIFICATION'
  ) {
    throw new Error('OTP can only be requested for loans in Agreement Pending status.');
  }

  // Fetch borrower user
  const borrowerUser = await User.findById(application.borrowerId);
  if (!borrowerUser) {
    throw new Error('Associated borrower user account not found.');
  }

  // Generate secure OTP
  const otpRecord = await generateAndSaveOTP(borrowerUser._id, application._id);
  console.log(`[AgreementService] OTP generated successfully for borrower ${borrowerUser._id}. Expiration: ${otpRecord.expiresAt}`);

  try {
    const tenantId = application.tenantId;

    // Charge for email OTP
    const emailIdemKey = `idem-otp-email-${application._id}-${otpRecord.otpCode}`;
    await tokenService.charge(tenantId, 'email', {
      actor: borrowerUser._id,
      idempotencyKey: emailIdemKey,
      metadata: { applicationId: application._id }
    });

    // Send EmailJS request
    await sendOtpEmail(
      application.emailAddress, 
      application.fullName, 
      otpRecord.otpCode, 
      application.applicationId
    );
    console.log(`[AgreementService] OTP Email sent successfully to ${application.emailAddress} for agreement ${application.applicationId}`);

    // Send SMS via BulkSMS integration
    if (application.phoneNumber) {
      // Don't wait for it to block the main flow, or wrap in a generic try-catch to avoid failing the whole process if SMS fails
      try {
        // Charge for SMS OTP
        const smsIdemKey = `idem-otp-sms-${application._id}-${otpRecord.otpCode}`;
        await tokenService.charge(tenantId, 'sms', {
          actor: borrowerUser._id,
          idempotencyKey: smsIdemKey,
          metadata: { applicationId: application._id }
        });

        await sendOtpSms(application.phoneNumber, otpRecord.otpCode, application.applicationId);
      } catch (smsError) {
        console.error(`[AgreementService] Non-fatal: SMS dispatch or token charge failed to ${application.phoneNumber}: ${smsError.message}`);
      }
    }

  } catch (error) {
    console.error(`[AgreementService] OTP dispatch failure for agreement ${application.applicationId}: ${error.message}`);
    throw new Error(`Dispatch failed: ${error.message}`);
  }

  return {
    message: 'OTP sent successfully to borrower email.',
    expiresAt: otpRecord.expiresAt,
  };
};

/**
 * Verify OTP and sign the agreement
 */
const signAgreement = async (loanApplicationId, otpCode, ip = '', userAgent = '') => {
  const application = await LoanApplication.findById(loanApplicationId);
  if (!application) {
    throw new Error('Loan application not found');
  }

  if (
    application.status !== 'Agreement Pending' && 
    application.status !== 'AGREEMENT_PENDING_VERIFICATION'
  ) {
    throw new Error('Only agreements pending signature can be signed.');
  }

  // Verify OTP via verification service
  await verifyOTP(application.borrowerId, application._id, otpCode);
  console.log(`[AgreementService] OTP verified successfully for agreement ${application.applicationId} by borrower.`);

  const signedAtDate = new Date();
  const documentText = `========================================================================
POINT.47 LOAN AGREEMENT & SIGNATURE RECEIPT
========================================================================
Application ID: ${application.applicationId}
Borrower Name: ${application.fullName}
Email Address: ${application.emailAddress}
Mobile Number: ${application.phoneNumber}
ID Number: ${application.idNumber}

LOAN PRINCIPAL DETAILS:
Approved Amount: R ${Number(application.requestedAmount || 0).toLocaleString()}
Duration: ${application.requestedDuration} Months
Estimated EMI: R ${Math.round(application.estimatedMonthlyEMI || 0).toLocaleString()}
Interest Rate: ${application.interestRate || '12'}% per annum

DIGITAL VERIFICATION & CONSENT RECORD:
Signing Method: Multi-Factor Secure OTP Consent
Consent Status: VERIFIED & COMPLETED
Agreement Status: SIGNED
Generated At: ${application.agreementGeneratedAt ? new Date(application.agreementGeneratedAt).toLocaleString() : new Date().toLocaleString()}
Signed At: ${signedAtDate.toLocaleString()}

Thank you for choosing Point.47.
========================================================================`;

  const agreementHtml = `<div style="font-family: monospace; white-space: pre-wrap; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; color: #334155;">${documentText}</div>`;

  // Update application status and agreement fields
  application.status = 'APPROVED';
  application.agreementSignedAt = signedAtDate;
  application.agreementStatus = 'SIGNED';
  application.otpVerificationStatus = 'VERIFIED';
  application.borrowerConsentVerified = true;
  application.signedAgreement = documentText;
  application.agreementHtml = agreementHtml;
  application.agreementPdfUrl = `/api/agreement/document/${application._id}`;

  // Log sequence: AGREEMENT_SIGNED -> APPROVED -> ACTIVE -> READY_FOR_DISBURSEMENT
  application.statusHistory.push(
    {
      status: 'AGREEMENT_SIGNED',
      changedBy: application.fullName,
      notes: 'Loan agreement digitally signed by borrower via secure OTP.',
      changedAt: new Date()
    },
    {
      status: 'APPROVED',
      changedBy: 'System',
      notes: 'Loan application status updated to APPROVED after digital signature verification.',
      changedAt: new Date()
    },
    {
      status: 'ACTIVE',
      changedBy: 'System',
      notes: 'Loan record activated and repayments scheduled.',
      changedAt: new Date()
    },
    {
      status: 'READY_FOR_DISBURSEMENT',
      changedBy: 'System',
      notes: 'Loan marked ready for disbursement internally.',
      changedAt: new Date()
    }
  );

  const borrower = await Borrower.findOne({ userId: application.borrowerId });
  if (!borrower) {
    throw new Error('Borrower profile not found for associated user account.');
  }

  await application.save();

  // Now, finalize the loan: Create ActiveLoan, RepaymentSchedule, Commission, and Sockets!
  try {
    const loanAmount = application.requestedAmount;
    const duration = application.requestedDuration;
    const rate = application.interestRate || 10; // Default 10% if not set

    // Simple EMI Schedule Generation
    const monthlyRate = rate / 12 / 100;
    const emiAmount = Math.round(
      (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, duration)) /
      (Math.pow(1 + monthlyRate, duration) - 1)
    );

    const emiSchedule = [];
    let remainingBal = loanAmount;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() + 1); // First EMI next month

    for (let i = 1; i <= duration; i++) {
      const interest = Math.round(remainingBal * monthlyRate);
      const principalAmount = emiAmount - interest;
      remainingBal -= principalAmount;

      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + (i - 1));

      emiSchedule.push({
        installmentNumber: i,
        dueDate,
        emiAmount,
        principalAmount,
        interestAmount: interest,
        paymentStatus: 'Pending',
      });
    }

    const ActiveLoan = require('../../../models/ActiveLoan');
    const RepaymentSchedule = require('../../../models/RepaymentSchedule');

    const activeLoan = await ActiveLoan.create({
      borrowerId: borrower._id, // Bug Fix: use borrower._id (ref Borrower) instead of application.borrowerId (ref User)
      borrowerName: application.fullName || borrower.fullName || 'Unknown',
      borrowerPhoto: borrower.profilePhoto || null,
      borrowerEmail: application.emailAddress || borrower.email,
      borrowerPhone: application.phoneNumber || borrower.phoneNumber,
      loanApplicationId: application._id,
      loanType: application.loanType || 'Personal Loan',
      approvedAmount: loanAmount,
      interestRate: rate,
      loanDurationMonths: duration,
      emiAmount,
      totalPayableAmount: emiAmount * duration,
      remainingBalance: emiAmount * duration,
      nextDueDate: emiSchedule[0].dueDate,
      repaymentSchedule: emiSchedule,
      approvedBy: application.adminDecision?.approvedBy || null,
      notes: application.adminDecision?.adminNotes || null,
      
      // Metadata added for Requirement 2 & 3:
      applicationId: application.applicationId,
      fullName: application.fullName || borrower.fullName || 'Unknown',
      emailAddress: application.emailAddress || borrower.email,
      phoneNumber: application.phoneNumber || borrower.phoneNumber,
      idNumber: application.idNumber,
      requestedAmount: application.requestedAmount,
      requestedDuration: application.requestedDuration,
      estimatedMonthlyEMI: application.estimatedMonthlyEMI,
      agreementGeneratedAt: application.agreementGeneratedAt || new Date(),
      verificationIp: ip,
      verificationUserAgent: userAgent,
      agreementHtml: application.agreementHtml || agreementHtml,
      agreementPdfUrl: application.agreementPdfUrl || `/api/agreement/document/${application._id}`,
      signedAgreement: application.signedAgreement || documentText,
      otpVerificationStatus: application.otpVerificationStatus || 'VERIFIED',
      processingFee: application.processingFee || 0,
      
      disbursementReady: true,
      disbursementStatus: 'Ready for Disbursement',
      agreementStatus: 'SIGNED',
      agreementSignedAt: signedAtDate,
      agreementDocumentUrl: application.agreementDocumentUrl || `/api/agreement/document/${application._id}`
    });

    // Create records in centralized RepaymentSchedule collection
    const repaymentEntries = emiSchedule.map(emi => ({
      loanId: activeLoan._id,
      borrowerId: borrower._id, // Bug Fix: use borrower._id instead of application.borrowerId
      emiNumber: emi.installmentNumber,
      dueDate: emi.dueDate,
      amount: emi.emiAmount,
      status: 'Pending'
    }));

    await RepaymentSchedule.insertMany(repaymentEntries);

    // COMMISSION LOGIC: If borrower has an assigned agent, generate commission
    if (borrower && borrower.assignedAgent) {
      const Commission = require('../../../models/Commission');
      const commissionPercent = 2.5; // Default 2.5%
      const commissionAmount = (loanAmount * commissionPercent) / 100;

      await Commission.create({
        agentId: borrower.assignedAgent,
        borrowerId: borrower._id,
        loanId: activeLoan._id,
        loanAmount,
        commissionPercent,
        commissionAmount,
        status: 'Pending'
      });
    }

    // Trigger Real-time Notifications & Sockets
    if (borrower) {
      await createNotification({
        title: 'Agreement Signed',
        message: `Congratulations! Your loan agreement for ${application.applicationId} has been successfully signed and verified via OTP.`,
        notificationType: 'Approval Alert',
        priority: 'Important',
        receiverId: borrower._id,
        receiverRole: 'borrower',
        applicationId: application._id
      });

      await BorrowerAlert.create({
        borrowerId: borrower._id,
        title: 'Agreement Signed',
        message: `Your digital loan agreement for ${application.applicationId} has been signed successfully. Status: Ready for Disbursement.`,
        alertType: 'LOAN_APPROVED',
        priority: 'High'
      });

      // Log Activity
      await LoanActivity.create({
        loanId: activeLoan._id,
        borrowerId: borrower._id,
        title: 'Agreement Signed',
        message: `Your loan agreement for ${application.applicationId} was signed successfully via secure OTP.`,
        type: 'StatusChange'
      });

      // Socket notification for borrower
      const io = getIO();
      if (io) {
        const borrowerUserId = borrower.userId.toString();
        io.to(borrowerUserId).emit('loan-updated', { 
          status: 'APPROVED',
          loanId: activeLoan._id,
          message: 'Your loan agreement has been successfully signed!'
        });
        io.to(borrowerUserId).emit('dashboard-updated');
        io.to(borrowerUserId).emit('notification-created');

        // Notify admin
        io.emit('admin:loanSigned', {
          applicationId: application._id,
          borrowerName: application.fullName
        });
      }
    }

    if (borrower && borrower.assignedAgent) {
      // Notify Agent
      await createNotification({
        receiverId: borrower.assignedAgent,
        receiverRole: 'agent',
        type: 'LOAN_APPROVAL',
        title: 'New Loan Signed',
        message: `Your borrower ${borrower.fullName}'s loan application ${application.applicationId} has been signed and is ready for disbursement.`,
        priority: 'IMPORTANT'
      });

      // Socket notification for agent
      const io = getIO();
      if (io) {
        io.to(borrower.assignedAgent.toString()).emit('commission:generated', {
          message: `New commission generated for loan application ${application.applicationId}`,
          borrowerName: borrower.fullName
        });
      }
    }

  } catch (err) {
    console.error('Failed to finalize active loan setup after OTP verification:', err.message);
  }

  return application;
};

/**
 * Transition signed loan to Ready For Disbursement
 */
const markReadyForDisbursement = async (loanApplicationId, adminId) => {
  const application = await LoanApplication.findById(loanApplicationId);
  if (!application) {
    throw new Error('Loan application not found');
  }

  const signedStatuses = ['Agreement Signed', 'AGREEMENT_SIGNED', 'OTP_VERIFIED'];
  if (!signedStatuses.includes(application.status)) {
    throw new Error('Only signed agreements can be marked ready for disbursement.');
  }

  const mandateAccepted = application.debicheckMandateStatus === 'ACCEPTED'
    || application.realPayMandate?.status === 'ACCEPTED'
    || application.nupayMandate?.outcome === 'ACCEPTED';

  if (!mandateAccepted) {
    throw new Error('Cannot mark loan ready for disbursement: DebiCheck mandate status is not ACCEPTED.');
  }

  const staffUser = await User.findById(adminId);
  const staffName = staffUser ? (staffUser.fullName || staffUser.name) : 'Admin';

  application.status = 'Ready for Disbursement';

  application.statusHistory.push({
    status: 'Ready for Disbursement',
    changedBy: staffName,
    notes: 'Loan confirmed and marked as ready for disbursement.',
  });

  await application.save();

  // Socket notification
  try {
    const borrower = await Borrower.findOne({ userId: application.borrowerId });
    const io = getIO();
    if (io && borrower) {
      io.to(borrower.userId.toString()).emit('loan-updated', {
        status: 'Ready for Disbursement',
        message: 'Your loan is now ready for disbursement!'
      });
      io.to(borrower.userId.toString()).emit('dashboard-updated');
    }
  } catch (err) {
    console.error('Failed to notify borrower of ready for disbursement status:', err.message);
  }

  return application;
};

module.exports = {
  generateAgreement,
  sendAgreementOTP,
  signAgreement,
  markReadyForDisbursement,
};
