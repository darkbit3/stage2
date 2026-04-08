const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
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

// Service configuration
const services = {
  bigserver: { url: process.env.BIGSERVER_URL || `http://localhost:${process.env.BIGSERVER_PORT}`, name: 'Big Server', connected: false },
  db_manager: { url: process.env.DB_MANAGER || `http://localhost:${process.env.DB_MANAGER_PORT}`, name: 'DB Manager', connected: false }
};

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
    try {
      const dbManagerResult = await checkWithRetry('DB Manager', services.db_manager.url);
      
      services.db_manager.connected = true;
      console.log('✅ Connected to DB Manager (Port ' + process.env.DB_MANAGER_PORT + ')');
      console.log('   📊 DB Manager Status:', dbManagerResult.data.status);
      console.log('   🗄️  Database Status:', dbManagerResult.data.databases?.sqlite?.status || 'Unknown');
      logger.info(`✅ DB Manager (Port ${process.env.DB_MANAGER_PORT}) is connected`);
      
    } catch (error) {
      services.db_manager.connected = false;
      console.log('❌ Failed to connect to DB Manager (Port ' + process.env.DB_MANAGER_PORT + '):', error.message);
      logger.warn(`❌ DB Manager (Port ${process.env.DB_MANAGER_PORT}) connection error: ${error.message}`);
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
        lastChecked: new Date().toISOString()
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
    
    if (response.data && response.data.success) {
      const gameData = response.data.data;
      console.log(`✅ Stage2: Received latest game data from DB Manager for Stage ${stage.toUpperCase()}:`, gameData);
      
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
      
      console.log(`✅ Stage2: Formatted latest game data for frontend:`, formattedResponse);
      
      res.json({
        success: true,
        data: formattedResponse,
        source: 'db_manager',
        stage: 'stage2',
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error('Invalid response from DB Manager');
    }
    
  } catch (error) {
    console.error('❌ Stage2: Error getting latest game data from DB Manager:', error.message);
    logger.error('Stage2: Error getting latest game data from DB Manager:', error.message);
    
    // Return fallback data if DB Manager is unavailable
    const fallbackData = {
      gameId: 'G00000',
      payout: 0,
      players: '',
      boards: '',
      totalPlayers: 0,
      stage: 'E',
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: fallbackData,
      source: 'fallback',
      stage: 'stage2',
      warning: 'DB Manager unavailable, using fallback data',
      timestamp: new Date().toISOString()
    });
  }
});

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
    
    // Split by comma to get individual player:board pairs
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
      const updateResponse = await axios.put(`${DB_MANAGER_URL}/api/v1/stage-${stage.toLowerCase()}/update-game`, {
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
app.listen(PORT, async () => {
  logger.info(`🚀 Stage 2 Backend API is running on port ${PORT}`);
  logger.info(`📋 Health Check: http://localhost:${PORT}/health`);
  logger.info(`🔗 Services Status: http://localhost:${PORT}/services`);
  
  // Display initial service status
  await displayServiceStatus();
  
  // Check services every 10 seconds for better real-time updates
  setInterval(async () => {
    console.log('\n🔄 Checking service connections...');
    await checkServiceConnections();
  }, 10000);
});

module.exports = app;
