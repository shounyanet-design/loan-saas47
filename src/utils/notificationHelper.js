const Notification = require('../models/Notification');
const User = require('../models/User');
const { getIO } = require('../socket/socketServer');

const VALID_NOTIFICATION_TYPES = new Set([
  'BORROWER_ALERT',
  'DUE_REMINDER',
  'LOAN_APPROVAL',
  'PAYMENT_UPDATE',
  'PAYMENT_RECEIVED',
  'OVERDUE_WARNING',
  'FOLLOWUP_REMINDER',
  'DOCUMENT_REQUEST',
  'ADMIN_ALERT',
  'NewLoanRequest',
  'ReviewAssigned',
  'PaymentVerification',
  'PaymentRejected',
  'NewMessage',
  'BorrowerReply',
  'AdminMessage',
  'OverdueAlert',
  'LoanApproved',
  'LoanRejected'
]);

const NOTIFICATION_TYPE_MAP = {
  'Approval Alert': 'LOAN_APPROVAL',
  'System Alert': 'ADMIN_ALERT',
  'Borrower Registered': 'ADMIN_ALERT',
  'Loan Application Recommendation': 'ReviewAssigned',
  'Shield Alert': 'ADMIN_ALERT',
  'FOLLOWUP_UPDATE': 'FOLLOWUP_REMINDER',
  'RECOVERY_ALERT': 'FOLLOWUP_REMINDER',
  'NEW_ASSIGNMENT': 'ReviewAssigned',
  'Reminder': 'DUE_REMINDER',
  'AssistanceProvided': 'ADMIN_ALERT'
};

const normalizePriority = (pri) => {
  if (!pri) return 'NORMAL';
  const upper = String(pri).toUpperCase();
  if (['NORMAL', 'IMPORTANT', 'URGENT'].includes(upper)) {
    return upper;
  }
  if (upper === 'HIGH') return 'URGENT';
  if (upper === 'MEDIUM' || upper === 'LOW') return 'NORMAL';
  return 'NORMAL';
};

const resolveNotificationType = (rawType, receiverRole) => {
  if (rawType && VALID_NOTIFICATION_TYPES.has(rawType)) {
    return rawType;
  }
  if (rawType && NOTIFICATION_TYPE_MAP[rawType]) {
    return NOTIFICATION_TYPE_MAP[rawType];
  }
  return receiverRole === 'borrower' ? 'BORROWER_ALERT' : 'ADMIN_ALERT';
};

/**
 * Create a new notification and broadcast in real-time
 * @param {Object} data - Notification data
 * @param {String} data.receiverId - ID of the user receiving the notification
 * @param {String} data.receiverRole - Role of the user receiving the notification
 * @param {String} data.senderId - ID of the user sending the notification (optional)
 * @param {String} data.senderRole - Role of the user sending the notification (optional)
 * @param {String} data.notificationType - Type of notification
 * @param {String} data.type - Type of notification
 * @param {String} data.title - Title of the notification
 * @param {String} data.message - Message of the notification
 * @param {String} data.priority - Priority (NORMAL, IMPORTANT, URGENT)
 */
const createNotification = async (data) => {
  try {
    if (!data) return null;

    // Handle role=admin broadcast without receiverId by querying admin user(s)
    if (data.receiverRole === 'admin' && !data.receiverId) {
      try {
        const admins = await User.find({ role: 'admin' }).select('_id').lean();
        if (admins && admins.length > 0) {
          const createdList = [];
          for (const adminUser of admins) {
            const created = await createNotification({
              ...data,
              receiverId: adminUser._id
            });
            if (created) createdList.push(created);
          }
          return createdList.length > 0 ? createdList[0] : null;
        }
      } catch (adminLookupErr) {
        console.error('[NotificationHelper] Failed to lookup admin users for notification dispatch:', adminLookupErr.message);
      }
    }

    const rawType = data.type || data.notificationType;
    const resolvedType = resolveNotificationType(rawType, data.receiverRole);
    const resolvedPriority = normalizePriority(data.priority);

    const notificationData = {
      ...data,
      type: resolvedType,
      notificationType: resolvedType,
      priority: resolvedPriority,
      status: data.status || 'UNREAD',
      isRead: data.isRead || false,
      isDeleted: false
    };

    const notification = await Notification.create(notificationData);

    // Emit to specific user if receiverId is provided
    try {
      const io = getIO();
      if (data.receiverId) {
        const roomId = data.receiverId.toString();
        io.to(roomId).emit('notification:new', notification);
        
        const unreadCount = await Notification.countDocuments({
          receiverId: data.receiverId,
          status: 'UNREAD',
          isDeleted: false
        });
        
        io.to(roomId).emit('unread:updated', { unreadCount });
        io.to(roomId).emit('notification:count', { unreadCount });
      } else if (data.receiverRole === 'admin') {
        io.to('admin').emit('notification:new', notification);
      }
    } catch (socketErr) {
      console.error('[NotificationHelper] Socket emit warning inside createNotification:', socketErr.message);
    }

    return notification;
  } catch (error) {
    console.error(`[NotificationHelper] Error creating notification model: ${error.message}`);
    return null;
  }
};

module.exports = { createNotification };

