# 🚀 Solar Energy Microgrid System Setup

## 📋 Prerequisites
1. **Node.js** (v14 or higher)
2. **MongoDB Atlas Account** (or local MongoDB)
3. **Git** (optional)

## 🔧 MongoDB Atlas Setup
1. **Whitelist Your IP**:
   - Go to MongoDB Atlas Dashboard
   - Navigate to Network Access
   - Click "Add IP Address"
   - Add your current IP or use 0.0.0.0/0 for all IPs (development only)

2. **Get Connection String**:
   - Your current string: `mongodb+srv://SandheeshS:Vishnu%402006@cluster0.r78zvli.mongodb.net/solar_microgrid?retryWrites=true&w=majority&appName=Cluster0`

## 🚀 Quick Start

### Option 1: With MongoDB Atlas
```bash
# 1. Install dependencies
npm install
cd frontend && npm install && cd ..

# 2. Seed database (after whitelisting IP)
node database/simple-seed.js

# 3. Start backend
npm run server

# 4. Start frontend (new terminal)
npm run client
```

### Option 2: Without MongoDB (In-Memory)
```bash
# 1. Install dependencies
npm install
cd frontend && npm install && cd ..

# 2. Start simple server (no database needed)
node backend/simple-server.js

# 3. Start frontend (new terminal)
cd frontend && npm start
```

## 🌐 Access Points
- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:5000

## 🔑 Demo Accounts
- **Admin**: admin@solar.com / admin123
- **User**: user@solar.com / user123

## 📊 Features
- ✅ Role-based dashboards (Admin/User)
- ✅ Real-time sensor data
- ✅ User registration with home selection
- ✅ Admin can see all registered users
- ✅ Socket.IO for live updates
- ✅ MongoDB Atlas integration

## 🛠️ Troubleshooting
1. **Port 5000 in use**: Kill process with `taskkill /f /pid <PID>`
2. **MongoDB connection**: Check IP whitelist in Atlas
3. **CORS errors**: Server allows both port 3000 and 3001

## 📁 Project Structure
```
SolarEnergySystemSIH/
├── backend/
│   ├── server.js (MongoDB version)
│   ├── simple-server.js (In-memory version)
│   ├── models/
│   └── routes/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   └── context/
│   └── public/
├── database/
│   ├── seed.js
│   └── simple-seed.js
└── README.md
```