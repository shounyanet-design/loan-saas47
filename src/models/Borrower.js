const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');
const bcrypt = require('bcryptjs');

const borrowerSchema = new mongoose.Schema(
  {
    // PERSONAL DETAILS
    fullName: {
      type: String,
      required: [true, 'Please add a full name'],
    },
    idNumber: {
      type: String,
      // Uniqueness enforced per-tenant via a partial compound index (below).
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      // Uniqueness enforced per-tenant via a compound index (below).
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please add a valid email'],
    },
    phoneNumber: {
      type: String,
      required: [true, 'Please add a phone number'],
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: 6,
      select: false,
    },
    physicalAddress: {
      type: String,
    },
    residentialArea: {
      type: String,
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
    },
    dateOfBirth: {
      type: Date,
    },
    profilePhoto: {
      type: String,
      default: 'no-photo.jpg',
    },
    profilePhotoFileId: {
      type: String,
    },

    // EMPLOYMENT
    employerName: {
      type: String,
    },
    occupation: {
      type: String,
    },
    employmentStatus: {
      type: String,
      enum: ['Permanent', 'Contract', 'Self-Employed', 'Unemployed'],
    },
    monthlyNetSalary: {
      type: Number,
    },
    yearsOfService: {
      type: Number,
    },
    workAddress: {
      type: String,
    },

    // BANKING INFORMATION
    bankName: {
      type: String,
    },
    accountNumber: {
      type: String,
    },
    branchCode: {
      type: String,
    },
    accountType: {
      type: String,
    },
    accountHolderName: {
      type: String,
    },

    // SYSTEM FIELDS
    borrowerCode: {
      type: String,
      // Uniqueness enforced per-tenant via a partial compound index (below).
    },
    accountStatus: {
      type: String,
      enum: ['Active', 'Frozen', 'Blacklisted', 'Pending Verification'],
      default: 'Active',
    },
    isBlacklisted: {
      type: Boolean,
      default: false,
    },
    isFrozen: {
      type: Boolean,
      default: false,
    },
    internalNotes: {
      type: String,
    },
    frozenAt: {
      type: Date,
    },
    frozenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    blacklistReason: {
      type: String,
    },
    blacklistedAt: {
      type: Date,
    },
    blacklistedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    assignedAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    assignedStaff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // REUSABLE KYC & IDENTITY VERIFICATION PROFILE
    kycStatus: {
      type: String,
      enum: ['UNVERIFIED', 'VERIFIED', 'FAILED', 'OVERRIDDEN', 'EXPIRED'],
      default: 'UNVERIFIED',
    },
    kycVerifiedAt: {
      type: Date,
    },
    kycProvider: {
      type: String,
      default: 'DATANAMIX',
    },
    kycProviderProduct: {
      type: String,
      default: 'Profile Plus ID Photo Match',
    },
    kycProviderReference: {
      type: String,
    },
    kycVerifiedIdNumber: {
      type: String,
    },
    kycPhotoUrl: {
      type: String,
    },
    kycPhotoFileId: {
      type: String,
    },
    kycReportPdfUrl: {
      type: String,
    },
    kycReportPdfPath: {
      type: String,
    },
    kycReportReference: {
      type: String,
    },
    kycFaceMatchScore: {
      type: Number,
    },
    kycExtractedData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    kycSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
      sparse: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook to hash password
borrowerSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Pre-save hook to generate unique borrowerCode
borrowerSchema.pre('save', async function () {
  if (!this.borrowerCode) {
    const lastBorrower = await this.constructor.findOne({}, {}, { sort: { 'createdAt': -1 } });
    let nextNumber = 1001;
    
    if (lastBorrower && lastBorrower.borrowerCode) {
      const parts = lastBorrower.borrowerCode.split('-');
      if (parts.length === 2) {
        const lastNumber = parseInt(parts[1]);
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }
    }
    
    this.borrowerCode = `BRW-${nextNumber}`;
  }
});

borrowerSchema.plugin(tenantPlugin);

// Tenant-scoped uniqueness. Optional fields use a partial filter so multiple
// documents without the field remain allowed within a tenant.
borrowerSchema.index({ tenantId: 1, email: 1 }, { unique: true });
borrowerSchema.index(
  { tenantId: 1, idNumber: 1 },
  { unique: true, partialFilterExpression: { idNumber: { $type: 'string' } } }
);
borrowerSchema.index(
  { tenantId: 1, borrowerCode: 1 },
  { unique: true, partialFilterExpression: { borrowerCode: { $type: 'string' } } }
);

module.exports = mongoose.model('Borrower', borrowerSchema);
