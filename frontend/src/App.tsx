import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import io from 'socket.io-client';
import Navbar from './components/Navbar';
import AdminSidebar from './components/AdminSidebar';
import UserSidebar from './components/UserSidebar';
import Dashboard from './components/Dashboard';
import UserDashboard from './components/UserDashboard';
import AdminDashboard from './components/AdminDashboard';
import SolarPanel from './components/SolarPanel';
import PowerUsage from './components/PowerUsage';
import Battery from './components/Battery';
import UserConsumption from './components/UserConsumption';
import Faults from './components/Faults';
import Messages from './components/Messages';
import ACLoad from './components/ACLoad';
import DCLoad from './components/DCLoad';
import Login from './components/Login';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { NotificationProvider } from './context/NotificationContext';

function AppContent() {
  const { user } = useAuth();
  const { isDarkTheme } = useTheme();

  if (!user) {
    return <Login />;
  }

  if (user?.role === 'admin') {
    return (
      <div className={`min-h-screen transition-colors duration-300 ${
        isDarkTheme 
          ? 'bg-gray-900' 
          : 'bg-gradient-to-br from-blue-50 via-green-50 to-yellow-50'
      }`}>
        <AdminSidebar />
        <main className={`ml-64 p-8 min-h-screen ${
          isDarkTheme ? 'bg-slate-900' : ''
        }`}>
          <Routes>
            <Route path="/" element={<AdminDashboard />} />
            <Route path="/solar-panel" element={<SolarPanel />} />
            <Route path="/battery" element={<Battery />} />
            <Route path="/ac-load" element={<ACLoad />} />
            <Route path="/dc-load" element={<DCLoad />} />
            <Route path="/user-consumption" element={<UserConsumption />} />
            <Route path="/faults" element={<Faults />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      isDarkTheme 
        ? 'bg-slate-900' 
        : 'bg-gradient-to-br from-blue-50 via-green-50 to-yellow-50'
    }`}>
      <UserSidebar />
      <main className={`ml-64 p-8 min-h-screen ${
        isDarkTheme ? 'bg-slate-900' : ''
      }`}>
        <Routes>
          <Route path="/" element={<UserDashboard />} />
          <Route path="/ac-load" element={<ACLoad />} />
          <Route path="/dc-load" element={<DCLoad />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <NotificationProvider>
          <ThemeProvider>
            <Router>
              <AppContent />
            </Router>
          </ThemeProvider>
        </NotificationProvider>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;