const express = require('express');
const router = express.Router();

// Mock game data for Stage 2 (Card Generation)
let games = [
  {
    id: 1,
    name: 'Bingo Game 1',
    stage: 'Stage 2',
    status: 'card_generation',
    players: [
      {
        id: 'player1',
        name: 'John Doe',
        cards: [
          {
            id: 'card1',
            numbers: [1, 15, 30, 45, 60, 2, 16, 31, 46, 61, 3, 17, 32, 47, 62, 4, 18, 33, 48, 63, 5, 19, 34, 49, 64],
            generatedAt: new Date().toISOString()
          }
        ]
      }
    ],
    cardTemplates: ['standard', 'pattern1', 'pattern2'],
    createdAt: new Date().toISOString()
  }
];

// GET /api/games - Get all games
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: games,
    count: games.length,
    stage: 'Stage 2 - Card Generation'
  });
});

// GET /api/games/:id - Get specific game
router.get('/:id', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  res.json({
    success: true,
    data: game
  });
});

// POST /api/games/:id/generate-cards - Generate bingo cards for players
router.post('/:id/generate-cards', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  const { playerId, cardType = 'standard' } = req.body;
  
  if (!playerId) {
    return res.status(400).json({
      success: false,
      error: 'Player ID is required'
    });
  }
  
  const player = game.players.find(p => p.id === playerId);
  if (!player) {
    return res.status(404).json({
      success: false,
      error: 'Player not found in game'
    });
  }
  
  // Generate random bingo card
  const generateBingoCard = () => {
    const card = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        if (i === 2 && j === 2) {
          continue; // Free space
        }
        let min, max;
        switch (j) {
          case 0: min = 1; max = 15; break;   // B
          case 1: min = 16; max = 30; break;  // I
          case 2: min = 31; max = 45; break;  // N
          case 3: min = 46; max = 60; break;  // G
          case 4: min = 61; max = 75; break;  // O
        }
        card.push(Math.floor(Math.random() * (max - min + 1)) + min);
      }
    }
    return card;
  };
  
  const newCard = {
    id: `card_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    numbers: generateBingoCard(),
    type: cardType,
    generatedAt: new Date().toISOString()
  };
  
  player.cards.push(newCard);
  
  res.json({
    success: true,
    data: newCard,
    message: 'Bingo card generated successfully'
  });
});

// GET /api/games/:id/players/:playerId/cards - Get player's cards
router.get('/:id/players/:playerId/cards', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  const player = game.players.find(p => p.id === req.params.playerId);
  if (!player) {
    return res.status(404).json({
      success: false,
      error: 'Player not found in game'
    });
  }
  
  res.json({
    success: true,
    data: player.cards,
    count: player.cards.length
  });
});

// DELETE /api/games/:id/players/:playerId/cards/:cardId - Delete a specific card
router.delete('/:id/players/:playerId/cards/:cardId', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  const player = game.players.find(p => p.id === req.params.playerId);
  if (!player) {
    return res.status(404).json({
      success: false,
      error: 'Player not found in game'
    });
  }
  
  const cardIndex = player.cards.findIndex(c => c.id === req.params.cardId);
  if (cardIndex === -1) {
    return res.status(404).json({
      success: false,
      error: 'Card not found'
    });
  }
  
  const deletedCard = player.cards.splice(cardIndex, 1)[0];
  
  res.json({
    success: true,
    data: deletedCard,
    message: 'Card deleted successfully'
  });
});

module.exports = router;
