const mongoose = require('mongoose');

async function testConnection() {
  try {
    console.log('🔄 Testing MongoDB Atlas connection...');
    
    await mongoose.connect('mongodb+srv://prometheus140925_db_user:YOUR_PASSWORD@cluster0.hfwbdpi.mongodb.net/solar_microgrid?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    
    console.log('✅ MongoDB Atlas connected successfully!');
    console.log('📊 Database "solar_microgrid" will be created automatically');
    console.log('🚀 Ready to create collections and store data');
    
    // Test creating a simple document
    const testSchema = new mongoose.Schema({ test: String });
    const TestModel = mongoose.model('Test', testSchema);
    
    const testDoc = new TestModel({ test: 'Connection successful' });
    await testDoc.save();
    
    console.log('✅ Test document created successfully');
    console.log('🗄️ Database and collections are working');
    
    await TestModel.deleteMany({});
    console.log('🧹 Test data cleaned up');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.log('\n📋 To fix this:');
    console.log('1. Go to MongoDB Atlas Dashboard');
    console.log('2. Click "Network Access"');
    console.log('3. Click "Add IP Address"');
    console.log('4. Select "Add Current IP Address"');
    console.log('5. Run this test again');
    process.exit(1);
  }
}

testConnection();