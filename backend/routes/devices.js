const express = require('express');
const router = express.Router();

// Control device (turn on/off loads, switch power sources)
router.post('/control', async (req, res) => {
  try {
    const { deviceId, action, value } = req.body;
    
    // Simulate device control
    console.log(`Controlling device ${deviceId}: ${action} = ${value}`);
    
    res.json({ 
      success: true, 
      message: `Device ${deviceId} ${action} set to ${value}`,
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get device status
router.get('/status', async (req, res) => {
  try {
    const devices = {
      solarPanels: { status: 'active', efficiency: 85 },
      battery: { status: 'charging', health: 92 },
      loads: {
        L1: { status: 'on', priority: 'high' },
        L2: { status: 'on', priority: 'medium' },
        L3: { status: 'off', priority: 'low' }
      }
    };
    
    res.json(devices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;