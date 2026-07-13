const mongoose = require('mongoose');
const tenantPlugin = require('../tenancy/tenantPlugin');
const bcrypt = require('bcryptjs');

const staffSchema = new mongoose.Schema(
  {
    // Authentication & Linking
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      default: 'Staff',
    },

    // Personal Details
    fullName: {
      type: String,
      required: [true, 'Please add a full name'],
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
      // Uniqueness enforced per-tenant via a compound index (below).
    },
    idNumber: {
      type: String,
      required: [true, 'Please add an ID number'],
      // Uniqueness enforced per-tenant via a compound index (below).
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
      required: [true, 'Please specify gender'],
    },
    dateOfBirth: {
      type: Date,
      required: [true, 'Please add date of birth'],
    },
    physicalAddress: {
      type: String,
      required: [true, 'Please add a physical address'],
    },
    profilePhoto: {
      url: {
        type: String,
        default: null,
      },
      fileId: {
        type: String,
        default: null,
      },
    },

    // Employment Details
    employeeId: {
      type: String,
      // Uniqueness enforced per-tenant via a partial compound index (below).
    },
    department: {
      type: String,
      required: [true, 'Please add a department'],
    },
    designation: {
      type: String,
      required: [true, 'Please add a designation'],
    },
    joiningDate: {
      type: Date,
      required: [true, 'Please add a joining date'],
    },
    reportingManager: {
      type: String,
      required: [true, 'Please add a reporting manager'],
    },
    branchRegion: {
      type: String,
      required: [true, 'Please add a branch/region'],
    },

    // Permissions
    permissions: [
      {
        type: String,
        enum: [
          'Review Loan Applications',
          'Verify Documents',
          'Verify Payments',
          'View Borrowers',
          'Add Notes',
          'Recommend Approval',
          'Reject Applications',
        ],
      },
    ],

    // System Status
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Suspended'],
      default: 'Active',
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
staffSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Auto-generate Employee ID (STF-1001)
staffSchema.pre('save', async function () {
  if (!this.employeeId) {
    try {
      const lastStaff = await this.constructor.findOne({}, {}, { sort: { 'createdAt': -1 } });
      let nextNumber = 1001;

      if (lastStaff && lastStaff.employeeId) {
        const parts = lastStaff.employeeId.split('-');
        if (parts.length === 2) {
          const lastNumber = parseInt(parts[1]);
          if (!isNaN(lastNumber)) {
            nextNumber = lastNumber + 1;
          }
        }
      }
      this.employeeId = `STF-${nextNumber}`;
    } catch (error) {
      throw error;
    }
  }
});

staffSchema.plugin(tenantPlugin);

// Tenant-scoped uniqueness.
staffSchema.index({ tenantId: 1, email: 1 }, { unique: true });
staffSchema.index({ tenantId: 1, phoneNumber: 1 }, { unique: true });
staffSchema.index({ tenantId: 1, idNumber: 1 }, { unique: true });
staffSchema.index(
  { tenantId: 1, employeeId: 1 },
  { unique: true, partialFilterExpression: { employeeId: { $type: 'string' } } }
);

module.exports = mongoose.model('Staff', staffSchema);
