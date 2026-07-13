const Agent = require('../../models/Agent');
const User = require('../../models/User');
const Loan = require('../../models/Loan');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const imagekit = require('../../config/imagekit');
const crypto = require('crypto');

// @desc    Create new agent
// @route   POST /api/admin/agents/create
// @access  Private/Admin
exports.createAgent = asyncHandler(async (req, res) => {
  const {
    fullName,
    email,
    phoneNumber,
    idNumber,
    physicalAddress,
    assignedRegion,
    joiningDate,
    reportingManager,
    baseCommission,
    recoveryBonus,
    commissionTier,
    role,
    internalNotes,
    password,
  } = req.body;

  // Check if agent already exists
  const agentExists = await Agent.findOne({ 
    $or: [{ email }, { phoneNumber }, { idNumber }] 
  });

  if (agentExists) {
    let field = 'Agent';
    if (agentExists.email === email) field = 'Email';
    if (agentExists.phoneNumber === phoneNumber) field = 'Phone number';
    if (agentExists.idNumber === idNumber) field = 'ID number';
    return sendError(res, `${field} already exists`, 400);
  }

  // Check if email already exists in User model (Auth system)
  const userExists = await User.findOne({ email });
  if (userExists) {
    return sendError(res, 'This email is already registered in the authentication system. Please use a unique email.', 400);
  }

  // Handle Profile Photo Upload
  let profilePhoto = null;
  let profilePhotoFileId = null;

  if (req.file) {
    const uploadResponse = await imagekit.upload({
      file: req.file.buffer,
      fileName: `agent_${Date.now()}_${req.file.originalname}`,
      folder: '/agents/profiles',
    });
    profilePhoto = uploadResponse.url;
    profilePhotoFileId = uploadResponse.fileId;
  }

  let user;
  let agent;
  try {
    // Create User for authentication
    user = await User.create({
      fullName,
      email,
      phone: phoneNumber,
      password,
      role: 'agent',
      profilePhoto: profilePhoto || 'no-photo.jpg',
    });

    // Create Agent Profile
    agent = await Agent.create({
      userId: user._id,
      fullName,
      email,
      password, 
      phoneNumber,
      idNumber,
      physicalAddress,
      profilePhoto,
      profilePhotoFileId,
      assignedRegion,
      joiningDate,
      reportingManager,
      baseCommission,
      recoveryBonus,
      commissionTier,
      role,
      internalNotes,
      createdBy: req.user._id,
    });

    sendSuccess(res, 'Agent created successfully', { agent }, 201);
  } catch (error) {
    // Cleanup: If any record was created but the process failed later, delete them
    if (user) await User.findByIdAndDelete(user._id).catch(() => {});
    if (agent) await Agent.findByIdAndDelete(agent._id).catch(() => {});
    throw error;
  }
});

// @desc    Get all agents
// @route   GET /api/admin/agents
// @access  Private/Admin
exports.getAgents = asyncHandler(async (req, res) => {
  const agents = await Agent.find({ isDeleted: false })
    .sort({ createdAt: -1 });

  sendSuccess(res, 'Agents retrieved successfully', agents);
});

// @desc    Get single agent
// @route   GET /api/admin/agents/:id
// @access  Private/Admin
exports.getAgentById = asyncHandler(async (req, res) => {
  const agent = await Agent.findOne({ _id: req.params.id, isDeleted: false });

  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  sendSuccess(res, 'Agent retrieved successfully', agent);
});

// @desc    Update agent
// @route   PUT /api/admin/agents/:id
// @access  Private/Admin
exports.updateAgent = asyncHandler(async (req, res) => {
  let agent = await Agent.findOne({ _id: req.params.id, isDeleted: false });

  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  const {
    fullName,
    email,
    phoneNumber,
    idNumber,
    physicalAddress,
    assignedRegion,
    joiningDate,
    reportingManager,
    baseCommission,
    recoveryBonus,
    commissionTier,
    accountStatus,
    role,
    internalNotes,
    password
  } = req.body;

  // Check uniqueness if email, phone, or idNumber are being changed
  const uniquenessCheck = [];
  if (email && email !== agent.email) uniquenessCheck.push({ email });
  if (phoneNumber && phoneNumber !== agent.phoneNumber) uniquenessCheck.push({ phoneNumber });
  if (idNumber && idNumber !== agent.idNumber) uniquenessCheck.push({ idNumber });

  if (uniquenessCheck.length > 0) {
    const existing = await Agent.findOne({
      $or: uniquenessCheck,
      _id: { $ne: agent._id },
      isDeleted: false
    });

    if (existing) {
      let field = 'Agent';
      if (existing.email === email) field = 'Email';
      if (existing.phoneNumber === phoneNumber) field = 'Phone number';
      if (existing.idNumber === idNumber) field = 'ID number';
      return sendError(res, `${field} already exists`, 400);
    }
  }

  // Handle Profile Photo Update
  if (req.file) {
    // Delete old photo if exists
    if (agent.profilePhotoFileId) {
      try {
        await imagekit.deleteFile(agent.profilePhotoFileId);
      } catch (err) {
        console.error('Error deleting old photo:', err);
      }
    }

    const uploadResponse = await imagekit.upload({
      file: req.file.buffer,
      fileName: `agent_${Date.now()}_${req.file.originalname}`,
      folder: '/agents/profiles',
    });
    
    agent.profilePhoto = uploadResponse.url;
    agent.profilePhotoFileId = uploadResponse.fileId;
  }

  // Update Agent fields manually to support .save() hooks
  const fields = [
    'fullName', 'email', 'phoneNumber', 'idNumber', 'physicalAddress',
    'assignedRegion', 'joiningDate', 'reportingManager', 'baseCommission',
    'recoveryBonus', 'commissionTier', 'accountStatus', 'role', 'internalNotes',
    'password'
  ];

  fields.forEach(field => {
    if (req.body[field] !== undefined && req.body[field] !== '') {
      agent[field] = req.body[field];
    }
  });

  await agent.save();

  // Sync with User model
  try {
    const userUpdate = {};
    if (fullName) userUpdate.fullName = fullName;
    if (email) userUpdate.email = email;
    if (phoneNumber) userUpdate.phone = phoneNumber;
    if (password) userUpdate.password = password;
    
    // Status sync
    if (accountStatus === 'Active' || accountStatus === 'Inactive') {
      userUpdate.isActive = true;
      userUpdate.isFrozen = false;
    } else if (accountStatus === 'Suspended') {
      userUpdate.isFrozen = true;
    }

    if (Object.keys(userUpdate).length > 0) {
      const user = await User.findById(agent.userId);
      if (user) {
        Object.keys(userUpdate).forEach(key => {
          user[key] = userUpdate[key];
        });
        await user.save(); // Triggers hashing
      }
    }
  } catch (syncError) {
    console.error('Agent User Sync Error:', syncError);
  }

  sendSuccess(res, 'Agent updated successfully', agent);
});

// @desc    Delete agent (Hard delete)
// @route   DELETE /api/admin/agents/:id
// @access  Private/Admin
exports.deleteAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);

  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  // 1. Delete Profile Photo from ImageKit
  if (agent.profilePhotoFileId) {
    try {
      await imagekit.deleteFile(agent.profilePhotoFileId);
    } catch (err) {
      console.error('Error deleting agent photo from ImageKit:', err);
    }
  }

  // 2. Delete linked User record
  if (agent.userId) {
    await User.findByIdAndDelete(agent.userId);
  }

  // 3. Delete Agent record from database
  await Agent.findByIdAndDelete(req.params.id);

  sendSuccess(res, 'Agent and associated user deleted permanently');
});

// @desc    Get all borrowers assigned to an agent
// @route   GET /api/admin/agents/:id/clients
// @access  Private/Admin
exports.getAgentClients = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id).populate({
    path: 'assignedBorrowers',
    match: { isDeleted: false }
  });

  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  // Enrich borrower data with loan info
  const enrichedBorrowers = await Promise.all(agent.assignedBorrowers.map(async (borrower) => {
    const loans = await Loan.find({ borrowerId: borrower._id });
    const activeLoans = loans.filter(l => l.status === 'active');
    
    // Determine EMI Status (if any active loan has overdue repayment)
    let emiStatus = 'Good';
    activeLoans.forEach(loan => {
      const hasOverdue = loan.repaymentSchedule.some(s => s.status === 'overdue');
      if (hasOverdue) emiStatus = 'Overdue';
    });

    return {
      _id: borrower._id,
      fullName: borrower.fullName,
      email: borrower.email,
      phoneNumber: borrower.phoneNumber,
      profilePhoto: borrower.profilePhoto,
      accountStatus: borrower.accountStatus,
      borrowerCode: borrower.borrowerCode,
      activeLoansCount: activeLoans.length,
      loanStatus: activeLoans.length > 0 ? 'Active' : 'No Active Loans',
      emiStatus
    };
  }));

  sendSuccess(res, 'Agent clients retrieved successfully', enrichedBorrowers);
});

// @desc    Update agent commission settings
// @route   PUT /api/admin/agents/:id/commission
// @access  Private/Admin
exports.updateAgentCommission = asyncHandler(async (req, res) => {
  const { baseCommission, recoveryBonus, commissionTier, internalNotes } = req.body;

  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  // Update fields
  if (baseCommission !== undefined) agent.baseCommission = baseCommission;
  if (recoveryBonus !== undefined) agent.recoveryBonus = recoveryBonus;
  if (commissionTier !== undefined) agent.commissionTier = commissionTier;
  if (internalNotes !== undefined) agent.internalNotes = internalNotes;

  await agent.save();

  sendSuccess(res, 'Commission updated successfully', agent);
});

// @desc    Suspend agent
// @route   PUT /api/admin/agents/:id/suspend
// @access  Private/Admin
exports.suspendAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  agent.accountStatus = 'Suspended';
  agent.suspendedAt = new Date();
  await agent.save();

  // Sync with User
  const user = await User.findById(agent.userId);
  if (user) {
    user.isFrozen = true;
    user.statusReason = 'Your account has been suspended';
    await user.save();
  }

  sendSuccess(res, 'Agent suspended successfully', agent);
});

// @desc    Activate agent
// @route   PUT /api/admin/agents/:id/activate
// @access  Private/Admin
exports.activateAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  agent.accountStatus = 'Active';
  agent.activatedAt = new Date();
  await agent.save();

  // Sync with User
  const user = await User.findById(agent.userId);
  if (user) {
    user.isFrozen = false;
    user.statusReason = '';
    await user.save();
  }

  sendSuccess(res, 'Agent activated successfully', agent);
});

// @desc    Deactivate agent
// @route   PUT /api/admin/agents/:id/deactivate
// @access  Private/Admin
exports.deactivateAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  agent.accountStatus = 'Inactive';
  await agent.save();

  // Sync with User - Inactive agents can still login
  const user = await User.findById(agent.userId);
  if (user) {
    user.isFrozen = false;
    user.statusReason = '';
    await user.save();
  }

  sendSuccess(res, 'Agent marked as inactive successfully', agent);
});
