const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function setupDatabase() {
  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    
    await mongoose.connect('mongodb+srv://prometheus140925_db_user:YOUR_PASSWORD@cluster0.hfwbdpi.mongodb.net/solar_microgrid?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connected to MongoDB Atlas!');
    console.log('📊 Database "solar_microgrid" created/connected');
    
    // User Schema
    const userSchema = new mongoose.Schema({
      name: { type: String, required: true },
      email: { type: String, required: true, unique: true },
      password: { type: String, required: true },
      role: { type: String, enum: ['admin', 'user'], default: 'user' },
      homeId: { type: String },
      createdAt: { type: Date, default: Date.now }
    });
    
    const User = mongoose.model('User', userSchema);
    
    // Sensor Data Schema
    const sensorDataSchema = new mongoose.Schema({
      timestamp: { type: Date, default: Date.now },
      solarPanel: {
        voltage: Number,
        current: Number,
        power: Number
      },
      battery: {
        soc: Number,
        voltage: Number,
        current: Number,
        temperature: Number
      },
      loads: {
        L1: Number,
        L2: Number,
        L3: Number
      }
    });
    
    const SensorData = mongoose.model('SensorData', sensorDataSchema);
    
    console.log('🗄️ Creating collections...');
    
    // Clear existing data
    await User.deleteMany({});
    await SensorData.deleteMany({});
    
    console.log('👨💼 Creating admin user...');
    const adminPassword = await bcrypt.hash('admin123', 12);
    const admin = new User({
      name: 'System Administrator',
      email: 'admin@solar.com',
      password: adminPassword,
      role: 'admin'
    });
    await admin.save();
    
    console.log('👤 Creating demo users...');
    const userPassword = await bcrypt.hash('user123', 12);
    
    const users = [
      {
        name: 'John Doe',
        email: 'user@solar.com',
        password: userPassword,
        role: 'user',
        homeId: 'Home1'
      },
      {
        name: 'Jane Smith',
        email: 'jane@solar.com',
        password: userPassword,
        role: 'user',
        homeId: 'Home2'
      }
    ];
    
    for (const userData of users) {
      const user = new User(userData);
      await user.save();
      console.log(`✅ Created: ${userData.name} (${userData.homeId})`);
    }
    
    console.log('📊 Creating sample sensor data...');
    const sampleSensorData = new SensorData({
      solarPanel: { voltage: 230, current: 16, power: 3680 },
      battery: { soc: 85, voltage: 48.5, current: 12, temperature: 26 },
      loads: { L1: 500, L2: 350, L3: 420 }
    });
    await sampleSensorData.save();
    
    console.log('\n🎉 Database setup completed successfully!');
    console.log('📊 Collections created:');
    console.log('   - users (with admin and demo users)');
    console.log('   - sensordatas (with sample data)');
    console.log('\n🔑 Login credentials:');
    console.log('   Admin: admin@solar.com / admin123');
    console.log('   User:  user@solar.com / user123');
    console.log('\n🚀 You can now start the server!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.log('\n📋 Make sure to:');
    console.log('1. Whitelist your IP in MongoDB Atlas');
    console.log('2. Check your internet connection');
    console.log('3. Verify the connection string');
    process.exit(1);
  }
}

setupDatabase();