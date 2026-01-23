const express = require('express');
const SensorData = require('../models/SensorData');
const router = express.Router();

// Get latest sensor data
router.get('/latest', async (req, res) => {
  try {
    const latestData = await SensorData.find()
      .sort({ timestamp: -1 })
      .limit(10);
    res.json(latestData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get historical data
router.get('/history', async (req, res) => {
  try {
    const { deviceType, startDate, endDate } = req.query;
    const query = {};
    
    if (deviceType) query.deviceType = deviceType;
    if (startDate && endDate) {
      query.timestamp = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const data = await SensorData.find(query).sort({ timestamp: -1 });
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add sensor data (for IoT devices)
router.post('/data', async (req, res) => {
  try {
    const sensorData = new SensorData(req.body);
    await sensorData.save();
    res.status(201).json(sensorData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;