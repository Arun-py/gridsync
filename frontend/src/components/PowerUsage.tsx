import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Zap, Home, Lightbulb, Tv, Refrigerator, Fan, Power } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const PowerUsage: React.FC = () => {
  const { sensorData } = useSocket();
  const { user } = useAuth();
  const [selectedHome, setSelectedHome] = useState('L1');

  const mockUsageData = [
    { hour: '00', L1: 200, L2: 150, L3: 180 },
    { hour: '06', L1: 400, L2: 300, L3: 350 },
    { hour: '12', L1: 600, L2: 450, L3: 500 },
    { hour: '18', L1: 800, L2: 600, L3: 700 },
    { hour: '24', L1: 300, L2: 200, L3: 250 },
  ];

  const applianceData = [
    { name: 'Lighting', power: 120, color: '#f59e0b', icon: Lightbulb },
    { name: 'Refrigerator', power: 180, color: '#3b82f6', icon: Refrigerator },
    { name: 'TV/Electronics', power: 95, color: '#8b5cf6', icon: Tv },
    { name: 'Fans', power: 75, color: '#10b981', icon: Fan },
    { name: 'Others', power: 130, color: '#6b7280', icon: Power },
  ];

  const totalUsage = sensorData ? 
    parseFloat(sensorData.loads.L1) + parseFloat(sensorData.loads.L2) + parseFloat(sensorData.loads.L3) : 0;

  // Mock registered users data
  const registeredUsers = [
    { homeId: 'Home 1', name: 'John Smith', usage: sensorData?.loads.L1 || '0', status: 'Normal' },
    { homeId: 'Home 2', name: 'Sarah Johnson', usage: sensorData?.loads.L2 || '0', status: 'High Usage' },
    { homeId: 'Home 3', name: 'Mike Wilson', usage: sensorData?.loads.L3 || '0', status: 'Normal' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Power Usage Monitor</h1>
        <div className="flex items-center space-x-2">
          <Zap className="h-5 w-5 text-blue-500" />
          <span className="text-sm text-gray-600">
            Total Load: {totalUsage.toFixed(0)}W
          </span>
        </div>
      </div>

      {/* Registered Users Power Usage */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">Registered Users Power Usage</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {registeredUsers.map((home, index) => (
            <div key={index} className="card border-l-4 border-blue-500">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Home className="h-5 w-5 text-blue-600" />
                  <div>
                    <span className="font-medium">{home.homeId}</span>
                    <p className="text-sm text-gray-600">{home.name}</p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  home.status === 'High Usage' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                }`}>
                  {home.status}
                </span>
              </div>
              
              <p className="text-2xl font-bold text-blue-600 mb-2">{home.usage}W</p>
              
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${Math.min((parseFloat(home.usage) / 1000) * 100, 100)}%` }}
                ></div>
              </div>
              
              <p className="text-xs text-gray-500 mt-2">
                Daily avg: {(parseFloat(home.usage) * 0.8).toFixed(0)}W
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Usage Trends */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">24-Hour Usage Trends - Registered Users</h3>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={mockUsageData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="L1" fill="#3b82f6" name="Home 1 (John)" />
            <Bar dataKey="L2" fill="#10b981" name="Home 2 (Sarah)" />
            <Bar dataKey="L3" fill="#8b5cf6" name="Home 3 (Mike)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      </div>

      {/* Energy Efficiency Recommendations for Registered Users */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Energy Efficiency Recommendations - Registered Users</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">John Smith (Home 1)</h4>
            <p className="text-sm text-blue-800">
              Reduce evening usage by 20W. Consider using LED bulbs to save energy.
            </p>
          </div>
          <div className="p-4 bg-red-50 rounded-lg">
            <h4 className="font-medium text-red-900 mb-2">Sarah Johnson (Home 2)</h4>
            <p className="text-sm text-red-800">
              High usage detected! Schedule heavy appliances during solar peak hours (11 AM - 3 PM).
            </p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <h4 className="font-medium text-green-900 mb-2">Mike Wilson (Home 3)</h4>
            <p className="text-sm text-green-800">
              Excellent energy management! Continue current usage patterns.
            </p>
          </div>
        </div>
      </div>

      {/* Usage Statistics */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Usage Statistics</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">18.2 kWh</p>
            <p className="text-sm text-gray-600">Today's Consumption</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">542 kWh</p>
            <p className="text-sm text-gray-600">This Month</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-600">₹2,180</p>
            <p className="text-sm text-gray-600">Monthly Bill</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-yellow-600">12%</p>
            <p className="text-sm text-gray-600">Efficiency Gain</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PowerUsage;