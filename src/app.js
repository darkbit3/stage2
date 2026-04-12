const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const ioClient = require('socket.io-client');
require('dotenv').config();

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

const app = express();
const server = http.createServer(app);

// Socket.IO server for Big Server connections
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Service configuration
const DB_MANAGER_LOCAL_URL = `http://localhost:${process.env.DB_MANAGER_PORT || 3007}`;
const DB_MANAGER_REMOTE_URL = process.env.DB_MANAGER || 'https://db-manager-1.onrender.com';

const services = {
  bigserver: { url: process.env.BIGSERVER_URL || `http://localhost:${process.env.BIGSERVER_PORT}`, name: 'Big Server', connected: false },
  db_manager: {
    primaryUrl: DB_MANAGER_LOCAL_URL,
    fallbackUrl: DB_MANAGER_REMOTE_URL,
    url: DB_MANAGER_LOCAL_URL,
    name: 'DB Manager',
    connected: false,
    fallbackUsed: false
  }
};

const {
  getRoomCountdown,
  resetRoomCountdown,
  decrementCountdowns,
  setRoomCountdown,
  getAllCountdowns,
  DEFAULT_COUNTDOWN_SECONDS
} = require('./countdownManager');

// Socket.IO client for real-time connection to DB Manager
let dbManagerSocket = null;
let socketConnected = false;

// Helper function to extract port from URL
const getPortFromUrl = (url) => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
  } catch (error) {
    return 'unknown';
  }
};

// Enhanced service connection checking with retry logic
const checkServiceConnections = async () => {
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds
  
  const checkWithRetry = async (serviceName, url, headers = {}, retries = maxRetries) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, { timeout: 5000, headers });
        if (response.status === 200) {
          return { success: true, data: response.data };
        }
      } catch (error) {
        if (i === retries - 1) {
          throw error;
        }
        console.log(`⚠️  ${serviceName} connection attempt ${i + 1} failed, retrying in ${retryDelay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  };
  
  try {
    // Check BigServer connection with API key
    try {
      const bigserverResult = await checkWithRetry(
        'BigServer',
        services.bigserver.url,
        { 'x-api-key': process.env.BIGSERVER_API_KEY }
      );
      
      services.bigserver.connected = true;
      console.log('✅ Connected to Big Server (Port ' + process.env.BIGSERVER_PORT + ') with API key');
      console.log('   📊 Big Server Status:', bigserverResult.data.status);
      logger.info(`✅ Big Server (Port ${process.env.BIGSERVER_PORT}) is connected`);
      
    } catch (error) {
      services.bigserver.connected = false;
      console.log('❌ Failed to connect to Big Server (Port ' + process.env.BIGSERVER_PORT + '):', error.message);
      if (error.response && error.response.status === 401) {
        console.log('🔑 API Key authentication failed - check your API key configuration');
      }
      logger.warn(`❌ Big Server (Port ${process.env.BIGSERVER_PORT}) connection error: ${error.message}`);
    }

    // Check DB Manager connection
    const checkDbManagerConnection = async () => {
      const tryUrl = async (url) => {
        const result = await checkWithRetry('DB Manager', url);
        services.db_manager.url = url;
        services.db_manager.connected = true;
        services.db_manager.fallbackUsed = url !== services.db_manager.primaryUrl;
        return result;
      };

      try {
        // Skip local connection if USE_REMOTE_DB is set to true
        if (process.env.USE_REMOTE_DB === 'true') {
          console.log('🔄 USE_REMOTE_DB is true, skipping local DB Manager connection');
          const dbManagerResult = await tryUrl(services.db_manager.fallbackUrl);
          console.log('✅ Connected to DB Manager via remote URL');
          logger.info(`✅ DB Manager connected via remote URL ${services.db_manager.fallbackUrl}`);
          return dbManagerResult;
        } else {
          const dbManagerResult = await tryUrl(services.db_manager.primaryUrl);
          console.log('✅ Connected to DB Manager on local port ' + process.env.DB_MANAGER_PORT);
          return dbManagerResult;
        }
      } catch (localError) {
        if (process.env.USE_REMOTE_DB !== 'true') {
          console.warn('⚠️ Local DB Manager failed on port ' + process.env.DB_MANAGER_PORT + ', falling back to remote DB Manager URL:', services.db_manager.fallbackUrl);
          logger.warn(`⚠️ Local DB Manager connection failed, switching to fallback URL ${services.db_manager.fallbackUrl}`);

          try {
            const dbManagerResult = await tryUrl(services.db_manager.fallbackUrl);
            console.log('✅ Connected to DB Manager via remote fallback');
            logger.info(`✅ DB Manager connected via remote fallback URL ${services.db_manager.fallbackUrl}`);
            return dbManagerResult;
          } catch (remoteError) {
            throw remoteError;
          }
        } else {
          throw localError;
        }
      }
    };

    try {
      const dbManagerResult = await checkDbManagerConnection();
      console.log('   📊 DB Manager Status:', dbManagerResult.data.status);
      console.log('   🗄️  Database Status:', dbManagerResult.data.databases?.sqlite?.status || 'Unknown');
      logger.info(`✅ DB Manager is connected using URL ${services.db_manager.url}`);
    } catch (error) {
      services.db_manager.connected = false;
      console.log('❌ Failed to connect to DB Manager:', error.message);
      logger.warn(`❌ DB Manager connection error: ${error.message}`);
    }
    
    // Enhanced connection summary
    const connectionStatus = {
      bigserver: services.bigserver.connected ? 'connected' : 'disconnected',
      db_manager: services.db_manager.connected ? 'connected' : 'disconnected',
      overall: (services.bigserver.connected && services.db_manager.connected) ? 'healthy' : 'degraded'
    };
    
    console.log('📊 Connection Status Summary:', connectionStatus);
    
  } catch (error) {
    console.error('Error checking service connections:', error.message);
    logger.error('Error checking service connections:', error.message);
  }
};

// Initialize Socket.IO connection to DB Manager
const initializeSocketConnection = () => {
  if (dbManagerSocket) {
    dbManagerSocket.disconnect();
  }

  console.log('🔌 Connecting to DB Manager via Socket.IO...');
  logger.info('🔌 Connecting to DB Manager via Socket.IO...');

  dbManagerSocket = ioClient(services.db_manager.url, {
    transports: ['websocket', 'polling'],
    timeout: 5000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });

  dbManagerSocket.on('connect', () => {
    console.log('✅ Connected to DB Manager via Socket.IO');
    logger.info('✅ Connected to DB Manager via Socket.IO');
    socketConnected = true;

    // Identify as stage2
    dbManagerSocket.emit('stage2-connect', {
      stage: 'stage2',
      timestamp: new Date().toISOString(),
      port: process.env.PORT
    });
  });

  dbManagerSocket.on('db-manager-connected', (data) => {
    console.log('🎯 DB Manager acknowledged connection:', data);
    logger.info('🎯 DB Manager acknowledged connection:', data);
  });

  dbManagerSocket.on('game-data-update', (data) => {
    console.log('📊 Real-time game data update received:', data);
    logger.info('📊 Real-time game data update received:', data);
    // Handle real-time game data updates
    // This can be used to cache data or notify connected clients
  });

  dbManagerSocket.on('bet-update', (data) => {
    console.log('🎯 Real-time bet update received:', data);
    logger.info('🎯 Real-time bet update received:', data);
    // Handle real-time bet notifications
  });

  dbManagerSocket.on('db-status-update', (data) => {
    console.log('🗄️ Real-time DB status update:', data);
    logger.info('🗄️ Real-time DB status update:', data);
  });

  dbManagerSocket.on('connect_error', (error) => {
    console.log('❌ Socket.IO connection error:', error.message);
    logger.warn('❌ Socket.IO connection error:', error.message);
    socketConnected = false;

    if (!services.db_manager.fallbackUsed && services.db_manager.url === services.db_manager.primaryUrl) {
      console.log('⚠️ Socket connection to local DB Manager failed, switching to remote fallback...');
      services.db_manager.url = services.db_manager.fallbackUrl;
      services.db_manager.fallbackUsed = true;
      dbManagerSocket.disconnect();
      initializeSocketConnection();
    }
  });

  dbManagerSocket.on('disconnect', (reason) => {
    console.log('🔌 Disconnected from DB Manager:', reason);
    logger.info('🔌 Disconnected from DB Manager:', reason);
    socketConnected = false;
  });

  dbManagerSocket.on('reconnect', (attemptNumber) => {
    console.log(`🔄 Reconnected to DB Manager after ${attemptNumber} attempts`);
    logger.info(`🔄 Reconnected to DB Manager after ${attemptNumber} attempts`);
    socketConnected = true;
  });
};

// Request real-time game data
const requestRealtimeGameData = async (stage = 'a') => {
  if (dbManagerSocket && socketConnected) {
    console.log(`📊 Requesting real-time game data for Stage ${stage.toUpperCase()}`);
    logger.info(`📊 Requesting real-time game data for Stage ${stage.toUpperCase()}`);
    dbManagerSocket.emit('request-game-data', { stage });
    return;
  }

  if (services.db_manager.connected) {
    try {
      console.log('⚠️ Socket not connected, falling back to HTTP request for real-time game data');
      logger.warn('⚠️ Socket not connected, falling back to HTTP request for real-time game data');

      const response = await axios.get(`${services.db_manager.url}/api/v1/stage-${stage}/last-game-id`, {
        timeout: 10000
      });

      if (response.data && response.data.success) {
        console.log(`✅ HTTP fallback game data received for Stage ${stage.toUpperCase()}`);
        logger.info(`✅ HTTP fallback game data received for Stage ${stage.toUpperCase()}`, response.data.data);
        io.emit('game-data-update', {
          stage: stage.toUpperCase(),
          data: response.data.data,
          timestamp: new Date().toISOString(),
          source: 'db_manager_http_fallback'
        });
      } else {
        console.warn('⚠️ HTTP fallback request returned invalid data');
      }
    } catch (error) {
      console.error('❌ HTTP fallback failed for real-time game data:', error.message);
      logger.error('❌ HTTP fallback failed for real-time game data:', error.message);
    }
    return;
  }

  console.log('⚠️ No DB Manager connection available for real-time game data');
  logger.warn('⚠️ No DB Manager connection available for real-time game data');
};

// Send bet placement notification
const notifyBetPlaced = (betData) => {
  if (dbManagerSocket && socketConnected) {
    console.log('🎯 Sending bet placement notification via Socket.IO');
    logger.info('🎯 Sending bet placement notification via Socket.IO');
    dbManagerSocket.emit('bet-placed', betData);
  } else {
    console.log('⚠️ Socket not connected, bet notification not sent');
    logger.warn('⚠️ Socket not connected, bet notification not sent');
  }
};

// Process bet function for WebSocket requests
const processBet = async (betData) => {
  const { boardNumber, playerId, amount, stage } = betData;

  console.log(`🎯 Stage2 WebSocket: Processing bet - Board: ${boardNumber}, Player: ${playerId}, Amount: ${amount}, Stage: ${stage}`);
  logger.info(`🎯 Stage2 WebSocket: Processing bet - Board: ${boardNumber}, Player: ${playerId}, Amount: ${amount}, Stage: ${stage}`);

  // Validate input
  if (!boardNumber || !playerId || !amount || !stage) {
    throw new Error('Missing required fields: boardNumber, playerId, amount, stage');
  }

  // Validate board number range
  if (boardNumber < 1 || boardNumber > 400) {
    throw new Error('Board number must be between 1 and 400');
  }

  // Step 1: Check player balance with BigServer
  console.log(`💰 Stage2 WebSocket: Checking balance for player ${playerId}...`);
  let balanceResponse;
  try {
    balanceResponse = await axios.get(`${services.bigserver.url}/api/v1/player/balance/${playerId}`, {
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${process.env.BIGSERVER_API_KEY}`,
        'X-API-Key': process.env.BIGSERVER_API_KEY
      }
    });
  } catch (balanceError) {
    console.error('❌ Stage2 WebSocket: Error checking balance:', balanceError.message);
    logger.error('❌ Stage2 WebSocket: Error checking balance:', balanceError.message);
    throw new Error('Failed to check player balance');
  }

  if (!balanceResponse.data || !balanceResponse.data.success) {
    throw new Error('Unable to verify player balance');
  }

  const playerBalance = balanceResponse.data.balance;
  console.log(`💰 Stage2 WebSocket: Player balance: ${playerBalance}, Bet amount: ${amount}`);

  // Step 2: Validate sufficient balance
  if (playerBalance < amount) {
    throw new Error('Insufficient balance');
  }

  // Step 3: Deduct balance from BigServer
  console.log(`💸 Stage2 WebSocket: Deducting ${amount} from player ${playerId}...`);
  try {
    await axios.post(`${services.bigserver.url}/api/v1/player/deduct`, {
      playerId: playerId,
      amount: amount
    }, {
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${process.env.BIGSERVER_API_KEY}`,
        'X-API-Key': process.env.BIGSERVER_API_KEY,
        'Content-Type': 'application/json'
      }
    });
  } catch (deductError) {
    console.error('❌ Stage2 WebSocket: Error deducting balance:', deductError.message);
    logger.error('❌ Stage2 WebSocket: Error deducting balance:', deductError.message);
    throw new Error('Failed to deduct balance');
  }

  // Step 4: Update game in DB Manager
  console.log(`🗄️ Stage2 WebSocket: Updating game ${stage} with new bet...`);
  try {
    const updateResponse = await axios.put(`${services.db_manager.url}/api/v1/stage-${stage.toLowerCase()}/update-game`, {
      newPlayerId: playerId,
      newBoardNumber: boardNumber,
      amount: amount
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!updateResponse.data || !updateResponse.data.success) {
      const error = updateResponse.data?.error || 'Failed to update game';

      // Check if this is a 2-board limit error
      if (error.includes('maximum limit of 2 boards')) {
        throw new Error(`Board limit reached: ${error}`);
      }

      throw new Error(error);
    }

    const updatedGame = updateResponse.data.data;
    console.log(`✅ Stage2 WebSocket: Game updated successfully - Game ID: ${updatedGame.gameId}, New Players: ${updatedGame.totalPlayers}`);
    logger.info(`✅ Stage2 WebSocket: Game updated successfully - Game ID: ${updatedGame.gameId}, New Players: ${updatedGame.totalPlayers}`);

    return {
      betId: `${updatedGame.gameId}-${playerId}-${boardNumber}`,
      gameId: updatedGame.gameId,
      boardNumber: boardNumber,
      playerId: playerId,
      amount: amount,
      newBalance: playerBalance - amount,
      updatedGame: updatedGame,
      timestamp: new Date().toISOString()
    };

  } catch (updateError) {
    console.error('❌ Stage2 WebSocket: Error updating game:', updateError.message);
    logger.error('❌ Stage2 WebSocket: Error updating game:', updateError.message);
    throw new Error(`Failed to update game: ${updateError.message}`);
  }
};

// Enhanced health check with detailed information
const performHealthCheck = async () => {
  const health = {
    status: 'healthy',
    stage: 'Stage 2',
    port: process.env.PORT,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    connections: {
      bigserver: {
        connected: services.bigserver.connected,
        port: process.env.BIGSERVER_PORT,
        url: services.bigserver.url,
        lastChecked: new Date().toISOString()
      },
      db_manager: {
        connected: services.db_manager.connected,
        port: process.env.DB_MANAGER_PORT,
        url: services.db_manager.url,
        lastChecked: new Date().toISOString(),
        realtime: {
          socketConnected: socketConnected,
          socketId: dbManagerSocket ? dbManagerSocket.id : null
        }
      }
    },
    businessLogic: {
      stagesSupported: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
      amountRanges: {
        low: { stages: ['A', 'B'], amount: 10 },
        medium: { stages: ['C', 'D'], amount: 20 },
        high: { stages: ['E', 'F'], amount: 30 },
        premium: { stages: ['G', 'H'], amount: 50 },
        elite: { stages: ['I', 'J'], amount: 100 },
        ultimate: { stages: ['K', 'L'], amount: 200 }
      }
    },
    endpoints: {
      getLastGameId: `/api/v1/game/last-id?stage=<stage>`,
      getAllLastGameIds: `/api/v1/game/last-id/all`,
      createGame: `/api/v1/game/create`,
      getStageStatus: `/api/v1/game/status/<stage>`
    },
    features: {
      compression: true,
      rateLimiting: true,
      winstonLogging: true,
      enhancedErrorHandling: true
    }
  };
  
  // Determine overall health
  if (!services.bigserver.connected && !services.db_manager.connected) {
    health.status = 'unhealthy';
  } else if (!services.bigserver.connected || !services.db_manager.connected) {
    health.status = 'degraded';
  }
  
  return health;
};

// Socket.IO server event handlers for Big Server connections
io.on('connection', (socket) => {
  console.log('🔗 Big Server connected via WebSocket:', socket.id);
  logger.info('🔗 Big Server connected via WebSocket:', socket.id);

  socket.on('bet-request', async (data) => {
    console.log('🎯 Received bet request from Big Server:', data);
    logger.info('🎯 Received bet request from Big Server:', data);

    try {
      // Process the bet through existing logic
      const betResult = await processBet(data);

      // Send response back to Big Server
      socket.emit('bet-response', {
        success: true,
        betId: betResult.betId,
        result: betResult,
        timestamp: new Date().toISOString()
      });

      // Notify DB Manager of the bet
      notifyBetPlaced({
        ...data,
        stage: 'stage2',
        processedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Error processing bet:', error);
      logger.error('❌ Error processing bet:', error);
      socket.emit('bet-response', {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('game-status-request', (data) => {
    console.log('📊 Game status request from Big Server:', data);
    logger.info('📊 Game status request from Big Server:', data);
    // Send current game status
    socket.emit('game-status-response', {
      stage: 'stage2',
      status: 'active',
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    console.log('🔌 Big Server disconnected from WebSocket');
    logger.info('🔌 Big Server disconnected from WebSocket');
  });
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 1000
});
app.use(limiter);

app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
const apiPrefix = '/api/v1';
app.use(`${apiPrefix}/games`, require('./routes/gameRoutes'));
app.use(`${apiPrefix}/cards`, require('./routes/cardRoutes'));

// Enhanced DB Manager Integration Routes
app.get(`${apiPrefix}/game/last-id`, async (req, res) => {
  try {
    const { stage = 'c' } = req.query; // Default to stage C for Stage2
    console.log(`🔍 Stage2: Requesting last game ID from DB Manager for Stage ${stage.toUpperCase()}...`);
    
    // Request last game ID from DB Manager for specific stage
    const response = await axios.get(`${services.db_manager.url}/api/v1/stage-${stage}/last-game-id`, { 
      timeout: 10000 
    });
    
    if (response.data && response.data.success) {
      const gameData = response.data.data;
      console.log(`✅ Stage2: Received last game ID from DB Manager for Stage ${stage.toUpperCase()}:`, gameData);
      
      // Enhanced response with business logic validation
      res.json({
        success: true,
        data: {
          ...gameData,
          stage: stage.toUpperCase(),
          businessLogic: {
            amount: getStageAmount(stage.toUpperCase()),
            calculatedPayout: gameData.payout,
            playerCount: gameData.numberOfPlayerIds,
            totalBet: (gameData.numberOfPlayerIds * getStageAmount(stage.toUpperCase())),
            ownerCommission: (gameData.numberOfPlayerIds * getStageAmount(stage.toUpperCase())) * 0.2
          }
        },
        source: 'db_manager',
        stage: 'stage2',
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Invalid response from DB Manager');
    }
    
  } catch (error) {
    console.error('❌ Stage2: Error getting last game ID from DB Manager:', error.message);
    logger.error('Stage2: Error getting last game ID from DB Manager:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get last game ID from DB Manager',
      details: error.message,
      stage: 'stage2'
    });
  }
});

// Get last game ID for all stages
app.get(`${apiPrefix}/game/last-id/all`, async (req, res) => {
  try {
    console.log('🔍 Stage2: Requesting last game IDs from ALL stages...');
    
    const stages = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    const results = {};
    
    for (const stage of stages) {
      try {
        const response = await axios.get(`${services.db_manager.url}/api/v1/stage-${stage}/last-game-id`, { 
          timeout: 5000 
        });
        
        if (response.data && response.data.success) {
          results[stage.toUpperCase()] = {
            ...response.data.data,
            businessLogic: {
              amount: getStageAmount(stage.toUpperCase()),
              totalBet: response.data.data.numberOfPlayerIds * getStageAmount(stage.toUpperCase()),
              payoutPercentage: 80,
              ownerPercentage: 20
            }
          };
        }
      } catch (error) {
        console.warn(`⚠️  Stage2: Failed to get data for Stage ${stage.toUpperCase()}:`, error.message);
        results[stage.toUpperCase()] = {
          error: error.message,
          available: false
        };
      }
    }
    
    const summary = {
      totalStages: stages.length,
      availableStages: Object.values(results).filter(r => !r.error).length,
      totalPayouts: Object.values(results)
        .filter(r => !r.error && r.payout)
        .reduce((sum, r) => sum + r.payout, 0)
    };
    
    console.log('✅ Stage2: Retrieved game IDs from all stages:', summary);
    
    res.json({
      success: true,
      data: results,
      summary,
      source: 'db_manager',
      stage: 'stage2',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Stage2: Error getting last game IDs from all stages:', error.message);
    logger.error('Stage2: Error getting last game IDs from all stages:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get last game IDs from all stages',
      details: error.message,
      stage: 'stage2'
    });
  }
});

// Create new game record for any stage
app.post(`${apiPrefix}/game/create`, async (req, res) => {
  try {
    const { stage, gameId, playerId, selectedBoard } = req.body;
    
    if (!stage || !gameId || !playerId || !selectedBoard) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: stage, gameId, playerId, selectedBoard'
      });
    }
    
    if (!['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].includes(stage.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid stage. Must be one of: A, B, C, D, E, F, G, H, I, J, K, L'
      });
    }
    
    console.log(`🎮 Stage2: Creating new game record for Stage ${stage.toUpperCase()}...`);
    
    const gameData = {
      gameId,
      playerId,
      selectedBoard,
      status: 'active',
      stage: stage.toUpperCase()
    };
    
    const response = await axios.post(`${services.db_manager.url}/api/v1/stage-${stage}/create`, gameData, { 
      timeout: 10000 
    });
    
    if (response.data && response.data.success) {
      console.log(`✅ Stage2: Created game record for Stage ${stage.toUpperCase()}:`, response.data.data);
      
      res.json({
        success: true,
        data: response.data.data,
        message: `Game record created successfully for Stage ${stage.toUpperCase()}`,
        source: 'db_manager',
        stage: 'stage2'
      });
    } else {
      throw new Error('Invalid response from DB Manager');
    }
    
  } catch (error) {
    console.error('❌ Stage2: Error creating game record:', error.message);
    logger.error('Stage2: Error creating game record:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create game record',
      details: error.message,
      stage: 'stage2'
    });
  }
});

// Get stage status
app.get(`${apiPrefix}/game/status/:stage`, async (req, res) => {
  try {
    const { stage } = req.params;
    
    if (!['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].includes(stage.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid stage. Must be one of: A, B, C, D, E, F, G, H, I, J, K, L'
      });
    }
    
    console.log(`📊 Stage2: Getting status for Stage ${stage.toUpperCase()}...`);
    
    const response = await axios.get(`${services.db_manager.url}/api/v1/stage-${stage}/status`, { 
      timeout: 5000 
    });
    
    if (response.data && response.data.success) {
      console.log(`✅ Stage2: Got status for Stage ${stage.toUpperCase()}:`, response.data.data);
      
      res.json({
        success: true,
        data: response.data.data,
        source: 'db_manager',
        stage: 'stage2'
      });
    } else {
      throw new Error('Invalid response from DB Manager');
    }
    
  } catch (error) {
    console.error(`❌ Stage2: Error getting status for stage ${req.params.stage}:`, error.message);
    logger.error(`Stage2: Error getting status for stage ${req.params.stage}:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get stage status',
      details: error.message,
      stage: 'stage2'
    });
  }
});

// Get latest game data with highest game ID and parsed selectedBoard
app.get(`${apiPrefix}/game/latest-data`, async (req, res) => {
  try {
    const { stage = 'e' } = req.query; // Default to stage E for Stage2
    console.log(`🔍 Stage2: Requesting latest game data from DB Manager for Stage ${stage.toUpperCase()}...`);

    // Request highest game ID record from DB Manager for specific stage
    const response = await axios.get(`${services.db_manager.url}/api/v1/stage-${stage}/last-game-id`, {
      timeout: 10000
    });

    if (response.data && response.data.success && response.data.data) {
      const gameData = response.data.data;
      console.log(`✅ Stage2: Found existing game data for Stage ${stage.toUpperCase()}:`, gameData);

      // Parse selectedBoard format: "+251909090909:2,+251909090910:4"
      const parsedData = parseSelectedBoard(gameData.selectedBoard || '');

      // Format response for frontend
      const formattedResponse = {
        gameId: gameData.gameId || '',
        payout: gameData.payout || 0,
        players: parsedData.playerIds,
        boards: parsedData.boards,
        totalPlayers: parsedData.totalPlayers,
        stage: stage.toUpperCase(),
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Stage2: Returning existing game data for frontend:`, formattedResponse);

      res.json({
        success: true,
        data: formattedResponse,
        source: 'db_manager',
        stage: 'stage2',
        timestamp: new Date().toISOString()
      });
    } else {
      // No existing data found, create a new game
      console.log(`📝 Stage2: No existing data found for Stage ${stage.toUpperCase()}, creating new game...`);

      const newGameData = await createNewGameForStage(stage.toLowerCase());
      console.log(`✅ Stage2: Created new game for Stage ${stage.toUpperCase()}:`, newGameData);

      res.json({
        success: true,
        data: newGameData,
        source: 'newly_created',
        stage: 'stage2',
        message: `New game created for Stage ${stage.toUpperCase()}`,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ Stage2: Error getting latest game data from DB Manager:', error.message);
    logger.error('Stage2: Error getting latest game data from DB Manager:', error.message);

    // Try to create a new game even if DB Manager fails
    try {
      const { stage = 'e' } = req.query;
      console.log(`🔄 Stage2: DB Manager failed, attempting to create new game for Stage ${stage.toUpperCase()}...`);

      const newGameData = await createNewGameForStage(stage.toLowerCase());
      console.log(`✅ Stage2: Created fallback game for Stage ${stage.toUpperCase()}:`, newGameData);

      res.json({
        success: true,
        data: newGameData,
        source: 'fallback_created',
        stage: 'stage2',
        warning: 'DB Manager unavailable, created new game',
        timestamp: new Date().toISOString()
      });
    } catch (createError) {
      console.error('❌ Stage2: Failed to create fallback game:', createError.message);

      // Last resort fallback
      const fallbackData = {
        gameId: 'G' + Date.now().toString().slice(-5),
        payout: 0,
        players: '',
        boards: '',
        totalPlayers: 0,
        stage: stage.toUpperCase(),
        timestamp: new Date().toISOString()
      };

      res.json({
        success: true,
        data: fallbackData,
        source: 'emergency_fallback',
        stage: 'stage2',
        warning: 'All systems failed, using emergency fallback',
        timestamp: new Date().toISOString()
      });
    }
  }
});

// Helper function to create a new game when no data exists
async function createNewGameForStage(stage) {
  try {
    // Generate a new game ID based on current timestamp
    const timestamp = Date.now();
    const gameId = (timestamp % 100000).toString().padStart(5, '0');

    console.log(`🎮 Stage2: No existing game data found for Stage ${stage.toUpperCase()}`);

    // Return empty game state - no sample data
    return {
      gameId: gameId,
      payout: 0,
      players: '',
      boards: '',
      totalPlayers: 0,
      stage: stage.toUpperCase(),
      timestamp: new Date().toISOString(),
      message: 'No active game found. Please place bets to start a new game.'
    };

  } catch (error) {
    console.error(`❌ Stage2: Error creating empty game response for stage ${stage}:`, error.message);
    throw error;
  }
}


// Helper function to parse selectedBoard format
function parseSelectedBoard(selectedBoard) {
  try {
    if (!selectedBoard || typeof selectedBoard !== 'string') {
      return {
        playerIds: '',
        boards: '',
        totalPlayers: 0
      };
    }

    const pairs = selectedBoard.split(',');
    const playerIds = [];
    const boards = [];

    pairs.forEach(pair => {
      const [playerId, board] = pair.split(':');
      if (playerId && board) {
        playerIds.push(playerId.trim());
        boards.push(board.trim());
      }
    });

    return {
      playerIds: playerIds.join(','),
      boards: boards.join(','),
      totalPlayers: playerIds.length
    };

  } catch (error) {
    console.error('Error parsing selectedBoard:', error);
    return {
      playerIds: '',
      boards: '',
      totalPlayers: 0
    };
  }
}

// Helper function to get stage amount
function getStageAmount(stage) {
  const amounts = {
    'A': 10, 'B': 10,
    'C': 20, 'D': 20,
    'E': 30, 'F': 30,
    'G': 50, 'H': 50,
    'I': 100, 'J': 100,
    'K': 200, 'L': 200
  };
  return amounts[stage] || 10;
}

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Stage 2 Backend API is running!',
    stage: 'Stage 2',
    port: process.env.PORT,
    status: 'active',
    timestamp: new Date().toISOString()
  });
});

// Place bet endpoint
app.post('/api/v1/game/place-bet', async (req, res) => {
  try {
    const { boardNumber, playerId, amount, stage } = req.body;
    
    console.log(`🎯 Stage2: Received bet request - Board: ${boardNumber}, Player: ${playerId}, Amount: ${amount}, Stage: ${stage}`);
    
    // Validate input
    if (!boardNumber || !playerId || !amount || !stage) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: boardNumber, playerId, amount, stage'
      });
    }
    
    // Validate board number range
    if (boardNumber < 1 || boardNumber > 400) {
      return res.status(400).json({
        success: false,
        error: 'Board number must be between 1 and 400'
      });
    }
    
    // Step 1: Check player balance with BigServer
    console.log(`💰 Stage2: Checking balance for player ${playerId}...`);
    let balanceResponse;
    try {
      balanceResponse = await axios.get(`${BIGSERVER_URL}/api/v1/player/balance/${playerId}`, {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${process.env.BIGSERVER_API_KEY}`,
          'X-API-Key': process.env.BIGSERVER_API_KEY
        }
      });
    } catch (balanceError) {
      console.error('❌ Stage2: Error checking balance:', balanceError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to check player balance'
      });
    }
    
    if (!balanceResponse.data || !balanceResponse.data.success) {
      return res.status(400).json({
        success: false,
        error: 'Unable to verify player balance'
      });
    }
    
    const playerBalance = balanceResponse.data.balance;
    console.log(`💰 Stage2: Player balance: ${playerBalance}, Bet amount: ${amount}`);
    
    // Step 2: Validate sufficient balance
    if (playerBalance < amount) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance'
      });
    }
    
    // Step 3: Deduct balance from BigServer
    console.log(`💸 Stage2: Deducting ${amount} from player ${playerId}...`);
    try {
      await axios.post(`${BIGSERVER_URL}/api/v1/player/deduct`, {
        playerId: playerId,
        amount: amount
      }, {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${process.env.BIGSERVER_API_KEY}`,
          'X-API-Key': process.env.BIGSERVER_API_KEY,
          'Content-Type': 'application/json'
        }
      });
    } catch (deductError) {
      console.error('❌ Stage2: Error deducting balance:', deductError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to deduct balance'
      });
    }
    
    // Step 4: Update game in DB Manager
    console.log(`🗄️ Stage2: Updating game ${stage} with new bet...`);
    try {
const updateResponse = await axios.put(`${services.db_manager.url}/api/v1/stage-${stage.toLowerCase()}/update-game`, {
        newPlayerId: playerId,
        newBoardNumber: boardNumber,
        amount: amount
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!updateResponse.data || !updateResponse.data.success) {
        throw new Error(updateResponse.data?.error || 'Failed to update game');
      }
      
      const updatedGame = updateResponse.data.data;
      console.log(`✅ Stage2: Game updated successfully - Game ID: ${updatedGame.gameId}, New Players: ${updatedGame.totalPlayers}`);
      
      // Step 5: Return success response
      res.json({
        success: true,
        data: {
          gameId: updatedGame.gameId,
          boardNumber: boardNumber,
          playerId: playerId,
          amount: amount,
          newBalance: playerBalance - amount,
          updatedGame: updatedGame,
          timestamp: new Date().toISOString()
        },
        message: 'Bet placed successfully'
      });
      
      // Step 6: Send real-time notification via Socket.IO
      notifyBetPlaced({
        stage: stage.toUpperCase(),
        gameId: updatedGame.gameId,
        boardNumber: boardNumber,
        playerId: playerId,
        amount: amount,
        totalPlayers: updatedGame.totalPlayers,
        payout: updatedGame.payout,
        timestamp: new Date().toISOString()
      });
      
    } catch (updateError) {
      console.error('❌ Stage2: Error updating game:', updateError.message);
      
      // Rollback: Restore balance if game update failed
      try {
        await axios.post(`${BIGSERVER_URL}/api/v1/player/add`, {
          playerId: playerId,
          amount: amount
        }, {
          timeout: 10000,
          headers: {
            'Authorization': `Bearer ${process.env.BIGSERVER_API_KEY}`,
            'X-API-Key': process.env.BIGSERVER_API_KEY,
            'Content-Type': 'application/json'
          }
        });
        console.log(`💰 Stage2: Balance restored for player ${playerId}`);
      } catch (rollbackError) {
        console.error('❌ Stage2: Failed to restore balance:', rollbackError.message);
      }
      
      return res.status(500).json({
        success: false,
        error: 'Failed to place bet - balance has been restored'
      });
    }
    
  } catch (error) {
    console.error('❌ Stage2: Error placing bet:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = await performHealthCheck();
    res.json(health);
  } catch (error) {
    console.error('Health check error:', error.message);
    logger.error('Health check error:', error.message);
    res.status(500).json({
      status: 'error',
      error: 'Health check failed',
      details: error.message
    });
  }
});

// Enhanced services status endpoint
app.get('/services', async (req, res) => {
  try {
    await checkServiceConnections();
    
    res.json({
      stage: 'Stage 2',
      timestamp: new Date().toISOString(),
      services: {
        bigserver: {
          url: services.bigserver.url,
          connected: services.bigserver.connected,
          port: process.env.BIGSERVER_PORT,
          authenticated: !!process.env.BIGSERVER_API_KEY,
          status: services.bigserver.connected ? 'operational' : 'offline'
        },
        db_manager: {
          url: services.db_manager.url,
          connected: services.db_manager.connected,
          port: process.env.DB_MANAGER_PORT,
          status: services.db_manager.connected ? 'operational' : 'offline'
        }
      },
      overall: (services.bigserver.connected && services.db_manager.connected) ? 'all_systems_go' : 'degraded_operation'
    });
  } catch (error) {
    console.error('Services status error:', error.message);
    logger.error('Services status error:', error.message);
    res.status(500).json({
      error: 'Failed to get services status',
      details: error.message
    });
  }
});

// Real-time connection test endpoint
app.get('/api/v1/realtime/status', (req, res) => {
  res.json({
    success: true,
    realtime: {
      socketConnected: socketConnected,
      socketId: dbManagerSocket ? dbManagerSocket.id : null,
      dbManagerUrl: services.db_manager.url
    },
    timestamp: new Date().toISOString()
  });
});

// Request real-time game data endpoint
app.get('/api/v1/realtime/game-data/:stage?', (req, res) => {
  const stage = req.params.stage || 'e'; // Stage 2 defaults to stage E
  
  if (!socketConnected) {
    return res.status(503).json({
      success: false,
      error: 'Real-time connection not available'
    });
  }
  
  requestRealtimeGameData(stage);
  
  res.json({
    success: true,
    message: `Requested real-time game data for Stage ${stage.toUpperCase()}`,
    timestamp: new Date().toISOString()
  });
});

// Room countdown endpoint
app.get('/api/v1/room-countdown', (req, res) => {
  try {
    const room = req.query.room;
    
    if (!room || (room !== '1' && room !== '2')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid room parameter. Must be 1 or 2'
      });
    }

    const countdownData = getRoomCountdown(room);
    
    res.json({
      success: true,
      data: {
        room: parseInt(room),
        countdown: countdownData.seconds,
        active: countdownData.active
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching room countdown:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3002;

// Display service connection status on startup
const displayServiceStatus = async () => {
  console.log('\n🔍 Checking Service Connections...');
  console.log('─'.repeat(60));
  
  const results = await checkServiceConnections();
  
  console.log('\n📊 Service Status Summary:');
  console.log('─'.repeat(60));
  
  let connectedCount = 0;
  let totalCount = Object.keys(services).length;
  
  for (const [key, service] of Object.entries(services)) {
    const port = getPortFromUrl(service.url);
    const status = service.connected ? '✅ CONNECTED' : '❌ DISCONNECTED';
    const statusColor = service.connected ? '\x1b[32m' : '\x1b[31m'; // Green for connected, Red for disconnected
    const reset = '\x1b[0m';
    
    console.log(`${service.name.padEnd(12)} | Port ${port.padEnd(6)} | ${statusColor}${status}${reset}`);
    
    if (service.connected) {
      connectedCount++;
    }
  }
  
  console.log('─'.repeat(60));
  console.log(`� Connection Status: ${connectedCount}/${totalCount} services connected`);
  console.log('─'.repeat(60));
  console.log(`🌐 Stage 2 is running on port ${PORT}`);
  console.log(`📋 Health Check: http://localhost:${PORT}/health`);
  console.log(`🔗 Services API: http://localhost:${PORT}/services`);
  console.log(`⏰ Auto-check: Every 10 seconds`);
  console.log('─'.repeat(60));
  
  if (connectedCount === 0) {
    console.log('\n⚠️  No services are currently running.');
    console.log('💡 Start Big Server and DB Manager to see them connect automatically.');
  } else if (connectedCount < totalCount) {
    console.log(`\n🔄 Waiting for ${totalCount - connectedCount} more services to start...`);
  } else {
    console.log('\n🎉 All services are connected and running!');
  }
  console.log('');
};

// Start server and check connections
server.listen(PORT, async () => {
  logger.info(`🚀 Stage 2 Backend API is running on port ${PORT}`);
  logger.info(`📋 Health Check: http://localhost:${PORT}/health`);
  logger.info(`🔗 Services Status: http://localhost:${PORT}/services`);
  
  // Display initial service status
  await displayServiceStatus();
  
  // Initialize Socket.IO connection to DB Manager
  initializeSocketConnection();
  
  // Check services every 10 seconds for better real-time updates
  setInterval(async () => {
    console.log('\n🔄 Checking service connections...');
    await checkServiceConnections();
  }, 10000);
  
  // Request initial game data every 10 seconds
  setInterval(() => {
    requestRealtimeGameData('e'); // Stage 2 defaults to stage E
  }, 10000);

  // Decrement countdowns every second
  setInterval(() => {
    decrementCountdowns();
  }, 1000);
});

module.exports = app;
