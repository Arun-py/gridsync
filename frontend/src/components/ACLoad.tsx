import React from 'react';
import { useSocket } from '../context/SocketContext';
import { Zap, Activity, Power, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const ACLoad: React.FC = () => {
  const { sensorData } = useSocket();

  const mockVoltageData = [
    { time: '00:00', voltage: 220.2 },
    { time: '04:00', voltage: 219.8 },
    { time: '08:00', voltage: 220.5 },
    { time: '12:00', voltage: 219.5 },
    { time: '16:00', voltage: 220.1 },
    { time: '20:00', voltage: 219.9 },
    { time: '24:00', voltage: 220.3 },
  ];

  const acVoltage = parseFloat(sensorData?.acLoad?.voltage || '220');
  const acCurrent = parseFloat(sensorData?.acLoad?.current || '0.06');
  const acPower = parseFloat(sensorData?.acLoad?.power || '15');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">AC Load Monitor</h1>
        <div className="flex items-center space-x-2">
          <Zap className="h-5 w-5 text-blue-500" />
          <span className="text-sm text-gray-600">
            Status: {acPower > 0 ? 'Active' : 'Standby'}
          </span>
        </div>
      </div>

      {/* Real-time Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">AC Voltage</p>
              <p className="text-3xl font-bold text-blue-600">
                {acVoltage.toFixed(2)} V
              </p>
              <p className="text-xs text-gray-500">Range: 219-220.5V</p>
            </div>
            <Activity className="h-10 w-10 text-blue-500" />
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${((acVoltage - 219) / 1.5) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">AC Current</p>
              <p className="text-3xl font-bold text-green-600">
                {acCurrent.toFixed(3)} A
              </p>
              <p className="text-xs text-gray-500">Nominal: 0.06A</p>
            </div>
            <Zap className="h-10 w-10 text-green-500" />
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-green-600 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${(acCurrent / 0.1) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">AC Power</p>
              <p className="text-3xl font-bold text-purple-600">
                {acPower.toFixed(1)} W
              </p>
              <p className="text-xs text-gray-500">Rated: 15W</p>
            </div>
            <Power className="h-10 w-10 text-purple-500" />
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${(acPower / 20) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Voltage Trend Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">24-Hour Voltage Trend</h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={mockVoltageData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis domain={[219, 221]} />
            <Tooltip />
            <Line 
              type="monotone" 
              dataKey="voltage" 
              stroke="#3b82f6" 
              strokeWidth={3}
              dot={{ fill: '#3b82f6', r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Load Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Load Characteristics</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
              <span className="font-medium">Voltage Type</span>
              <span className="text-blue-600 font-semibold">AC 220V</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
              <span className="font-medium">Frequency</span>
              <span className="text-green-600 font-semibold">50 Hz</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
              <span className="font-medium">Power Factor</span>
              <span className="text-purple-600 font-semibold">0.95</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
              <span className="font-medium">Efficiency</span>
              <span className="text-yellow-600 font-semibold">92%</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Performance Metrics</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Voltage Stability</span>
                <span className="text-sm text-green-600">Excellent</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div className="bg-green-500 h-3 rounded-full" style={{ width: '95%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Load Balance</span>
                <span className="text-sm text-blue-600">Good</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div className="bg-blue-500 h-3 rounded-full" style={{ width: '88%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">System Health</span>
                <span className="text-sm text-purple-600">Optimal</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div className="bg-purple-500 h-3 rounded-full" style={{ width: '97%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Energy Consumption Stats */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Energy Consumption Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">Today</p>
            <p className="text-2xl font-bold text-blue-600">360 Wh</p>
          </div>
          <div className="text-center p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">This Week</p>
            <p className="text-2xl font-bold text-green-600">2.5 kWh</p>
          </div>
          <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">This Month</p>
            <p className="text-2xl font-bold text-purple-600">10.8 kWh</p>
          </div>
          <div className="text-center p-4 bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">Cost Saved</p>
            <p className="text-2xl font-bold text-yellow-600">₹85</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ACLoad;
