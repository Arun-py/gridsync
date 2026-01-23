import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Sun, Battery, Zap, AlertTriangle, MessageSquare, LogOut, Wifi, WifiOff, Moon, User, ChevronDown } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useNotification } from '../context/NotificationContext';

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const { isDarkTheme, toggleTheme } = useTheme();
  const { unreadAlertsCount, markAlertsAsRead } = useNotification();
  const location = useLocation();
  const [showProfileDropdown, setShowProfileDropdown] = React.useState(false);

  const navItems = [
    { path: '/', icon: Sun, label: 'Dashboard' },
    ...(user?.role === 'admin' ? [
      { path: '/solar-panel', icon: Sun, label: 'Solar Panel' },
      { path: '/power-usage', icon: Zap, label: 'Power Usage' },
      { path: '/battery', icon: Battery, label: 'Battery' },
      { path: '/faults', icon: AlertTriangle, label: 'ReadMe' },
    ] : []),
    { path: '/messages', icon: MessageSquare, label: 'Messages' },
  ];

  return (
    <nav className={`shadow-lg border-b transition-colors duration-300 ${
      isDarkTheme ? 'bg-gray-800 border-gray-700' : 'bg-white'
    }`}>
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-8">
            <Link to="/" className="flex items-center space-x-2">
              <Sun className="h-8 w-8 text-yellow-500" />
              <span className={`text-xl font-bold ${
                isDarkTheme ? 'text-white' : 'text-gray-900'
              }`}>Smart Micro Grid</span>
            </Link>

            <div className="hidden md:flex space-x-1">
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
                    className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative ${
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
                            ? 'text-gray-300 hover:text-white hover:bg-gray-700'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                    {item.path === '/faults' && unreadAlertsCount > 0 && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse">
                        <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-full transition-colors duration-300 ${
                isDarkTheme 
                  ? 'bg-yellow-500 text-gray-900 hover:bg-yellow-400' 
                  : 'bg-gray-800 text-yellow-400 hover:bg-gray-700'
              }`}
            >
              {isDarkTheme ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <div className="flex items-center space-x-2">
              {connected ? (
                <Wifi className="h-4 w-4 text-green-500" />
              ) : (
                <WifiOff className="h-4 w-4 text-red-500" />
              )}
              <span className={`text-sm ${
                isDarkTheme ? 'text-gray-300' : 'text-gray-600'
              }`}>
                {connected ? 'Connected' : 'Offline'}
              </span>
            </div>

            <div className="relative">
              <button
                onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                  isDarkTheme 
                    ? 'text-gray-200 hover:bg-gray-700' 
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <User className="h-4 w-4" />
                <span className="text-sm">{user?.name}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              
              {showProfileDropdown && (
                <div className={`absolute right-0 mt-2 w-48 rounded-lg shadow-lg border z-50 ${
                  isDarkTheme 
                    ? 'bg-gray-800 border-gray-700' 
                    : 'bg-white border-gray-200'
                }`}>
                  <div className={`px-4 py-3 border-b ${
                    isDarkTheme ? 'border-gray-700' : 'border-gray-200'
                  }`}>
                    <p className={`text-sm font-medium ${
                      isDarkTheme ? 'text-white' : 'text-gray-900'
                    }`}>Profile Details</p>
                    <p className={`text-xs ${
                      isDarkTheme ? 'text-gray-400' : 'text-gray-500'
                    }`}>{user?.email}</p>
                    <p className={`text-xs ${
                      isDarkTheme ? 'text-gray-400' : 'text-gray-500'
                    }`}>Role: {user?.role}</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowProfileDropdown(false);
                      logout();
                    }}
                    className={`w-full flex items-center space-x-2 px-4 py-2 text-left transition-colors ${
                      isDarkTheme 
                        ? 'text-gray-300 hover:bg-gray-700 hover:text-red-400' 
                        : 'text-gray-600 hover:bg-gray-50 hover:text-red-600'
                    }`}
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="text-sm">Logout</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;