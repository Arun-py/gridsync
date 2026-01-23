import React, { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { Battery as BatteryIcon, Thermometer, Zap, Activity, Settings, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadialBarChart, RadialBar } from 'recharts';

const Battery: React.FC = () => {
  const { sensorData } = useSocket();
  const { user } = useAuth();
  const [chargingMode, setChargingMode] = useState('auto');

  const mockBatteryHistory = [
    { time: '00:00', soc: 65, voltage: 48.2, current: -5 },
    { time: '06:00', soc: 60, voltage: 47.8, current: -8 },
    { time: '12:00', soc: 85, voltage: 50.4, current: 15 },
    { time: '18:00', soc: 75, voltage: 49.2, current: -12 },
    { time: '24:00', soc: 70, voltage: 48.8, current: -6 },
  ];

  const batterySOC = parseFloat(sensorData?.battery.soc || '0');
  const batteryTemp = parseFloat(sensorData?.battery.temperature || '25');
  const batteryVoltage = parseFloat(sensorData?.battery.voltage || '48');
  const batteryCurrent = parseFloat(sensorData?.battery.current || '0');

  const getBatteryStatus = () => {
    if (batteryCurrent > 0) return { status: 'Charging', color: 'text-green-600' };
    if (batteryCurrent < 0) return { status: 'Discharging', color: 'text-blue-600' };
    return { status: 'Standby', color: 'text-gray-600' };
  };

  const getHealthStatus = () => {
    if (batterySOC > 80) return { health: 'Excellent', color: 'text-green-600' };
    if (batterySOC > 50) return { health: 'Good', color: 'text-blue-600' };
    if (batterySOC > 20) return { health: 'Fair', color: 'text-yellow-600' };
    return { health: 'Low', color: 'text-red-600' };
  };

  const batteryStatus = getBatteryStatus();
  const healthStatus = getHealthStatus();

  const radialData = [{ name: 'SOC', value: batterySOC, fill: '#10b981' }];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Battery Management System</h1>
        <div className="flex items-center space-x-2">
          <BatteryIcon className="h-5 w-5 text-green-500" />
          <span className={`text-sm font-medium ${batteryStatus.color}`}>
            {batteryStatus.status}
          </span>
        </div>
      </div>

      {/* Battery Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">State of Charge</p>
              <p className="text-2xl font-bold text-green-600">
                {sensorData?.battery.soc || '0'}%
              </p>
              <p className="text-xs text-gray-500">Capacity: 10 kWh</p>
            </div>
            <div className="relative">
              <BatteryIcon className="h-8 w-8 text-green-500" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-green-600">
                  {Math.round(batterySOC)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Voltage</p>
              <p className="text-2xl font-bold text-blue-600">
                {sensorData?.battery.voltage || '0'} V
              </p>
              <p className="text-xs text-gray-500">Nominal: 48V</p>
            </div>
            <Activity className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Current</p>
              <p className="text-2xl font-bold text-purple-600">
                {sensorData?.battery.current || '0'} A
              </p>
              <p className="text-xs text-gray-500">
                {batteryCurrent > 0 ? 'Charging' : batteryCurrent < 0 ? 'Discharging' : 'Idle'}
              </p>
            </div>
            <Zap className="h-8 w-8 text-purple-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Temperature</p>
              <p className="text-2xl font-bold text-orange-600">
                {sensorData?.battery.temperature || '0'}°C
              </p>
              <p className="text-xs text-gray-500">
                {batteryTemp > 35 ? 'High' : batteryTemp < 10 ? 'Low' : 'Normal'}
              </p>
            </div>
            <Thermometer className="h-8 w-8 text-orange-500" />
          </div>
        </div>
      </div>

      {/* Battery Health Status */}
      <div className="card">
        <h3 className="text-md font-semibold mb-2">Health Status</h3>
        <div className="space-y-2">
          <div className="flex justify-between items-center p-2 bg-green-50 rounded-lg">
            <span className="text-sm font-medium">Cell Balance</span>
            <span className="text-green-600 font-semibold text-sm">Good</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-green-50 rounded-lg">
            <span className="text-sm font-medium">Cycle Count</span>
            <span className="text-green-600 font-semibold text-sm">1,247 / 5,000</span>
          </div>
        </div>
      </div>

      {/* Battery History Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">24-Hour Battery Performance</h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={mockBatteryHistory}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Line yAxisId="left" type="monotone" dataKey="soc" stroke="#10b981" strokeWidth={2} name="SOC %" />
            <Line yAxisId="left" type="monotone" dataKey="voltage" stroke="#3b82f6" strokeWidth={2} name="Voltage (V)" />
            <Line yAxisId="right" type="monotone" dataKey="current" stroke="#8b5cf6" strokeWidth={2} name="Current (A)" />
          </LineChart>
        </ResponsiveContainer>
      </div>


    </div>
  );
};

export default Battery;