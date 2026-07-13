const asyncHandler = require('express-async-handler');
const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const User = require('../../models/User');
const Borrower = require('../../models/Borrower');
const { getIO } = require('../../socket/socketServer');
const { sendSuccess, sendError } = require('../../utils/responseHandler');
const { createNotification } = require('../../utils/notificationHelper');

/**
 * @desc    Get all conversations for admin
 * @route   GET /api/admin/communications
 * @access  Private/Admin
 */
const getAllConversations = asyncHandler(async (req, res) => {
  const { filter } = req.query; // e.g., 'borrower', 'agent', 'staff'
  const shouldIncludeBorrowers = !filter || filter === 'all' || filter === 'borrower';
  const activeBorrowerUserIds = shouldIncludeBorrowers
    ? new Set((await Borrower.find({ userId: { $ne: null } }).select('userId').lean()).map(b => b.userId.toString()))
    : new Set();

  let conversations = await Conversation.find({
    participants: req.user._id,
    isDeleted: false
  })
    .populate('participants', 'fullName email role profilePhoto accountStatus status')
    .sort({ updatedAt: -1 });

  // 2. Construct Query for all active system users.
  // Borrowers must also exist in Borrower profiles, matching the Admin Borrowers menu.
  let userQuery;
  if (filter === 'borrower') {
    userQuery = {
      role: 'borrower',
      _id: { $in: [...activeBorrowerUserIds] },
      isDeleted: { $ne: true }
    };
  } else if (filter && filter !== 'all') {
    userQuery = {
      role: filter,
      isDeleted: { $ne: true }
    };
  } else {
    userQuery = {
      isDeleted: { $ne: true },
      $or: [
        { role: 'borrower', _id: { $in: [...activeBorrowerUserIds] } },
        { role: { $in: ['agent', 'staff'] } }
      ]
    };
  }

  const systemUsers = await User.find(userQuery).select('fullName email role profilePhoto accountStatus status');

  // 3. Build Unified Stream Map
  const unifiedList = [];
  const conversationUserMap = new Map();

  conversations.forEach(c => {
    const peer = c.participants.find(p => p?._id?.toString() !== req.user._id.toString());
    if (peer) {
      const peerIdStr = peer._id.toString();
      if (peer.role === 'borrower' && !activeBorrowerUserIds.has(peerIdStr)) return;
      // Only set if not already present (since conversations are sorted by updatedAt: -1, 
      // the first one we see is the most recent)
      if (!conversationUserMap.has(peerIdStr)) {
        conversationUserMap.set(peerIdStr, c);
      }
    }
  });

  // 4. Merge Active Users into Sidebar list
  systemUsers.forEach(user => {
    if (conversationUserMap.has(user._id.toString())) {
      unifiedList.push(conversationUserMap.get(user._id.toString()));
    } else {
      // Virtual conversation representation. Frontend clicks resolve natively to create in DB
      unifiedList.push({
        _id: user._id, // Client handles this _id transition seamlessly on select
        isVirtual: true,
        participants: [req.user, user],
        participantType: 'direct',
        unreadCounts: { [req.user._id.toString()]: 0, [user._id.toString()]: 0 },
        lastMessage: 'No messages yet.',
        lastMessageTime: null
      });
    }
  });

  // Sort so active chats appear on top
  unifiedList.sort((a, b) => {
    const valA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
    const valB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
    return valB - valA;
  });

  sendSuccess(res, 'Conversations populated successfully', unifiedList);
});

/**
 * @desc    Get single conversation
 * @route   GET /api/admin/communications/:id
 * @access  Private/Admin
 */
const getSingleConversation = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let conversation;

  // If id is a valid mongoose object id, look for conversation
  try {
    conversation = await Conversation.findById(id).populate('participants', 'fullName email role profilePhoto');
  } catch (e) { }

  if (!conversation) {
    // If id is a userId, find or create conversation between admin and user
    const otherUserId = id;
    conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, otherUserId] },
      participantType: 'direct'
    }).populate('participants', 'fullName email role profilePhoto');

    if (!conversation) {
      // Create new
      conversation = await Conversation.create({
        participants: [req.user._id, otherUserId],
        participantType: 'direct',
        unreadCounts: { [req.user._id.toString()]: 0, [otherUserId.toString()]: 0 }
      });
      await conversation.populate('participants', 'fullName email role profilePhoto');
    }
  }

  const messages = await Message.find({ conversationId: conversation._id, isDeleted: false })
    .populate('senderId', 'fullName role profilePhoto')
    .sort({ createdAt: 1 });

  sendSuccess(res, 'Conversation fetched', { conversation, messages });
});

/**
 * @desc    Send message
 * @route   POST /api/admin/communications/send
 * @access  Private/Admin
 */
const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId, receiverId, messageType, messageText } = req.body;

  let conversation;
  
  if (conversationId && conversationId.match(/^[0-9a-fA-F]{24}$/)) {
    conversation = await Conversation.findById(conversationId);
  }

  if (!conversation && receiverId) {
    // Look for existing conversation by participants to prevent duplicates
    conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, receiverId] },
      participantType: 'direct'
    });
  }

  if (!conversation) {
    conversation = await Conversation.create({
      participants: [req.user._id, receiverId],
      participantType: 'direct',
      unreadCounts: { [req.user._id.toString()]: 0, [receiverId.toString()]: 0 }
    });
  }

  const message = await Message.create({
    conversationId: conversation._id,
    senderId: req.user._id,
    senderRole: req.user.role,
    receiverId,
    messageType: messageType || 'text',
    message: messageText,
    messageText,
    isDelivered: true
  });

  // Increment unread count for receiver
  if (receiverId) {
    const unreads = conversation.unreadCounts.get(receiverId.toString()) || 0;
    conversation.unreadCounts.set(receiverId.toString(), unreads + 1);
  }

  conversation.lastMessage = messageText;
  conversation.lastMessageTime = new Date();
  conversation.lastMessageAt = new Date();
  await conversation.save();

  await message.populate('senderId', 'fullName role profilePhoto');

  // Create notification for receiver
  try {
    const receiverUser = await User.findById(receiverId);
    if (receiverUser) {
      await createNotification({
        receiverId,
        receiverRole: receiverUser.role,
        senderId: req.user._id,
        senderRole: req.user.role,
        notificationType: 'AdminMessage',
        title: 'New Message from Admin',
        message: messageText.length > 50 ? messageText.substring(0, 47) + '...' : messageText,
        relatedId: conversation._id,
        relatedModel: 'Conversation',
        priority: 'normal'
      });
    }
  } catch (notifErr) {
    console.error('Failed to create message notification:', notifErr);
  }

  // Broadcast via Socket
  try {
    const io = getIO();
    const roomId = conversationId.toString();
    io.to(roomId).emit('message-received', message);
    io.to(roomId).emit('message:received', message);
    io.to(roomId).emit('receiveMessage', message);
    io.to(roomId).emit('receive_message', message);
    
    // Also emit to conversationId room (without .toString()) just in case
    io.to(conversation._id.toString()).emit('message-received', message);
    // Also emit to user specific channel for notifications/sidebar updates
    io.emit(`receiveMessage_${receiverId}`, message);

    // Unread count update for receiver
    const newUnread = (conversation.unreadCounts.get(receiverId.toString()) || 0);
    io.emit(`unread:updated_${receiverId}`, { conversationId, unreadCount: newUnread });

    // Emit to sender too
    io.emit(`receiveMessage_${req.user._id}`, message);
  } catch (err) {
    console.error('Admin socket emit failed:', err);
  }

  sendSuccess(res, 'Message sent successfully', { message });
});

/**
 * @desc    Broadcast message
 * @route   POST /api/admin/communications/broadcast
 * @access  Private/Admin
 */
const broadcastMessage = asyncHandler(async (req, res) => {
  const { targetGroup, messageText } = req.body;

  let usersToBroadcast = [];
  if (targetGroup === 'Borrower') {
    const activeBorrowerUserIds = await Borrower.find({ userId: { $ne: null } }).distinct('userId');
    usersToBroadcast = await User.find({ role: 'borrower', _id: { $in: activeBorrowerUserIds }, isDeleted: { $ne: true } });
  } else if (targetGroup === 'Agent') {
    usersToBroadcast = await User.find({ role: 'agent', isDeleted: { $ne: true } });
  } else if (targetGroup === 'Staff') {
    usersToBroadcast = await User.find({ role: 'staff', isDeleted: { $ne: true } });
  } else if (targetGroup === 'All') {
    const activeBorrowerUserIds = await Borrower.find({ userId: { $ne: null } }).distinct('userId');
    usersToBroadcast = await User.find({
      isDeleted: { $ne: true },
      $or: [
        { role: 'borrower', _id: { $in: activeBorrowerUserIds } },
        { role: { $in: ['agent', 'staff'] } }
      ]
    });
  }

  // Create a broadcast conversation or individual messages?
  // Requirements: "Admin clicks: Execute Broadcast -> Save broadcast -> Emit via Socket.IO -> All selected users receive instantly"
  // For simplicity and direct messaging feel, create individual messages in their respective direct conversations, or one big broadcast.
  // The easiest is creating a message for each user.

  for (let user of usersToBroadcast) {
    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, user._id] },
      participantType: 'direct'
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user._id, user._id],
        participantType: 'direct',
        unreadCounts: { [req.user._id.toString()]: 0, [user._id.toString()]: 0 }
      });
    }

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: req.user._id,
      senderRole: req.user.role,
      receiverId: user._id,
      messageType: 'operational_update',
      message: messageText,
      messageText,
      isDelivered: true
    });

    const unreads = conversation.unreadCounts.get(user._id.toString()) || 0;
    conversation.unreadCounts.set(user._id.toString(), unreads + 1);
    conversation.lastMessage = messageText;
    conversation.lastMessageTime = new Date();
    conversation.lastMessageAt = new Date();
    await conversation.save();

    await message.populate('senderId', 'fullName role profilePhoto');

    const io = getIO();
    const roomId = conversation._id.toString();
    io.to(roomId).emit('message-received', message);
    io.to(roomId).emit('message:received', message);
    io.to(roomId).emit('receive_message', message);
    io.emit(`receive_message_${user._id}`, message);

    // Create notification for broadcast
    try {
      await createNotification({
        receiverId: user._id,
        receiverRole: user.role,
        senderId: req.user._id,
        senderRole: 'admin',
        notificationType: 'AdminMessage',
        title: 'New Broadcast Message',
        message: messageText.length > 50 ? messageText.substring(0, 47) + '...' : messageText,
        relatedId: conversation._id,
        relatedModel: 'Conversation',
        priority: 'important'
      });
    } catch (notifErr) { }
  }

  sendSuccess(res, 'Broadcast sent successfully');
});

/**
 * @desc    Mark messages as read
 * @route   PUT /api/admin/communications/read/:conversationId
 * @access  Private/Admin
 */
const markMessagesRead = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;

  await Message.updateMany(
    { conversationId, receiverId: req.user._id, isRead: false },
    { isRead: true }
  );

  const conversation = await Conversation.findById(conversationId);
  if (conversation) {
    conversation.unreadCounts.set(req.user._id.toString(), 0);
    await conversation.save();
  }

  const io = getIO();
  io.to(conversationId).emit('messages_read', { conversationId, userId: req.user._id });

  sendSuccess(res, 'Messages marked as read');
});

/**
 * @desc    Search conversations
 * @route   GET /api/admin/communications/search
 * @access  Private/Admin
 */
const searchConversations = asyncHandler(async (req, res) => {
  const { query } = req.query;
  const activeBorrowerUserIds = new Set((await Borrower.find({ userId: { $ne: null } }).select('userId').lean()).map(b => b.userId.toString()));

  const users = await User.find({
    isDeleted: { $ne: true },
    $or: [
      { fullName: { $regex: query, $options: 'i' } },
      { role: { $regex: query, $options: 'i' } }
    ]
  }).select('_id');

  const userIds = users.map(u => u._id);

  const conversations = await Conversation.find({
    isDeleted: false,
    participants: { $in: userIds }
  }).populate('participants', 'fullName email role profilePhoto');

  const filteredConversations = conversations.filter(conversation =>
    conversation.participants.every(participant =>
      participant && (participant.role !== 'borrower' || activeBorrowerUserIds.has(participant._id.toString()))
    )
  );

  sendSuccess(res, 'Search results', filteredConversations);
});

/**
 * @desc    Get unread counts
 * @route   GET /api/admin/communications/unread
 * @access  Private/Admin
 */
const getUnreadCounts = asyncHandler(async (req, res) => {
  const conversations = await Conversation.find({
    participants: req.user._id,
    isDeleted: false
  });

  let totalUnread = 0;
  conversations.forEach(c => {
    totalUnread += (c.unreadCounts.get(req.user._id.toString()) || 0);
  });

  sendSuccess(res, 'Unread count fetched', { totalUnread });
});

/**
 * @desc    Delete a single message (soft delete)
 * @route   DELETE /api/admin/communications/messages/:id
 * @access  Private/Admin
 */
const deleteMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const message = await Message.findById(id);

  if (!message) {
    return sendError(res, 'Message not found', 404);
  }

  message.isDeleted = true;
  await message.save();

  // Broadcast deletions via socket stream
  const io = getIO();
  io.to(message.conversationId.toString()).emit('message_deleted', {
    conversationId: message.conversationId,
    messageId: message._id
  });

  sendSuccess(res, 'Message deleted successfully', { messageId: id });
});

module.exports = {
  getAllConversations,
  getSingleConversation,
  sendMessage,
  broadcastMessage,
  markMessagesRead,
  searchConversations,
  getUnreadCounts,
  deleteMessage
};
