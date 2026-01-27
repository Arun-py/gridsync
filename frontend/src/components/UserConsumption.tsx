import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useTheme } from '../context/ThemeContext';
import { useNavigate } from 'react-router-dom';
import { Home, MessageSquare, MoreVertical } from 'lucide-react';
import axios from 'axios';

const UserConsumption: React.FC = () => {
  const { sensorData } = useSocket();
  const { isDarkTheme } = useTheme();
  const navigate = useNavigate();
  const [registeredUsers, setRegisteredUsers] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState<string | null>(null);

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

  const handleMessageClick = (homeId: string) => {
    navigate('/messages', { state: { selectedHome: homeId } });
  };

  const homeMap: { [key: string]: 'L1' | 'L2' | 'L3' } = { 
    'Home1': 'L1', 
    'Home2': 'L2', 
    'Home3': 'L3', 
    'Home4': 'L1', 
    'Home5': 'L2' 
  };

  const totalLoad = registeredUsers.reduce((sum, user) => {
    const loadKey = homeMap[user.homeId] || 'L1';
    const usage = parseFloat(sensorData?.loads[loadKey as keyof typeof sensorData.loads] || '0');
    return sum + usage;
  }, 0);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className={`relative overflow-hidden rounded-xl p-6 ${
        isDarkTheme 
          ? 'bg-slate-800 border border-slate-600' 
          : 'bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 border border-blue-200/50'
      }`}>
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${
            isDarkTheme ? 'bg-slate-700' : 'bg-blue-100'
          }`}>
            <Home className={`h-6 w-6 ${
              isDarkTheme ? 'text-blue-400' : 'text-blue-600'
            }`} />
          </div>
          <div>
            <h1 className={`text-3xl font-bold ${
              isDarkTheme ? 'text-white' : 'text-gray-900'
            }`}>User Consumption Monitor</h1>
            <p className={`${
              isDarkTheme ? 'text-slate-300' : 'text-gray-600'
            }`}>Live usage monitoring for all homes</p>
          </div>
        </div>
      </div>

      {/* Total Load Summary */}
      <div className={`card ${
        isDarkTheme ? 'bg-slate-800 border-slate-600' : 'bg-white'
      }`}>
        <div className="flex items-center justify-between">
          <h3 className={`text-lg font-semibold ${
            isDarkTheme ? 'text-white' : 'text-gray-900'
          }`}>Total System Load</h3>
          <div className="text-right">
            <p className={`text-3xl font-bold ${
              isDarkTheme ? 'text-blue-400' : 'text-blue-600'
            }`}>{totalLoad.toFixed(0)}W</p>
            <p className={`text-sm ${
              isDarkTheme ? 'text-slate-400' : 'text-gray-500'
            }`}>All Users Combined</p>
          </div>
        </div>
      </div>

      {/* Users List */}
      <div className={`card ${
        isDarkTheme ? 'bg-slate-800 border-slate-600' : 'bg-white'
      }`}>
        <h3 className={`text-lg font-semibold mb-6 ${
          isDarkTheme ? 'text-white' : 'text-gray-900'
        }`}>Individual User Consumption</h3>
        
        <div className="space-y-4">
          {registeredUsers.map((user: any, index) => {
            const loadKey = homeMap[user.homeId] || 'L1';
            const usage = parseFloat(sensorData?.loads[loadKey as keyof typeof sensorData.loads] || '0');
            
            return (
              <div key={index} className={`flex items-center justify-between p-4 rounded-lg border ${
                isDarkTheme ? 'bg-slate-700 border-slate-600' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-center space-x-4">
                  <div className={`p-2 rounded-full ${
                    isDarkTheme ? 'bg-slate-600' : 'bg-blue-100'
                  }`}>
                    <Home className={`h-5 w-5 ${
                      isDarkTheme ? 'text-blue-400' : 'text-blue-600'
                    }`} />
                  </div>
                  <div>
                    <p className={`font-medium ${
                      isDarkTheme ? 'text-white' : 'text-gray-900'
                    }`}>{user.homeId}</p>
                    <p className={`text-sm ${
                      isDarkTheme ? 'text-slate-300' : 'text-gray-600'
                    }`}>{user.name}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-6">
                  <div className="text-right">
                    <p className={`text-2xl font-bold ${
                      isDarkTheme ? 'text-blue-400' : 'text-blue-600'
                    }`}>{usage.toFixed(0)}W</p>
                    <p className={`text-xs ${
                      isDarkTheme ? 'text-slate-400' : 'text-gray-500'
                    }`}>Live Usage</p>
                  </div>
                  
                  <div className="relative">
                    <button
                      onClick={() => setShowDropdown(showDropdown === user.homeId ? null : user.homeId)}
                      className={`p-2 rounded-lg transition-colors ${
                        isDarkTheme 
                          ? 'bg-slate-600 hover:bg-slate-500 text-white' 
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      }`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    
                    {showDropdown === user.homeId && (
                      <div className={`absolute right-0 mt-2 w-32 rounded-lg shadow-lg border z-10 ${
                        isDarkTheme ? 'bg-slate-700 border-slate-600' : 'bg-white border-gray-200'
                      }`}>
                        <button
                          onClick={() => {
                            handleMessageClick(user.homeId);
                            setShowDropdown(null);
                          }}
                          className={`w-full flex items-center space-x-2 px-3 py-2 text-left hover:bg-opacity-80 ${
                            isDarkTheme ? 'text-white hover:bg-slate-600' : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <MessageSquare className="h-4 w-4" />
                          <span className="text-sm">Message</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default UserConsumption;