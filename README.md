# Stage 2 Backend

Stage 2 Backend Application for the Smart Betting System.

## Features

- REST API for game management and card operations
- Real-time communication with DB Manager via Socket.IO
- Integration with BigServer for player balance management
- Comprehensive health checks and service monitoring
- Winston logging with file and console outputs
- Rate limiting and security middleware

## Real-Time Connection

Stage 2 maintains a real-time WebSocket connection with the DB Manager for:

- **Live Game Data**: Real-time updates of game states and player data
- **Bet Notifications**: Instant notifications when bets are placed
- **Database Status**: Real-time monitoring of database connectivity
- **Automatic Reconnection**: Handles connection drops gracefully

### Socket.IO Events

#### Outgoing Events (Stage 2 → DB Manager)
- `stage2-connect`: Identifies Stage 2 connection
- `request-game-data`: Requests latest game data for a stage
- `bet-placed`: Notifies DB Manager of bet placements

#### Incoming Events (DB Manager → Stage 2)
- `db-manager-connected`: Acknowledges successful connection
- `game-data-update`: Provides real-time game data updates
- `bet-update`: Broadcasts bet placement notifications
- `db-status-update`: Database connectivity status updates

### API Endpoints

#### Real-Time Status
```
GET /api/v1/realtime/status
```
Returns the current status of the real-time connection.

#### Request Game Data
```
GET /api/v1/realtime/game-data/:stage?
```
Manually requests real-time game data for the specified stage (default: 'e' for Stage 2).

## Environment Variables

- `PORT`: Server port (default: 3002)
- `BIGSERVER_URL`: BigServer URL
- `BIGSERVER_PORT`: BigServer port
- `BIGSERVER_API_KEY`: API key for BigServer authentication
- `DB_MANAGER`: DB Manager URL
- `DB_MANAGER_PORT`: DB Manager port
- `LOG_LEVEL`: Winston logging level (default: 'info')

## Running the Application

```bash
npm install
npm start
```

## Testing Real-Time Connection

Run the test script to verify real-time connectivity:

```bash
node test_realtime.js
```
