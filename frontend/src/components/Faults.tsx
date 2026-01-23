import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { AlertTriangle, CheckCircle, Clock, X, Eye, Wrench, Filter } from 'lucide-react';
import axios from 'axios';

interface Alert {
  _id: string;
  alertId: string;
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'acknowledged' | 'resolved';
  deviceId?: string;
  timestamp: string;
  resolvedAt?: string;
}

const Faults: React.FC = () => {
  const { user } = useAuth();
  const { markAlertsAsRead } = useNotification();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  // Mock alerts data
  const mockAlerts: Alert[] = [
    {
      _id: '1',
      alertId: 'ALT_001',
      type: 'high_temperature',
      message: 'Battery temperature exceeds safe operating limit (45°C)',
      severity: 'high',
      status: 'active',
      deviceId: 'BATT_01',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      _id: '2',
      alertId: 'ALT_002',
      type: 'low_battery',
      message: 'Battery SOC dropped below 20%',
      severity: 'medium',
      status: 'acknowledged',
      deviceId: 'BATT_01',
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    },
    {
      _id: '3',
      alertId: 'ALT_003',
      type: 'load_imbalance',
      message: 'Load imbalance detected between L1 and L2 phases',
      severity: 'medium',
      status: 'active',
      deviceId: 'LOAD_01',
      timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    },
    {
      _id: '4',
      alertId: 'ALT_004',
      type: 'maintenance',
      message: 'Solar panel cleaning required - efficiency dropped by 8%',
      severity: 'low',
      status: 'active',
      deviceId: 'SOLAR_01',
      timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    },
    {
      _id: '5',
      alertId: 'ALT_005',
      type: 'fault',
      message: 'Inverter communication timeout',
      severity: 'critical',
      status: 'resolved',
      deviceId: 'INV_01',
      timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      resolvedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
    },
  ];

  useEffect(() => {
    // Mark alerts as read when component mounts
    markAlertsAsRead();
    
    // Simulate API call
    setTimeout(() => {
      setAlerts(mockAlerts);
      setLoading(false);
    }, 1000);
  }, [markAlertsAsRead]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200';
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <AlertTriangle className="h-5 w-5 text-red-500" />;
      case 'acknowledged': return <Clock className="h-5 w-5 text-yellow-500" />;
      case 'resolved': return <CheckCircle className="h-5 w-5 text-green-500" />;
      default: return <AlertTriangle className="h-5 w-5 text-gray-500" />;
    }
  };

  const handleStatusUpdate = async (alertId: string, newStatus: string) => {
    try {
      if (newStatus === 'resolved') {
        setAlerts(prev => prev.filter(alert => alert.alertId !== alertId));
      } else {
        setAlerts(prev => prev.map(alert => 
          alert.alertId === alertId 
            ? { ...alert, status: newStatus as any }
            : alert
        ));
      }
    } catch (error) {
      console.error('Failed to update alert status:', error);
    }
  };

  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'all') return true;
    return alert.status === filter;
  });

  const alertCounts = {
    active: alerts.filter(a => a.status === 'active').length,
    acknowledged: alerts.filter(a => a.status === 'acknowledged').length,
    resolved: alerts.filter(a => a.status === 'resolved').length,
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">System Faults & Alerts</h1>
        <div className="flex items-center space-x-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <span className="text-sm text-gray-600">
            {alertCounts.active} Active Alerts
          </span>
        </div>
      </div>

      {/* Alert Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Alerts</p>
              <p className="text-2xl font-bold text-red-600">{alertCounts.active}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Acknowledged</p>
              <p className="text-2xl font-bold text-yellow-600">{alertCounts.acknowledged}</p>
            </div>
            <Clock className="h-8 w-8 text-yellow-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Resolved Today</p>
              <p className="text-2xl font-bold text-green-600">{alertCounts.resolved}</p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">System Health</p>
              <p className="text-2xl font-bold text-blue-600">87%</p>
            </div>
            <Wrench className="h-8 w-8 text-blue-500" />
          </div>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Filter className="h-5 w-5 text-gray-600" />
            <span className="font-medium">Filter by Status:</span>
            <div className="flex space-x-2">
              {['all', 'active', 'acknowledged', 'resolved'].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    filter === status
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                  {status !== 'all' && (
                    <span className="ml-1">({alertCounts[status as keyof typeof alertCounts] || 0})</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Alerts List */}
      <div className="space-y-4">
        {filteredAlerts.length === 0 ? (
          <div className="card text-center py-12">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Alerts Found</h3>
            <p className="text-gray-600">
              {filter === 'all' ? 'All systems are running smoothly!' : `No ${filter} alerts at this time.`}
            </p>
          </div>
        ) : (
          filteredAlerts.map((alert) => (
            <div key={alert._id} className={`card border-l-4 ${getSeverityColor(alert.severity)}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4 flex-1">
                  <div className="mt-1">
                    {getStatusIcon(alert.status)}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <h3 className="font-semibold text-gray-900">{alert.alertId}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getSeverityColor(alert.severity)}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-500">
                        {alert.deviceId && `Device: ${alert.deviceId}`}
                      </span>
                    </div>
                    
                    <p className="text-gray-700 mb-2">{alert.message}</p>
                    
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span>
                        Created: {new Date(alert.timestamp).toLocaleString()}
                      </span>
                      {alert.resolvedAt && (
                        <span>
                          Resolved: {new Date(alert.resolvedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Buttons (Admin Only) */}
                {user?.role === 'admin' && alert.status !== 'resolved' && (
                  <div className="flex items-center space-x-2 ml-4">
                    {alert.status === 'active' && (
                      <button
                        onClick={() => handleStatusUpdate(alert.alertId, 'acknowledged')}
                        className="btn-secondary text-xs py-1 px-2"
                      >
                        Acknowledge
                      </button>
                    )}
                    <button
                      onClick={() => handleStatusUpdate(alert.alertId, 'resolved')}
                      className="btn-primary text-xs py-1 px-2"
                    >
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>



      {/* Preventive Maintenance Schedule */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Preventive Maintenance Schedule</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200">
            <div>
              <p className="font-medium text-red-900">Solar Panel Cleaning</p>
              <p className="text-sm text-red-700">Overdue by 3 days</p>
            </div>
            <span className="text-red-600 font-semibold">High Priority</span>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg border border-yellow-200">
            <div>
              <p className="font-medium text-yellow-900">Battery Equalization</p>
              <p className="text-sm text-yellow-700">Due in 5 days</p>
            </div>
            <span className="text-yellow-600 font-semibold">Medium Priority</span>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div>
              <p className="font-medium text-blue-900">System Calibration</p>
              <p className="text-sm text-blue-700">Due in 2 weeks</p>
            </div>
            <span className="text-blue-600 font-semibold">Low Priority</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Faults;