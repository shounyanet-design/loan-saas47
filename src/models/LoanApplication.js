const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');

const loanApplicationSchema = new mongoose.Schema(
  {
    applicationId: {
      type: String,
      // Uniqueness enforced per-tenant via a compound index (below).
      required: true,
    },
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Personal Info (Captured in Step 1)
    fullName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    emailAddress: { type: String, required: true },
    idNumber: { type: String, required: true },
    dateOfBirth: { type: Date, required: true },
    residentialAddress: { type: String, required: true },

    // Financial Totals (Calculated from Banking/Admin Settings)
    requestedAmount: { type: Number },
    requestedDuration: { type: Number }, // In months
    loanType: { type: String, default: 'Personal Loan' },
    processingFee: { type: Number },
    interestRate: { type: Number },
    estimatedMonthlyEMI: { type: Number },
    totalRepayment: { type: Number },
    repaymentDate: { type: Date },

    // Authoritative Itemized Financial Snapshots
    financialSnapshot: {
      principalAmount: { type: Number, default: 0 },
      annualInterestRate: { type: Number, default: 0 },
      monthlyInterestRate: { type: Number, default: 0 },
      durationMonths: { type: Number, default: 1 },
      interestType: { type: String, default: 'Reducing Balance' },
      baseEmi: { type: Number, default: 0 },
      pureInterestAmount: { type: Number, default: 0 },
      initiationFeeAmount: { type: Number, default: 0 },
      monthlyServiceFee: { type: Number, default: 0 },
      totalServiceFeeAmount: { type: Number, default: 0 },
      insuranceAmount: { type: Number, default: 0 },
      vatAmount: { type: Number, default: 0 },
      totalCostOfCreditAmount: { type: Number, default: 0 },
      totalRepaymentAmount: { type: Number, default: 0 },
      monthlyInstallmentAmount: { type: Number, default: 0 },
      calculatedAt: { type: Date, default: Date.now },
      calculatorVersion: { type: String, default: '2.0.0' }
    },
    agreementFinancialSnapshot: {
      principalAmount: { type: Number, default: 0 },
      annualInterestRate: { type: Number, default: 0 },
      monthlyInterestRate: { type: Number, default: 0 },
      durationMonths: { type: Number, default: 1 },
      interestType: { type: String, default: 'Reducing Balance' },
      baseEmi: { type: Number, default: 0 },
      pureInterestAmount: { type: Number, default: 0 },
      initiationFeeAmount: { type: Number, default: 0 },
      monthlyServiceFee: { type: Number, default: 0 },
      totalServiceFeeAmount: { type: Number, default: 0 },
      insuranceAmount: { type: Number, default: 0 },
      vatAmount: { type: Number, default: 0 },
      totalCostOfCreditAmount: { type: Number, default: 0 },
      totalRepaymentAmount: { type: Number, default: 0 },
      monthlyInstallmentAmount: { type: Number, default: 0 },
      calculatedAt: { type: Date },
      calculatorVersion: { type: String }
    },

    // Status Tracking
    status: {
      type: String,
      enum: ['Draft', 'New', 'Submitted', 'Pending Review', 'Under Review', 'Reviewed', 'Recommended', 'Pending Verification', 'Approved', 'APPROVED', 'ACTIVE', 'STAFF_VERIFIED', 'ADMIN_APPROVED_PENDING_SIGNATURE', 'OTP_SENT', 'Rejected', 'Disbursed', 'Hold', 'Agreement Pending', 'Agreement Signed', 'Ready for Disbursement', 'SUBMITTED', 'UNDER_REVIEW', 'STAFF_RECOMMENDED', 'AGREEMENT_PENDING_VERIFICATION', 'OTP_VERIFIED', 'AGREEMENT_SIGNED', 'READY_FOR_DISBURSEMENT', 'REJECTED', 'DISBURSED'],
      default: 'Draft',
    },
    
    disbursementStatus: {
      type: String,
      enum: ['READY_FOR_DISBURSEMENT', 'DISBURSED'],
      default: null
    },
    
    // Submission flags
    confirmationAccepted: { type: Boolean, default: false },
    submittedAt: { type: Date },

    // Credit-risk API readiness fields (populated at submission, used by future bureau integrations)
    creditConsentAccepted: { type: Boolean, default: false },
    creditConsentAcceptedAt: { type: Date },
    documentVerificationStatus: {
      type: String,
      enum: ['Pending', 'Complete', 'Incomplete'],
      default: 'Pending',
    },
    creditRiskReady: { type: Boolean, default: false },
    applicationAuditStatus: {
      type: String,
      enum: ['Ready For Review', 'Missing Documents', 'Awaiting Verification', 'Credit Consent Missing', 'Incomplete'],
      default: 'Incomplete',
    },
    
    reviewStatus: {
      type: String,
      enum: ['Pending', 'Under Review', 'Recommendation Submitted', 'Rejected Recommendation', 'Reviewed', 'Pending Review', 'Approved', 'Rejected', 'Hold'],
      default: 'Pending'
    },

    uploadedDocsStatus: {
      type: String,
      enum: ['Pending', 'Complete', 'Incomplete'],
      default: 'Pending'
    },

    documentVerification: {
      idProofStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
      idProofNotes: String,
      payslipStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
      payslipNotes: String,
      bankStatementStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
      bankStatementNotes: String,
      proofOfAddressStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
      proofOfAddressNotes: String
    },

    staffReview: {
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      staffName: String,
      verificationNotes: String,
      recommendation: { type: String, enum: ['Pending', 'Recommended', 'Recommended for Approval', 'Recommended for Rejection', 'Recommend Approval', 'Recommend Rejection', 'Rejected', 'Put On Hold'], default: 'Pending' },
      riskLevel: { type: String, enum: ['Low', 'Medium', 'High', 'Critical', 'N/A'], default: 'N/A' },
      verificationDate: Date
    },

    adminDecision: {
      decision: { type: String, enum: ['Approved', 'Rejected', 'Hold', 'Pending'], default: 'Pending' },
      adminNotes: String,
      approvedAmount: Number,
      finalDuration: Number,
      interestOverride: Number,
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedDate: Date,
      rejectionReason: String,
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      rejectedDate: Date,
      holdReason: String,
      holdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      holdDate: Date
    },

    statusHistory: [
      {
        status: String,
        changedBy: String,
        notes: String,
        changedAt: { type: Date, default: Date.now }
      }
    ],

    recommendationNotes: String,
    rejectionReason: String,
    internalReviewNotes: String,
    
    // Timeline/Milestones
    reviewedAt: { type: Date },
    approvedAt: { type: Date },
    rejectedAt: { type: Date },
    disbursedAt: { type: Date },

    // Link to the created ActiveLoan record (set at actual disbursement)
    activeLoanId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActiveLoan', default: null },

    // Communication
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },

    // Assignment Details
    assignedReviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date },

    staffReviewLocked: {
      type: Boolean,
      default: false
    },
    staffReviewCompleted: {
      type: Boolean,
      default: false
    },
    reviewSubmittedAt: {
      type: Date
    },
    reviewLockedAt: {
      type: Date
    },
    reviewStage: {
      type: String,
      enum: [
        "PENDING",
        "UNDER_REVIEW",
        "FINALIZED",
        "REOPENED"
      ],
      default: "PENDING"
    },

    // ── KYC Biometric Verification (Datanamix Profile Plus ID Photo Match) ──
    kycVerification: {
      verificationStatus: {
        type: String,
        enum: ['Pending', 'Verified', 'Failed', 'Overridden'],
        default: 'Pending'
      },
      responseStatusCode: { type: Number },
      responseMessage: { type: String },
      faceMatchScore: { type: Number },
      verificationReference: { type: String },
      verificationTimestamp: { type: Date },
      fraudFlags: [{ type: String }],
      extractedOCRData: { type: mongoose.Schema.Types.Mixed, default: {} },
      verificationPdf: { type: String },
      verifiedPhotoUrl: { type: String },
      verifiedPhotoFileId: { type: String },
      reportPdfUrl: { type: String },
      reportPdfPath: { type: String },
      reportReference: { type: String },
      isReused: { type: Boolean, default: false },
      originalVerifiedAt: { type: Date },
      reusedAt: { type: Date },
      idNumberMatch: { type: Boolean },
      photoMatch: { type: Boolean },
      rawApiResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      overrideReason: { type: String },
      overrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      overrideAt: { type: Date },
      verificationSource: { type: String, default: 'DATANAMIX' },
      verificationProvider: { type: String, default: 'Profile Plus ID Photo Match' }
    },

    // ── Bureau / Address Plus Profile IDV (Datanamix) ────────────────────────
    bureauVerification: {
      verificationStatus: {
        type: String,
        enum: ['Pending', 'Verified', 'Warning', 'Failed', 'Rejected', 'Overridden'],
        default: 'Pending'
      },
      responseCode:    { type: Number },
      responseMessage: { type: String },
      bureauReference: { type: String },

      // Bureau-verified identity fields
      verifiedFirstName:          { type: String },
      verifiedSurname:            { type: String },
      verifiedPhone:              { type: String },
      verifiedEmail:              { type: String },
      verifiedEmployer:           { type: String },
      verifiedResidentialAddress: { type: String },
      verifiedPostalAddress:      { type: String },

      // Fraud / deceased
      deceasedStatus: { type: Boolean, default: false },
      deceasedDate:   { type: String },
      safpsFlag:      { type: Boolean, default: false },
      fraudIndicators: [{ type: String }],

      // Address history array
      addressHistory: [{ type: mongoose.Schema.Types.Mixed }],

      // PDF report (base64)
      pdfReport: { type: String },

      // Raw API response
      bureauRawResponse: { type: mongoose.Schema.Types.Mixed, default: {} },

      verifiedAt: { type: Date },

      // Mismatch engine output
      comparedFields: { type: mongoose.Schema.Types.Mixed, default: {} },
      mismatchFlags:  [{ type: String }],

      // Override
      overrideReason: { type: String },
      overrideBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      overrideAt:     { type: Date },

      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },

    // ── Phone Verification (Datanamix Contact To ID — Step 1.75) ────────────
    phoneVerification: {
      verificationStatus: {
        type: String,
        enum: ['Pending', 'Verified', 'Rejected', 'Failed'],
        default: 'Pending',
      },
      verifiedPhoneNumber: { type: String },
      reportReference:     { type: String },
      ownershipMatched:    { type: Boolean, default: false },
      mismatchDetected:    { type: Boolean, default: false },
      mismatchReason:      { type: String },
      matchedConsumers:    [{ type: mongoose.Schema.Types.Mixed }],
      verifiedAt:          { type: Date },
      rawResponse:         { type: mongoose.Schema.Types.Mixed, default: {} },
    },

    // ── Bank Account Verification (Datanamix AVS Advanced — Step 3) ─────────
    bankVerification: {
      verificationStatus: {
        type: String,
        enum: ['Pending', 'Verified', 'VerifiedWithWarnings', 'Rejected', 'Failed', 'VERIFIED', 'VERIFIED_WITH_WARNINGS', 'FAILED', 'NOT_FOUND'],
        default: 'Pending',
      },
      status:               { type: String, default: 'Pending' },
      avsStatus:            { type: String },
      statusMessage:        { type: String },
      verificationLevel:    { type: String },
      accountFound:         { type: String },
      accountOpen:          { type: String },
      acceptsCredits:       { type: String },
      identityMatch:        { type: String },
      accountTypeMatch:     { type: String },
      initialsMatch:        { type: String },
      nameMatch:            { type: String },
      emailMatch:           { type: String },
      phoneMatch:           { type: String },
      bankReference:        { type: String },
      bankStatusCode:       { type: String },
      bankStatusMessage:    { type: String },
      reportReference:      { type: String },
      verifiedAt:           { type: Date },
      verificationTimestamp:{ type: Date },
      verifiedBankAccount:  { type: String },
      verifiedBranchCode:   { type: String },
      verifiedAccountType:  { type: String },
      pdfReport:            { type: String },
      pdfReportPath:        { type: String },
      pdfHash:              { type: String },
      verificationVersion:  { type: Number, default: 1 },
      rawResponse:          { type: mongoose.Schema.Types.Mixed, default: {} },
      verifiedBy:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      fraudIndicators:      [{ type: String }],
      mismatchFlags:        [{ type: String }],
      sandboxBypassEnabled: { type: Boolean, default: false },
      environmentType:      { type: String },
      bypassReason:         { type: String },
      bypassActivatedAt:    { type: Date }
    },

    // ── Consumer Credit Report Search (Datanamix — Step 2) ──────────────────
    creditAssessment: {
      verificationStatus: {
        type: String,
        enum: ['Pending', 'Verified', 'Warning', 'Failed'],
        default: 'Pending'
      },
      enquiryId:       { type: String },
      enquiryResultId: { type: String },

      matchedConsumers: [
        {
          consumerId:      { type: String },
          firstName:       { type: String },
          surname:         { type: String },
          idNo:            { type: String },
          birthDate:       { type: Date },
          gender:          { type: String },
          enquiryId:       { type: String },
          enquiryResultId: { type: String },
          reference:       { type: String }
        }
      ],

      reportReference: { type: String },
      reportDate:      { type: Date },
      searchSuccess:   { type: Boolean },
      responseCode:    { type: Number },

      overrideReason: { type: String },
      overriddenBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      overriddenAt:   { type: Date },

      completedAt: { type: Date },

      underwritingDecision: { type: String },
      riskSeverity:         { type: String },
      eligibilityStatus:    { type: String },
      workflowRoute:        { type: String },
      verificationHash:     { type: String }
    },

    // ── Consumer Credit Report Result (Datanamix — Step 4) ───────────────────
    consumerCreditReport: {
      verificationStatus: {
        type: String,
        enum: ['Pending', 'Verified', 'Failed', 'Partial'],
        default: 'Pending'
      },
      completedAt:     { type: Date },
      reportReference: { type: String },
      reportDate:      { type: String },
      enquiryId:       { type: String },
      enquiryResultId: { type: String },

      // Credit score section
      scoring: {
        finalScore:       { type: Number },
        classification:   { type: String },
        riskCategory:     { type: String },
        scoreDescription: { type: String },
        modelId:          { type: String },
        reasonCodes:      [{ type: String }]
      },

      // Debt metrics
      debtSummary: {
        totalOutstandingDebt:    { type: Number },
        totalMonthlyInstallment: { type: Number },
        totalArrearsAmount:      { type: Number },
        totalAdverseAmount:      { type: Number },
        judgementCount:          { type: Number, default: 0 },
        courtNoticeCount:        { type: Number, default: 0 },
        defaultListingCount:     { type: Number, default: 0 },
        highestMonthsInArrears:  { type: Number, default: 0 }
      },

      // Fraud flags
      fraudIndicators: {
        safpsListed:        { type: Boolean, default: false },
        deceasedStatus:     { type: Boolean, default: false },
        debtReviewStatus:   { type: Boolean, default: false },
        homeAffairsVerified:{ type: Boolean, default: false }
      },

      // Underwriting decision
      underwriting: {
        level:       { type: String },   // APPROVE | REVIEW REQUIRED | HIGH RISK | VERY HIGH RISK | DECLINE
        riskCategory:{ type: String },
        reasons:     [{ type: String }]
      },

      // All deeply-nested arrays stored as Mixed for flexibility
      consumerDetails:      { type: mongoose.Schema.Types.Mixed, default: {} },
      accountSummary:       [{ type: mongoose.Schema.Types.Mixed }],
      adverseInformation:   { type: mongoose.Schema.Types.Mixed, default: {} },
      properties:           [{ type: mongoose.Schema.Types.Mixed }],
      directorships:        [{ type: mongoose.Schema.Types.Mixed }],
      addressHistory:       [{ type: mongoose.Schema.Types.Mixed }],
      contactHistory:       [{ type: mongoose.Schema.Types.Mixed }],
      emailHistory:         [{ type: mongoose.Schema.Types.Mixed }],
      employmentHistory:    [{ type: mongoose.Schema.Types.Mixed }],
      enquiryHistory:       [{ type: mongoose.Schema.Types.Mixed }],
      monthlyPaymentHistory:[{ type: mongoose.Schema.Types.Mixed }],

      pdfReport:   { type: String },
      rawResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
      verificationHash: { type: String }
    },

    // ── AML & Sanctions Screening ────────────────────────────────────────────
    amlVerification: {
      verificationStatus: {
        type: String,
        enum: [
          "NOT_STARTED",
          "VERIFYING",
          "CLEARED",
          "CLEAR",
          "MANUAL_REVIEW",
          "AUTO_REJECT",
          "HIGH_RISK",
          "FAILED"
        ],
        default: "NOT_STARTED"
      },
      amlScore: Number,
      found: Boolean,
      pepMatch: Boolean,
      sanctionsMatch: Boolean,
      terrorMatch: Boolean,
      fraudMatch: Boolean,
      adverseMediaMatch: Boolean,
      ofacMatch: Boolean,
      fatfMatch: Boolean,
      riskLevel: String,
      riskReason: String,
      reportReference: String,
      clientReference: String,
      matchCount: Number,
      matchedEntities: [],
      screeningDate: Date,
      rawResponse: {},
      pdfReport: String,
      sanctionsStatus: String,
      complianceDecision: String,
      isBlocked: { type: Boolean, default: false },
      screeningTimestamp: Date
    },

    // ── Enterprise AML & Sanctions Compliance ──────────────────────────────
    compliance: {
      aml: {
        verificationStatus: { type: String, default: 'NOT_STARTED' },
        complianceDecision: { type: String },
        riskLevel: { type: String },
        amlScore: { type: Number },
        sanctionsStatus: { type: String },
        reportReference: { type: String },
        isBlocked: { type: Boolean, default: false },
        ofacMatch: { type: Boolean, default: false },
        sanctionsMatch: { type: Boolean, default: false },
        terrorMatch: { type: Boolean, default: false },
        pepMatch: { type: Boolean, default: false },
        fatfMatch: { type: Boolean, default: false },
        adverseMediaMatch: { type: Boolean, default: false },
        riskReason: { type: String },
        matchedEntities: { type: Array, default: [] },
        rawResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
        verifiedAt: { type: Date },
        provider: { type: String, default: 'DATANAMIX' },
        pdfPath: { type: String },
        pdfHash: { type: String },
        version: { type: Number, default: 1 }
      }
    },

    // Root-level gating metrics updated by compliance runs
    complianceGate: { type: String },
    approvalEligibility: { type: String },
    disbursementEligibility: { type: String },

    // Digital Agreement Signature Fields
    agreementGenerated: { type: Boolean, default: false },
    agreementGeneratedAt: { type: Date },
    agreementSignedAt: { type: Date },
    agreementStatus: { type: String, enum: ['Not Generated', 'Pending', 'Signed', 'PENDING SIGNATURE', 'SIGNED'], default: 'Not Generated' },
    otpVerificationStatus: { type: String, enum: ['Pending', 'Verified', 'Failed', 'VERIFIED'], default: 'Pending' },
    agreementDocumentUrl: { type: String, default: '' },
    borrowerConsentVerified: { type: Boolean, default: false },
    agreementHtml: { type: String, default: '' },
    agreementPdfUrl: { type: String, default: '' },
    signedAgreement: { type: String, default: '' },
    agreementCreditProviderSnapshot: {
      tenantId: { type: String, default: '' },
      legalName: { type: String, default: '' },
      tradingName: { type: String, default: '' },
      cipcRegistrationNumber: { type: String, default: '' },
      ncrRegistrationNumber: { type: String, default: '' },
      vatNumber: { type: String, default: '' },
      telephone: { type: String, default: '' },
      email: { type: String, default: '' },
      registeredAddress: {
        addressLine1: { type: String, default: '' },
        addressLine2: { type: String, default: '' },
        city: { type: String, default: '' },
        province: { type: String, default: '' },
        postalCode: { type: String, default: '' },
        country: { type: String, default: '' }
      },
      authorizedSignatory: {
        fullName: { type: String, default: '' },
        designation: { type: String, default: '' }
      },
      logoUrl: { type: String, default: '' }
    },
    debicheckMandateStatus: { type: String, default: '' },
    debicheckMandateReference: { type: String, default: '' },
    nupayMandate: {
      outcome: { type: String, enum: ['ACCEPTED', 'PENDING', 'REJECTED', 'UNKNOWN', ''], default: '' },
      providerStatus: { type: String, default: '' },
      resultCode: { type: String, default: '' },
      mandateId: { type: String, default: '' },
      clientReference: { type: String, default: '' },
      contractReference: { type: String, default: '' },
      providerTransactionId: { type: String, default: '' },
      providerMessageId: { type: String, default: '' },
      effectiveDate: { type: String, default: '' },
      statusDescription: { type: String, default: '' },
      callbackRequestId: { type: String, default: '' },
      callbackReceivedAt: { type: Date },
      updatedAt: { type: Date }
    },
    realPayMandate: {
      providerReference: { type: String, default: '' },
      mandateId: { type: String, default: '' },
      contractSequence: { type: String, default: '' },
      instalmentSequence: { type: String, default: '' },
      status: { type: String, default: '' },
      statusCode: { type: String, default: '' },
      statusDescription: { type: String, default: '' },
      product: { type: String, default: '' },
      clientReference: { type: String, default: '' },
      contractReference: { type: String, default: '' },
      createdAt: { type: Date },
      updatedAt: { type: Date },
      lastWebhookAt: { type: Date }
    },
    realPayClient: {
      clientNumber: { type: String, default: '' },
      registered: { type: Boolean, default: false },
      providerReference: { type: String, default: '' },
      status: { type: String, default: '' },
      statusCode: { type: String, default: '' },
      statusDescription: { type: String, default: '' },
      registeredAt: { type: Date },
      lastCheckedAt: { type: Date }
    },
    realPaySimulation: {
      environment: { type: String, default: 'UAT' },
      mandate: {
        requestedAt: { type: Date },
        contractSequence: { type: String, default: '' },
        statusCode: { type: String, default: '' },
        result: { type: String, default: '' },
        providerStatus: { type: String, default: '' },
        providerMessage: { type: String, default: '' },
        completedAt: { type: Date }
      },
      instalment: {
        requestedAt: { type: Date },
        contractSequence: { type: String, default: '' },
        instalmentSequence: { type: String, default: '' },
        statusCode: { type: String, default: '' },
        result: { type: String, default: '' },
        providerStatus: { type: String, default: '' },
        providerMessage: { type: String, default: '' },
        completedAt: { type: Date }
      }
    },

    // ── Consumer Credit Report Result (Datanamix — Dynamic Underwriting) ──
    consumerCreditReportRaw: { type: mongoose.Schema.Types.Mixed, default: {} },
    consumerCreditScore:     { type: Number },
    consumerRiskCategory:    { type: String },
    consumerDebtSummary:     { type: mongoose.Schema.Types.Mixed, default: {} },
    fraudIndicators:         { type: mongoose.Schema.Types.Mixed, default: {} },
    affordabilityOutcome:    { type: Object, default: {} },
    underwritingDecision:    { type: String },
    workflowRoute:           { type: String },
    bureauRecommendation:    { type: String },
    bureauReportFetchedAt:   { type: Date }
  },
  {
    timestamps: true,
  }
);

// Auto-generate Application ID before validation
loanApplicationSchema.pre('validate', async function () {
  if (this.isNew && !this.applicationId) {
    try {
      const lastApplication = await mongoose
        .model('LoanApplication')
        .findOne({ applicationId: /^LAPP-\d+$/ }, {}, { sort: { applicationId: -1 } });
      let nextId = 1001;
      if (lastApplication && lastApplication.applicationId) {
        const lastIdMatch = lastApplication.applicationId.match(/^LAPP-(\d+)$/);
        if (lastIdMatch) {
          nextId = parseInt(lastIdMatch[1], 10) + 1;
        }
      }
      this.applicationId = `LAPP-${nextId}`;
    } catch (err) {
      throw err;
    }
  }
});



loanApplicationSchema.plugin(tenantPlugin);

// Tenant-scoped uniqueness (each tenant has its own applicationId sequence).
loanApplicationSchema.index({ tenantId: 1, applicationId: 1 }, { unique: true });
// Hot-path query indexes: dashboards/lists filter+sort by status over time and
// look up applications per borrower. Additive — safe background builds.
loanApplicationSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
loanApplicationSchema.index({ tenantId: 1, borrowerId: 1 });

module.exports = mongoose.model('LoanApplication', loanApplicationSchema);
