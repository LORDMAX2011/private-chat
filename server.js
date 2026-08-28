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

const messageSchema = new mongoose.Schema({
  room: String,
  sender: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

app.use(express.static('public'));

io.on('connection', (socket) => {

  socket.on('join-room', async ({ room, username }) => {
    socket.join(room);
    socket.username = username;
    socket.room = room;

    try {
      const pastMessages = await Message.find({ room }).sort({ timestamp: 1 });
      
      const formattedHistory = pastMessages.map(msg => ({
        id: msg._id,
        sender: msg.sender,
        text: msg.text,
        time: new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }));

      socket.emit('load-history', formattedHistory);
      socket.to(room).emit('system-message', `${username} joined the chat`);
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  });

  socket.on('send-message', async (data) => {
    try {
      const newMessage = new Message({
        room: data.room,
        sender: data.sender,
        text: data.text
      });
      await newMessage.save();

      const payload = {
        id: newMessage._id,
        sender: data.sender,
        text: data.text,
        time: new Date(newMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      io.to(data.room).emit('receive-message', payload);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  // Handle single message deletion
  socket.on('delete-message', async ({ messageId, room }) => {
    try {
      await Message.findByIdAndDelete(messageId);
      io.to(room).emit('message-deleted', messageId);
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  });

  // Handle clear all messages in a room
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
    if (socket.room && socket.username) {
      io.to(socket.room).emit('system-message', `${socket.username} left the chat`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));