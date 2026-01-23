import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Sun, Battery, Home, Cloud } from 'lucide-react';

const UserDashboard: React.FC = () => {
  const { sensorData } = useSocket();
  const { user } = useAuth();
  const [todayTotal, setTodayTotal] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const { isDarkTheme } = useTheme();

  const getMyLoad = () => {
    const homeMap: { [key: string]: 'L1' | 'L2' | 'L3' } = { 'Home1': 'L1', 'Home2': 'L2', 'Home3': 'L3', 'Home4': 'L1', 'Home5': 'L2' };
    const loadKey = homeMap[user?.homeId || ''] || 'L1';
    return parseFloat(sensorData?.loads[loadKey as keyof typeof sensorData.loads] || '0');
  };

  const myLoad = getMyLoad();

  // Calculate today's total consumption
  useEffect(() => {
    if (sensorData && myLoad > 0) {
      const now = new Date();
      const timeDiff = (now.getTime() - lastUpdate.getTime()) / 1000; // seconds
      const energyConsumed = (myLoad * timeDiff) / 3600; // Wh
      setTodayTotal(prev => prev + energyConsumed);
      setLastUpdate(now);
    }
  }, [sensorData, myLoad]);

  // Reset daily total at midnight
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    const timer = setTimeout(() => {
      setTodayTotal(0);
    }, msUntilMidnight);
    
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className={`text-2xl font-bold ${isDarkTheme ? 'text-white' : 'text-gray-900'}`}>My Energy Monitor</h1>
          <p className={`${isDarkTheme ? 'text-gray-300' : 'text-gray-600'}`}>{user?.name}</p>
        </div>
        <div className={`text-sm px-3 py-1 rounded-full ${
          isDarkTheme 
            ? 'text-green-300 bg-green-900' 
            : 'text-gray-600 bg-green-100'
        }`}>
          Auto-refresh: {sensorData ? new Date(sensorData.timestamp).toLocaleTimeString() : 'Connecting...'}
        </div>
      </div>

      {/* Basic Real-time Data */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className={`card transition-colors duration-300 ${
          isDarkTheme 
            ? 'bg-gray-800 border-gray-700' 
            : 'bg-gradient-to-r from-yellow-50 to-yellow-100 border-yellow-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${
                isDarkTheme ? 'text-yellow-300' : 'text-yellow-800'
              }`}>Solar Power</p>
              <p className={`text-3xl font-bold ${
                isDarkTheme ? 'text-yellow-400' : 'text-yellow-600'
              }`}>
                {sensorData?.solarPanel.power || '0'} W
              </p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-yellow-300' : 'text-yellow-600'
              }`}>Current generation</p>
            </div>
            <Sun className="h-10 w-10 text-yellow-500" />
          </div>
        </div>

        <div className={`card transition-colors duration-300 ${
          isDarkTheme 
            ? 'bg-gray-800 border-gray-700' 
            : 'bg-gradient-to-r from-green-50 to-green-100 border-green-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${
                isDarkTheme ? 'text-green-300' : 'text-green-800'
              }`}>Battery Status</p>
              <p className={`text-3xl font-bold ${
                isDarkTheme ? 'text-green-400' : 'text-green-600'
              }`}>
                {sensorData?.battery.soc || '0'}%
              </p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-green-300' : 'text-green-600'
              }`}>State of charge</p>
            </div>
            <Battery className="h-10 w-10 text-green-500" />
          </div>
        </div>

        <div className={`card transition-colors duration-300 ${
          isDarkTheme 
            ? 'bg-gray-800 border-gray-700' 
            : 'bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${
                isDarkTheme ? 'text-blue-300' : 'text-blue-800'
              }`}>My Current Load</p>
              <p className={`text-3xl font-bold ${
                isDarkTheme ? 'text-blue-400' : 'text-blue-600'
              }`}>{myLoad.toFixed(0)} W</p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-blue-300' : 'text-blue-600'
              }`}>Right now</p>
            </div>
            <Home className="h-10 w-10 text-blue-500" />
          </div>
        </div>

        <div className={`card transition-colors duration-300 ${
          isDarkTheme 
            ? 'bg-gray-800 border-gray-700' 
            : 'bg-gradient-to-r from-purple-50 to-purple-100 border-purple-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${
                isDarkTheme ? 'text-purple-300' : 'text-purple-800'
              }`}>Today's Total Load</p>
              <p className={`text-3xl font-bold ${
                isDarkTheme ? 'text-purple-400' : 'text-purple-600'
              }`}>{(todayTotal + myLoad).toFixed(0)} W</p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-purple-300' : 'text-purple-600'
              }`}>Total consumption</p>
            </div>
            <Home className="h-10 w-10 text-purple-500" />
          </div>
        </div>
      </div>

      {/* System Status - Read Only */}
      <div className={`card transition-colors duration-300 ${
        isDarkTheme ? 'bg-gray-800 border-gray-700' : 'bg-white'
      }`}>
        <h3 className={`text-lg font-semibold mb-4 ${
          isDarkTheme ? 'text-gray-200' : 'text-gray-700'
        }`}>System Status (Read-Only)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors duration-300 ${
            isDarkTheme 
              ? 'bg-gray-700 border-gray-600' 
              : 'bg-yellow-50 border-yellow-200'
          }`}>
            <Sun className="h-6 w-6 text-yellow-600" />
            <div>
              <p className={`font-medium ${
                isDarkTheme ? 'text-yellow-300' : 'text-yellow-900'
              }`}>Solar System</p>
              <p className={`text-sm ${
                isDarkTheme ? 'text-yellow-400' : 'text-yellow-700'
              }`}>
                {sensorData?.solarPanel.voltage || '0'}V | {sensorData?.solarPanel.current || '0'}A
              </p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-yellow-300' : 'text-yellow-600'
              }`}>Operating normally</p>
            </div>
          </div>
          
          <div className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors duration-300 ${
            isDarkTheme 
              ? 'bg-gray-700 border-gray-600' 
              : 'bg-green-50 border-green-200'
          }`}>
            <Battery className="h-6 w-6 text-green-600" />
            <div>
              <p className={`font-medium ${
                isDarkTheme ? 'text-green-300' : 'text-green-900'
              }`}>Battery Health</p>
              <p className={`text-sm ${
                isDarkTheme ? 'text-green-400' : 'text-green-700'
              }`}>
                {sensorData?.battery.voltage || '0'}V | {sensorData?.battery.temperature || '0'}°C
              </p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-green-300' : 'text-green-600'
              }`}>Good condition</p>
            </div>
          </div>
          
          <div className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors duration-300 ${
            isDarkTheme 
              ? 'bg-gray-700 border-gray-600' 
              : 'bg-blue-50 border-blue-200'
          }`}>
            <Home className="h-6 w-6 text-blue-600" />
            <div>
              <p className={`font-medium ${
                isDarkTheme ? 'text-blue-300' : 'text-blue-900'
              }`}>My Home ({user?.name})</p>
              <p className={`text-sm ${
                isDarkTheme ? 'text-blue-400' : 'text-blue-700'
              }`}>Load: {myLoad.toFixed(0)}W</p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-blue-300' : 'text-blue-600'
              }`}>Connected & monitored</p>
            </div>
          </div>
        </div>
      </div>

      {/* Weather Status */}
      <div className={`card transition-colors duration-300 ${
        isDarkTheme 
          ? 'bg-gray-800 border-gray-700' 
          : 'bg-gradient-to-r from-sky-50 to-sky-100 border-sky-200'
      }`}>
        <h3 className={`text-lg font-semibold mb-4 ${
          isDarkTheme ? 'text-sky-300' : 'text-sky-800'
        }`}>Weather Status</h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Cloud className="h-12 w-12 text-sky-500" />
            <div>
              <p className={`text-2xl font-bold ${
                isDarkTheme ? 'text-sky-300' : 'text-sky-700'
              }`}>Partly Cloudy</p>
              <p className={`text-sm ${
                isDarkTheme ? 'text-sky-400' : 'text-sky-600'
              }`}>Temperature: 28°C</p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-sky-300' : 'text-sky-500'
              }`}>Humidity: 65% | Wind: 12 km/h</p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-sm font-medium ${
              isDarkTheme ? 'text-sky-300' : 'text-sky-700'
            }`}>Solar Forecast</p>
            <p className={`text-lg font-bold ${
              isDarkTheme ? 'text-yellow-400' : 'text-yellow-600'
            }`}>Good</p>
            <p className={`text-xs ${
              isDarkTheme ? 'text-sky-400' : 'text-sky-600'
            }`}>Expected generation: 85%</p>
          </div>
        </div>
      </div>

      {/* Notice */}
      <div className={`card transition-colors duration-300 ${
        isDarkTheme 
          ? 'bg-gray-800 border-gray-700' 
          : 'bg-yellow-50 border-yellow-200'
      }`}>
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-full ${
            isDarkTheme ? 'bg-gray-700' : 'bg-yellow-100'
          }`}>
            <Home className={`h-5 w-5 ${
              isDarkTheme ? 'text-yellow-400' : 'text-yellow-600'
            }`} />
          </div>
          <div>
            <p className={`font-medium ${
              isDarkTheme ? 'text-yellow-300' : 'text-yellow-900'
            }`}>Basic User Access</p>
            <p className={`text-sm ${
              isDarkTheme ? 'text-yellow-400' : 'text-yellow-700'
            }`}>
              You have read-only access to basic real-time data. No control actions available.
              Data refreshes automatically every 5-10 seconds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserDashboard;