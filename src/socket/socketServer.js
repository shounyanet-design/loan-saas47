const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*', // For development. Adjust for production
      methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
  });

  // Socket authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
      if (!token) return next(new Error('Authentication error'));

      const decoded = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');

      if (!user) return next(new Error('User not found'));

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    // Join a room named after the user's ID for targeted notifications
    socket.join(socket.user._id.toString());
    // console.log(`User joined personal room: ${socket.user._id}`);

    // Broadcast user online status (Both original & explicit prompt names)
    socket.broadcast.emit('online_status', { userId: socket.user._id, status: 'online' });
    socket.broadcast.emit('userOnline', { userId: socket.user._id, role: socket.user.role, name: socket.user.fullName });

    // Original listeners
    socket.on('join_room', (roomId) => {
      socket.join(roomId);
    });

    // Explicit prompt listeners
    socket.on('joinConversation', (conversationId) => {
      socket.join(conversationId);
    });

    socket.on('join-conversation', (conversationId) => {
      socket.join(conversationId);
      socket.join(`conversation_${conversationId}`);
    });

    // Typing indicators
    socket.on('typing', ({ roomId, conversationId, userId, userName }) => {
      const targetId = roomId || conversationId;
      if (targetId) {
        socket.to(targetId).emit('typing', { userId, userName });
        socket.to(targetId).emit('userTyping', { conversationId: targetId, userId, userName, isTyping: true });
      }
    });

    socket.on('typing-start', ({ conversationId, userId, userName }) => {
      if (conversationId) {
        socket.to(conversationId).emit('typing-status', { conversationId, userId, userName, isTyping: true });
        socket.to(`conversation_${conversationId}`).emit('typing-status', { conversationId, userId, userName, isTyping: true });
      }
    });

    socket.on('typing-stop', ({ conversationId, userId }) => {
      if (conversationId) {
        socket.to(conversationId).emit('typing-status', { conversationId, userId, isTyping: false });
        socket.to(`conversation_${conversationId}`).emit('typing-status', { conversationId, userId, isTyping: false });
      }
    });

    socket.on('stopTyping', ({ roomId, conversationId, userId }) => {
      const targetId = roomId || conversationId;
      if (targetId) {
        socket.to(targetId).emit('stop_typing', { userId });
        socket.to(targetId).emit('userTyping', { conversationId: targetId, userId, isTyping: false });
      }
    });

    // Mark read
    socket.on('mark_read', ({ roomId, userId }) => {
      socket.to(roomId).emit('mark_read', { userId });
    });

    socket.on('markRead', ({ conversationId, userId }) => {
      socket.to(conversationId).emit('unreadUpdated', { conversationId, userId });
    });

    socket.on('mark-messages-read', ({ conversationId, userId }) => {
      socket.to(conversationId).emit('messages-read', { conversationId, userId });
      socket.to(`conversation_${conversationId}`).emit('messages-read', { conversationId, userId });
    });

    socket.on('disconnect', () => {
      // console.log(`User disconnected: ${socket.user.email}`);
      socket.broadcast.emit('online_status', { userId: socket.user._id, status: 'offline' });
      socket.broadcast.emit('userOffline', { userId: socket.user._id });
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized!');
  return io;
};

module.exports = { initSocket, getIO };
