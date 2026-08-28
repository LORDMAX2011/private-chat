const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Connect to MongoDB Atlas
const MONGO_URI = "mongodb+srv://MAX:<db_password>@cluster0.uvhk3hz.mongodb.net/?appName=Cluster0";
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define how messages are stored in the database
const messageSchema = new mongoose.Schema({
  room: String,
  sender: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

app.use(express.static('public'));

io.on('connection', (socket) => {

  // When a user enters a room
  socket.on('join-room', async ({ room, username }) => {
    socket.join(room);

    // Fetch previous messages for this room from MongoDB
    const pastMessages = await Message.find({ room }).sort({ timestamp: 1 });
    
    // Send only to the joining user
    socket.emit('load-history', pastMessages);
  });

  // When a user sends a message
  socket.on('send-message', async (data) => {
    // Save to database
    const newMessage = new Message({
      room: data.room,
      sender: data.sender,
      text: data.text
    });
    await newMessage.save();

    // Send message to everyone in the room
    io.to(data.room).emit('receive-message', data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));