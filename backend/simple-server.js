const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

// In-memory storage
let users = [
  {
    id: '1',
    name: 'System Administrator',
    email: 'admin@solar.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.s5uIf6', // admin123
    role: 'admin'
  },
  {
    id: '2',
    name: 'John Doe',
    email: 'user@solar.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.s5uIf6', // user123
    role: 'user',
    homeId: 'Home1'
  }
];

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, homeId } = req.body;
    
    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = {
      id: Date.now().toString(),
      name,
      email,
      password: hashedPassword,
      role: role || 'user',
      homeId: role === 'user' ? homeId : undefined
    };
    
    users.push(newUser);
    
    const token = jwt.sign({ userId: newUser.id }, 'secret', { expiresIn: '7d' });
    
    res.status(201).json({
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, homeId: newUser.homeId }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = users.find(u => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ userId: user.id }, 'secret', { expiresIn: '7d' });
    
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, homeId: user.homeId }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get users route
app.get('/api/users', (req, res) => {
  try {
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

// Socket.IO
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Simulate sensor data
setInterval(() => {
  const sensorData = {
    timestamp: new Date(),
    solarPanel: {
      voltage: (220 + Math.random() * 20).toFixed(2),
      current: (15 + Math.random() * 5).toFixed(2),
      power: (3300 + Math.random() * 500).toFixed(2)
    },
    battery: {
      soc: (70 + Math.random() * 30).toFixed(1),
      voltage: (48 + Math.random() * 4).toFixed(2),
      current: (10 + Math.random() * 5).toFixed(2),
      temperature: (25 + Math.random() * 10).toFixed(1)
    },
    loads: {
      L1: (500 + Math.random() * 200).toFixed(2),
      L2: (300 + Math.random() * 150).toFixed(2),
      L3: (400 + Math.random() * 100).toFixed(2)
    }
  };
  
  io.emit('sensor-data', sensorData);
}, 5000);

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Frontend should connect to http://localhost:3000`);
  console.log(`🔗 Backend API available at http://localhost:${PORT}`);
  console.log(`🔑 Demo accounts:`);
  console.log(`   Admin: admin@solar.com / admin123`);
  console.log(`   User: user@solar.com / user123`);
});