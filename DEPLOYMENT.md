# 🚀 Deployment Guide - GridSync

## Vercel Deployment (Frontend + Backend)

### Prerequisites
1. GitHub account with repository: https://github.com/Arun-py/gridsync.git
2. Vercel account (free): https://vercel.com/signup
3. MongoDB Atlas account with connection string

---

## 📋 **Step-by-Step Deployment**

### **Step 1: Install Vercel CLI (Optional)**
```bash
npm install -g vercel
```

### **Step 2: Build Frontend**
```bash
cd frontend
npm install
npm run build
```

### **Step 3: Login to Vercel**
Visit [Vercel Dashboard](https://vercel.com/dashboard)
- Sign up with GitHub
- Authorize Vercel to access your repositories

### **Step 4: Import Your GitHub Repository**
1. Click **"Add New Project"** → **"Import"**
2. Select repository: **Arun-py/gridsync**
3. Click **"Import"**

### **Step 5: Configure Project Settings**

**Framework Preset:** Other (or Node.js)

**Root Directory:** `./` (leave as root)

**Build Settings:**
- **Build Command:** 
  ```
  cd frontend && npm install && npm run build
  ```
- **Output Directory:** 
  ```
  frontend/build
  ```
- **Install Command:** 
  ```
  npm install
  ```

### **Step 6: Environment Variables**
Add these in Vercel dashboard → Settings → Environment Variables:

```
MONGODB_URI=mongodb+srv://SandheeshS:Vishnu%402006@cluster0.r78zvli.mongodb.net/solar_microgrid?retryWrites=true&w=majority&appName=Cluster0

JWT_SECRET=your_secure_random_string_here_change_this

NODE_ENV=production
```

**To generate secure JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### **Step 7: Deploy**
Click **"Deploy"** button

---

## ⚠️ **Important: Socket.IO Limitation**

Vercel uses **serverless functions** which don't support persistent WebSocket connections needed for Socket.IO.

### **Solution Options:**

#### **Option A: Deploy Backend Separately**
1. **Frontend on Vercel** ✅
2. **Backend on Railway/Render** (free tier available)

#### **Option B: Use Vercel + External WebSocket Service**
- Deploy REST APIs on Vercel
- Use **Pusher** or **Ably** for real-time features

#### **Option C: Deploy Everything on Railway (Recommended for this project)**
Railway supports full Node.js apps with Socket.IO

---

## 🚂 **Alternative: Deploy on Railway (Better for WebSockets)**

### **Railway Deployment Steps:**

1. **Visit:** https://railway.app/
2. **Login with GitHub**
3. **New Project → Deploy from GitHub**
4. **Select:** Arun-py/gridsync
5. **Add Environment Variables:**
   ```
   MONGODB_URI=your_connection_string
   JWT_SECRET=your_secret
   PORT=5000
   ```
6. **Railway will auto-detect and deploy**

---

## 🌐 **Recommended Deployment Strategy**

### **Best Approach:**
1. **Frontend:** Vercel (static files, fast CDN)
2. **Backend:** Railway or Render (supports Socket.IO)

### **Steps:**
1. Deploy frontend to Vercel
2. Deploy backend to Railway
3. Update frontend API endpoints to point to Railway backend URL
4. Update CORS settings in backend to allow Vercel domain

---

## 📝 **After Deployment Checklist**

- [ ] Test login functionality
- [ ] Verify real-time sensor data updates
- [ ] Check admin/user dashboards
- [ ] Test messaging system
- [ ] Verify MongoDB connection
- [ ] Update MongoDB Atlas IP whitelist (add 0.0.0.0/0 for production or Vercel IPs)

---

## 🔧 **Troubleshooting**

**Issue:** Build fails
- Check Node.js version (use v18+)
- Ensure all dependencies are in package.json

**Issue:** API calls fail
- Verify environment variables are set
- Check CORS configuration
- Ensure MongoDB Atlas IP whitelist includes Vercel/Railway IPs

**Issue:** Socket.IO not working on Vercel
- This is expected! Use Railway for backend or switch to REST polling

---

## 📱 **Contact**
For issues, check the logs in Vercel/Railway dashboard
