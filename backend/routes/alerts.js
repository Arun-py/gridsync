const express = require('express');
const Alert = require('../models/Alert');
const router = express.Router();

// Get alerts for user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const alerts = await Alert.find({ 
      $or: [{ userId }, { userId: null }] 
    }).sort({ timestamp: -1 });
    
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create new alert
router.post('/', async (req, res) => {
  try {
    const alert = new Alert({
      ...req.body,
      alertId: `ALT_${Date.now()}`
    });
    
    await alert.save();
    res.status(201).json(alert);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update alert status
router.patch('/:alertId', async (req, res) => {
  try {
    const { alertId } = req.params;
    const { status } = req.body;
    
    const alert = await Alert.findOneAndUpdate(
      { alertId },
      { status, resolvedAt: status === 'resolved' ? new Date() : null },
      { new: true }
    );
    
    res.json(alert);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;