#!/usr/bin/env node
/**
 * Confidence Score Calculator for LEGO Portfolio
 * Calculates confidence scores based on data recency, source agreement, and transaction volume
 *
 * Run: node scripts/calculate-confidence.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const EBAY_HISTORY_FILE = path.join(DATA_DIR, 'ebay-price-history.json');
const CONFIDENCE_OUTPUT = path.join(DATA_DIR, 'confidence.json');
const PUBLIC_CONFIDENCE_OUTPUT = path.join(PUBLIC_DATA_DIR, 'confidence.json');

/**
 * Calculate recency score based on data age
 * fresh (under 7 days) = +3, medium (7-30 days) = +2, stale (over 30 days) = +0
 */
function calculateRecencyScore(lastUpdatedStr) {
  if (!lastUpdatedStr) {
    return { score: 0, age_days: null };
  }

  const lastUpdated = new Date(lastUpdatedStr);
  const now = new Date();
  const ageDays = Math.floor((now - lastUpdated) / (1000 * 60 * 60 * 24));

  let score = 0;
  if (ageDays < 7) {
    score = 3;
  } else if (ageDays <= 30) {
    score = 2;
  }

  return { score, age_days: ageDays };
}

/**
 * Calculate source agreement score
 * under 15% diff = +3, 15-25% diff = +1, over 25% diff = +0
 */
function calculateSourceAgreementScore(brickEconomyValue, ebayValue) {
  const sources = ['BrickEconomy'];

  if (!ebayValue) {
    // Only BrickEconomy data available, give medium score
    return { score: 2, sources, maxDiff: null };
  }

  sources.push('eBay');

  // Calculate percentage difference
  const diff = Math.abs(brickEconomyValue - ebayValue);
  const avgValue = (brickEconomyValue + ebayValue) / 2;
  const diffPercent = diff / avgValue;

  let score = 0;
  if (diffPercent < 0.15) {
    score = 3;
  } else if (diffPercent <= 0.25) {
    score = 1;
  }

  return { score, sources, maxDiff: diffPercent };
}

/**
 * Calculate transaction volume score based on price history data points
 * high (over 10) = +2, medium (5-10) = +1, low (under 5) = +0
 */
function calculateTransactionVolumeScore(priceHistoryLength) {
  const count = priceHistoryLength || 0;

  let score = 0;
  if (count >= 10) {
    score = 2;
  } else if (count >= 5) {
    score = 1;
  }

  return { score, count };
}

/**
 * Determine confidence level from total score
 * High (7-8), Medium (4-6), Low (0-3)
 */
function getConfidenceLevel(score) {
  if (score >= 7) return 'High';
  if (score >= 4) return 'Medium';
  return 'Low';
}

/**
 * Generate warnings based on confidence factors
 */
function generateWarnings(factors, recency) {
  const warnings = [];

  // Check for missing eBay data
  if (!factors.sourceAgreement.sources.includes('eBay')) {
    warnings.push('No eBay data available');
  }

  // Check for stale data
  if (recency.age_days > 30) {
    warnings.push('BrickEconomy data stale');
  } else if (recency.age_days > 14) {
    warnings.push('Data is over 2 weeks old');
  }

  // Check for source disagreement
  if (factors.sourceAgreement.maxDiff && factors.sourceAgreement.maxDiff > 0.15) {
    const diffPercent = (factors.sourceAgreement.maxDiff * 100).toFixed(0);
    warnings.push(`Sources disagree by ${diffPercent}%`);
  }

  // Check for low transaction volume
  if (factors.transactionVolume.count < 5) {
    warnings.push('Insufficient sales data');
  }

  return warnings;
}

/**
 * Load JSON file safely
 */
function loadJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Warning: Could not load ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Get latest eBay value for a set
 */
function getEbayValue(setId, ebayHistory) {
  if (!ebayHistory || !ebayHistory.snapshots || ebayHistory.snapshots.length === 0) {
    return null;
  }

  // Get the most recent snapshot
  const latestSnapshot = ebayHistory.snapshots[ebayHistory.snapshots.length - 1];

  if (latestSnapshot.sets && latestSnapshot.sets[setId]) {
    return latestSnapshot.sets[setId].marketValue;
  }

  return null;
}

/**
 * Get price history length for a set
 */
function getPriceHistoryLength(setId, priceHistory) {
  if (!priceHistory || !priceHistory.sets || !priceHistory.sets[setId]) {
    return 0;
  }

  const setPriceHistory = priceHistory.sets[setId].priceHistory;
  return setPriceHistory ? setPriceHistory.length : 0;
}

/**
 * Main calculation function
 */
async function calculateConfidence() {
  console.log('=== LEGO Portfolio Confidence Score Calculator ===\n');

  // Load data files
  console.log('Loading data files...');
  const portfolio = loadJsonFile(PORTFOLIO_FILE);
  const priceHistory = loadJsonFile(PRICE_HISTORY_FILE);
  const ebayHistory = loadJsonFile(EBAY_HISTORY_FILE);

  if (!portfolio) {
    console.error('Error: Could not load portfolio.json');
    process.exit(1);
  }

  const lastUpdated = portfolio.metadata?.lastUpdated || null;
  const recencyData = calculateRecencyScore(lastUpdated);

  console.log(`Portfolio last updated: ${lastUpdated || 'Unknown'}`);
  console.log(`Data age: ${recencyData.age_days !== null ? recencyData.age_days + ' days' : 'Unknown'}\n`);

  // Calculate confidence for each set
  const confidenceScores = {};
  const sets = portfolio.sets || [];
  let processedCount = 0;

  for (const set of sets) {
    const setId = set.setNumber;
    const brickEconomyValue = set.value;
    const ebayValue = getEbayValue(setId, ebayHistory);
    const historyLength = getPriceHistoryLength(setId, priceHistory);

    // Calculate individual factor scores
    const recencyScore = recencyData.score;
    const sourceAgreement = calculateSourceAgreementScore(brickEconomyValue, ebayValue);
    const transactionVolume = calculateTransactionVolumeScore(historyLength);

    // Calculate total score
    const totalScore = recencyScore + sourceAgreement.score + transactionVolume.score;
    const confidenceLevel = getConfidenceLevel(totalScore);

    // Build factors object
    const factors = {
      recency: {
        score: recencyScore,
        lastUpdated: lastUpdated,
        age_days: recencyData.age_days
      },
      sourceAgreement: {
        score: sourceAgreement.score,
        sources: sourceAgreement.sources,
        maxDiff: sourceAgreement.maxDiff
      },
      transactionVolume: {
        score: transactionVolume.score,
        count: historyLength
      }
    };

    // Generate warnings
    const warnings = generateWarnings(factors, recencyData);

    // Store confidence data
    confidenceScores[setId] = {
      confidence: confidenceLevel,
      score: totalScore,
      factors,
      warnings
    };

    processedCount++;
  }

  // Build output object
  const output = {
    metadata: {
      lastCalculated: new Date().toISOString(),
      totalSets: processedCount,
      dataSource: 'BrickEconomy + eBay',
      scoringCriteria: {
        recency: 'fresh (<7 days) = +3, medium (7-30 days) = +2, stale (>30 days) = +0',
        sourceAgreement: 'under 15% diff = +3, 15-25% diff = +1, over 25% diff = +0',
        transactionVolume: 'high (>10) = +2, medium (5-10) = +1, low (<5) = +0',
        confidenceLevels: 'High (7-8), Medium (4-6), Low (0-3)'
      }
    },
    sets: confidenceScores
  };

  // Write output files
  console.log(`Processed ${processedCount} sets\n`);
  console.log('Writing output files...');

  fs.writeFileSync(CONFIDENCE_OUTPUT, JSON.stringify(output, null, 2));
  console.log(`✓ Created ${CONFIDENCE_OUTPUT}`);

  // Ensure public/data directory exists
  if (!fs.existsSync(PUBLIC_DATA_DIR)) {
    fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(PUBLIC_CONFIDENCE_OUTPUT, JSON.stringify(output, null, 2));
  console.log(`✓ Created ${PUBLIC_CONFIDENCE_OUTPUT}`);

  // Display summary
  console.log('\n=== Confidence Score Summary ===');
  const highCount = Object.values(confidenceScores).filter(s => s.confidence === 'High').length;
  const mediumCount = Object.values(confidenceScores).filter(s => s.confidence === 'Medium').length;
  const lowCount = Object.values(confidenceScores).filter(s => s.confidence === 'Low').length;

  console.log(`High confidence:   ${highCount} sets`);
  console.log(`Medium confidence: ${mediumCount} sets`);
  console.log(`Low confidence:    ${lowCount} sets`);

  // Show sample of warnings
  const setsWithWarnings = Object.entries(confidenceScores)
    .filter(([_, data]) => data.warnings.length > 0);

  if (setsWithWarnings.length > 0) {
    console.log(`\nWarnings found for ${setsWithWarnings.length} sets:`);
    setsWithWarnings.slice(0, 5).forEach(([setId, data]) => {
      console.log(`  ${setId}: ${data.warnings.join(', ')}`);
    });
    if (setsWithWarnings.length > 5) {
      console.log(`  ... and ${setsWithWarnings.length - 5} more`);
    }
  }

  console.log('\n✓ Confidence calculation complete!');
}

// Export functions for testing
module.exports = {
  calculateRecencyScore,
  calculateSourceAgreementScore,
  calculateTransactionVolumeScore,
  getConfidenceLevel,
  generateWarnings,
  loadJsonFile,
  getEbayValue,
  getPriceHistoryLength,
};

// Run if executed directly
if (require.main === module) {
  calculateConfidence().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
