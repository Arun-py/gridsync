# Smart Renewable Energy Microgrid Monitoring System

A comprehensive web application for monitoring, controlling, and managing renewable energy microgrids with real-time data visualization, smart alerts, and predictive analytics.

## 🌟 Features

### Real-Time Dashboard
- Live solar panel data (voltage, current, power output)
- Battery SOC, voltage, current, temperature monitoring
- Load consumption per home with status indicators
- Interactive graphs and gauges for instant visualization

### User Roles
- **Admin View**: Complete microgrid oversight, per-home monitoring, fault detection, load control
- **User View**: Personal consumption data, solar vs battery contribution, alerts, simple graphs

### Control Panel (Admin)
- Remote switching of power sources (solar → load, battery → load)
- Enable/disable battery charging and discharging
- Set thresholds and automated responses
- Load shedding and distribution control

### Smart Alerts & Notifications
- Low battery, high temperature, load imbalance alerts
- Maintenance reminders and system health notifications
- Real-time web notifications with severity levels

### Data Analytics
- Daily/weekly/monthly usage reports
- Energy generation vs consumption trends
- Carbon savings calculator and efficiency metrics
- Export functionality for reports

### Communication System
- Admin-to-user messaging
- Broadcast announcements
- Priority-based message system
- Message templates for common notifications

## 🛠 Tech Stack

### Frontend
- **React.js** with TypeScript
- **Tailwind CSS** for modern UI
- **Recharts** for data visualization
- **Socket.IO Client** for real-time updates
- **Lucide React** for icons

### Backend
- **Node.js** with Express
- **Socket.IO** for real-time communication
- **MongoDB** with Mongoose
- **JWT** for authentication
- **bcryptjs** for password hashing

### Database
- **MongoDB** for flexible data storage
- Real-time data sync capabilities
- Scalable document-based structure

## 📦 Installation

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (local or cloud)
- npm or yarn

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd SolarEnergySystemSIH
   ```

2. **Install dependencies**
   ```bash
   npm run install-all
   ```

3. **Environment Configuration**
   - Copy `.env.example` to `.env`
   - Update MongoDB connection string
   - Set JWT secret key

4. **Database Setup**
   ```bash
   # Start MongoDB service
   # Then seed the database
   node database/seed.js
   ```

5. **Start the application**
   ```bash
   npm run dev
   ```

   This will start both backend (port 5000) and frontend (port 3000) concurrently.

## 🚀 Usage

### Demo Accounts
- **Admin**: admin@solar.com / admin123
- **User**: user@solar.com / user123

### Navigation
- **Dashboard**: Overview of entire microgrid system
- **Solar Panel**: Detailed solar generation monitoring
- **Power Usage**: Load consumption and appliance breakdown
- **Battery**: Battery management and health monitoring
- **Faults**: System alerts and maintenance tracking
- **Messages**: Communication between admin and users

### Key Functionalities

#### For Administrators
- Monitor all homes in the microgrid
- Control load distribution and power sources
- Send messages and alerts to users
- Manage system maintenance schedules
- View comprehensive analytics and reports

#### For Users
- View personal energy consumption
- Monitor solar generation and battery status
- Receive system alerts and messages
- Track energy savings and efficiency
- Access usage history and trends

## 📊 System Architecture

### Real-Time Data Flow
1. IoT sensors collect data every 5-10 seconds
2. Backend processes and validates sensor data
3. Socket.IO broadcasts updates to connected clients
4. Frontend updates dashboards in real-time
5. Database stores historical data for analytics

### Security Features
- JWT-based authentication
- Role-based access control
- Password hashing with bcrypt
- Input validation and sanitization
- CORS protection

## 🔧 Configuration

### Environment Variables
```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/solar_microgrid
JWT_SECRET=your_jwt_secret_key
MQTT_BROKER_URL=mqtt://localhost:1883
```

### Database Collections
- **Users**: User accounts and roles
- **SensorData**: IoT sensor readings
- **Alerts**: System notifications and faults
- **Messages**: Admin-user communications
- **EnergyProfiles**: Aggregated energy data

## 📈 Performance Metrics

### Expected Improvements
- **15%+ Energy Efficiency** through smart monitoring
- **Real-time Response** to system faults
- **Predictive Maintenance** reducing downtime
- **User Engagement** through intuitive interface

### System Capabilities
- Handles 1000+ concurrent users
- Processes sensor data every 5 seconds
- 99.9% uptime with proper infrastructure
- Scalable to multiple microgrid sites

## 🌍 Environmental Impact

### Carbon Footprint Reduction
- Real-time carbon savings calculator
- Monthly environmental impact reports
- Tree planting equivalency metrics
- Renewable energy percentage tracking

### Efficiency Optimization
- Peak hour load management
- Smart appliance scheduling
- Weather-based energy forecasting
- Automated load balancing

## 🔮 Future Enhancements

### Planned Features
- Mobile application for iOS/Android
- Machine learning for predictive analytics
- Integration with weather APIs
- Advanced energy trading capabilities
- IoT device management interface

### Scalability Options
- Multi-site management
- Cloud deployment with AWS/Azure
- Microservices architecture
- Advanced caching with Redis

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📞 Support

For technical support or questions:
- Email: support@solarmicrogrid.com
- Documentation: [Wiki](link-to-wiki)
- Issues: [GitHub Issues](link-to-issues)

## 🙏 Acknowledgments

- Smart India Hackathon for the opportunity
- Open source community for excellent libraries
- Rural communities inspiring sustainable solutions

---

**Built with ❤️ for sustainable energy future**