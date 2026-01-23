import React from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Sun, Battery, Zap, Home, TrendingUp, AlertCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const Dashboard: React.FC = () => {
  const { sensorData } = useSocket();
  const { user } = useAuth();

  const mockHistoryData = [
    { time: '00:00', solar: 0, battery: 45, load: 20 },
    { time: '06:00', solar: 15, battery: 40, load: 25 },
    { time: '12:00', solar: 85, battery: 80, load: 60 },
    { time: '18:00', solar: 30, battery: 70, load: 45 },
    { time: '24:00', solar: 0, battery: 65, load: 30 },
  ];

  const energyDistribution = [
    { name: 'Solar Direct', value: 45, color: '#f59e0b' },
    { name: 'Battery', value: 35, color: '#10b981' },
    { name: 'Grid Backup', value: 20, color: '#6366f1' },
  ];

  const totalPower = sensorData ? 
    parseFloat(sensorData.loads.L1) + parseFloat(sensorData.loads.L2) + parseFloat(sensorData.loads.L3) : 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">
          {user?.role === 'admin' ? 'Microgrid Overview' : 'My Energy Dashboard'}
        </h1>
        <div className="text-sm text-gray-600">
          Last updated: {sensorData ? new Date(sensorData.timestamp).toLocaleTimeString() : 'No data'}
        </div>
      </div>

      {/* Real-time Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Solar Generation</p>
              <p className="text-2xl font-bold text-yellow-600">
                {sensorData?.solarPanel.power || '0'} W
              </p>
              <p className="text-xs text-gray-500">
                {sensorData?.solarPanel.voltage || '0'}V • {sensorData?.solarPanel.current || '0'}A
              </p>
            </div>
            <Sun className="h-8 w-8 text-yellow-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Battery Status</p>
              <p className="text-2xl font-bold text-green-600">
                {sensorData?.battery.soc || '0'}%
              </p>
              <p className="text-xs text-gray-500">
                {sensorData?.battery.voltage || '0'}V • {sensorData?.battery.temperature || '0'}°C
              </p>
            </div>
            <Battery className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Load</p>
              <p className="text-2xl font-bold text-blue-600">
                {totalPower.toFixed(0)} W
              </p>
              <p className="text-xs text-gray-500">
                L1: {sensorData?.loads.L1 || '0'}W
              </p>
            </div>
            <Zap className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Efficiency</p>
              <p className="text-2xl font-bold text-purple-600">92%</p>
              <p className="text-xs text-green-500">+15% vs baseline</p>
            </div>
            <TrendingUp className="h-8 w-8 text-purple-500" />
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">24-Hour Energy Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={mockHistoryData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="solar" stroke="#f59e0b" strokeWidth={2} />
              <Line type="monotone" dataKey="battery" stroke="#10b981" strokeWidth={2} />
              <Line type="monotone" dataKey="load" stroke="#3b82f6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Energy Source Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={energyDistribution}
                cx="50%"
                cy="50%"
                outerRadius={80}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}%`}
              >
                {energyDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Load Distribution (Admin View) */}
      {user?.role === 'admin' && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Load Distribution by Home</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Home L1</span>
                <Home className="h-4 w-4 text-gray-600" />
              </div>
              <p className="text-xl font-bold text-blue-600">{sensorData?.loads.L1 || '0'}W</p>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full" 
                  style={{ width: `${Math.min((parseFloat(sensorData?.loads.L1 || '0') / 1000) * 100, 100)}%` }}
                ></div>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Home L2</span>
                <Home className="h-4 w-4 text-gray-600" />
              </div>
              <p className="text-xl font-bold text-green-600">{sensorData?.loads.L2 || '0'}W</p>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div 
                  className="bg-green-600 h-2 rounded-full" 
                  style={{ width: `${Math.min((parseFloat(sensorData?.loads.L2 || '0') / 1000) * 100, 100)}%` }}
                ></div>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Home L3</span>
                <Home className="h-4 w-4 text-gray-600" />
              </div>
              <p className="text-xl font-bold text-purple-600">{sensorData?.loads.L3 || '0'}W</p>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div 
                  className="bg-purple-600 h-2 rounded-full" 
                  style={{ width: `${Math.min((parseFloat(sensorData?.loads.L3 || '0') / 1000) * 100, 100)}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Alerts */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">System Status</h3>
        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-green-600">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">All systems operational</span>
          </div>
          <div className="flex items-center space-x-2 text-blue-600">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Battery charging efficiently</span>
          </div>
          <div className="flex items-center space-x-2 text-yellow-600">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">Peak solar generation expected at 2 PM</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;