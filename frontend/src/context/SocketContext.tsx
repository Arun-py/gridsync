import React, { createContext, useContext, useEffect, useState } from 'react';
import io, { Socket } from 'socket.io-client';

interface SensorData {
  timestamp: Date;
  solarPanel: {
    voltage: string;
    current: string;
    power: string;
  };
  battery: {
    soc: string;
    voltage: string;
    current: string;
    temperature: string;
  };
  loads: {
    L1: string;
    L2: string;
    L3: string;
  };
  acLoad?: {
    voltage: string;
    current: string;
    power: string;
  };
  dcLoad?: {
    voltage: string;
    current: string;
    power: string;
  };
}

interface SocketContextType {
  socket: Socket | null;
  sensorData: SensorData | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const newSocket = io('https://gridsync-qpsn.onrender.com');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnected(true);
      console.log('Connected to server');
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from server');
    });

    newSocket.on('sensor-data', (data: SensorData) => {
      setSensorData(data);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, sensorData, connected }}>
      {children}
    </SocketContext.Provider>
  );
};