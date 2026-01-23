import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Sun, Thermometer, Zap, Activity, Settings, Power } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

const SolarPanel: React.FC = () => {
  const { sensorData } = useSocket();
  const { user } = useAuth();
  const [controlMode, setControlMode] = useState('auto');

  const mockPowerData = [
    { time: '06:00', power: 0, efficiency: 0 },
    { time: '08:00', power: 1200, efficiency: 75 },
    { time: '10:00', power: 2800, efficiency: 85 },
    { time: '12:00', power: 3500, efficiency: 92 },
    { time: '14:00', power: 3200, efficiency: 88 },
    { time: '16:00', power: 2100, efficiency: 80 },
    { time: '18:00', power: 800, efficiency: 65 },
    { time: '20:00', power: 0, efficiency: 0 },
  ];

  const currentPower = parseFloat(sensorData?.solarPanel.power || '0');
  const maxPower = 4000; // 4kW system
  const efficiency = Math.min((currentPower / maxPower) * 100, 100);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Solar Panel System</h1>
        <div className="flex items-center space-x-2">
          <Sun className="h-5 w-5 text-yellow-500" />
          <span className="text-sm text-gray-600">
            Status: {currentPower > 100 ? 'Generating' : 'Standby'}
          </span>
        </div>
      </div>

      {/* Real-time Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Current Power</p>
              <p className="text-2xl font-bold text-yellow-600">
                {sensorData?.solarPanel.power || '0'} W
              </p>
              <p className="text-xs text-gray-500">Peak: 4000W</p>
            </div>
            <Zap className="h-8 w-8 text-yellow-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Voltage</p>
              <p className="text-2xl font-bold text-blue-600">
                {sensorData?.solarPanel.voltage || '0'} V
              </p>
              <p className="text-xs text-gray-500">Nominal: 240V</p>
            </div>
            <Activity className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Current</p>
              <p className="text-2xl font-bold text-green-600">
                {sensorData?.solarPanel.current || '0'} A
              </p>
              <p className="text-xs text-gray-500">Max: 20A</p>
            </div>
            <Activity className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Efficiency</p>
              <p className="text-2xl font-bold text-purple-600">
                {efficiency.toFixed(1)}%
              </p>
              <p className="text-xs text-gray-500">Today's avg: 78%</p>
            </div>
            <Thermometer className="h-8 w-8 text-purple-500" />
          </div>
        </div>
      </div>

      {/* Power Generation Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Daily Power Generation</h3>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={mockPowerData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Area 
              type="monotone" 
              dataKey="power" 
              stroke="#f59e0b" 
              fill="#fef3c7" 
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Panel Status */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Panel Status</h3>
        <div className="space-y-4">
          <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
            <span className="font-medium">Panel Array 1</span>
            <span className="text-green-600 font-semibold">Active</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
            <span className="font-medium">Panel Array 2</span>
            <span className="text-green-600 font-semibold">Active</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SolarPanel;