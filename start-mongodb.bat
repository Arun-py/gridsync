@echo off
echo ========================================
echo   Solar Microgrid - MongoDB Version
echo ========================================

echo.
echo Checking MongoDB Atlas connection...
echo.

echo 1. Creating admin user...
node database/create-admin.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ MongoDB connection failed!
    echo 📋 Please follow these steps:
    echo    1. Go to MongoDB Atlas Dashboard
    echo    2. Click "Network Access"
    echo    3. Add your current IP address
    echo    4. Try again
    echo.
    echo 🔄 Starting simple server instead...
    node backend/simple-server.js
    pause
    exit
)

echo.
echo 2. Starting MongoDB server...
start "MongoDB Server" cmd /k "node backend/mongodb-server.js"

echo.
echo 3. Waiting for server to start...
timeout /t 3 /nobreak > nul

echo.
echo 4. Starting frontend...
cd frontend
start "Frontend App" cmd /k "npm start"
cd ..

echo.
echo ========================================
echo   MongoDB System Started!
echo ========================================
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:5001
echo   Database: MongoDB Atlas
echo.
echo   Admin: admin@solar.com / admin123
echo ========================================

pause