const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schema with Reactions & Password-Protected Rooms
const roomSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  password: String // Stored as plain string for simplicity; hash in production
});
const Room = mongoose.model('Room', roomSchema);

const messageSchema = new mongoose.Schema({
  room: String,
  sender: String,
  text: String,
  replyTo: { type: String, default: null },
  reactions: [{ user: String, emoji: String }],
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

app.use(express.static('public'));

// Tracks users per room: { roomName: Set([username1, username2]) }
const roomUsers = {};

io.on('connection', (socket) => {

  socket.on('join-room', async ({ room, password, username }) => {
    try {
      let roomDoc = await Room.findOne({ name: room });
      if (roomDoc) {
        if (roomDoc.password && roomDoc.password !== password) {
          return socket.emit('join-error', 'Incorrect room passcode!');
        }
      } else if (password) {
        // Create new password-protected room on first join
        roomDoc = new Room({ name: room, password });
        await roomDoc.save();
      }

      socket.join(room);
      socket.username = username;
      socket.room = room;

      if (!roomUsers[room]) roomUsers[room] = new Set();
      roomUsers[room].add(username);

      const pastMessages = await Message.find({ room }).sort({ timestamp: 1 });
      const formattedHistory = pastMessages.map(msg => ({
        id: msg._id,
        sender: msg.sender,
        text: msg.text,
        replyTo: msg.replyTo,
        reactions: msg.reactions || [],
        time: new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }));

      socket.emit('load-history', formattedHistory);
      io.to(room).emit('update-user-list', Array.from(roomUsers[room]));
      socket.to(room).emit('system-message', `${username} joined the chat`);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('send-message', async (data) => {
    try {
      const newMessage = new Message({
        room: data.room,
        sender: data.sender,
        text: data.text,
        replyTo: data.replyTo || null
      });
      await newMessage.save();

      const payload = {
        id: newMessage._id,
        sender: data.sender,
        text: data.text,
        replyTo: data.replyTo || null,
        reactions: [],
        time: new Date(newMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      io.to(data.room).emit('receive-message', payload);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  socket.on('toggle-reaction', async ({ messageId, emoji, username, room }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;

      const existingIndex = msg.reactions.findIndex(r => r.user === username && r.emoji === emoji);
      if (existingIndex > -1) {
        msg.reactions.splice(existingIndex, 1);
      } else {
        msg.reactions.push({ user: username, emoji });
      }
      await msg.save();

      io.to(room).emit('reaction-updated', { messageId, reactions: msg.reactions });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('delete-message', async ({ messageId, room }) => {
    try {
      await Message.findByIdAndDelete(messageId);
      io.to(room).emit('message-deleted', messageId);
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  });

  socket.on('delete-all-messages', async (room) => {
    try {
      await Message.deleteMany({ room });
      io.to(room).emit('all-messages-deleted');
    } catch (err) {
      console.error('Error clearing messages:', err);
    }
  });

  socket.on('typing', (data) => {
    socket.to(data.room).emit('user-typing', data.username);
  });

  socket.on('stop-typing', (data) => {
    socket.to(data.room).emit('user-stopped-typing');
  });

  socket.on('disconnect', () => {
    if (socket.room && socket.username && roomUsers[socket.room]) {
      roomUsers[socket.room].delete(socket.username);
      io.to(socket.room).emit('update-user-list', Array.from(roomUsers[socket.room]));
      io.to(socket.room).emit('system-message', `${socket.username} left the chat`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));