const express = require('express');
const router = express.Router();

// Card templates and patterns
const cardTemplates = {
  standard: {
    name: 'Standard Bingo',
    description: 'Classic 5x5 bingo card with free space',
    size: { rows: 5, cols: 5 },
    freeSpace: { row: 2, col: 2 }
  },
  pattern1: {
    name: 'Four Corners',
    description: 'Card optimized for four corners pattern',
    size: { rows: 5, cols: 5 },
    freeSpace: { row: 2, col: 2 }
  },
  pattern2: {
    name: 'Full House',
    description: 'Card optimized for full house pattern',
    size: { rows: 5, cols: 5 },
    freeSpace: { row: 2, col: 2 }
  }
};

// GET /api/cards/templates - Get all card templates
router.get('/templates', (req, res) => {
  res.json({
    success: true,
    data: cardTemplates,
    count: Object.keys(cardTemplates).length,
    stage: 'Stage 2 - Card Generation'
  });
});

// GET /api/cards/templates/:templateId - Get specific template
router.get('/templates/:templateId', (req, res) => {
  const template = cardTemplates[req.params.templateId];
  if (!template) {
    return res.status(404).json({
      success: false,
      error: 'Template not found'
    });
  }
  res.json({
    success: true,
    data: template
  });
});

// POST /api/cards/generate - Generate a new bingo card
router.post('/generate', (req, res) => {
  const { template = 'standard', customRange } = req.body;
  
  const templateConfig = cardTemplates[template];
  if (!templateConfig) {
    return res.status(400).json({
      success: false,
      error: 'Invalid template'
    });
  }
  
  const generateCard = (template, customRange) => {
    const card = [];
    const { rows, cols } = template.size;
    
    for (let col = 0; col < cols; col++) {
      let min, max;
      
      if (customRange && customRange[col]) {
        min = customRange[col].min;
        max = customRange[col].max;
      } else {
        // Standard BINGO ranges
        switch (col) {
          case 0: min = 1; max = 15; break;   // B
          case 1: min = 16; max = 30; break;  // I
          case 2: min = 31; max = 45; break;  // N
          case 3: min = 46; max = 60; break;  // G
          case 4: min = 61; max = 75; break;  // O
        }
      }
      
      for (let row = 0; row < rows; row++) {
        if (template.freeSpace && 
            row === template.freeSpace.row && 
            col === template.freeSpace.col) {
          card.push(0); // Free space
        } else {
          card.push(Math.floor(Math.random() * (max - min + 1)) + min);
        }
      }
    }
    
    return card;
  };
  
  const newCard = {
    id: `card_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    template: template,
    numbers: generateCard(templateConfig, customRange),
    generatedAt: new Date().toISOString(),
    metadata: {
      template: templateConfig,
      customRange: customRange || null
    }
  };
  
  res.status(201).json({
    success: true,
    data: newCard,
    message: 'Card generated successfully'
  });
});

// POST /api/cards/validate - Validate a card
router.post('/validate', (req, res) => {
  const { card, pattern } = req.body;
  
  if (!card || !Array.isArray(card)) {
    return res.status(400).json({
      success: false,
      error: 'Card data is required and must be an array'
    });
  }
  
  // Basic validation
  const validation = {
    isValid: true,
    errors: [],
    warnings: []
  };
  
  // Check card length (should be 25 for 5x5)
  if (card.length !== 25) {
    validation.isValid = false;
    validation.errors.push('Card must have exactly 25 numbers');
  }
  
  // Check number ranges for each column
  const ranges = [
    { min: 1, max: 15, letter: 'B' },
    { min: 16, max: 30, letter: 'I' },
    { min: 31, max: 45, letter: 'N' },
    { min: 46, max: 60, letter: 'G' },
    { min: 61, max: 75, letter: 'O' }
  ];
  
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      const index = row * 5 + col;
      const number = card[index];
      
      // Skip free space
      if (row === 2 && col === 2 && number === 0) continue;
      
      if (number < ranges[col].min || number > ranges[col].max) {
        validation.warnings.push(
          `Number ${number} at position ${index} is outside ${ranges[col].letter} range (${ranges[col].min}-${ranges[col].max})`
        );
      }
    }
  }
  
  res.json({
    success: true,
    data: validation,
    message: validation.isValid ? 'Card is valid' : 'Card validation failed'
  });
});

module.exports = router;
