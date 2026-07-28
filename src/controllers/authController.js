const User = require('../models/User');
const Borrower = require('../models/Borrower');
const Tenant = require('../models/Tenant');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const generateToken = require('../utils/generateToken');
const tenantContext = require('../tenancy/tenantContext');
const { healUserTenant, NO_TENANT_MESSAGE } = require('../tenancy/tenantHealing');

// @desc    Register a new borrower
// @route   POST /api/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password, confirmPassword } = req.body;

  // Basic validation
  if (!fullName || !email || !phone || !password || !confirmPassword) {
    return sendError(res, 'Please provide all required fields', 400);
  }

  if (password !== confirmPassword) {
    return sendError(res, 'Passwords do not match', 400);
  }

  // Public self-registration joins the default tenant (Milestone 1: single
  // tenant). Resolve it in SYSTEM mode (Tenant is a platform collection).
  const defaultTenant = await tenantContext.runAsSystem(() =>
    Tenant.findOne({ isDefault: true })
  );
  if (!defaultTenant) {
    return sendError(res, 'Tenant not configured. Please contact support.', 500);
  }

  // Run the whole registration inside the tenant context so created records
  // (User, Borrower, Notification) are stamped with the correct tenantId.
  return tenantContext.runWithTenant(defaultTenant._id, async () => {
  // Check if user exists
  const userExists = await User.findOne({ email });
  if (userExists) {
    return sendError(res, 'User already exists', 400);
  }

  // Create user
  const user = await User.create({
    fullName,
    email,
    phone,
    password,
    role: 'borrower', // Registration is only for borrowers as per requirements
  });

  if (user) {
    // Create borrower profile (linked to user)
    const borrowerProfile = await Borrower.create({
      userId: user._id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phone,
      password, // Borrower schema requires a password; hashed by its pre-save hook.
      accountStatus: 'Active'
    });

    // Notify each admin in the tenant that a new borrower registered.
    // (Notifications require a receiverId, so we fan out one per admin.)
    try {
      const { createNotification } = require('../utils/notificationHelper');
      const admins = await User.find({ role: 'admin' }).select('_id').lean();
      await Promise.all(admins.map((admin) => createNotification({
        receiverId: admin._id,
        receiverRole: 'admin',
        title: 'Borrower Registered',
        message: `A new borrower profile has been registered for ${user.fullName}.`,
        notificationType: 'ADMIN_ALERT',
        priority: 'NORMAL',
        relatedId: borrowerProfile._id,
        relatedModel: 'Borrower',
      })));
    } catch (notifErr) {
      console.error('Failed to log borrower registration notification:', notifErr.message);
    }

    const token = generateToken(user._id, user.role, defaultTenant._id);

    sendSuccess(res, 'Borrower registered successfully', {
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        operationalStatus: user.operationalStatus,
        profilePhoto: user.profilePhoto,
        phoneNumber: user.phoneNumber,
        primaryBranch: user.primaryBranch,
      },
      token,
    }, 201);
  } else {
    sendError(res, 'Invalid user data', 400);
  }
  }); // end runWithTenant (default tenant)
});

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    return sendError(res, 'Please provide email and password', 400);
  }

  const cleanEmail = String(email).toLowerCase().trim();

  const Tenant = require('../models/Tenant');
  const tenant = await tenantContext.runAsSystem(() =>
    Tenant.findOne({ email: cleanEmail })
  );

  // Look for a user document matching email. If a tenant exists, prefer the user document already linked to this tenant!
  let user;
  if (tenant) {
    user = await tenantContext.runAsSystem(() =>
      User.findOne({ email: cleanEmail, tenantId: tenant._id }).select('+password')
    );
  }
  if (!user) {
    user = await tenantContext.runAsSystem(() =>
      User.findOne({ email: cleanEmail }).select('+password')
    );
  }

  // Self-healing for Tenant Admin: If user account does not exist in `users` collection yet,
  // but a Tenant record exists with this email, automatically provision the Tenant Admin user.
  if (!user && tenant) {
    console.log(`[auth-heal] Tenant found for ${cleanEmail} without User account. Auto-provisioning admin user...`);
    try {
      user = await tenantContext.runAsSystem(() =>
        User.create({
          fullName: tenant.owner || (tenant.companyName + ' Admin'),
          email: tenant.email.toLowerCase().trim(),
          password: password,
          role: 'admin',
          tenantId: tenant._id,
          phone: tenant.phone || '0000000000',
          isActive: true,
        })
      );
    } catch (createErr) {
      // If creation hits an index conflict, fallback to fetching the existing user for this tenant
      user = await tenantContext.runAsSystem(() =>
        User.findOne({ email: cleanEmail }).select('+password')
      );
    }

    if (user) {
      user = await tenantContext.runAsSystem(() =>
        User.findById(user._id).select('+password')
      );
    }
  }

  if (!user) {
    return sendError(res, 'Invalid credentials', 401);
  }

  // Check if password matches
  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    return sendError(res, 'Invalid credentials', 401);
  }

  // Ensure user is attached to tenantId if missing
  if (!user.tenantId && tenant) {
    await tenantContext.runAsSystem(() =>
      User.collection.updateOne({ _id: user._id }, { $set: { tenantId: tenant._id } })
    );
    user.tenantId = tenant._id;
  }

  // Check if tenant is active/suspended
  if (user.tenantId) {
    const tenant = await tenantContext.runAsSystem(() =>
      Tenant.findById(user.tenantId)
    );
    if (!tenant) {
      return sendError(res, 'Tenant account not found', 404);
    }
    if (tenant.status === 'suspended') {
      return sendError(res, 'Your organization account has been suspended. Please contact support.', 403);
    }
    if (tenant.status === 'disabled') {
      return sendError(res, 'Your organization account is disabled.', 403);
    }
    if (tenant.status === 'expired') {
      return sendError(res, 'Your organization subscription has expired.', 403);
    }
  }



  // Check if user is active
  if (!user.isActive) {
    // If it's a staff/agent and they are suspended, provide the specific message
    const message = (user.role === 'staff' || user.role === 'agent') 
      ? 'Your account has been suspended' 
      : 'Your account is inactive. Please contact support.';
    return sendError(res, message, 403);
  }

  if (user.isFrozen) {
    if (user.statusReason === 'Your account has been suspended') {
      return sendError(res, 'Your account has been suspended', 403);
    }
    const reason = user.statusReason ? `: ${user.statusReason}` : '';
    return sendError(res, `Your account is frozen${reason}. Please contact support to unfreeze.`, 403);
  }

  if (user.isBlacklisted) {
    const reason = user.statusReason ? `: ${user.statusReason}` : '';
    return sendError(res, `Access Denied: Your account has been blacklisted${reason}.`, 403);
  }

  if (user.isBlacklisted) {
    return sendError(res, 'Your account is blacklisted.', 403);
  }

  // Self-healing: a user created before the multi-tenant migration (or via a
  // seeder/import/manual insert) may have no tenantId. Rather than letting every
  // subsequent request 403, assign the unambiguous tenant once, here at login.
  if (!user.tenantId) {
    const heal = await healUserTenant(user);
    if (!heal.healed && !heal.alreadyScoped) {
      // Ambiguous (multiple tenants) or no tenant — never a generic 403.
      return sendError(res, heal.reason || NO_TENANT_MESSAGE, 403);
    }
  }

  const token = generateToken(user._id, user.role, user.tenantId);

  sendSuccess(res, 'Login successful', {
    user: {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      profilePhoto: user.profilePhoto,
      phoneNumber: user.phoneNumber,
      primaryBranch: user.primaryBranch,
    },
    token,
  });
});

// @desc    Forgot Password - Request OTP Code
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return sendError(res, 'Please provide your email address', 400);
  }

  const cleanEmail = String(email).toLowerCase().trim();
  let user = await tenantContext.runAsSystem(() =>
    User.findOne({ email: cleanEmail })
  );

  const resetPin = Math.floor(100000 + Math.random() * 900000).toString();
  const expireTime = new Date(Date.now() + 15 * 60 * 1000);

  if (user) {
    await tenantContext.runAsSystem(() =>
      User.collection.updateOne(
        { _id: user._id },
        { $set: { resetPasswordToken: resetPin, resetPasswordExpire: expireTime } }
      )
    );
  } else {
    const rawUser = await tenantContext.runAsSystem(() =>
      User.collection.findOne({ email: cleanEmail })
    );
    if (rawUser) {
      await tenantContext.runAsSystem(() =>
        User.collection.updateOne(
          { _id: rawUser._id },
          { $set: { resetPasswordToken: resetPin, resetPasswordExpire: expireTime } }
        )
      );
    }
  }

  const { sendPasswordResetEmail } = require('../integrations/emailjs/emailjs.service');
  let emailDispatched = false;
  try {
    emailDispatched = await sendPasswordResetEmail(cleanEmail, user?.fullName || 'User', resetPin);
  } catch (e) {
    console.error('Failed to dispatch password reset email:', e);
  }

  return sendSuccess(
    res,
    `Verification OTP code has been sent to ${cleanEmail}.`,
    { email: cleanEmail, dispatched: emailDispatched }
  );
});

// @desc    Reset Password with OTP Code
// @route   POST /api/auth/reset-password
// @access  Public
exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, otpCode, newPassword } = req.body;
  if (!email || !otpCode || !newPassword) {
    return sendError(res, 'Please provide email, verification OTP code, and new password', 400);
  }

  const cleanEmail = String(email).toLowerCase().trim();
  const cleanOtp = String(otpCode).trim();

  // Fetch raw user record from MongoDB collection directly
  const userDoc = await tenantContext.runAsSystem(() =>
    User.collection.findOne({ email: cleanEmail })
  );

  if (!userDoc) {
    return sendError(res, 'User account not found', 404);
  }

  const storedToken = userDoc.resetPasswordToken ? String(userDoc.resetPasswordToken).trim() : null;

  if (!storedToken || storedToken !== cleanOtp) {
    return sendError(res, 'Invalid OTP verification code. Please check your email.', 400);
  }

  if (userDoc.resetPasswordExpire && new Date(userDoc.resetPasswordExpire) < new Date()) {
    return sendError(res, 'OTP verification code has expired. Please request a new code.', 400);
  }

  const bcrypt = require('bcryptjs');
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  await tenantContext.runAsSystem(() =>
    User.collection.updateOne(
      { _id: userDoc._id },
      {
        $set: { password: hashedPassword },
        $unset: { resetPasswordToken: 1, resetPasswordExpire: 1 }
      }
    )
  );

  const token = generateToken(userDoc._id, userDoc.role, userDoc.tenantId);

  return sendSuccess(res, 'Password successfully reset. Logging in...', {
    user: {
      _id: userDoc._id,
      fullName: userDoc.fullName,
      email: userDoc.email,
      role: userDoc.role,
    },
    token
  });
});

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  sendSuccess(res, 'User data retrieved', user);
});
