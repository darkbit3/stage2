const io = require('socket.io-client');

// Test script for real-time connection between Stage2 and DB Manager
const testRealtimeConnection = () => {
  console.log('🧪 Testing real-time connection between Stage2 and DB Manager...');

  const DB_MANAGER_URL = process.env.DB_MANAGER || 'http://localhost:3007';

  // Connect as a test client
  const socket = io(DB_MANAGER_URL, {
    transports: ['websocket', 'polling'],
    timeout: 5000
  });

  socket.on('connect', () => {
    console.log('✅ Test client connected to DB Manager');

    // Test stage2 connection
    socket.emit('stage2-connect', {
      stage: 'test-stage2',
      timestamp: new Date().toISOString()
    });

    // Test game data request
    setTimeout(() => {
      console.log('📊 Requesting game data...');
      socket.emit('request-game-data', { stage: 'e' });
    }, 1000);

    // Test bet notification
    setTimeout(() => {
      console.log('🎯 Sending test bet notification...');
      socket.emit('bet-placed', {
        stage: 'E',
        gameId: 'TEST456',
        boardNumber: 150,
        playerId: 'test-player-stage2',
        amount: 30,
        totalPlayers: 8,
        payout: 240
      });
    }, 2000);

    // Disconnect after tests
    setTimeout(() => {
      console.log('🔌 Disconnecting test client...');
      socket.disconnect();
      process.exit(0);
    }, 5000);
  });

  socket.on('db-manager-connected', (data) => {
    console.log('🎯 DB Manager acknowledged test connection:', data);
  });

  socket.on('game-data-update', (data) => {
    console.log('📊 Received game data update:', data);
  });

  socket.on('bet-update', (data) => {
    console.log('🎯 Received bet update:', data);
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Test client disconnected');
  });
};

testRealtimeConnection();