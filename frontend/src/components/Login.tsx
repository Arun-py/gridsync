import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Sun, Battery, Zap, Home, Leaf, Shield } from 'lucide-react';
import axios from 'axios';

const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [homeId, setHomeId] = useState('');
  const [homeIdError, setHomeIdError] = useState('');
  const [homeIdSuggestion, setHomeIdSuggestion] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const checkHomeId = async (inputHomeId: string) => {
    if (!inputHomeId.trim()) {
      setHomeIdError('');
      setHomeIdSuggestion('');
      return;
    }
    
    try {
      const response = await axios.get(`http://localhost:5003/api/check-home-id/${inputHomeId}`);
      if (response.data.exists) {
        setHomeIdError('Home ID already exists');
        setHomeIdSuggestion(`Suggestion: ${response.data.suggestion}`);
      } else {
        setHomeIdError('');
        setHomeIdSuggestion('');
      }
    } catch (error) {
      console.error('Failed to check home ID:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        await login(email, password);
        // Clear form after successful login
        setEmail('');
        setPassword('');
      } else {
        await axios.post('http://localhost:5003/api/auth/register', {
          name,
          email,
          password,
          homeId
        });
        // Clear form after successful registration
        setName('');
        setEmail('');
        setPassword('');
        setHomeId('');
        setHomeIdError('');
        setHomeIdSuggestion('');
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || (isLogin ? 'Login failed' : 'Registration failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-green-50 to-blue-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-10 left-10 w-20 h-20 bg-yellow-200 rounded-full opacity-20 animate-pulse"></div>
        <div className="absolute top-32 right-20 w-16 h-16 bg-green-200 rounded-full opacity-30 animate-bounce"></div>
        <div className="absolute bottom-20 left-20 w-24 h-24 bg-blue-200 rounded-full opacity-25 animate-pulse"></div>
        <div className="absolute bottom-32 right-10 w-12 h-12 bg-yellow-300 rounded-full opacity-20"></div>
      </div>
      
      <div className="max-w-md w-full relative z-10">
        <div className="text-center mb-8">
          <div className="relative mb-6">
            <div className="flex justify-center items-center space-x-3 mb-4">
              <div className="relative">
                <Sun className="h-12 w-12 text-yellow-500 animate-spin" style={{animationDuration: '8s'}} />
                <div className="absolute inset-0 h-12 w-12 bg-yellow-400 rounded-full opacity-20 animate-ping"></div>
              </div>
              <div className="relative">
                <Battery className="h-10 w-10 text-green-500" />
                <div className="absolute top-2 left-2 w-6 h-2 bg-green-400 rounded animate-pulse"></div>
              </div>
              <div className="relative">
                <Zap className="h-10 w-10 text-blue-500 animate-bounce" />
              </div>
            </div>
            <div className="flex justify-center space-x-4 mb-4">
              <Home className="h-6 w-6 text-green-600" />
              <Leaf className="h-6 w-6 text-green-500" />
              <Shield className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-600 via-green-600 to-blue-600 bg-clip-text text-transparent mb-2">
            Smart Micro Grid
          </h1>
          <p className="text-gray-600 text-lg font-medium">Renewable Energy Monitoring System</p>
          <div className="mt-2 flex justify-center space-x-2 text-sm text-gray-500">
            <span className="flex items-center"><Sun className="h-4 w-4 mr-1" />Solar</span>
            <span className="flex items-center"><Battery className="h-4 w-4 mr-1" />Storage</span>
            <span className="flex items-center"><Zap className="h-4 w-4 mr-1" />Smart</span>
          </div>
        </div>

        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl border border-white/20 p-8">
          <div className="flex mb-8 bg-gray-100 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-3 px-6 text-center font-semibold rounded-lg transition-all duration-300 ${
                isLogin 
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg transform scale-105' 
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                <Shield className="h-4 w-4" />
                <span>Login</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-3 px-6 text-center font-semibold rounded-lg transition-all duration-300 ${
                !isLogin 
                  ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg transform scale-105' 
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                <Home className="h-4 w-4" />
                <span>User Register</span>
              </div>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200 bg-gray-50 hover:bg-white"
                  placeholder="Enter your full name"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-gray-50 hover:bg-white"
                placeholder="Enter your email address"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-gray-50 hover:bg-white"
                placeholder="Enter your password"
                required
              />
            </div>

            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Home ID
                </label>
                <input
                  type="text"
                  value={homeId}
                  onChange={(e) => {
                    setHomeId(e.target.value);
                    checkHomeId(e.target.value);
                  }}
                  className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200 bg-gray-50 hover:bg-white ${
                    homeIdError ? 'border-red-300 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="Enter your desired Home ID (e.g., Home 1)"
                  required
                />
                {homeIdError && (
                  <p className="text-xs text-red-500 mt-1">{homeIdError}</p>
                )}
                {homeIdSuggestion && (
                  <p className="text-xs text-blue-500 mt-1">{homeIdSuggestion}</p>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center space-x-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-red-700 text-sm font-medium">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!isLogin && !!homeIdError)}
              className={`w-full py-4 px-6 rounded-xl font-semibold text-white transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:transform-none ${
                isLogin 
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-lg hover:shadow-xl'
                  : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 shadow-lg hover:shadow-xl'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>{isLogin ? 'Signing in...' : 'Creating account...'}</span>
                  </>
                ) : (
                  <>
                    {isLogin ? <Shield className="h-5 w-5" /> : <Home className="h-5 w-5" />}
                    <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
                  </>
                )}
              </div>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;