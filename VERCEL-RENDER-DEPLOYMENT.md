# 🚀 Complete Deployment Guide: Vercel + Render

## Overview
- **Frontend (React):** Deploy to Vercel
- **Backend (Node.js + Socket.IO):** Deploy to Render
- **Database:** MongoDB Atlas (already configured)

---

## Part 1: Deploy Backend to Render 🔧

### Step 1: Create Render Account
1. Go to **https://render.com**
2. Click **"Get Started"**
3. Sign up with **GitHub** (recommended)
4. Authorize Render to access your GitHub repositories

### Step 2: Create New Web Service
1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub account if not already connected
3. Find and select repository: **"Arun-py/gridsync"**
4. Click **"Connect"**

### Step 3: Configure Web Service Settings

**Basic Settings:**
```
Name: gridsync-backend
Region: Singapore (or closest to you)
Branch: main
Root Directory: (leave blank)
Runtime: Node
Build Command: npm install
Start Command: node backend/server.js
```

**Instance Type:**
```
Free
```

### Step 4: Add Environment Variables
Click **"Advanced"** → **"Add Environment Variable"**

Add these variables:

```bash
# MongoDB Connection
MONGODB_URI=mongodb+srv://prometheus140925_db_user:wkDGjpvOnQJ7gCW9@cluster0.hfwbdpi.mongodb.net/gridsync?retryWrites=true&w=majority

# JWT Secret
JWT_SECRET=GridSync2026SecureJWTKeyChangeThis

# Node Environment
NODE_ENV=production

# Port (Render uses PORT automatically, but define it)
PORT=10000
```

### Step 5: Deploy
1. Click **"Create Web Service"**
2. Wait 3-5 minutes for deployment
3. You'll get a URL like: `https://gridsync-backend.onrender.com`

### Step 6: Update MongoDB Atlas IP Whitelist
1. Go to **MongoDB Atlas Dashboard**
2. Navigate to **Network Access**
3. Click **"Add IP Address"**
4. Select **"Allow Access from Anywhere"** (0.0.0.0/0)
5. Click **"Confirm"**

### Step 7: Test Backend
Visit: `https://YOUR-RENDER-URL.onrender.com/api/health` or similar endpoint

**Copy your Render backend URL - you'll need it for frontend!**

---

## Part 2: Deploy Frontend to Vercel ⚡

### Step 1: Update Frontend API URLs

**IMPORTANT:** Before deploying to Vercel, update your frontend to use the Render backend URL.

You need to update these files:
1. `frontend/src/context/AuthContext.tsx` - Line 50
2. `frontend/src/context/SocketContext.tsx` - Line 45

Replace `http://localhost:5003` with your Render URL: `https://gridsync-backend.onrender.com`

### Step 2: Create Vercel Account
1. Go to **https://vercel.com**
2. Click **"Sign Up"**
3. Choose **"Continue with GitHub"**
4. Authorize Vercel

### Step 3: Import Project
1. Click **"Add New..."** → **"Project"**
2. Find repository: **"Arun-py/gridsync"**
3. Click **"Import"**

### Step 4: Configure Project Settings

**Framework Preset:** Other

**Root Directory:** `./`

**Build Settings:**
```bash
Build Command: cd frontend && npm install && npm run build
Output Directory: frontend/build
Install Command: npm install
```

### Step 5: Environment Variables (Optional for Frontend)
You can add these if needed:

```bash
REACT_APP_API_URL=https://YOUR-RENDER-URL.onrender.com
REACT_APP_SOCKET_URL=https://YOUR-RENDER-URL.onrender.com
```

### Step 6: Deploy
1. Click **"Deploy"**
2. Wait 2-3 minutes
3. You'll get a URL like: `https://gridsync-xxx.vercel.app`

### Step 7: Update Backend CORS

After deployment, update your backend's CORS to allow your Vercel domain:

In `backend/server.js`, update CORS configuration:
```javascript
app.use(cors({
  origin: [
    "http://localhost:3000", 
    "http://localhost:3001",
    "https://gridsync-xxx.vercel.app"  // Add your Vercel URL
  ]
}));
```

---

## Part 3: Post-Deployment Configuration 🔧

### Update Frontend with Backend URL

You'll need to update these 2 files in your frontend:

**File 1: frontend/src/context/AuthContext.tsx**
```typescript
const response = await axios.post('https://YOUR-RENDER-URL.onrender.com/api/auth/login', {
```

**File 2: frontend/src/context/SocketContext.tsx**
```typescript
const newSocket = io('https://YOUR-RENDER-URL.onrender.com');
```

### Redeploy Frontend
After updating the URLs:
```bash
git add .
git commit -m "Update API URLs for production"
git push origin main
```

Vercel will auto-deploy on push!

---

## 🎯 Quick Deployment Checklist

### Backend (Render) ✅
- [ ] Render account created
- [ ] Repository connected
- [ ] Web service configured
- [ ] Environment variables added
- [ ] Backend deployed successfully
- [ ] Backend URL copied
- [ ] MongoDB IP whitelist updated

### Frontend (Vercel) ✅
- [ ] Vercel account created
- [ ] Repository imported
- [ ] Build settings configured
- [ ] Frontend API URLs updated
- [ ] CORS updated in backend
- [ ] Frontend deployed successfully
- [ ] App tested and working

---

## 🔍 Testing Your Deployment

### Test Backend
```bash
# Health check
curl https://YOUR-RENDER-URL.onrender.com/

# Test API endpoint
curl https://YOUR-RENDER-URL.onrender.com/api/auth/login -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@solar.com","password":"admin123"}'
```

### Test Frontend
1. Visit your Vercel URL
2. Try logging in with: `admin@solar.com` / `admin123`
3. Check if real-time data updates work
4. Test Socket.IO connection

---

## ⚠️ Important Notes

### Free Tier Limitations

**Render Free Tier:**
- Spins down after 15 minutes of inactivity
- First request after spin-down takes 30-60 seconds
- 750 hours/month free

**Vercel Free Tier:**
- Unlimited deployments
- 100GB bandwidth/month
- Auto-scaling

### MongoDB Atlas
- Keep IP whitelist as 0.0.0.0/0 for production
- Monitor connection limits (free tier: 500 connections)

---

## 🛠️ Troubleshooting

### Backend Issues
```bash
# Check Render logs
Dashboard → Your Service → Logs

# Common issues:
1. MongoDB connection timeout → Check IP whitelist
2. Port error → Render uses PORT env variable
3. Dependencies error → Check package.json
```

### Frontend Issues
```bash
# Check Vercel deployment logs
Dashboard → Your Project → Deployments → View Function Logs

# Common issues:
1. Build fails → Check Node version (use 18+)
2. API calls fail → Verify backend URL is correct
3. CORS error → Update backend CORS settings
```

### Socket.IO Not Connecting
```bash
# Ensure:
1. Backend URL in SocketContext is correct
2. Backend is running (not spun down)
3. CORS includes your Vercel domain
```

---

## 📱 Your Live URLs

After deployment, you'll have:

```
Frontend: https://gridsync-xxx.vercel.app
Backend:  https://gridsync-backend.onrender.com
Database: MongoDB Atlas (cluster0.hfwbdpi.mongodb.net)
```

---

## 🔄 Continuous Deployment

Both Vercel and Render support auto-deployment:

**Push to GitHub → Auto Deploy**
```bash
git add .
git commit -m "Your changes"
git push origin main
```

- Vercel: Deploys automatically on push
- Render: Deploys automatically on push

---

## 🎉 You're Done!

Your GridSync app is now live with:
- ✅ Frontend on Vercel (fast CDN)
- ✅ Backend on Render (supports Socket.IO)
- ✅ Database on MongoDB Atlas
- ✅ Real-time updates working
- ✅ Auto-deployment enabled

**Need help?** Check logs in Vercel/Render dashboards!
