const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST"]
  }
});

app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001"]
}));
app.use(express.json());

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb+srv://prometheus140925_db_user:YOUR_PASSWORD@cluster0.hfwbdpi.mongodb.net/solar_microgrid?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ MongoDB Atlas connected successfully!');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  homeId: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

const User = mongoose.model('User', userSchema);

// Sensor Data Schema
const sensorDataSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  solarPanel: {
    voltage: Number,
    current: Number,
    power: Number
  },
  battery: {
    soc: Number,
    voltage: Number,
    current: Number,
    temperature: Number
  },
  loads: {
    L1: Number,
    L2: Number,
    L3: Number
  }
});

const SensorData = mongoose.model('SensorData', sensorDataSchema);

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, homeId } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    const newUser = new User({
      name,
      email,
      password,
      role: role || 'user',
      homeId: role === 'user' ? homeId : undefined
    });
    
    await newUser.save();
    console.log(`✅ New user registered: ${name} (${email}) - ${role}`);
    console.log(`📊 User saved to MongoDB with ID: ${newUser._id}`);
    
    // Verify user was saved
    const savedUser = await User.findById(newUser._id);
    console.log(`🔍 Verification - User found in DB: ${savedUser ? 'YES' : 'NO'}`);
    
    const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    
    res.status(201).json({
      token,
      user: { 
        id: newUser._id, 
        name: newUser.name, 
        email: newUser.email, 
        role: newUser.role, 
        homeId: newUser.homeId 
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    console.log(`✅ User logged in: ${user.name} (${email})`);
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    
    res.json({
      token,
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        role: user.role, 
        homeId: user.homeId 
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get users route
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('name email homeId createdAt');
    console.log(`📊 Found ${users.length} users in database`);
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get sensor data
app.get('/api/sensors/latest', async (req, res) => {
  try {
    const latestData = await SensorData.findOne().sort({ timestamp: -1 });
    res.json(latestData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

// Generate and store sensor data
const generateSensorData = async () => {
  const sensorData = {
    timestamp: new Date(),
    solarPanel: {
      voltage: parseFloat((220 + Math.random() * 20).toFixed(2)),
      current: parseFloat((15 + Math.random() * 5).toFixed(2)),
      power: parseFloat((3300 + Math.random() * 500).toFixed(2))
    },
    battery: {
      soc: parseFloat((70 + Math.random() * 30).toFixed(1)),
      voltage: parseFloat((48 + Math.random() * 4).toFixed(2)),
      current: parseFloat((10 + Math.random() * 5).toFixed(2)),
      temperature: parseFloat((25 + Math.random() * 10).toFixed(1))
    },
    loads: {
      L1: parseFloat((500 + Math.random() * 200).toFixed(2)),
      L2: parseFloat((300 + Math.random() * 150).toFixed(2)),
      L3: parseFloat((400 + Math.random() * 100).toFixed(2))
    }
  };
  
  try {
    // Save to database
    const newSensorData = new SensorData(sensorData);
    await newSensorData.save();
    
    // Emit to all connected clients
    io.emit('sensor-data', sensorData);
    
    console.log('📊 Sensor data updated and stored');
  } catch (error) {
    console.error('Error saving sensor data:', error);
  }
};

// Start database connection and server
const startServer = async () => {
  await connectDB();
  
  // Generate sensor data every 5 seconds
  setInterval(generateSensorData, 5005);
  
  const PORT = process.env.PORT || 5002;
  server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Frontend should connect to http://localhost:3000`);
    console.log(`🔗 Backend API available at http://localhost:${PORT}`);
    console.log(`📊 Real-time sensor data every 5 seconds`);
    console.log(`🔑 Demo accounts will be created on first registration`);
  });
};

startServer();