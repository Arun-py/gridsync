const express = require('express');
const Message = require('../models/Message');
const User = require('../models/User');
const router = express.Router();

// Send message (admin to user)
router.post('/send', async (req, res) => {
  try {
    const { senderId, receiverId, message, type, priority } = req.body;
    
    const newMessage = new Message({
      senderId,
      receiverId,
      message,
      type,
      priority
    });
    
    await newMessage.save();
    res.status(201).json(newMessage);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get messages for user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const messages = await Message.find({
      $or: [
        { receiverId: userId },
        { type: 'broadcast' }
      ]
    })
    .populate('senderId', 'name role')
    .sort({ timestamp: -1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Mark message as read
router.patch('/:messageId/read', async (req, res) => {
  try {
    const { messageId } = req.params;
    await Message.findByIdAndUpdate(messageId, { isRead: true });
    res.json({ message: 'Message marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all users (for admin)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('name email homeId');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;