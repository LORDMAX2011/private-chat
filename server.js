const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Connection string pulled securely from Render environment variables
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Database schema including room, sender, message text, and timestamp
const messageSchema = new mongoose.Schema({
  room: String,
  sender: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

app.use(express.static('public'));

io.on('connection', (socket) => {

  // Load chat history when entering a room
  socket.on('join-room', async ({ room, username }) => {
    socket.join(room);

    try {
      const pastMessages = await Message.find({ room }).sort({ timestamp: 1 });
      
      const formattedHistory = pastMessages.map(msg => ({
        sender: msg.sender,
        text: msg.text,
        time: new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }));

      socket.emit('load-history', formattedHistory);
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  });

  // Save new messages to DB and broadcast with formatted timestamp
  socket.on('send-message', async (data) => {
    try {
      const newMessage = new Message({
        room: data.room,
        sender: data.sender,
        text: data.text
      });
      await newMessage.save();

      const payload = {
        sender: data.sender,
        text: data.text,
        time: new Date(newMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      io.to(data.room).emit('receive-message', payload);
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  // Typing status events
  socket.on('typing', (data) => {
    socket.to(data.room).emit('user-typing', data.username);
  });

  socket.on('stop-typing', (data) => {
    socket.to(data.room).emit('user-stopped-typing');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));