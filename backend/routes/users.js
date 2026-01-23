const express = require('express');
const router = express.Router();

// Get all users (for admin)
router.get('/', async (req, res) => {
  try {
    // In simple server, we'll access users from the main file
    const users = req.app.get('users') || [];
    const userList = users.filter(u => u.role === 'user').map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      homeId: u.homeId
    }));
    
    res.json(userList);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;