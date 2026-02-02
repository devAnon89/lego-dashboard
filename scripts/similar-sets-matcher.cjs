#!/usr/bin/env node
/**
 * Similar Sets Matcher for LEGO Portfolio
 * Finds 3-5 similar sets by theme, piece count, retail price, and license
 *
 * Usage:
 *   node scripts/similar-sets-matcher.cjs --set 10316-1
 *   node scripts/similar-sets-matcher.cjs --set 10316-1 --dry-run
 *   node scripts/similar-sets-matcher.cjs --all
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger.cjs');

// Data file paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const DEEP_ANALYSIS_FILE = path.join(DATA_DIR, 'deep-analysis.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');

// Matching configuration
const CONFIG = {
  MIN_SIMILAR_SETS: 3,
  MAX_SIMILAR_SETS: 5,
  // Weights for similarity scoring (total = 1.0)
  WEIGHTS: {
    theme: 0.35,
    priceRange: 0.25,
    license: 0.25,
    pieceCount: 0.15,
  },
  // Price range tolerance for similarity (percentage)
  PRICE_TOLERANCE: 0.50, // 50% tolerance
  // Piece count tolerance (percentage)
  PIECE_TOLERANCE: 0.40, // 40% tolerance
};

// License strength mappings
const LICENSE_KEYWORDS = {
  // High-value licenses (score 8-10)
  'star wars': 10,
  'disney': 9,
  'marvel': 9,
  'lord of the rings': 9,
  'harry potter': 9,
  'batman': 8,
  'dc': 8,
  'ferrari': 8,
  'lamborghini': 8,
  'porsche': 8,
  'mclaren': 8,
  'nintendo': 8,
  'super mario': 8,
  'minecraft': 7,
  'fast and furious': 7,
  'fast & furious': 7,
  'bugatti': 7,
  'bmw': 7,
  'fortnite': 6,
  'wicked': 5,
  'lilo and stitch': 6,
  'stitch': 6,
  'polaroid': 6,
  'pac-man': 6,
  // Medium licenses (score 4-6)
  'licensed': 5,
  'cars': 6,
  // No license
  'botanical': 0,
  'icons': 0,
  'ideas': 0,
  'creator': 0,
  'seasonal': 0,
  'city': 0,
  'technic': 0,
  'art': 0,
  'modular': 0,
};

/**
 * Load portfolio data
 * @returns {Object} Portfolio data
 */
function loadPortfolio() {
  try {
    return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf-8'));
  } catch (error) {
    logger.error('Failed to load portfolio file', error);
    throw error;
  }
}

/**
 * Load deep analysis data (for license scores and performance metrics)
 * @returns {Object} Deep analysis data
 */
function loadDeepAnalysis() {
  try {
    return JSON.parse(fs.readFileSync(DEEP_ANALYSIS_FILE, 'utf-8'));
  } catch {
    logger.warn('Could not load deep analysis file, returning empty data');
    return { metadata: {} };
  }
}

/**
 * Load price history for additional metrics
 * @returns {Object} Price history data
 */
function loadPriceHistory() {
  try {
    return JSON.parse(fs.readFileSync(PRICE_HISTORY_FILE, 'utf-8'));
  } catch {
    logger.warn('Could not load price history file, returning empty data');
    return { metadata: {}, sets: {} };
  }
}

/**
 * Extract the main theme from a theme string
 * e.g., "Icons / Licensed" -> "Icons"
 * @param {string} theme - Full theme string
 * @returns {string} Main theme
 */
function extractMainTheme(theme) {
  if (!theme) return 'Unknown';
  return theme.split('/')[0].trim();
}

/**
 * Extract the sub-theme from a theme string
 * e.g., "Icons / Licensed" -> "Licensed"
 * @param {string} theme - Full theme string
 * @returns {string|null} Sub-theme or null
 */
function extractSubTheme(theme) {
  if (!theme) return null;
  const parts = theme.split('/');
  return parts.length > 1 ? parts.slice(1).join('/').trim() : null;
}

/**
 * Detect license strength from theme and name
 * @param {string} theme - Theme string
 * @param {string} name - Set name
 * @returns {number} License score (0-10)
 */
function detectLicenseStrength(theme, name) {
  const searchText = `${theme} ${name}`.toLowerCase();

  // Check each license keyword
  let maxScore = 0;
  for (const [keyword, score] of Object.entries(LICENSE_KEYWORDS)) {
    if (searchText.includes(keyword)) {
      maxScore = Math.max(maxScore, score);
    }
  }

  return maxScore;
}

/**
 * Estimate piece count from retail price (rough approximation)
 * Uses LEGO's typical price-per-piece ratio of ~0.10-0.12 EUR
 * @param {number} retailPrice - Retail price in EUR
 * @returns {number} Estimated piece count
 */
function estimatePieceCount(retailPrice) {
  if (!retailPrice || retailPrice <= 0) return 0;
  // Average price per piece is around €0.10-0.11
  return Math.round(retailPrice / 0.10);
}

/**
 * Calculate theme similarity score
 * @param {Object} set1 - First set
 * @param {Object} set2 - Second set
 * @returns {number} Similarity score (0-1)
 */
function calculateThemeSimilarity(set1, set2) {
  const theme1 = set1.theme || '';
  const theme2 = set2.theme || '';

  // Exact theme match
  if (theme1 === theme2) return 1.0;

  // Main theme match
  const main1 = extractMainTheme(theme1);
  const main2 = extractMainTheme(theme2);
  if (main1 === main2) return 0.8;

  // Sub-theme match
  const sub1 = extractSubTheme(theme1);
  const sub2 = extractSubTheme(theme2);
  if (sub1 && sub2 && sub1 === sub2) return 0.6;

  // Partial theme name match
  if (theme1.includes(main2) || theme2.includes(main1)) return 0.4;

  return 0;
}

/**
 * Calculate price range similarity score
 * @param {number} price1 - First price
 * @param {number} price2 - Second price
 * @returns {number} Similarity score (0-1)
 */
function calculatePriceSimilarity(price1, price2) {
  if (!price1 || !price2 || price1 <= 0 || price2 <= 0) return 0;

  const ratio = Math.min(price1, price2) / Math.max(price1, price2);

  // Perfect match
  if (ratio === 1) return 1.0;

  // Within tolerance
  if (ratio >= (1 - CONFIG.PRICE_TOLERANCE)) {
    return ratio;
  }

  // Outside tolerance but somewhat similar
  return ratio * 0.5;
}

/**
 * Calculate license similarity score
 * @param {number} license1 - First license score
 * @param {number} license2 - Second license score
 * @returns {number} Similarity score (0-1)
 */
function calculateLicenseSimilarity(license1, license2) {
  // Both unlicensed
  if (license1 === 0 && license2 === 0) return 1.0;

  // Both licensed (any level)
  if (license1 > 0 && license2 > 0) {
    const diff = Math.abs(license1 - license2);
    return Math.max(0, 1 - (diff / 10));
  }

  // One licensed, one not
  return 0;
}

/**
 * Calculate piece count similarity score
 * @param {number} pieces1 - First piece count
 * @param {number} pieces2 - Second piece count
 * @returns {number} Similarity score (0-1)
 */
function calculatePieceCountSimilarity(pieces1, pieces2) {
  if (!pieces1 || !pieces2 || pieces1 <= 0 || pieces2 <= 0) return 0.5; // Neutral score when unknown

  const ratio = Math.min(pieces1, pieces2) / Math.max(pieces1, pieces2);

  // Perfect or near-perfect match
  if (ratio >= 0.9) return 1.0;

  // Within tolerance
  if (ratio >= (1 - CONFIG.PIECE_TOLERANCE)) {
    return ratio;
  }

  // Outside tolerance
  return ratio * 0.3;
}

/**
 * Calculate overall similarity score between two sets
 * @param {Object} targetSet - Target set to compare against
 * @param {Object} candidateSet - Candidate set to evaluate
 * @param {Object} analysisData - Deep analysis data for license scores
 * @returns {Object} Similarity details with overall score
 */
function calculateSimilarity(targetSet, candidateSet, analysisData) {
  // Get license scores from analysis or detect from theme/name
  const targetLicense = analysisData[targetSet.setNumber]?.license
    || detectLicenseStrength(targetSet.theme, targetSet.name);
  const candidateLicense = analysisData[candidateSet.setNumber]?.license
    || detectLicenseStrength(candidateSet.theme, candidateSet.name);

  // Estimate piece counts from retail price
  const targetPieces = estimatePieceCount(targetSet.retail);
  const candidatePieces = estimatePieceCount(candidateSet.retail);

  // Calculate individual similarity scores
  const themeSimilarity = calculateThemeSimilarity(targetSet, candidateSet);
  const priceSimilarity = calculatePriceSimilarity(targetSet.retail, candidateSet.retail);
  const licenseSimilarity = calculateLicenseSimilarity(targetLicense, candidateLicense);
  const pieceSimilarity = calculatePieceCountSimilarity(targetPieces, candidatePieces);

  // Calculate weighted overall score
  const overallScore =
    (themeSimilarity * CONFIG.WEIGHTS.theme) +
    (priceSimilarity * CONFIG.WEIGHTS.priceRange) +
    (licenseSimilarity * CONFIG.WEIGHTS.license) +
    (pieceSimilarity * CONFIG.WEIGHTS.pieceCount);

  return {
    setNumber: candidateSet.setNumber,
    name: candidateSet.name,
    theme: candidateSet.theme,
    retail: candidateSet.retail,
    value: candidateSet.value,
    growth: candidateSet.growth,
    scores: {
      theme: parseFloat(themeSimilarity.toFixed(3)),
      price: parseFloat(priceSimilarity.toFixed(3)),
      license: parseFloat(licenseSimilarity.toFixed(3)),
      pieceCount: parseFloat(pieceSimilarity.toFixed(3)),
      overall: parseFloat(overallScore.toFixed(3)),
    },
    metadata: {
      detectedLicense: candidateLicense,
      estimatedPieces: candidatePieces,
    },
  };
}

/**
 * Find similar sets for a given target set
 * @param {string} targetSetId - Target set ID
 * @param {Object} portfolio - Portfolio data
 * @param {Object} analysisData - Deep analysis data
 * @returns {Object} Similar sets with performance metrics
 */
function findSimilarSets(targetSetId, portfolio, analysisData) {
  // Find target set
  const targetSet = portfolio.sets.find(s => s.setNumber === targetSetId);
  if (!targetSet) {
    throw new Error(`Set ${targetSetId} not found in portfolio`);
  }

  // Calculate similarity for all other sets
  const similarities = portfolio.sets
    .filter(s => s.setNumber !== targetSetId) // Exclude target set
    .map(candidateSet => calculateSimilarity(targetSet, candidateSet, analysisData))
    .sort((a, b) => b.scores.overall - a.scores.overall);

  // Get top N similar sets
  const topSimilar = similarities.slice(0, CONFIG.MAX_SIMILAR_SETS);

  // Ensure we have at least minimum similar sets (even if scores are low)
  const similarSets = topSimilar.length >= CONFIG.MIN_SIMILAR_SETS
    ? topSimilar
    : similarities.slice(0, CONFIG.MIN_SIMILAR_SETS);

  // Calculate performance metrics for similar sets
  const performanceMetrics = calculatePerformanceMetrics(similarSets);

  return {
    targetSet: {
      setNumber: targetSet.setNumber,
      name: targetSet.name,
      theme: targetSet.theme,
      retail: targetSet.retail,
      value: targetSet.value,
      growth: targetSet.growth,
      detectedLicense: analysisData[targetSetId]?.license
        || detectLicenseStrength(targetSet.theme, targetSet.name),
      estimatedPieces: estimatePieceCount(targetSet.retail),
    },
    similarSets,
    performanceMetrics,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Calculate average performance metrics for similar sets
 * @param {Array} similarSets - Array of similar sets with data
 * @returns {Object} Performance metrics
 */
function calculatePerformanceMetrics(similarSets) {
  if (!similarSets || similarSets.length === 0) {
    return {
      avgGrowth: null,
      avgValue: null,
      avgRetail: null,
      growthRange: { min: null, max: null },
      sampleSize: 0,
    };
  }

  const growths = similarSets.map(s => s.growth).filter(g => g != null);
  const values = similarSets.map(s => s.value).filter(v => v != null && v > 0);
  const retails = similarSets.map(s => s.retail).filter(r => r != null && r > 0);

  const avgGrowth = growths.length > 0
    ? growths.reduce((a, b) => a + b, 0) / growths.length
    : null;

  const avgValue = values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;

  const avgRetail = retails.length > 0
    ? retails.reduce((a, b) => a + b, 0) / retails.length
    : null;

  const sortedGrowths = [...growths].sort((a, b) => a - b);

  return {
    avgGrowth: avgGrowth !== null ? parseFloat(avgGrowth.toFixed(2)) : null,
    avgValue: avgValue !== null ? parseFloat(avgValue.toFixed(2)) : null,
    avgRetail: avgRetail !== null ? parseFloat(avgRetail.toFixed(2)) : null,
    growthRange: {
      min: sortedGrowths.length > 0 ? parseFloat(sortedGrowths[0].toFixed(2)) : null,
      max: sortedGrowths.length > 0 ? parseFloat(sortedGrowths[sortedGrowths.length - 1].toFixed(2)) : null,
    },
    sampleSize: similarSets.length,
  };
}

/**
 * Format similarity results for display
 * @param {Object} result - Similar sets result
 */
function displayResults(result) {
  const { targetSet, similarSets, performanceMetrics } = result;

  logger.section(`Similar Sets: ${targetSet.setNumber} - ${targetSet.name}`);

  logger.info(`Target Set Details:`);
  logger.info(`  Theme: ${targetSet.theme}`);
  logger.info(`  Retail: €${targetSet.retail?.toFixed(2) || 'N/A'}`);
  logger.info(`  Current Value: €${targetSet.value?.toFixed(2) || 'N/A'}`);
  logger.info(`  Growth: ${targetSet.growth?.toFixed(2) || 'N/A'}%`);
  logger.info(`  License Score: ${targetSet.detectedLicense}/10`);
  logger.info(`  Est. Pieces: ~${targetSet.estimatedPieces}`);

  logger.info('');
  logger.info(`Found ${similarSets.length} similar sets:`);

  similarSets.forEach((set, index) => {
    logger.info('');
    logger.info(`  ${index + 1}. ${set.setNumber} - ${set.name}`);
    logger.info(`     Theme: ${set.theme}`);
    logger.info(`     Similarity Score: ${(set.scores.overall * 100).toFixed(1)}%`);
    logger.info(`     Breakdown: Theme=${(set.scores.theme * 100).toFixed(0)}%, Price=${(set.scores.price * 100).toFixed(0)}%, License=${(set.scores.license * 100).toFixed(0)}%, Pieces=${(set.scores.pieceCount * 100).toFixed(0)}%`);
    logger.info(`     Retail: €${set.retail?.toFixed(2) || 'N/A'}, Value: €${set.value?.toFixed(2) || 'N/A'}, Growth: ${set.growth?.toFixed(2) || 'N/A'}%`);
  });

  logger.info('');
  logger.info('Similar Sets Performance Metrics:');
  logger.info(`  Average Growth: ${performanceMetrics.avgGrowth?.toFixed(2) || 'N/A'}%`);
  logger.info(`  Growth Range: ${performanceMetrics.growthRange.min?.toFixed(2) || 'N/A'}% to ${performanceMetrics.growthRange.max?.toFixed(2) || 'N/A'}%`);
  logger.info(`  Average Value: €${performanceMetrics.avgValue?.toFixed(2) || 'N/A'}`);
  logger.info(`  Sample Size: ${performanceMetrics.sampleSize} sets`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleSet = args.find((a, i) => args[i - 1] === '--set');
  const analyzeAll = args.includes('--all');

  logger.section('LEGO Similar Sets Matcher');

  if (dryRun) {
    logger.info('[DRY RUN] Would find similar sets');
    logger.info('Matching criteria: theme, price range, license, piece count');
    logger.info(`Returns ${CONFIG.MIN_SIMILAR_SETS}-${CONFIG.MAX_SIMILAR_SETS} similar sets`);
    logger.info('Weights: ' + JSON.stringify(CONFIG.WEIGHTS));
    return;
  }

  // Load data
  const portfolio = loadPortfolio();
  const analysisData = loadDeepAnalysis();

  // Determine which sets to analyze
  let setsToAnalyze = [];

  if (singleSet) {
    const portfolioSet = portfolio.sets.find(s => s.setNumber === singleSet);
    if (!portfolioSet) {
      logger.error(`Set ${singleSet} not found in portfolio`);
      process.exit(1);
    }
    setsToAnalyze = [singleSet];
  } else if (analyzeAll) {
    setsToAnalyze = portfolio.sets.map(s => s.setNumber);
  } else {
    logger.error('Please specify --set <setId> or --all');
    process.exit(1);
  }

  logger.info(`Finding similar sets for ${setsToAnalyze.length} set(s)...`);

  // Process each set
  const results = [];
  for (const setId of setsToAnalyze) {
    try {
      const result = findSimilarSets(setId, portfolio, analysisData);
      results.push(result);
      displayResults(result);
    } catch (error) {
      logger.error(`Failed to find similar sets for ${setId}`, error);
    }
  }

  // Summary for --all mode
  if (analyzeAll && results.length > 1) {
    logger.section('Overall Summary');
    logger.info(`Processed ${results.length} sets`);

    // Find sets with most similar matches (highest avg similarity score)
    const avgScores = results.map(r => ({
      setId: r.targetSet.setNumber,
      name: r.targetSet.name,
      avgSimilarity: r.similarSets.reduce((sum, s) => sum + s.scores.overall, 0) / r.similarSets.length,
    })).sort((a, b) => b.avgSimilarity - a.avgSimilarity);

    logger.info('');
    logger.info('Sets with strongest similarity matches:');
    avgScores.slice(0, 5).forEach((s, i) => {
      logger.info(`  ${i + 1}. ${s.setId} - ${s.name} (avg similarity: ${(s.avgSimilarity * 100).toFixed(1)}%)`);
    });
  }

  return results;
}

// Export functions for testing and use by other modules
module.exports = {
  loadPortfolio,
  loadDeepAnalysis,
  loadPriceHistory,
  extractMainTheme,
  extractSubTheme,
  detectLicenseStrength,
  estimatePieceCount,
  calculateThemeSimilarity,
  calculatePriceSimilarity,
  calculateLicenseSimilarity,
  calculatePieceCountSimilarity,
  calculateSimilarity,
  findSimilarSets,
  calculatePerformanceMetrics,
  CONFIG,
  LICENSE_KEYWORDS,
  DATA_DIR,
  PORTFOLIO_FILE,
  DEEP_ANALYSIS_FILE,
};

if (require.main === module) {
  main().catch(error => {
    logger.error('Similar sets matcher failed', error);
    process.exit(1);
  });
}
