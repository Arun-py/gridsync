const axios = require('axios');

async function testRegistration() {
  try {
    console.log('🧪 Testing user registration...');
    
    const testUser = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'test123',
      role: 'user',
      homeId: 'Home1'
    };
    
    const response = await axios.post('http://localhost:5001/api/auth/register', testUser);
    
    console.log('✅ Registration successful!');
    console.log('📊 Response:', response.data);
    console.log('🔑 User created with ID:', response.data.user.id);
    
    // Test getting users
    const usersResponse = await axios.get('http://localhost:5001/api/users');
    console.log('👥 All users in database:', usersResponse.data.length);
    
  } catch (error) {
    console.error('❌ Registration failed:', error.response?.data || error.message);
  }
}

testRegistration();