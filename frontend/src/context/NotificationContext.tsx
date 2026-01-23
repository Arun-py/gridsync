import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSocket } from './SocketContext';

interface NotificationContextType {
  unreadAlertsCount: number;
  markAlertsAsRead: () => void;
  addNewAlert: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [unreadAlertsCount, setUnreadAlertsCount] = useState(0);
  const { socket } = useSocket();

  useEffect(() => {
    if (socket) {
      socket.on('newAlert', () => {
        setUnreadAlertsCount(prev => prev + 1);
      });

      return () => {
        socket.off('newAlert');
      };
    }
  }, [socket]);

  const markAlertsAsRead = () => {
    setUnreadAlertsCount(0);
  };

  const addNewAlert = () => {
    setUnreadAlertsCount(prev => prev + 1);
  };

  return (
    <NotificationContext.Provider value={{
      unreadAlertsCount,
      markAlertsAsRead,
      addNewAlert
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return context;
};