import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useTheme } from '../context/ThemeContext';
import { Sun, Battery, Zap, Home, TrendingUp, AlertTriangle, Users, Settings, Cloud, CloudRain, CloudSnow } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import axios from 'axios';

const AdminDashboard: React.FC = () => {
  const { sensorData } = useSocket();
  const { isDarkTheme } = useTheme();
  const [registeredUsers, setRegisteredUsers] = useState<any[]>([]);


  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await axios.get('https://gridsync-qpsn.onrender.com/api/users');
      setRegisteredUsers(response.data);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const mockHistoryData = [
    { time: '00:00', solar: 0, battery: 45, totalLoad: 65 },
    { time: '06:00', solar: 15, battery: 40, totalLoad: 80 },
    { time: '12:00', solar: 85, battery: 80, totalLoad: 145 },
    { time: '18:00', solar: 30, battery: 70, totalLoad: 190 },
    { time: '24:00', solar: 0, battery: 65, totalLoad: 95 },
  ];

  const homeUsageData = [
    { home: 'L1', usage: parseFloat(sensorData?.loads.L1 || '0'), status: 'Normal' },
    { home: 'L2', usage: parseFloat(sensorData?.loads.L2 || '0'), status: 'High' },
    { home: 'L3', usage: parseFloat(sensorData?.loads.L3 || '0'), status: 'Normal' },
  ];

  const totalPower = sensorData ? 
    parseFloat(sensorData.loads.L1) + parseFloat(sensorData.loads.L2) + parseFloat(sensorData.loads.L3) : 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header with gradient background */}
      <div className={`relative overflow-hidden rounded-xl p-6 ${
        isDarkTheme 
          ? 'bg-slate-800 border border-slate-600' 
          : 'bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 border border-blue-200/50'
      }`}>
        <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
        <div className="relative flex justify-between items-center">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <div className={`p-2 rounded-lg ${
                isDarkTheme ? 'bg-slate-700' : 'bg-blue-100'
              }`}>
                <Settings className={`h-6 w-6 ${
                  isDarkTheme ? 'text-blue-400' : 'text-blue-600'
                }`} />
              </div>
              <h1 className={`text-3xl font-bold bg-gradient-to-r ${
                isDarkTheme 
                  ? 'from-blue-400 to-purple-400 bg-clip-text text-transparent' 
                  : 'from-blue-600 to-purple-600 bg-clip-text text-transparent'
              }`}>Admin Control Center</h1>
            </div>
            <p className={`${
              isDarkTheme ? 'text-slate-300' : 'text-gray-600'
            }`}>Complete Microgrid Management & Monitoring</p>
          </div>
          <div className={`px-3 py-2 rounded-lg ${
            isDarkTheme ? 'bg-slate-700 border border-slate-500' : 'bg-white/70 border border-gray-200'
          }`}>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className={`text-sm ${
                isDarkTheme ? 'text-slate-300' : 'text-gray-600'
              }`}>
                Last updated: {sensorData ? new Date(sensorData.timestamp).toLocaleTimeString() : 'No data'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* System Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <div className={`card transition-all duration-300 hover:scale-105 hover:shadow-xl ${
          isDarkTheme ? 'bg-slate-800 border-slate-600' : 'bg-gradient-to-br from-white to-gray-50'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${
                isDarkTheme ? 'text-slate-300' : 'text-gray-600'
              }`}>Solar Generation</p>
              <p className={`text-2xl font-bold ${
                isDarkTheme ? 'text-yellow-400' : 'text-yellow-600'
              }`}>
                {sensorData?.solarPanel.power || '0'} W
              </p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-slate-400' : 'text-gray-500'
              }`}>Peak: 4000W</p>
            </div>
            <div className={`p-3 rounded-full ${
              isDarkTheme ? 'bg-slate-700' : 'bg-yellow-100'
            }`}>
              <Sun className="h-8 w-8 text-yellow-500" />
            </div>
          </div>
        </div>

        <div className={`card transition-all duration-300 hover:scale-105 hover:shadow-xl ${
          isDarkTheme ? 'bg-slate-800 border-slate-600' : 'bg-gradient-to-br from-white to-gray-50'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${
                isDarkTheme ? 'text-slate-300' : 'text-gray-600'
              }`}>Battery SOC</p>
              <p className={`text-2xl font-bold ${
                isDarkTheme ? 'text-green-400' : 'text-green-600'
              }`}>
                {sensorData?.battery.soc || '0'}%
              </p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-slate-400' : 'text-gray-500'
              }`}>10 kWh capacity</p>
            </div>
            <div className={`p-3 rounded-full ${
              isDarkTheme ? 'bg-slate-700' : 'bg-green-100'
            }`}>
              <Battery className="h-8 w-8 text-green-500" />
            </div>
          </div>
        </div>

        <div className={`card transition-all duration-300 hover:scale-105 hover:shadow-xl ${
          isDarkTheme ? 'bg-slate-800 border-slate-600' : 'bg-gradient-to-br from-white to-gray-50'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${
                isDarkTheme ? 'text-slate-300' : 'text-gray-600'
              }`}>Total Load</p>
              <p className={`text-2xl font-bold ${
                isDarkTheme ? 'text-blue-400' : 'text-blue-600'
              }`}>
                {totalPower.toFixed(0)} W
              </p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-slate-400' : 'text-gray-500'
              }`}>3 homes connected</p>
            </div>
            <div className={`p-3 rounded-full ${
              isDarkTheme ? 'bg-slate-700' : 'bg-blue-100'
            }`}>
              <Zap className="h-8 w-8 text-blue-500" />
            </div>
          </div>
        </div>

        <div className={`card transition-all duration-300 hover:scale-105 hover:shadow-xl ${
          isDarkTheme ? 'bg-slate-800 border-slate-600' : 'bg-gradient-to-br from-white to-gray-50'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${
                isDarkTheme ? 'text-slate-300' : 'text-gray-600'
              }`}>Active Users</p>
              <p className={`text-2xl font-bold ${
                isDarkTheme ? 'text-purple-400' : 'text-purple-600'
              }`}>{registeredUsers.length}</p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-slate-400' : 'text-gray-500'
              }`}>Registered users</p>
            </div>
            <div className={`p-3 rounded-full ${
              isDarkTheme ? 'bg-slate-700' : 'bg-purple-100'
            }`}>
              <Users className="h-8 w-8 text-purple-500" />
            </div>
          </div>
        </div>

        <div className={`card transition-all duration-300 hover:scale-105 hover:shadow-xl ${
          isDarkTheme ? 'bg-slate-800 border-slate-600' : 'bg-gradient-to-br from-white to-gray-50'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${
                isDarkTheme ? 'text-slate-300' : 'text-gray-600'
              }`}>System Health</p>
              <p className={`text-2xl font-bold ${
                isDarkTheme ? 'text-green-400' : 'text-green-600'
              }`}>98%</p>
              <p className={`text-xs ${
                isDarkTheme ? 'text-green-400' : 'text-green-500'
              }`}>Excellent</p>
            </div>
            <div className={`p-3 rounded-full ${
              isDarkTheme ? 'bg-slate-700' : 'bg-green-100'
            }`}>
              <TrendingUp className="h-8 w-8 text-green-500" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">

        {/* Smart Microgrid Control Center */}
        <div className={`card transition-all duration-300 hover:shadow-2xl ${
          isDarkTheme ? 'bg-slate-800 border-slate-600' : 'bg-gradient-to-br from-white to-gray-50'
        }`}>
          <h3 className={`text-lg font-semibold mb-4 ${
            isDarkTheme ? 'text-white' : 'text-gray-900'
          }`}>Smart Microgrid Control Center</h3>
          
          <div className="space-y-4">
            {/* User Statistics */}
            <div className={`p-4 rounded-lg ${
              isDarkTheme ? 'bg-slate-700 border border-slate-500' : 'bg-blue-50 border border-blue-200'
            }`}>
              <h4 className={`font-medium mb-2 ${
                isDarkTheme ? 'text-blue-300' : 'text-blue-900'
              }`}>User Statistics</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <p className={`text-2xl font-bold ${
                    isDarkTheme ? 'text-blue-400' : 'text-blue-600'
                  }`}>{registeredUsers.length}</p>
                  <p className={`text-xs ${
                    isDarkTheme ? 'text-blue-300' : 'text-blue-700'
                  }`}>Total Users</p>
                </div>
                <div className="text-center">
                  <p className={`text-2xl font-bold ${
                    isDarkTheme ? 'text-blue-400' : 'text-blue-600'
                  }`}>{registeredUsers.filter(u => new Date(u.createdAt).toDateString() === new Date().toDateString()).length}</p>
                  <p className={`text-xs ${
                    isDarkTheme ? 'text-blue-300' : 'text-blue-700'
                  }`}>New Today</p>
                </div>
              </div>
            </div>

            {/* Today's Weather */}
            <div className={`p-4 rounded-lg ${
              isDarkTheme ? 'bg-slate-700 border border-slate-500' : 'bg-orange-50 border border-orange-200'
            }`}>
              <h4 className={`font-medium mb-2 ${
                isDarkTheme ? 'text-orange-300' : 'text-orange-900'
              }`}>Today's Weather</h4>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Sun className={`h-6 w-6 ${
                    isDarkTheme ? 'text-orange-400' : 'text-orange-600'
                  }`} />
                  <div>
                    <p className={`text-lg font-bold ${
                      isDarkTheme ? 'text-orange-400' : 'text-orange-600'
                    }`}>28°C</p>
                    <p className={`text-xs ${
                      isDarkTheme ? 'text-orange-300' : 'text-orange-700'
                    }`}>Sunny</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${
                    isDarkTheme ? 'text-orange-400' : 'text-orange-600'
                  }`}>Optimal</p>
                  <p className={`text-xs ${
                    isDarkTheme ? 'text-orange-300' : 'text-orange-700'
                  }`}>Solar Conditions</p>
                </div>
              </div>
            </div>

            {/* Energy Flow */}
            <div className={`p-4 rounded-lg ${
              isDarkTheme ? 'bg-slate-700 border border-slate-500' : 'bg-purple-50 border border-purple-200'
            }`}>
              <h4 className={`font-medium mb-3 ${
                isDarkTheme ? 'text-purple-300' : 'text-purple-900'
              }`}>Energy Flow Management</h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={`text-sm ${
                    isDarkTheme ? 'text-purple-200' : 'text-purple-800'
                  }`}>Solar → Homes</span>
                  <span className={`text-sm font-semibold ${
                    isDarkTheme ? 'text-purple-400' : 'text-purple-600'
                  }`}>{sensorData?.solarPanel.power || '0'}W</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={`text-sm ${
                    isDarkTheme ? 'text-purple-200' : 'text-purple-800'
                  }`}>Battery → Homes</span>
                  <span className={`text-sm font-semibold ${
                    isDarkTheme ? 'text-purple-400' : 'text-purple-600'
                  }`}>{Math.abs(parseFloat(sensorData?.battery.current || '0') * 48).toFixed(0)}W</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={`text-sm ${
                    isDarkTheme ? 'text-purple-200' : 'text-purple-800'
                  }`}>Total Consumption</span>
                  <span className={`text-sm font-semibold ${
                    isDarkTheme ? 'text-purple-400' : 'text-purple-600'
                  }`}>{totalPower.toFixed(0)}W</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>




    </div>
  );
};

export default AdminDashboard;