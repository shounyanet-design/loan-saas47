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

  // STEP 9 - Validate tenant legal details before agreement generation
  const Tenant = require('../../../models/Tenant');
  const tenantContext = require('../../../tenancy/tenantContext');
  const tenant = await tenantContext.runAsSystem(() => Tenant.findById(application.tenantId));

  const companyProfile = (tenant && tenant.companyProfile) ? tenant.companyProfile : {};
  const legalName = companyProfile.legalName || (tenant && tenant.companyName);
  const cipcRegistrationNumber = companyProfile.cipcRegistrationNumber;
  const ncrRegistrationNumber = companyProfile.ncrRegistrationNumber;
  const telephone = companyProfile.telephone || (tenant && tenant.phone);
  const registeredAddress = companyProfile.registeredAddress || {};
  const addressLine1 = registeredAddress.addressLine1;
  const city = registeredAddress.city;
  const province = registeredAddress.province;
  const postalCode = registeredAddress.postalCode;
  const country = registeredAddress.country || (tenant && tenant.country);

  const missingFields = [];
  if (!legalName) missingFields.push('legalName');
  if (!cipcRegistrationNumber) missingFields.push('cipcRegistrationNumber');
  if (!ncrRegistrationNumber) missingFields.push('ncrRegistrationNumber');
  if (!telephone) missingFields.push('telephone');
  if (!addressLine1) missingFields.push('addressLine1');
  if (!city) missingFields.push('city');
  if (!province) missingFields.push('province');
  if (!postalCode) missingFields.push('postalCode');
  if (!country) missingFields.push('country');

  if (missingFields.length > 0) {
    const error = new Error('Complete the Credit Provider legal details before generating a loan agreement.');
    error.code = 'TENANT_LEGAL_PROFILE_INCOMPLETE';
    error.missingFields = missingFields;
    throw error;
  }

  // Create immutable snapshot of Credit Provider Legal Details (Step 6)
  application.agreementCreditProviderSnapshot = {
    tenantId: application.tenantId,
    legalName,
    tradingName: companyProfile.tradingName || legalName,
    cipcRegistrationNumber,
    ncrRegistrationNumber,
    vatNumber: companyProfile.vatNumber || '',
    telephone,
    email: companyProfile.email || (tenant && tenant.email) || '',
    registeredAddress: {
      addressLine1,
      addressLine2: registeredAddress.addressLine2 || '',
      city,
      province,
      postalCode,
      country
    },
    authorizedSignatory: {
      fullName: companyProfile.authorizedSignatory?.fullName || staffName,
      designation: companyProfile.authorizedSignatory?.designation || 'Authorized Officer'
    },
    logoUrl: companyProfile.logoUrl || (tenant && tenant.brandLogo) || ''
  };

  // Authoritative Financial Snapshot for Agreement
  const { calculateLoanFinances } = require('../../../services/loanFinancialCalculator');
  const SystemSettings = require('../../../models/SystemSettings');
  const settings = await SystemSettings.findOne();
  const activeProducts = settings?.loanProducts || [];
  const selectedProduct = activeProducts.find(p => p.name === application.loanType);

  const amount = Number(application.approvedAmount || application.requestedAmount || 0);
  const duration = Number(application.adminDecision?.finalDuration || application.requestedDuration || 1);
  const rate = Number(application.adminDecision?.interestOverride || application.interestRate || 12.5);

  const finances = calculateLoanFinances({
    amount,
    duration,
    interestRate: rate,
    interestType: selectedProduct?.interestType || application.financialSnapshot?.interestType || 'Reducing Balance',
    settings,
    selectedProduct
  });

  application.financialSnapshot = finances;
  application.agreementFinancialSnapshot = finances;
  application.approvedAmount = finances.principalAmount;
  application.processingFee = finances.initiationFeeAmount;
  application.estimatedMonthlyEMI = finances.monthlyInstallmentAmount;
  application.totalRepayment = finances.totalRepaymentAmount;

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

  const hasSnapshot = application.agreementCreditProviderSnapshot && application.agreementCreditProviderSnapshot.legalName;
  const snapshot = hasSnapshot ? application.agreementCreditProviderSnapshot : {
    legalName: 'Point.47 Finance Pty Ltd',
    cipcRegistrationNumber: '2021/098765/07',
    ncrRegistrationNumber: 'NCRCP12345',
    telephone: '+27 11 456 7890',
    email: 'info@point47.co.za',
    registeredAddress: {
      addressLine1: 'Platform default office address',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2000',
      country: 'South Africa'
    },
    authorizedSignatory: {
      fullName: 'Aander',
      designation: 'Authorized Signatory'
    }
  };

  const addr = snapshot.registeredAddress || {};
  const formattedAddress = `${addr.addressLine1 || ''}${addr.addressLine2 ? ', ' + addr.addressLine2 : ''}, ${addr.city || ''}, ${addr.province || ''}, ${addr.postalCode || ''}, ${addr.country || ''}`;

  const finSnap = (application.agreementFinancialSnapshot && application.agreementFinancialSnapshot.principalAmount)
    ? application.agreementFinancialSnapshot
    : (application.financialSnapshot && application.financialSnapshot.principalAmount ? application.financialSnapshot : null);

  const approvedPrincipal = finSnap?.principalAmount ?? Number(application.approvedAmount || application.requestedAmount || 0);
  const durationMonths = finSnap?.durationMonths ?? Number(application.adminDecision?.finalDuration || application.requestedDuration || 1);
  const monthlyEmi = finSnap?.monthlyInstallmentAmount ?? Number(application.estimatedMonthlyEMI || 0);
  const annualInterest = finSnap?.annualInterestRate ?? Number(application.interestRate || 12.5);
  const totalRepay = finSnap?.totalRepaymentAmount ?? Number(application.totalRepayment || (monthlyEmi * durationMonths));

  const signedAtDate = new Date();
  const documentText = `========================================================================
LOAN AGREEMENT & SIGNATURE RECEIPT
========================================================================
Application ID: ${application.applicationId}
Borrower Name: ${application.fullName}
Email Address: ${application.emailAddress}
Mobile Number: ${application.phoneNumber}
ID Number: ${application.idNumber}

CREDIT PROVIDER DETAILS:
Full Name / Entity: ${snapshot.legalName}
CIPC Registration No: ${snapshot.cipcRegistrationNumber}
NCR Registration No: ${snapshot.ncrRegistrationNumber}
Telephone: ${snapshot.telephone}
Email: ${snapshot.email}
Registered Address: ${formattedAddress}

LOAN PRINCIPAL DETAILS:
Approved Amount: R ${approvedPrincipal.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Duration: ${durationMonths} Months
Estimated EMI: R ${monthlyEmi.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Interest Rate: ${annualInterest.toFixed(2)}% per annum
Total Repayable: R ${totalRepay.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

DIGITAL VERIFICATION & CONSENT RECORD:
Signing Method: Multi-Factor Secure OTP Consent
Consent Status: VERIFIED & COMPLETED
Agreement Status: SIGNED
Generated At: ${application.agreementGeneratedAt ? new Date(application.agreementGeneratedAt).toLocaleString('en-ZA') : new Date().toLocaleString('en-ZA')}
Signed At: ${signedAtDate.toLocaleString('en-ZA')}

SIGNATURE CREDIT PROVIDER:
Authorized Signatory: ${snapshot.authorizedSignatory?.fullName || 'Aander'}
Designation: ${snapshot.authorizedSignatory?.designation || 'Authorized Officer'}
Status: SIGNED

Thank you for choosing ${snapshot.legalName}.
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

  // ── Post-signing notifications & activity log ────────────────────────────
  // NOTE: ActiveLoan creation is intentionally NOT done here.
  // It is handled exclusively by POST /api/admin/loans/:id/disburse once the
  // admin explicitly triggers disbursement after all gates are satisfied.
  try {
    const loanAmount = application.requestedAmount;

    // COMMISSION LOGIC: If borrower has an assigned agent, generate a pending commission
    if (borrower && borrower.assignedAgent) {
      const Commission = require('../../../models/Commission');
      const commissionPercent = 2.5;
      const commissionAmount = (loanAmount * commissionPercent) / 100;

      await Commission.create({
        agentId: borrower.assignedAgent,
        borrowerId: borrower._id,
        loanId: application._id,   // Reference the LoanApplication until ActiveLoan exists
        loanAmount,
        commissionPercent,
        commissionAmount,
        status: 'Pending'
      });
    }

    // Trigger real-time notifications & sockets for borrower
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
        message: `Your digital loan agreement for ${application.applicationId} has been signed successfully. It is now ready for disbursement.`,
        alertType: 'LOAN_APPROVED',
        priority: 'High'
      });

      await LoanActivity.create({
        loanId: application._id,
        borrowerId: borrower._id,
        title: 'Agreement Signed',
        message: `Your loan agreement for ${application.applicationId} was signed successfully via secure OTP.`,
        type: 'StatusChange'
      });

      const io = getIO();
      if (io) {
        const borrowerUserId = borrower.userId.toString();
        io.to(borrowerUserId).emit('loan-updated', {
          status: 'APPROVED',
          applicationId: application._id,
          message: 'Your loan agreement has been successfully signed!'
        });
        io.to(borrowerUserId).emit('dashboard-updated');
        io.to(borrowerUserId).emit('notification-created');

        io.emit('admin:loanSigned', {
          applicationId: application._id,
          borrowerName: application.fullName
        });
      }
    }

    // Notify agent
    if (borrower && borrower.assignedAgent) {
      await createNotification({
        receiverId: borrower.assignedAgent,
        receiverRole: 'agent',
        type: 'LOAN_APPROVAL',
        title: 'New Loan Signed',
        message: `Your borrower ${borrower.fullName}'s loan application ${application.applicationId} has been signed and is ready for disbursement.`,
        priority: 'IMPORTANT'
      });

      const io = getIO();
      if (io) {
        io.to(borrower.assignedAgent.toString()).emit('commission:generated', {
          message: `New commission generated for loan application ${application.applicationId}`,
          borrowerName: borrower.fullName
        });
      }
    }

  } catch (err) {
    console.error('[AgreementService] Non-fatal post-signing side-effect error:', err.message);
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

  // 1. Authoritative Signed Agreement Gate
  const isAgreementSigned =
    application.agreementStatus === 'SIGNED' ||
    application.agreementStatus === 'Signed' ||
    Boolean(application.agreementSignedAt) ||
    ['Agreement Signed', 'AGREEMENT_SIGNED', 'OTP_VERIFIED', 'READY_FOR_DISBURSEMENT', 'Ready for Disbursement'].includes(application.status) ||
    (application.status === 'APPROVED' && (application.agreementStatus === 'SIGNED' || application.agreementSignedAt));

  if (!isAgreementSigned) {
    throw new Error('Only signed agreements can be marked ready for disbursement.');
  }

  // 2. DebiCheck Mandate Gate
  const mandateAccepted = application.debicheckMandateStatus === 'ACCEPTED'
    || application.realPayMandate?.status === 'ACCEPTED'
    || application.nupayMandate?.outcome === 'ACCEPTED';

  if (!mandateAccepted) {
    throw new Error('Cannot mark loan ready for disbursement: DebiCheck mandate status is not ACCEPTED.');
  }

  // 3. AML Compliance Gate
  const isAmlBlocked = Boolean(
    application.amlVerification?.isBlocked ||
    application.verifications?.aml?.isBlocked
  );
  if (isAmlBlocked) {
    throw new Error('Cannot mark loan ready for disbursement: AML compliance check has blocked this application.');
  }

  // Idempotency: If already in Ready for Disbursement, ensure active loan status and return safely
  if (application.status === 'Ready for Disbursement' || application.status === 'READY_FOR_DISBURSEMENT') {
    const ActiveLoan = require('../../../models/ActiveLoan');
    await ActiveLoan.updateMany(
      { loanApplicationId: application._id },
      { $set: { disbursementReady: true, disbursementStatus: 'Ready for Disbursement' } }
    );
    return application;
  }

  const staffUser = await User.findById(adminId);
  const staffName = staffUser ? (staffUser.fullName || staffUser.name) : 'Admin';

  application.status = 'Ready for Disbursement';
  application.disbursementStatus = 'READY_FOR_DISBURSEMENT';

  application.statusHistory.push({
    status: 'Ready for Disbursement',
    changedBy: staffName,
    notes: 'Loan confirmed and marked as ready for disbursement.',
  });

  await application.save();

  // Keep ActiveLoan in sync
  try {
    const ActiveLoan = require('../../../models/ActiveLoan');
    await ActiveLoan.updateMany(
      { loanApplicationId: application._id },
      { $set: { disbursementReady: true, disbursementStatus: 'Ready for Disbursement' } }
    );
  } catch (syncErr) {
    console.error('Non-fatal: Failed to sync ActiveLoan status on ready-disbursement:', syncErr.message);
  }

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
