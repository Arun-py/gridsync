import React from 'react';
import { useSocket } from '../context/SocketContext';
import { Battery, Activity, Power, Zap } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

const DCLoad: React.FC = () => {
  const { sensorData } = useSocket();

  const mockPowerData = [
    { time: '00:00', power: 4.8, current: 0.40 },
    { time: '04:00', power: 4.9, current: 0.41 },
    { time: '08:00', power: 5.1, current: 0.42 },
    { time: '12:00', power: 5.0, current: 0.41 },
    { time: '16:00', power: 4.7, current: 0.39 },
    { time: '20:00', power: 5.2, current: 0.43 },
    { time: '24:00', power: 4.9, current: 0.40 },
  ];

  const dcVoltage = parseFloat(sensorData?.dcLoad?.voltage || '12');
  const dcCurrent = parseFloat(sensorData?.dcLoad?.current || '0.41');
  const dcPower = parseFloat(sensorData?.dcLoad?.power || '5');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">DC Load Monitor</h1>
        <div className="flex items-center space-x-2">
          <Battery className="h-5 w-5 text-green-500" />
          <span className="text-sm text-gray-600">
            Status: {dcPower > 0 ? 'Active' : 'Standby'}
          </span>
        </div>
      </div>

      {/* Real-time Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">DC Voltage</p>
              <p className="text-3xl font-bold text-green-600">
                {dcVoltage.toFixed(2)} V
              </p>
              <p className="text-xs text-gray-500">Nominal: 12V</p>
            </div>
            <Activity className="h-10 w-10 text-green-500" />
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-green-600 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${(dcVoltage / 15) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">DC Current</p>
              <p className="text-3xl font-bold text-blue-600">
                {dcCurrent.toFixed(2)} A
              </p>
              <p className="text-xs text-gray-500">Rated: 0.41A</p>
            </div>
            <Zap className="h-10 w-10 text-blue-500" />
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${(dcCurrent / 0.5) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">DC Power</p>
              <p className="text-3xl font-bold text-purple-600">
                {dcPower.toFixed(1)} W
              </p>
              <p className="text-xs text-gray-500">Rated: 5W</p>
            </div>
            <Power className="h-10 w-10 text-purple-500" />
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${(dcPower / 6) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Power & Current Trend Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">24-Hour Power & Current Trend</h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={mockPowerData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Line 
              yAxisId="left"
              type="monotone" 
              dataKey="power" 
              stroke="#a855f7" 
              strokeWidth={3}
              name="Power (W)"
              dot={{ fill: '#a855f7', r: 4 }}
            />
            <Line 
              yAxisId="right"
              type="monotone" 
              dataKey="current" 
              stroke="#3b82f6" 
              strokeWidth={3}
              name="Current (A)"
              dot={{ fill: '#3b82f6', r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Load Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Load Specifications</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
              <span className="font-medium">Voltage Type</span>
              <span className="text-green-600 font-semibold">DC 12V</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
              <span className="font-medium">Rated Power</span>
              <span className="text-blue-600 font-semibold">5W</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
              <span className="font-medium">Rated Current</span>
              <span className="text-purple-600 font-semibold">0.41A</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
              <span className="font-medium">Efficiency</span>
              <span className="text-yellow-600 font-semibold">95%</span>
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
                <div className="bg-green-500 h-3 rounded-full" style={{ width: '98%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Current Regulation</span>
                <span className="text-sm text-blue-600">Optimal</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div className="bg-blue-500 h-3 rounded-full" style={{ width: '96%' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Load Health</span>
                <span className="text-sm text-purple-600">Perfect</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div className="bg-purple-500 h-3 rounded-full" style={{ width: '99%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connected Devices */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Connected DC Devices</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center p-4 bg-gradient-to-r from-green-50 to-green-100 rounded-lg">
            <div className="flex items-center space-x-3">
              <Battery className="h-8 w-8 text-green-600" />
              <div>
                <p className="font-semibold text-gray-900">LED Lighting System</p>
                <p className="text-sm text-gray-600">3W - Active</p>
              </div>
            </div>
            <span className="text-green-600 font-semibold">Running</span>
          </div>
          <div className="flex justify-between items-center p-4 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg">
            <div className="flex items-center space-x-3">
              <Zap className="h-8 w-8 text-blue-600" />
              <div>
                <p className="font-semibold text-gray-900">DC Fan</p>
                <p className="text-sm text-gray-600">2W - Active</p>
              </div>
            </div>
            <span className="text-blue-600 font-semibold">Running</span>
          </div>
        </div>
      </div>

      {/* Energy Consumption Stats */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Energy Consumption Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">Today</p>
            <p className="text-2xl font-bold text-green-600">120 Wh</p>
          </div>
          <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">This Week</p>
            <p className="text-2xl font-bold text-blue-600">840 Wh</p>
          </div>
          <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">This Month</p>
            <p className="text-2xl font-bold text-purple-600">3.6 kWh</p>
          </div>
          <div className="text-center p-4 bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">Efficiency</p>
            <p className="text-2xl font-bold text-yellow-600">95%</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DCLoad;
