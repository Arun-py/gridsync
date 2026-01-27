import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocation } from 'react-router-dom';
import { MessageSquare, Send, Users, User, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import axios from 'axios';

interface Message {
  _id: string;
  senderId: {
    _id: string;
    name: string;
    role: string;
  };
  receiverId?: {
    _id: string;
    name: string;
  };
  message: string;
  type: 'broadcast' | 'personal';
  priority: 'low' | 'medium' | 'high';
  isRead: boolean;
  timestamp: string;
}

interface UserData {
  _id: string;
  name: string;
  email: string;
  homeId: string;
}

const Messages: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<UserData[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [messageType, setMessageType] = useState<'broadcast' | 'personal'>('personal');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [loading, setLoading] = useState(true);
  const [userMessages, setUserMessages] = useState<Message[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // Mock data
  const mockMessages: Message[] = [
    {
      _id: '1',
      senderId: { _id: 'admin1', name: 'System Admin', role: 'admin' },
      receiverId: { _id: 'user1', name: 'John Doe' },
      message: 'Your solar system is performing excellently today! Energy generation is 15% above average.',
      type: 'personal',
      priority: 'medium',
      isRead: true,
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      _id: '2',
      senderId: { _id: 'admin1', name: 'System Admin', role: 'admin' },
      message: 'Scheduled maintenance will be performed tomorrow from 10 AM to 2 PM. Expect brief power interruptions.',
      type: 'broadcast',
      priority: 'high',
      isRead: false,
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    },

    {
      _id: '4',
      senderId: { _id: 'admin1', name: 'System Admin', role: 'admin' },
      message: 'Weather forecast shows cloudy conditions for the next 3 days. Consider conserving energy.',
      type: 'broadcast',
      priority: 'low',
      isRead: false,
      timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const fetchUsers = async () => {
    try {
      const response = await axios.get('https://gridsync-qpsn.onrender.com/api/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      setUsers([]);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchMessages();
      fetchUsers();
    } else {
      fetchUserMessages();
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    const selectedHome = (location.state as any)?.selectedHome;
    if (selectedHome && users.length > 0) {
      const targetUser = users.find(u => u.homeId === selectedHome);
      if (targetUser) {
        setSelectedUser(targetUser._id);
        setMessageType('personal');
      }
    }
  }, [users, location.state]);

  const fetchUserMessages = async () => {
    try {
      const response = await axios.get(`https://gridsync-qpsn.onrender.com/api/messages/user/${user?.name}`);
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to fetch user messages:', error);
      setMessages(mockMessages);
    }
  };

  const fetchMessages = async () => {
    try {
      const response = await axios.get('https://gridsync-qpsn.onrender.com/api/messages');
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      setMessages(mockMessages);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      if (user?.role === 'user') {
        // Send message to backend
        await axios.post('https://gridsync-qpsn.onrender.com/api/messages', {
          from: user?.name || 'User',
          to: 'admin',
          message: newMessage
        });
        
        // Create user message locally for display
        const newMsg: Message = {
          _id: Date.now().toString(),
          senderId: { _id: user?.id || '', name: user?.name || '', role: user?.role || '' },
          receiverId: { _id: 'admin', name: 'Admin' },
          message: newMessage,
          type: 'personal',
          priority: 'medium',
          isRead: false,
          timestamp: new Date().toISOString(),
        };
        
        // Add to user messages
        setUserMessages(prev => [newMsg, ...prev]);
        alert('Message sent to admin successfully!');
      } else {
        // Admin sending message
        const selectedUserData = users.find(u => u._id === selectedUser);
        const recipientName = messageType === 'personal' ? selectedUserData?.name : 'all';
        
        await axios.post('https://gridsync-qpsn.onrender.com/api/messages', {
          from: 'Admin',
          to: recipientName,
          message: newMessage
        });

        const newMsg: Message = {
          _id: Date.now().toString(),
          senderId: { _id: user?.id || '', name: user?.name || '', role: user?.role || '' },
          receiverId: messageType === 'personal' && selectedUser ? 
            users.find(u => u._id === selectedUser) : undefined,
          message: newMessage,
          type: messageType,
          priority,
          isRead: false,
          timestamp: new Date().toISOString(),
        };

        // Only add to messages if it's a broadcast
        if (messageType === 'broadcast') {
          setMessages(prev => [newMsg, ...prev]);
        }
        alert('Message sent successfully!');
      }
      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message');
    }
  };

  const markAsRead = async (messageId: string) => {
    if (user?.role === 'user') {
      setShowDeleteConfirm(messageId);
    } else {
      try {
        await axios.put(`https://gridsync-qpsn.onrender.com/api/messages/${messageId}/read`);
        setMessages(prev => prev.map(msg => 
          msg._id === messageId ? { ...msg, isRead: true } : msg
        ));
      } catch (error) {
        console.error('Failed to mark message as read:', error);
      }
    }
  };



  const deleteMessage = async (messageId: string) => {
    if (user?.role === 'user') {
      setUserMessages(prev => prev.filter(msg => msg._id !== messageId));
    } else {
      setShowDeleteConfirm(messageId);
    }
  };

  const confirmDeleteMessage = async (messageId: string) => {
    try {
      // Check if it's a mock message (string IDs like '1', '2', '4')
      if (messageId.length < 10) {
        // It's a mock message, just remove from frontend
        setMessages(prev => prev.filter(msg => msg._id !== messageId));
      } else {
        // It's a real database message, delete from backend
        await axios.delete(`https://gridsync-qpsn.onrender.com/api/messages/${messageId}`);
        setMessages(prev => prev.filter(msg => msg._id !== messageId));
      }
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error('Failed to delete message:', error);
      // Still remove from frontend even if backend fails
      setMessages(prev => prev.filter(msg => msg._id !== messageId));
      setShowDeleteConfirm(null);
    }
  };

  const handleReply = async (userName: string) => {
    if (!replyMessage.trim()) return;
    
    try {
      await axios.post('https://gridsync-qpsn.onrender.com/api/messages', {
        from: 'Admin',
        to: userName,
        message: replyMessage
      });
      
      // Delete the original user message after reply
      if (replyingTo) {
        await axios.delete(`https://gridsync-qpsn.onrender.com/api/messages/${replyingTo}`);
        setMessages(prev => prev.filter(msg => msg._id !== replyingTo));
      }
      
      setReplyMessage('');
      setReplyingTo(null);
      alert('Reply sent successfully!');
    } catch (error) {
      console.error('Failed to send reply:', error);
      alert('Failed to send reply');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-50 border-red-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const filteredMessages = user?.role === 'admin' 
    ? messages.filter(msg => msg && msg.senderId) 
    : messages.filter(msg => 
        msg && msg.senderId && (
          msg.type === 'broadcast' || 
          msg.receiverId?._id === user?.id || 
          msg.senderId?._id === user?.id
        )
      );

  const unreadCount = filteredMessages.filter(msg => msg && !msg.isRead && msg.senderId?._id !== user?.id).length;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Safety check for messages array
  if (!Array.isArray(messages)) {
    return (
      <div className="flex justify-center items-center h-64">
        <p className="text-gray-500">Loading messages...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Messages & Communications</h1>
        <div className="flex items-center space-x-2">
          <MessageSquare className="h-5 w-5 text-blue-500" />
          <span className="text-sm text-gray-600">
            {unreadCount} Unread Messages
          </span>
        </div>
      </div>

      {/* Message Stats - Admin Only */}
      {user?.role === 'admin' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Messages</p>
                <p className="text-2xl font-bold text-blue-600">{filteredMessages.length}</p>
              </div>
              <MessageSquare className="h-8 w-8 text-blue-500" />
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Unread</p>
                <p className="text-2xl font-bold text-red-600">{unreadCount}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-500" />
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Broadcasts</p>
                <p className="text-2xl font-bold text-green-600">
                  {filteredMessages.filter(m => m && m.type === 'broadcast').length}
                </p>
              </div>
              <Users className="h-8 w-8 text-green-500" />
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Personal</p>
                <p className="text-2xl font-bold text-purple-600">
                  {filteredMessages.filter(m => m && m.type === 'personal' && m.senderId?.role === 'user' && !m.isRead).length}
                </p>
              </div>
              <User className="h-8 w-8 text-purple-500" />
            </div>
          </div>
        </div>
      )}

      {/* Send Message Box for Users */}
      {user?.role === 'user' && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Send Message to Admin</h3>
          <div className="space-y-4">
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Type your message or suggestion to admin here..."
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              <span>Send to Admin</span>
            </button>
          </div>
        </div>
      )}

      {/* Send Message (Admin Only) */}
      {user?.role === 'admin' && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Send Message</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Message Type
                </label>
                <select 
                  value={messageType}
                  onChange={(e) => setMessageType(e.target.value as 'broadcast' | 'personal')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="personal">Personal Message</option>
                  <option value="broadcast">Broadcast to All</option>
                </select>
              </div>

              {messageType === 'personal' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Recipient
                  </label>
                  <select 
                    value={selectedUser}
                    onChange={(e) => setSelectedUser(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Home</option>
                    {users.map(user => (
                      <option key={user._id} value={user._id}>
                        {user.homeId} - {user.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Priority
                </label>
                <select 
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message
              </label>
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Type your message here..."
              />
            </div>

            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || (messageType === 'personal' && !selectedUser)}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              <span>Send Message</span>
            </button>
          </div>
        </div>
      )}

      {/* Messages List */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Recent Messages</h3>
        
        {user?.role === 'user' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column - My Messages to Admin */}
            <div className="space-y-4">
              <h4 className="text-md font-medium text-gray-700">My Messages to Admin</h4>
              {userMessages.length === 0 ? (
                <div className="card text-center py-8">
                  <p className="text-gray-500">No messages sent yet</p>
                </div>
              ) : (
                userMessages.map((message) => (
                  <div key={message._id} className="space-y-2">
                    {/* User Message */}
                    <div className="card bg-blue-50 border-l-4 border-blue-500">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <User className="h-4 w-4 text-blue-600" />
                            <span className="font-medium text-blue-900">You</span>
                            <span className="text-xs text-blue-600">to Admin</span>
                          </div>
                          <p className="text-gray-800 mb-3">{message.message}</p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1 text-sm text-blue-600">
                              <Clock className="h-3 w-3" />
                              <span>{new Date(message.timestamp).toLocaleString()}</span>
                            </div>
                            <button
                              onClick={() => deleteMessage(message._id)}
                              className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Admin Reply (if exists) */}
                    {filteredMessages.find(msg => 
                      msg.senderId?.role === 'admin' && 
                      msg.receiverId?._id === user?.id &&
                      msg.timestamp > message.timestamp
                    ) && (
                      <div className="ml-8 card bg-green-50 border-l-4 border-green-500">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <User className="h-4 w-4 text-green-600" />
                              <span className="font-medium text-green-900">Admin Reply</span>
                            </div>
                            <p className="text-gray-800 mb-3">
                              {filteredMessages.find(msg => 
                                msg.senderId?.role === 'admin' && 
                                msg.receiverId?._id === user?.id &&
                                msg.timestamp > message.timestamp
                              )?.message}
                            </p>
                            <div className="flex items-center space-x-1 text-sm text-green-600">
                              <Clock className="h-3 w-3" />
                              <span>
                                {new Date(filteredMessages.find(msg => 
                                  msg.senderId?.role === 'admin' && 
                                  msg.receiverId?._id === user?.id &&
                                  msg.timestamp > message.timestamp
                                )?.timestamp || '').toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Right Column - Admin Messages */}
            <div className="space-y-4">
              <h4 className="text-md font-medium text-gray-700">Messages from Admin</h4>
              {filteredMessages.filter(msg => msg && msg.senderId?.role === 'admin').length === 0 ? (
                <div className="card text-center py-8">
                  <p className="text-gray-500">No admin messages yet</p>
                </div>
              ) : (
                filteredMessages.filter(msg => msg && msg.senderId?.role === 'admin').map((message) => (
                  <div key={message._id} className={`card ${message.type === 'broadcast' ? 'bg-green-50 border-l-4 border-green-500' : 'bg-gray-50 border-l-4 border-gray-500'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          {message.type === 'broadcast' ? (
                            <Users className="h-4 w-4 text-green-600" />
                          ) : (
                            <User className="h-4 w-4 text-gray-600" />
                          )}
                          <span className="font-medium text-gray-900">{message.senderId?.name}</span>
                          {message.type === 'broadcast' && (
                            <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                              BROADCAST
                            </span>
                          )}
                        </div>
                        <p className="text-gray-800 mb-3">{message.message}</p>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <div className="flex items-center space-x-1">
                            <Clock className="h-3 w-3" />
                            <span>{new Date(message.timestamp).toLocaleString()}</span>
                          </div>
                          {!message.isRead && (
                            <button
                              onClick={() => markAsRead(message._id)}
                              className="text-blue-600 hover:text-blue-800 text-xs"
                            >
                              Mark as Read
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          // Admin view - split layout
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column - Messages from Users */}
            <div className="space-y-4">
              <h4 className="text-md font-medium text-gray-700">Messages from Users</h4>
              {filteredMessages.filter(msg => msg && msg.senderId?.role === 'user' && msg.senderId?.name !== 'Admin').length === 0 ? (
                <div className="card text-center py-8">
                  <p className="text-gray-500">No user messages yet</p>
                </div>
              ) : (
                filteredMessages.filter(msg => msg && msg.senderId?.role === 'user' && msg.senderId?.name !== 'Admin').map((message) => (
                  <div key={message._id} className="card bg-blue-50 border-l-4 border-blue-500">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <User className="h-4 w-4 text-blue-600" />
                          <span className="font-medium text-blue-900">{message.senderId?.name}</span>
                        </div>
                        <p className="text-gray-800 mb-3">{message.message}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1 text-sm text-blue-600">
                            <Clock className="h-3 w-3" />
                            <span>{new Date(message.timestamp).toLocaleString()}</span>
                          </div>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => setReplyingTo(message._id)}
                              className="text-green-600 hover:text-green-800 text-xs px-2 py-1 rounded"
                            >
                              Reply
                            </button>
                          </div>
                        </div>
                        {replyingTo === message._id && (
                          <div className="mt-3 p-3 bg-white rounded border">
                            <textarea
                              value={replyMessage}
                              onChange={(e) => setReplyMessage(e.target.value)}
                              rows={2}
                              className="w-full px-2 py-1 border rounded text-sm"
                              placeholder="Type your reply..."
                            />
                            <div className="flex justify-end space-x-2 mt-2">
                              <button
                                onClick={() => setReplyingTo(null)}
                                className="text-gray-500 text-xs px-2 py-1"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleReply(message.senderId?.name || '')}
                                className="bg-green-600 text-white text-xs px-3 py-1 rounded"
                              >
                                Send Reply
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Right Column - Admin Broadcast Messages */}
            <div className="space-y-4">
              <h4 className="text-md font-medium text-gray-700">Admin Broadcast Messages</h4>
              {filteredMessages.filter(msg => msg && msg.senderId?.role === 'admin' && msg.type === 'broadcast').length === 0 ? (
                <div className="card text-center py-8">
                  <p className="text-gray-500">No broadcast messages yet</p>
                </div>
              ) : (
                filteredMessages.filter(msg => msg && msg.senderId?.role === 'admin' && msg.type === 'broadcast').map((message) => (
                  <div key={message._id} className="card bg-green-50 border-l-4 border-green-500">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <Users className="h-4 w-4 text-green-600" />
                          <span className="font-medium text-green-900">Admin Broadcast</span>
                        </div>
                        <p className="text-gray-800 mb-3">{message.message}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1 text-sm text-green-600">
                            <Clock className="h-3 w-3" />
                            <span>{new Date(message.timestamp).toLocaleString()}</span>
                          </div>
                          <button
                            onClick={() => deleteMessage(message._id)}
                            className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>



      {/* Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Delete Message</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this message? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDeleteMessage(showDeleteConfirm)}
                className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Messages;