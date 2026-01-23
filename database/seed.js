const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Connect to MongoDB
mongoose.connect('mongodb+srv://prometheus140925_db_user:YOUR_PASSWORD@cluster0.hfwbdpi.mongodb.net/solar_microgrid?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// User Schema
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: String,
  homeId: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Seed data
async function seedDatabase() {
  try {
    // Clear existing data
    await User.deleteMany({});
    
    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 12);
    const admin = new User({
      name: 'System Administrator',
      email: 'admin@solar.com',
      password: adminPassword,
      role: 'admin'
    });
    await admin.save();
    
    // Create user accounts
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
      },
      {
        name: 'Bob Johnson',
        email: 'bob@solar.com',
        password: userPassword,
        role: 'user',
        homeId: 'Home3'
      }
    ];
    
    for (const userData of users) {
      const user = new User(userData);
      await user.save();
    }
    
    console.log('✅ Database seeded successfully!');
    console.log('🔑 Demo accounts created:');
    console.log('   Admin: admin@solar.com / admin123');
    console.log('   User: user@solar.com / user123');
    console.log('🌐 MongoDB Atlas connected successfully!');
    console.log('📊 Ready to start the application!');
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();