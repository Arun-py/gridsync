import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Sun, Battery, Zap, AlertTriangle, MessageSquare, LogOut, Wifi, WifiOff, Moon, User, Home, Power } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useNotification } from '../context/NotificationContext';

const AdminSidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const { isDarkTheme, toggleTheme } = useTheme();
  const { unreadAlertsCount, markAlertsAsRead } = useNotification();
  const location = useLocation();

  const navItems = [
    { path: '/', icon: Zap, label: 'Generation' },
    { path: '/solar-panel', icon: Sun, label: 'Solar Panel' },
    { path: '/battery', icon: Battery, label: 'Storage' },
    { path: '/ac-load', icon: Power, label: 'AC Load' },
    { path: '/dc-load', icon: Battery, label: 'DC Load' },
    { path: '/user-consumption', icon: Home, label: 'User Consumption' },
    { path: '/faults', icon: AlertTriangle, label: 'ReadMe' },
    { path: '/messages', icon: MessageSquare, label: 'Messages' },
  ];

  return (
    <div className={`w-64 h-screen fixed left-0 top-0 transition-colors duration-300 border-r ${
      isDarkTheme ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`p-6 border-b ${
        isDarkTheme ? 'border-slate-700' : 'border-gray-200'
      }`}>
        <div className="flex items-center space-x-3">
          <Sun className="h-8 w-8 text-yellow-500" />
          <div>
            <h1 className={`text-lg font-bold ${
              isDarkTheme ? 'text-white' : 'text-gray-900'
            }`}>Smart Micro Grid</h1>
            <p className={`text-xs ${
              isDarkTheme ? 'text-slate-400' : 'text-gray-500'
            }`}>Admin Panel</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-4 flex-1">
        <div className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => {
                  if (item.path === '/faults' && unreadAlertsCount > 0) {
                    markAlertsAsRead();
                  }
                }}
                className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors relative ${
                  item.path === '/faults'
                    ? isActive
                      ? isDarkTheme
                        ? 'bg-red-900 text-red-300'
                        : 'bg-red-100 text-red-700'
                      : isDarkTheme
                        ? 'text-red-300 hover:text-red-200 hover:bg-red-800'
                        : 'text-red-600 hover:text-red-700 hover:bg-red-50'
                    : isActive
                      ? isDarkTheme 
                        ? 'bg-blue-900 text-blue-300' 
                        : 'bg-blue-100 text-blue-700'
                      : isDarkTheme
                        ? 'text-slate-300 hover:text-white hover:bg-slate-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
                {item.path === '/faults' && unreadAlertsCount > 0 && (
                  <div className="absolute right-3 w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className={`p-4 border-t ${
        isDarkTheme ? 'border-slate-700' : 'border-gray-200'
      }`}>
        {/* Connection Status */}
        <div className={`flex items-center space-x-2 mb-4 px-3 py-2 rounded-lg ${
          isDarkTheme ? 'bg-slate-800' : 'bg-gray-50'
        }`}>
          {connected ? (
            <Wifi className="h-4 w-4 text-green-500" />
          ) : (
            <WifiOff className="h-4 w-4 text-red-500" />
          )}
          <span className={`text-xs ${
            isDarkTheme ? 'text-slate-300' : 'text-gray-600'
          }`}>
            {connected ? 'Connected' : 'Offline'}
          </span>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors mb-2 ${
            isDarkTheme 
              ? 'text-slate-300 hover:text-white hover:bg-slate-700' 
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          {isDarkTheme ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          <span>{isDarkTheme ? 'Light Mode' : 'Dark Mode'}</span>
        </button>

        {/* User Profile */}
        <div className={`px-4 py-3 rounded-lg mb-2 ${
          isDarkTheme ? 'bg-slate-800' : 'bg-gray-50'
        }`}>
          <div className="flex items-center space-x-3">
            <User className={`h-5 w-5 ${
              isDarkTheme ? 'text-slate-400' : 'text-gray-500'
            }`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate ${
                isDarkTheme ? 'text-white' : 'text-gray-900'
              }`}>{user?.name}</p>
              <p className={`text-xs truncate ${
                isDarkTheme ? 'text-slate-400' : 'text-gray-500'
              }`}>{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
            isDarkTheme 
              ? 'text-slate-300 hover:text-red-400 hover:bg-slate-700' 
              : 'text-gray-600 hover:text-red-600 hover:bg-gray-100'
          }`}
        >
          <LogOut className="h-5 w-5" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
};

export default AdminSidebar;