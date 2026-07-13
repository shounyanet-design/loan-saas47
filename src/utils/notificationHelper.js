const Notification = require('../models/Notification');
const { getIO } = require('../socket/socketServer');

/**
 * Create a new notification and broadcast in real-time
 * @param {Object} data - Notification data
 * @param {String} data.receiverId - ID of the user receiving the notification
 * @param {String} data.receiverRole - Role of the user receiving the notification
 * @param {String} data.senderId - ID of the user sending the notification (optional)
 * @param {String} data.senderRole - Role of the user sending the notification (optional)
 * @param {String} data.notificationType - Type of notification
 * @param {String} data.title - Title of the notification
 * @param {String} data.message - Message of the notification
 * @param {String} data.relatedId - ID of the related entity (Loan, Payment, etc.)
 * @param {String} data.relatedModel - Model name of the related entity
 * @param {String} data.priority - Priority (normal, important, urgent)
 */
const createNotification = async (data) => {
  try {
    // Standardize the type field
    const notificationData = {
      ...data,
      type: data.type || data.notificationType,
      notificationType: data.notificationType || data.type,
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
        console.log(`[Notification] Emitting notification:new to room: ${roomId}`);
        
        // Emit the full notification object
        io.to(roomId).emit('notification:new', notification);
        
        // Also emit unread count update for navbar bell
        const unreadCount = await Notification.countDocuments({
          receiverId: data.receiverId,
          status: 'UNREAD',
          isDeleted: false
        });
        
        console.log(`[Notification] Emitting unread:updated to room: ${roomId}, count: ${unreadCount}`);
        io.to(roomId).emit('unread:updated', { unreadCount });
        io.to(roomId).emit('notification:count', { unreadCount }); // For Agent Dashboard specific listener
      } else if (data.receiverRole === 'admin') {
        // Broadcast to all admins if no specific receiverId
        io.to('admin').emit('notification:new', notification);
      }
    } catch (socketErr) {
      console.error('Socket emit failed inside createNotification:', socketErr.message);
    }

    return notification;
  } catch (error) {
    console.error('Error creating notification model:', error);
    return null;
  }
};


module.exports = { createNotification };
