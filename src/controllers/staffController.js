const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const Staff = require('../models/Staff');
const User = require('../models/User');
const ImageKit = require('../config/imagekit');

/**
 * @desc    Create new staff
 * @route   POST /api/admin/staff/create
 * @access  Private (Admin)
 */
exports.createStaff = asyncHandler(async (req, res) => {
  const {
    fullName, email, phoneNumber, idNumber, gender, dateOfBirth,
    physicalAddress, password, confirmPassword, department,
    designation, joiningDate, reportingManager, branchRegion,
    permissions, status
  } = req.body;

  // 1. Validations
  if (password !== confirmPassword) {
    return sendError(res, 'Passwords do not match', 400);
  }

  // Check in Staff model
  const emailExistsStaff = await Staff.findOne({ email });
  if (emailExistsStaff) return sendError(res, 'Email already registered in staff', 400);

  const phoneExistsStaff = await Staff.findOne({ phoneNumber });
  if (phoneExistsStaff) return sendError(res, 'Phone number already registered in staff', 400);

  const idExists = await Staff.findOne({ idNumber });
  if (idExists) return sendError(res, 'ID number already registered', 400);

  // Check in User model to prevent authentication conflicts
  const userExists = await User.findOne({ $or: [{ email }, { phone: phoneNumber }] });
  if (userExists) {
    return sendError(res, 'A user account with this email or phone already exists', 400);
  }

  // 2. Handle Profile Photo Upload (ImageKit)
  let profilePhoto = { url: null, fileId: null };
  if (req.file) {
    const uploadResponse = await ImageKit.upload({
      file: req.file.buffer,
      fileName: `staff_${Date.now()}`,
      folder: '/staff-profiles'
    });
    profilePhoto = { url: uploadResponse.url, fileId: uploadResponse.fileId };
  }

  let user;
  let staff;
  try {
    // 3. Create User record for Authentication
    user = await User.create({
      fullName,
      email,
      phone: phoneNumber,
      password,
      role: 'staff',
      isActive: status !== 'Suspended',
      operationalStatus: status || 'Active'
    });

    // 4. Create Staff record
    staff = await Staff.create({
      userId: user._id,
      fullName, email, phoneNumber, idNumber, gender, dateOfBirth,
      physicalAddress, password, department, designation,
      joiningDate, reportingManager, branchRegion,
      permissions: Array.isArray(permissions) ? permissions : (permissions ? [permissions] : []),
      status: status || 'Active',
      profilePhoto
    });

    sendSuccess(res, 'Staff created successfully', { staff }, 201);
  } catch (error) {
    // Cleanup: If any record was created but the process failed later, delete them
    if (user) await User.findByIdAndDelete(user._id).catch(() => {});
    if (staff) await Staff.findByIdAndDelete(staff._id).catch(() => {});
    
    // Forward error to global handler
    throw error;
  }
});

/**
 * @desc    Get all staff
 * @route   GET /api/admin/staff
 * @access  Private (Admin)
 */
exports.getAllStaff = asyncHandler(async (req, res) => {
  const { search, status, department, page = 1, limit = 10 } = req.query;
  const query = {};

  if (status) query.status = status;
  if (department) query.department = department;
  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { employeeId: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;
  const staff = await Staff.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Staff.countDocuments(query);

  sendSuccess(res, 'Staff list retrieved', {
    staff,
    pagination: {
      total,
      page: Number(page),
      pages: Math.ceil(total / limit)
    }
  });
});

/**
 * @desc    Get single staff
 * @route   GET /api/admin/staff/:id
 * @access  Private (Admin)
 */
exports.getStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id).populate('userId', 'email phone role');
  if (!staff) return sendError(res, 'Staff not found', 404);
  sendSuccess(res, 'Staff retrieved', { staff });
});

/**
 * @desc    Update staff
 * @route   PUT /api/admin/staff/:id
 * @access  Private (Admin)
 */
exports.updateStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) return sendError(res, 'Staff not found', 404);

  const { email, phoneNumber, password, ...otherUpdates } = req.body;
  
  // 1. Uniqueness Checks if email/phone changed
  if (email && email !== staff.email) {
    const emailExists = await Staff.findOne({ email });
    if (emailExists) return sendError(res, 'Email already in use', 400);
    const userExists = await User.findOne({ email });
    if (userExists) return sendError(res, 'Email already in use by another user', 400);
  }

  if (phoneNumber && phoneNumber !== staff.phoneNumber) {
    const phoneExists = await Staff.findOne({ phoneNumber });
    if (phoneExists) return sendError(res, 'Phone number already in use', 400);
    const userExists = await User.findOne({ phone: phoneNumber });
    if (userExists) return sendError(res, 'Phone number already in use by another user', 400);
  }

  // 2. Handle Photo Update
  if (req.file) {
    if (staff.profilePhoto?.fileId) {
      await ImageKit.deleteFile(staff.profilePhoto.fileId).catch(() => {});
    }
    const uploadResponse = await ImageKit.upload({
      file: req.file.buffer,
      fileName: `staff_${Date.now()}`,
      folder: '/staff-profiles'
    });
    staff.profilePhoto = { url: uploadResponse.url, fileId: uploadResponse.fileId };
  } else if (req.body.removePhoto === 'true' || req.body.removePhoto === true) {
    if (staff.profilePhoto?.fileId) {
      await ImageKit.deleteFile(staff.profilePhoto.fileId).catch(() => {});
    }
    staff.profilePhoto = { url: null, fileId: null };
  }

  // 3. Update Staff Fields
  Object.keys(otherUpdates).forEach(key => {
    if (otherUpdates[key] !== undefined) {
      staff[key] = otherUpdates[key];
    }
  });

  if (email) staff.email = email;
  if (phoneNumber) staff.phoneNumber = phoneNumber;
  if (password && password.trim() !== '') {
    staff.password = password;
  }

  await staff.save();

  // 4. Update linked User record
  const user = await User.findById(staff.userId);
  if (user) {
    if (email) user.email = email;
    if (phoneNumber) user.phone = phoneNumber;
    if (password && password.trim() !== '') {
      user.password = password;
    }
    if (otherUpdates.fullName) user.fullName = otherUpdates.fullName;
    if (otherUpdates.status) user.isActive = otherUpdates.status !== 'Suspended';
    
    await user.save();
  }

  sendSuccess(res, 'Staff updated successfully', { staff });
});

/**
 * @desc    Get staff members eligible for loan review (with workload stats)
 * @route   GET /api/admin/staff/reviewers
 * @access  Private (Admin)
 */
exports.getReviewers = asyncHandler(async (req, res) => {
  // 1. Fetch all active staff users
  const staffUsers = await User.find({ 
    role: 'staff', 
    isActive: true 
  }).select('fullName email phone');

  // 2. Fetch staff profile details to get branch and designation
  const staffProfiles = await Staff.find({
    userId: { $in: staffUsers.map(u => u._id) },
    status: 'Active'
  }).select('userId branchRegion designation profilePhoto');

  // 3. Import LoanReview to count active tasks
  const LoanReview = require('../models/LoanReview');

  // 4. Map and collect workload stats
  const reviewers = await Promise.all(staffProfiles.map(async (profile) => {
    const user = staffUsers.find(u => u._id.toString() === profile.userId.toString());
    if (!user) return null;

    const activeReviewsCount = await LoanReview.countDocuments({
      reviewerId: user._id,
      status: { $in: ['Pending', 'Under Review'] }
    });

    let workloadStatus = 'Low';
    if (activeReviewsCount > 10) workloadStatus = 'High';
    else if (activeReviewsCount > 5) workloadStatus = 'Medium';

    return {
      _id: user._id,
      fullName: user.fullName,
      role: profile.designation || 'Staff',
      branch: profile.branchRegion || 'General',
      profilePhoto: profile.profilePhoto?.url,
      activeReviews: activeReviewsCount,
      workloadStatus
    };
  }));

  const filteredReviewers = reviewers.filter(r => r !== null);

  sendSuccess(res, 'Reviewers list retrieved', { reviewers: filteredReviewers });
});

// @desc    Change Permissions
// @route   PUT /api/admin/staff/:id/permissions
// */
exports.changePermissions = asyncHandler(async (req, res) => {
  const { permissions } = req.body;
  const staff = await Staff.findByIdAndUpdate(
    req.params.id,
    { permissions },
    { new: true, runValidators: true }
  );
  if (!staff) return sendError(res, 'Staff not found', 404);
  sendSuccess(res, 'Permissions updated', { staff });
});

/**
 * @desc    Activate Staff
 */
exports.activateStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findByIdAndUpdate(req.params.id, { status: 'Active' }, { new: true });
  await User.findByIdAndUpdate(staff.userId, { isActive: true, operationalStatus: 'Active' });
  sendSuccess(res, 'Staff activated');
});

/**
 * @desc    Mark Inactive
 */
exports.markInactive = asyncHandler(async (req, res) => {
  const staff = await Staff.findByIdAndUpdate(req.params.id, { status: 'Inactive' }, { new: true });
  await User.findByIdAndUpdate(staff.userId, { operationalStatus: 'Inactive' });
  sendSuccess(res, 'Staff marked as inactive');
});

/**
 * @desc    Suspend Staff
 */
exports.suspendStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findByIdAndUpdate(req.params.id, { status: 'Suspended' }, { new: true });
  await User.findByIdAndUpdate(staff.userId, { isActive: false, operationalStatus: 'Suspended' });
  sendSuccess(res, 'Staff suspended');
});

/**
 * @desc    Hard Delete Staff
 */
exports.deleteStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) return sendError(res, 'Staff not found', 404);

  // 1. Delete Profile Photo from ImageKit if exists
  if (staff.profilePhoto?.fileId) {
    await ImageKit.deleteFile(staff.profilePhoto.fileId).catch(() => {});
  }

  // 2. Hard Delete User account
  if (staff.userId) {
    await User.findByIdAndDelete(staff.userId);
  }

  // 3. Hard Delete Staff record
  await Staff.findByIdAndDelete(req.params.id);

  sendSuccess(res, 'Staff and associated user account deleted successfully');
});
