const mongoose = require('mongoose');
const Borrower = require('../models/Borrower');
const LoanApplication = require('../models/LoanApplication');
const ActiveLoan = require('../models/ActiveLoan');
const Payment = require('../models/Payment');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const imagekit = require('../config/imagekit');

// @desc    Create a new borrower (Admin only)
// @route   POST /api/admin/borrowers/create
// @access  Private/Admin
exports.createBorrower = async (req, res, next) => {
  try {
    const {
      fullName,
      idNumber,
      email,
      phoneNumber,
      physicalAddress,
      employerName,
      occupation,
      monthlyNetSalary,
      yearsOfService,
      bankName,
      accountNumber,
      branchCode,
      accountType,
      password
    } = req.body;

    // 1. Check if borrower already exists (Email or ID Number)
    const emailExists = await Borrower.findOne({ email });
    if (emailExists) {
      return sendError(res, 'A borrower with this email already exists', 400);
    }

    if (idNumber) {
      const idExists = await Borrower.findOne({ idNumber });
      if (idExists) {
        return sendError(res, 'A borrower with this ID Number already exists', 400);
      }
    }

    // Check if email already exists in User model (Auth system)
    const userExists = await User.findOne({ email });
    if (userExists) {
      return sendError(res, 'This email is already registered in the authentication system. Please use a unique email.', 400);
    }

    // 2. Handle Profile Photo Upload to ImageKit
    let profilePhotoUrl = 'no-photo.jpg';
    
    console.log('FILE RECEIVED:', req.file);
    console.log('BODY RECEIVED:', req.body);

    if (req.file) {
      try {
        const uploadResponse = await imagekit.upload({
          file: req.file.buffer, // Buffer from multer
          fileName: `borrower_${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`,
          folder: '/borrowers/profiles',
        });
        profilePhotoUrl = uploadResponse.url;
      } catch (uploadError) {
        console.error('ImageKit Upload Error:', uploadError);
        return sendError(res, 'Failed to upload profile photo', 500);
      }
    }

    // 2.5 Create User for authentication
    let user;
    let borrower;
    try {
      user = await User.create({
        fullName,
        email,
        phone: phoneNumber,
        password,
        role: 'borrower',
        profilePhoto: profilePhotoUrl,
      });

      // 2.7 Cleanup empty fields to avoid casting errors (e.g. empty ObjectId)
      Object.keys(req.body).forEach(key => {
        if (req.body[key] === '' || req.body[key] === 'null') {
          req.body[key] = null;
        }
      });

      // 3. Create Borrower
      borrower = await Borrower.create({
        ...req.body,
        userId: user._id,
        profilePhoto: profilePhotoUrl,
        profilePhotoFileId: req.body.profilePhotoFileId,
        monthlyNetSalary: Number(req.body.monthlyNetSalary) || 0,
        yearsOfService: Number(req.body.yearsOfService) || 0,
        createdBy: req.user._id, // From protect middleware
      });

      // Create admin real-time notification
      try {
        const { createNotification } = require('../utils/notificationHelper');
        await createNotification({
          title: 'Borrower Onboarded',
          message: `New borrower profile manually created for ${borrower.fullName}.`,
          notificationType: 'Borrower Registered',
          priority: 'Important',
          borrowerId: borrower._id
        });
      } catch (notifErr) {
        console.error('Failed to log borrower registration notification:', notifErr.message);
      }

      return sendSuccess(res, 'Borrower created successfully', borrower, 201);
    } catch (createError) {
      // Cleanup: If any record was created but the process failed later, delete them
      if (user) await User.findByIdAndDelete(user._id).catch(() => {});
      if (borrower) await Borrower.findByIdAndDelete(borrower._id).catch(() => {});
      throw createError;
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Get all borrowers
// @route   GET /api/admin/borrowers
// @access  Private/Admin
exports.getAllBorrowers = asyncHandler(async (req, res) => {
  const { search, status, loanStatus } = req.query;
  let query = {};

  // Search by name, email or phone
  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phoneNumber: { $regex: search, $options: 'i' } }
    ];
  }

  // Filter by status
  if (status && status !== 'all') {
    query.accountStatus = status;
  }

  const borrowers = await Borrower.find(query).sort({ createdAt: -1 });
  
  // Fetch active loans count for retrieved borrowers in a single efficient query, handling user/borrower ID mapping inconsistency
  const borrowerIds = borrowers.map(b => b._id);
  const userIds = borrowers.filter(b => b.userId).map(b => b.userId);
  
  const activeLoans = await ActiveLoan.find({ 
    $or: [
      { borrowerId: { $in: borrowerIds } },
      { borrowerId: { $in: userIds } }
    ],
    loanStatus: { $in: ['Active', 'Overdue'] },
    isDeleted: false 
  });
  
  const borrowersWithLoans = borrowers.map(b => {
    const activeLoansCount = activeLoans.filter(l => 
      l.borrowerId.toString() === b._id.toString() || 
      (b.userId && l.borrowerId.toString() === b.userId.toString())
    ).length;
    
    return {
      ...b.toObject(),
      activeLoansCount
    };
  });
  
  // Calculate stats
  const stats = {
    totalBorrowers: await Borrower.countDocuments(),
    activeBorrowers: await Borrower.countDocuments({ accountStatus: 'Active' }),
    blacklistedBorrowers: await Borrower.countDocuments({ accountStatus: 'Blacklisted' }),
    frozenBorrowers: await Borrower.countDocuments({ accountStatus: 'Frozen' }),
  };

  sendSuccess(res, 'Borrowers retrieved successfully', { borrowers: borrowersWithLoans, stats });
});

// @desc    Get single borrower
// @route   GET /api/admin/borrowers/:id
// @access  Private/Admin
exports.getBorrowerById = asyncHandler(async (req, res, next) => {
  const borrower = await Borrower.findById(req.params.id)
    .populate('assignedAgent', 'fullName email')
    .populate('assignedStaff', 'fullName email');

  if (!borrower) {
    return sendError(res, 'Borrower not found', 404);
  }

  // Fetch Activity History (Applications, Loans, Payments)
  const [applications, loans, payments] = await Promise.all([
    LoanApplication.find({ borrowerId: borrower.userId }).sort({ createdAt: -1 }),
    ActiveLoan.find({ 
      $or: [
        { borrowerId: borrower._id },
        { borrowerId: borrower.userId }
      ],
      isDeleted: false 
    }).sort({ createdAt: -1 }),
    Payment.find({ borrowerId: borrower._id, isDeleted: false }).sort({ createdAt: -1 }),
  ]);

  const activityHistory = [
    ...applications.map(app => ({
      type: 'Application',
      title: `Loan Application ${app.applicationId}`,
      date: app.createdAt,
      amount: app.requestedAmount || app.loanAmount,
      status: app.status,
      iconType: 'FileText'
    })),
    ...loans.map(loan => ({
      type: 'Loan',
      title: `Loan Approved ${loan.loanCode}`,
      date: loan.approvedDate || loan.createdAt,
      amount: loan.approvedAmount,
      status: loan.loanStatus,
      iconType: 'CheckCircle'
    })),
    ...payments.map(pay => ({
      type: 'Payment',
      title: `EMI Payment ${pay.transactionId}`,
      date: pay.paymentDate,
      amount: pay.paymentAmount,
      status: pay.paymentStatus,
      iconType: 'Wallet'
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  sendSuccess(res, 'Borrower retrieved successfully', { 
    borrower,
    activityHistory 
  });
});

// @desc    Update borrower
// @route   PUT /api/admin/borrowers/:id
// @access  Private/Admin
exports.updateBorrower = async (req, res, next) => {
  try {
    let borrower = await Borrower.findById(req.params.id);
    if (!borrower) {
      return sendError(res, 'Borrower not found', 404);
    }

    // Handle Profile Photo Update
    if (req.file) {
      try {
        const uploadResponse = await imagekit.upload({
          file: req.file.buffer,
          fileName: `borrower_update_${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`,
          folder: '/borrowers/profiles',
        });
        req.body.profilePhoto = uploadResponse.url;
        req.body.profilePhotoFileId = uploadResponse.fileId;
      } catch (uploadError) {
        console.error('ImageKit Update Upload Error:', uploadError);
      }
    }

    // Convert numeric fields
    if (req.body.monthlyNetSalary) req.body.monthlyNetSalary = Number(req.body.monthlyNetSalary);
    if (req.body.yearsOfService) req.body.yearsOfService = Number(req.body.yearsOfService);

    // Handle empty fields
    Object.keys(req.body).forEach(key => {
      if (req.body[key] === '' || req.body[key] === 'null') {
        delete req.body[key]; // Delete instead of null to avoid casting errors for optional fields
      }
    });

    // Update fields manually to support password hashing via .save()
    Object.keys(req.body).forEach(key => {
      borrower[key] = req.body[key];
    });

    // Reset flags if status is changed to Active
    if (req.body.accountStatus === 'Active') {
      borrower.isFrozen = false;
      borrower.isBlacklisted = false;
    }

    await borrower.save();

    // Sync with User model
    try {
      const userUpdate = {};
      
      // Update basic info in User model if changed
      if (req.body.fullName) userUpdate.fullName = req.body.fullName;
      if (req.body.email) userUpdate.email = req.body.email;
      if (req.body.phoneNumber) userUpdate.phone = req.body.phoneNumber;
      if (req.body.password) userUpdate.password = req.body.password; // User model has its own pre-save hook

      if (req.body.accountStatus === 'Active') {
        userUpdate.isActive = true;
        userUpdate.isFrozen = false;
        userUpdate.isBlacklisted = false;
        userUpdate.statusReason = null;
      } else if (req.body.accountStatus === 'Frozen') {
        userUpdate.isFrozen = true;
      } else if (req.body.accountStatus === 'Blacklisted') {
        userUpdate.isBlacklisted = true;
        userUpdate.isActive = false;
      }

      if (Object.keys(userUpdate).length > 0) {
        let user;
        if (borrower.userId) {
          user = await User.findById(borrower.userId);
          if (user) {
            Object.keys(userUpdate).forEach(key => {
              user[key] = userUpdate[key];
            });
            await user.save(); // Triggers password hashing
          }
        } else {
          // Fallback: Find user by email
          user = await User.findOne({ email: { $regex: new RegExp(`^${borrower.email}$`, 'i') } });
          if (user) {
            Object.keys(userUpdate).forEach(key => {
              user[key] = userUpdate[key];
            });
            await user.save();
          }
        }
      }
      console.log(`Sync status for ${borrower.email}: User updated`);
    } catch (syncError) {
      console.error('Account Sync Error:', syncError);
    }

    sendSuccess(res, 'Borrower updated successfully', borrower);
  } catch (error) {
    next(error);
  }
};

// @desc    Freeze borrower
// @route   PATCH /api/admin/borrowers/:id/freeze
// @access  Private/Admin
exports.freezeBorrower = asyncHandler(async (req, res, next) => {
  const borrower = await Borrower.findById(req.params.id);

  if (!borrower) {
    return sendError(res, 'Borrower not found', 404);
  }

  borrower.accountStatus = 'Frozen';
  borrower.isFrozen = true;
  borrower.frozenAt = new Date();
  borrower.frozenBy = req.user._id;
  
  if (req.body.reason) {
    borrower.internalNotes = (borrower.internalNotes || '') + `\n[Freeze Reason]: ${req.body.reason}`;
  }

  await borrower.save();

  // Sync with User model if linked
  if (borrower.userId) {
    await mongoose.model('User').findByIdAndUpdate(borrower.userId, {
      isFrozen: true,
      accountStatus: 'Frozen',
      statusReason: req.body.reason
    });
  }

  sendSuccess(res, 'Borrower account frozen successfully', borrower);
});

// @desc    Blacklist borrower
// @route   PATCH /api/admin/borrowers/:id/blacklist
// @access  Private/Admin
exports.blacklistBorrower = asyncHandler(async (req, res, next) => {
  const borrower = await Borrower.findById(req.params.id);

  if (!borrower) {
    return sendError(res, 'Borrower not found', 404);
  }

  borrower.accountStatus = 'Blacklisted';
  borrower.isBlacklisted = true;
  borrower.blacklistedAt = new Date();
  borrower.blacklistedBy = req.user._id;
  borrower.blacklistReason = req.body.reason;

  await borrower.save();

  // Sync with User model if linked
  if (borrower.userId) {
    await mongoose.model('User').findByIdAndUpdate(borrower.userId, {
      isBlacklisted: true,
      isActive: false,
      statusReason: req.body.reason
    });
  }

  sendSuccess(res, 'Borrower blacklisted successfully', borrower);
});

// @desc    Delete borrower (Hard delete)
// @route   DELETE /api/admin/borrowers/:id
// @access  Private/Admin
exports.deleteBorrower = asyncHandler(async (req, res, next) => {
  const borrower = await Borrower.findById(req.params.id);

  if (!borrower) {
    return sendError(res, 'Borrower not found', 404);
  }

  // 1. Delete Profile Photo from ImageKit if it's not the default
  if (borrower.profilePhotoFileId) {
    try {
      await imagekit.deleteFile(borrower.profilePhotoFileId);
    } catch (err) {
      console.error('Error deleting borrower photo from ImageKit:', err);
    }
  }

  // 2. Delete linked User record
  if (borrower.userId) {
    await User.findByIdAndDelete(borrower.userId);
  }

  // 3. Delete Borrower record from database
  await Borrower.findByIdAndDelete(req.params.id);

  sendSuccess(res, 'Borrower and associated user deleted permanently');
});
