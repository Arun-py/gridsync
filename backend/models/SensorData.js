const mongoose = require('mongoose');

const sensorDataSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  deviceId: { type: String, required: true },
  deviceType: { type: String, enum: ['solar', 'battery', 'load'], required: true },
  voltage: { type: Number },
  current: { type: Number },
  power: { type: Number },
  soc: { type: Number }, // State of Charge for battery
  temperature: { type: Number },
  status: { type: String, enum: ['active', 'inactive', 'fault'], default: 'active' },
  location: { type: String }
});

module.exports = mongoose.model('SensorData', sensorDataSchema);