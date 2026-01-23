@echo off
echo ========================================
echo   Solar Energy Microgrid System Setup
echo ========================================

echo.
echo 1. Seeding MongoDB Atlas Database...
node database/seed.js

echo.
echo 2. Starting Backend Server...
start "Backend Server" cmd /k "node backend/server.js"

echo.
echo 3. Waiting 3 seconds for backend to start...
timeout /t 3 /nobreak > nul

echo.
echo 4. Starting Frontend Application...
cd frontend
start "Frontend App" cmd /k "npm start"
cd ..

echo.
echo ========================================
echo   System Started Successfully!
echo ========================================
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:5000
echo   Database: MongoDB Atlas
echo.
echo   Demo Accounts:
echo   Admin: admin@solar.com / admin123
echo   User:  user@solar.com / user123
echo ========================================

pause