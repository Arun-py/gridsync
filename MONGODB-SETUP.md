# 🗄️ MongoDB Atlas Setup Guide

## 🚨 IMPORTANT: IP Whitelist Issue
Your MongoDB Atlas cluster is blocking connections because your IP address is not whitelisted.

## 🔧 Fix MongoDB Atlas Connection

### Step 1: Whitelist Your IP Address
1. Go to [MongoDB Atlas Dashboard](https://cloud.mongodb.com/)
2. Select your cluster: **Cluster0**
3. Click **"Network Access"** in the left sidebar
4. Click **"Add IP Address"**
5. Choose one option:
   - **Add Current IP Address** (recommended for development)
   - **Allow Access from Anywhere** (0.0.0.0/0) - Less secure but works

### Step 2: Verify Connection String
Your connection string:
```
mongodb+srv://prometheus140925_db_user:wkDGjpvOnQJ7gCW9@cluster0.hfwbdpi.mongodb.net/gridsync?retryWrites=true&w=majority
```

## 🚀 After Whitelisting IP

### Option 1: Full MongoDB Setup
```bash
# 1. Create admin user
node database/create-admin.js

# 2. Start MongoDB server
node backend/mongodb-server.js

# 3. Start frontend (new terminal)
cd frontend && npm start
```

### Option 2: Quick Test (In-Memory)
```bash
# Start simple server (no database)
node backend/simple-server.js

# Start frontend (new terminal)  
cd frontend && npm start
```

## 📊 What Gets Stored in MongoDB

### Users Collection
```json
{
  "_id": "ObjectId",
  "name": "John Doe",
  "email": "john@example.com", 
  "password": "hashed_password",
  "role": "user",
  "homeId": "Home1",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Sensor Data Collection
```json
{
  "_id": "ObjectId",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "solarPanel": {
    "voltage": 235.67,
    "current": 18.23,
    "power": 3456.78
  },
  "battery": {
    "soc": 85.5,
    "voltage": 49.2,
    "current": 12.5,
    "temperature": 28.3
  },
  "loads": {
    "L1": 650.25,
    "L2": 420.15,
    "L3": 380.90
  }
}
```

## 🔑 Demo Accounts (After Setup)
- **Admin**: admin@solar.com / admin123
- **Users**: Register new users through the app

## 🛠️ Features with MongoDB
- ✅ **Persistent User Data**: All registrations saved
- ✅ **Real-time Sensor Storage**: Every 5 seconds
- ✅ **Login History**: Track user sessions
- ✅ **Data Analytics**: Historical sensor data
- ✅ **Admin Dashboard**: See all registered users
- ✅ **Automatic Updates**: Database syncs with UI

## 🔍 Verify Database
After setup, check your MongoDB Atlas dashboard:
1. Go to **"Browse Collections"**
2. You should see:
   - **users** collection (registered users)
   - **sensordatas** collection (real-time sensor data)

## 🚨 Troubleshooting
1. **Connection Timeout**: Check IP whitelist
2. **Authentication Failed**: Verify username/password
3. **Database Not Found**: Will be created automatically
4. **Port Issues**: Use different port (5001 instead of 5000)

## 📱 Access Points
- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:5001
- **MongoDB**: Atlas Dashboard