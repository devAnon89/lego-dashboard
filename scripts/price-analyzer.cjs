#!/usr/bin/env node
/**
 * Price Analyzer for LEGO Portfolio
 * Analyzes historical price trends (30/90/365-day), volatility, and trend indicators
 *
 * Usage:
 *   node scripts/price-analyzer.cjs --set 10316-1
 *   node scripts/price-analyzer.cjs --set 10316-1 --dry-run
 *   node scripts/price-analyzer.cjs --all
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger.cjs');

// Data file paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const EBAY_PRICE_HISTORY_FILE = path.join(DATA_DIR, 'ebay-price-history.json');

// Trend thresholds (percentage)
const TREND_THRESHOLDS = {
  RISING: 5,    // > 5% increase
  FALLING: -5,  // < -5% decrease
};

// Volatility thresholds (coefficient of variation)
const VOLATILITY_THRESHOLDS = {
  LOW: 0.05,    // < 5%
  HIGH: 0.15,   // > 15%
};

// Theme introduction data - maps themes/categories to their first set and introduction dates
// Used for first-of-kind detection to identify pioneering sets in their category
const THEME_INTRODUCTIONS = {
  // Icons/Licensed first-of-kind sets
  'Icons / Licensed / Lord of the Rings': {
    firstSet: '10316-1',
    year: 2023,
    description: 'First Icons-scale Lord of the Rings set (Rivendell)',
  },
  'Icons / Modular Buildings': {
    firstSet: '10182-1',
    year: 2007,
    description: 'First Modular Building (Café Corner)',
  },
  'Botanicals': {
    firstSet: '10280-1',
    year: 2021,
    description: 'First Botanical Collection (Flower Bouquet)',
  },
  'Ideas / Licensed / Polaroid': {
    firstSet: '21345-1',
    year: 2024,
    description: 'First Polaroid licensed set',
  },
  'Ideas / Botanical': {
    firstSet: '21353-1',
    year: 2024,
    description: 'First Ideas Botanical Garden',
  },
  'LEGO Art / Paintings': {
    firstSet: '31218-1',
    year: 2024,
    description: 'First LEGO Art mosaic landscape painting',
  },
  'Super Mario / Mario Kart': {
    firstSet: '72037-1',
    year: 2025,
    description: 'First Mario Kart buildable set',
  },
  'Technic / Lamborghini': {
    firstSet: '42115-1',
    year: 2020,
    description: 'First Technic Ultimate Car Series Lamborghini',
  },
  'Fortnite': {
    firstSet: '77073-1',
    year: 2024,
    description: 'First LEGO Fortnite licensed set (Battle Bus)',
  },
  'Wicked': {
    firstSet: '75682-1',
    year: 2024,
    description: 'First LEGO Wicked licensed set',
  },
  'Super Mario / Game Boy': {
    firstSet: '72046-1',
    year: 2025,
    description: 'First buildable Game Boy set',
  },
};

// Keywords that indicate first-of-kind status in specific categories
const FIRST_OF_KIND_INDICATORS = {
  licenses: ['Lord of the Rings', 'Polaroid', 'Fortnite', 'Wicked', 'Mario Kart', 'Game Boy'],
  categories: ['Modular Buildings', 'Botanical', 'Paintings'],
  prefixes: ['First', 'Iconic', 'Ultimate'],
};

/**
 * Load price history from BrickEconomy data
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
 * Load eBay price history
 * @returns {Object} eBay price history data
 */
function loadEbayPriceHistory() {
  try {
    return JSON.parse(fs.readFileSync(EBAY_PRICE_HISTORY_FILE, 'utf-8'));
  } catch {
    logger.warn('Could not load eBay price history file, returning empty data');
    return { snapshots: [], soldListings: {} };
  }
}

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
 * Filter price history to a specific date range
 * @param {Array} priceHistory - Array of {date, newValue, usedValue} objects
 * @param {number} days - Number of days to look back
 * @returns {Array} Filtered price history
 */
function filterByDays(priceHistory, days) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return priceHistory.filter(entry => {
    const entryDate = new Date(entry.date);
    return entryDate >= cutoffDate;
  });
}

/**
 * Calculate percentage change between two values
 * @param {number} oldValue - Starting value
 * @param {number} newValue - Ending value
 * @returns {number|null} Percentage change or null if invalid
 */
function calculatePercentageChange(oldValue, newValue) {
  if (!oldValue || oldValue === 0) return null;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Calculate the trend indicator based on percentage change
 * @param {number} percentChange - Percentage change
 * @returns {string} 'rising', 'falling', or 'stable'
 */
function getTrendIndicator(percentChange) {
  if (percentChange === null) return 'unknown';
  if (percentChange > TREND_THRESHOLDS.RISING) return 'rising';
  if (percentChange < TREND_THRESHOLDS.FALLING) return 'falling';
  return 'stable';
}

/**
 * Calculate mean of an array of numbers
 * @param {Array<number>} values - Array of values
 * @returns {number|null} Mean or null if empty
 */
function calculateMean(values) {
  if (!values || values.length === 0) return null;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate standard deviation of an array of numbers
 * @param {Array<number>} values - Array of values
 * @returns {number|null} Standard deviation or null if empty
 */
function calculateStdDev(values) {
  if (!values || values.length < 2) return null;
  const mean = calculateMean(values);
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((acc, d) => acc + d, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate coefficient of variation (volatility measure)
 * @param {Array<number>} values - Array of values
 * @returns {number|null} Coefficient of variation or null if invalid
 */
function calculateCoeffOfVariation(values) {
  const mean = calculateMean(values);
  const stdDev = calculateStdDev(values);
  if (!mean || mean === 0 || !stdDev) return null;
  return stdDev / mean;
}

/**
 * Get volatility indicator based on coefficient of variation
 * @param {number} coeffVar - Coefficient of variation
 * @returns {string} 'low', 'medium', or 'high'
 */
function getVolatilityIndicator(coeffVar) {
  if (coeffVar === null) return 'unknown';
  if (coeffVar < VOLATILITY_THRESHOLDS.LOW) return 'low';
  if (coeffVar > VOLATILITY_THRESHOLDS.HIGH) return 'high';
  return 'medium';
}

/**
 * Calculate moving average
 * @param {Array<number>} values - Array of values
 * @param {number} window - Window size
 * @returns {Array<number>} Moving averages
 */
function calculateMovingAverage(values, window) {
  if (values.length < window) return [];
  const result = [];
  for (let i = window - 1; i < values.length; i++) {
    const windowValues = values.slice(i - window + 1, i + 1);
    result.push(calculateMean(windowValues));
  }
  return result;
}

/**
 * Analyze price trends for a specific time period
 * @param {Array} priceHistory - Array of {date, newValue, usedValue} objects
 * @param {number} days - Number of days to analyze
 * @returns {Object} Trend analysis for the period
 */
function analyzeTrendForPeriod(priceHistory, days) {
  const filtered = filterByDays(priceHistory, days);

  if (filtered.length < 2) {
    return {
      period: `${days}d`,
      dataPoints: filtered.length,
      startValue: null,
      endValue: null,
      percentChange: null,
      trend: 'insufficient_data',
      volatility: null,
      volatilityIndicator: 'unknown',
    };
  }

  // Sort by date ascending
  const sorted = [...filtered].sort((a, b) => new Date(a.date) - new Date(b.date));

  const startEntry = sorted[0];
  const endEntry = sorted[sorted.length - 1];

  // Use newValue for analysis (primary market value)
  const startValue = startEntry.newValue;
  const endValue = endEntry.newValue;

  const percentChange = calculatePercentageChange(startValue, endValue);
  const trend = getTrendIndicator(percentChange);

  // Calculate volatility using all values in the period
  const allValues = sorted.map(entry => entry.newValue).filter(v => v != null);
  const coeffVar = calculateCoeffOfVariation(allValues);
  const volatilityIndicator = getVolatilityIndicator(coeffVar);

  return {
    period: `${days}d`,
    dataPoints: filtered.length,
    startDate: startEntry.date,
    endDate: endEntry.date,
    startValue: startValue ? parseFloat(startValue.toFixed(2)) : null,
    endValue: endValue ? parseFloat(endValue.toFixed(2)) : null,
    percentChange: percentChange ? parseFloat(percentChange.toFixed(2)) : null,
    trend,
    volatility: coeffVar ? parseFloat(coeffVar.toFixed(4)) : null,
    volatilityIndicator,
  };
}

/**
 * Analyze eBay sold listings for price trends
 * @param {Object} soldListingsData - Sold listings data for a set
 * @param {number} days - Number of days to analyze
 * @returns {Object} eBay trend analysis
 */
function analyzeEbayTrendForPeriod(soldListingsData, days) {
  if (!soldListingsData || !soldListingsData.listings || soldListingsData.listings.length === 0) {
    return {
      period: `${days}d`,
      dataPoints: 0,
      trend: 'no_data',
      volatility: null,
      volatilityIndicator: 'unknown',
    };
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Filter listings by sold date
  const filtered = soldListingsData.listings.filter(listing => {
    if (!listing.soldDate) return false;
    const soldDate = new Date(listing.soldDate);
    return soldDate >= cutoffDate;
  });

  if (filtered.length < 2) {
    return {
      period: `${days}d`,
      dataPoints: filtered.length,
      trend: 'insufficient_data',
      volatility: null,
      volatilityIndicator: 'unknown',
    };
  }

  // Sort by sold date ascending
  const sorted = [...filtered].sort((a, b) => new Date(a.soldDate) - new Date(b.soldDate));

  const prices = sorted.map(l => l.price);
  const startPrice = prices[0];
  const endPrice = prices[prices.length - 1];

  const percentChange = calculatePercentageChange(startPrice, endPrice);
  const trend = getTrendIndicator(percentChange);

  const coeffVar = calculateCoeffOfVariation(prices);
  const volatilityIndicator = getVolatilityIndicator(coeffVar);

  // Calculate statistics
  const mean = calculateMean(prices);
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const median = sortedPrices.length % 2 === 0
    ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
    : sortedPrices[Math.floor(sortedPrices.length / 2)];

  return {
    period: `${days}d`,
    dataPoints: filtered.length,
    startDate: sorted[0].soldDate,
    endDate: sorted[sorted.length - 1].soldDate,
    startPrice: startPrice ? parseFloat(startPrice.toFixed(2)) : null,
    endPrice: endPrice ? parseFloat(endPrice.toFixed(2)) : null,
    meanPrice: mean ? parseFloat(mean.toFixed(2)) : null,
    medianPrice: median ? parseFloat(median.toFixed(2)) : null,
    percentChange: percentChange ? parseFloat(percentChange.toFixed(2)) : null,
    trend,
    volatility: coeffVar ? parseFloat(coeffVar.toFixed(4)) : null,
    volatilityIndicator,
  };
}

/**
 * Detect if a set is "first of kind" based on theme introduction data
 * @param {string} setId - Set identifier (e.g., '10316-1')
 * @param {Object} setInfo - Set information from portfolio (name, theme)
 * @returns {Object} First-of-kind analysis result
 */
function detectFirstOfKind(setId, setInfo) {
  const result = {
    isFirstOfKind: false,
    category: null,
    reason: null,
    introductionYear: null,
    premiumFactor: 1.0,
  };

  if (!setId || !setInfo) {
    return result;
  }

  const theme = setInfo.theme || '';
  const name = setInfo.name || '';

  // Check exact matches in THEME_INTRODUCTIONS
  for (const [category, data] of Object.entries(THEME_INTRODUCTIONS)) {
    if (data.firstSet === setId) {
      result.isFirstOfKind = true;
      result.category = category;
      result.reason = data.description;
      result.introductionYear = data.year;
      result.premiumFactor = 1.25; // 25% premium for first-of-kind sets
      return result;
    }
  }

  // Check if set matches theme introduction pattern
  for (const [category, data] of Object.entries(THEME_INTRODUCTIONS)) {
    const categoryParts = category.split(' / ');
    const themeParts = theme.split(' / ');

    // Check if theme hierarchy matches
    const themeMatches = categoryParts.every((part, index) => {
      if (index >= themeParts.length) return false;
      return themeParts[index].toLowerCase().includes(part.toLowerCase()) ||
             part.toLowerCase().includes(themeParts[index].toLowerCase());
    });

    if (themeMatches && data.firstSet === setId) {
      result.isFirstOfKind = true;
      result.category = category;
      result.reason = data.description;
      result.introductionYear = data.year;
      result.premiumFactor = 1.25;
      return result;
    }
  }

  // Check for license-based first-of-kind
  for (const license of FIRST_OF_KIND_INDICATORS.licenses) {
    if (name.toLowerCase().includes(license.toLowerCase()) ||
        theme.toLowerCase().includes(license.toLowerCase())) {
      // Check if this set is the first for this license in THEME_INTRODUCTIONS
      const matchingCategory = Object.entries(THEME_INTRODUCTIONS).find(([cat, data]) => {
        return cat.toLowerCase().includes(license.toLowerCase()) && data.firstSet === setId;
      });

      if (matchingCategory) {
        result.isFirstOfKind = true;
        result.category = matchingCategory[0];
        result.reason = matchingCategory[1].description;
        result.introductionYear = matchingCategory[1].year;
        result.premiumFactor = 1.20;
        return result;
      }
    }
  }

  // Check for category-based first-of-kind
  for (const category of FIRST_OF_KIND_INDICATORS.categories) {
    if (theme.toLowerCase().includes(category.toLowerCase())) {
      const matchingCategory = Object.entries(THEME_INTRODUCTIONS).find(([cat, data]) => {
        return cat.toLowerCase().includes(category.toLowerCase()) && data.firstSet === setId;
      });

      if (matchingCategory) {
        result.isFirstOfKind = true;
        result.category = matchingCategory[0];
        result.reason = matchingCategory[1].description;
        result.introductionYear = matchingCategory[1].year;
        result.premiumFactor = 1.15;
        return result;
      }
    }
  }

  return result;
}

/**
 * Determine overall trend direction based on multiple periods
 * @param {Object} trend30d - 30-day trend analysis
 * @param {Object} trend90d - 90-day trend analysis
 * @param {Object} trend365d - 365-day trend analysis
 * @returns {string} Overall trend direction
 */
function determineOverallTrend(trend30d, trend90d, trend365d) {
  const trends = [trend30d.trend, trend90d.trend, trend365d.trend];
  const validTrends = trends.filter(t => t && t !== 'unknown' && t !== 'insufficient_data' && t !== 'no_data');

  if (validTrends.length === 0) return 'unknown';

  const risingCount = validTrends.filter(t => t === 'rising').length;
  const fallingCount = validTrends.filter(t => t === 'falling').length;

  // Weight recent trends more heavily
  if (trend30d.trend === 'rising' && risingCount >= 2) return 'rising';
  if (trend30d.trend === 'falling' && fallingCount >= 2) return 'falling';

  if (risingCount > fallingCount) return 'rising';
  if (fallingCount > risingCount) return 'falling';

  return 'stable';
}

/**
 * Analyze all price trends for a set
 * @param {string} setId - Set identifier
 * @param {Object} priceHistoryData - Price history data
 * @param {Object} ebayHistoryData - eBay price history data
 * @param {Object} portfolioSetInfo - Portfolio set info (optional, for first-of-kind detection)
 * @returns {Object} Complete analysis results
 */
function analyzeSet(setId, priceHistoryData, ebayHistoryData, portfolioSetInfo = null) {
  const setData = priceHistoryData.sets?.[setId];
  const priceHistory = setData?.priceHistory || [];

  // BrickEconomy trends
  const trend30d = analyzeTrendForPeriod(priceHistory, 30);
  const trend90d = analyzeTrendForPeriod(priceHistory, 90);
  const trend365d = analyzeTrendForPeriod(priceHistory, 365);

  // eBay trends (if available)
  const ebayListings = ebayHistoryData.soldListings?.[setId];
  const ebayTrend30d = analyzeEbayTrendForPeriod(ebayListings, 30);
  const ebayTrend90d = analyzeEbayTrendForPeriod(ebayListings, 90);

  // Overall trend determination
  const overallTrend = determineOverallTrend(trend30d, trend90d, trend365d);

  // Calculate overall volatility
  const allPrices = priceHistory.map(e => e.newValue).filter(v => v != null);
  const overallVolatility = calculateCoeffOfVariation(allPrices);
  const overallVolatilityIndicator = getVolatilityIndicator(overallVolatility);

  // First-of-kind detection
  const setInfo = portfolioSetInfo || { name: setData?.name, theme: setData?.theme };
  const firstOfKind = detectFirstOfKind(setId, setInfo);

  return {
    setId,
    setName: setData?.name || portfolioSetInfo?.name || 'Unknown',
    theme: portfolioSetInfo?.theme || setData?.theme || 'Unknown',
    currentValue: setData?.currentValue || null,
    analyzedAt: new Date().toISOString(),
    brickEconomy: {
      trend30d,
      trend90d,
      trend365d,
      overallTrend,
      overallVolatility: overallVolatility ? parseFloat(overallVolatility.toFixed(4)) : null,
      overallVolatilityIndicator,
      dataPointsTotal: priceHistory.length,
    },
    ebay: {
      trend30d: ebayTrend30d,
      trend90d: ebayTrend90d,
      statistics: ebayListings?.statistics || null,
      lastUpdate: ebayListings?.lastUpdate || null,
    },
    firstOfKind,
    summary: {
      trend: overallTrend,
      volatility: overallVolatilityIndicator,
      firstOfKind: firstOfKind.isFirstOfKind,
      recommendation: getRecommendation(overallTrend, overallVolatilityIndicator),
    },
  };
}

/**
 * Generate a recommendation based on trend and volatility
 * @param {string} trend - Trend direction
 * @param {string} volatility - Volatility level
 * @returns {string} Recommendation
 */
function getRecommendation(trend, volatility) {
  if (trend === 'rising' && volatility === 'low') {
    return 'Strong buy - consistent upward trend with low volatility';
  }
  if (trend === 'rising' && volatility === 'high') {
    return 'Moderate buy - upward trend but high volatility';
  }
  if (trend === 'falling' && volatility === 'low') {
    return 'Hold or sell - consistent downward trend';
  }
  if (trend === 'falling' && volatility === 'high') {
    return 'Caution - declining with high volatility';
  }
  if (trend === 'stable') {
    return 'Hold - stable prices, good for long-term holding';
  }
  return 'Insufficient data for recommendation';
}

/**
 * Format analysis results for display
 * @param {Object} analysis - Analysis results
 */
function displayAnalysis(analysis) {
  logger.section(`Analysis: ${analysis.setId} - ${analysis.setName}`);

  logger.info(`Theme: ${analysis.theme || 'Unknown'}`);
  logger.info(`Current Value: ${analysis.currentValue ? '€' + analysis.currentValue.toFixed(2) : 'N/A'}`);
  logger.info(`Overall Trend: ${analysis.summary.trend.toUpperCase()}`);
  logger.info(`Volatility: ${analysis.summary.volatility.toUpperCase()}`);

  // Display first-of-kind status
  if (analysis.firstOfKind && analysis.firstOfKind.isFirstOfKind) {
    logger.info('');
    logger.info('⭐ FIRST OF KIND');
    logger.info(`  Category: ${analysis.firstOfKind.category}`);
    logger.info(`  Reason: ${analysis.firstOfKind.reason}`);
    logger.info(`  Introduction Year: ${analysis.firstOfKind.introductionYear}`);
    logger.info(`  Premium Factor: ${(analysis.firstOfKind.premiumFactor * 100 - 100).toFixed(0)}% premium`);
  }

  logger.info('');
  logger.info(`Recommendation: ${analysis.summary.recommendation}`);

  logger.info('');
  logger.info('BrickEconomy Price Trends:');
  logger.info(`  30-day:  ${formatTrendLine(analysis.brickEconomy.trend30d)}`);
  logger.info(`  90-day:  ${formatTrendLine(analysis.brickEconomy.trend90d)}`);
  logger.info(`  365-day: ${formatTrendLine(analysis.brickEconomy.trend365d)}`);

  if (analysis.ebay.statistics) {
    logger.info('');
    logger.info('eBay Market Data:');
    logger.info(`  Median Price: €${analysis.ebay.statistics.median || 'N/A'}`);
    logger.info(`  Price Range: €${analysis.ebay.statistics.min || 'N/A'} - €${analysis.ebay.statistics.max || 'N/A'}`);
    logger.info(`  Sample Size: ${analysis.ebay.statistics.count || 0} listings`);
    logger.info(`  30-day trend: ${formatTrendLine(analysis.ebay.trend30d)}`);
  }
}

/**
 * Format a single trend line for display
 * @param {Object} trendData - Trend data for a period
 * @returns {string} Formatted trend line
 */
function formatTrendLine(trendData) {
  if (trendData.trend === 'insufficient_data' || trendData.trend === 'no_data') {
    return `${trendData.period} - Insufficient data (${trendData.dataPoints} points)`;
  }

  const changeStr = trendData.percentChange !== null
    ? `${trendData.percentChange > 0 ? '+' : ''}${trendData.percentChange}%`
    : 'N/A';

  const trendIcon = trendData.trend === 'rising' ? '↑' :
                    trendData.trend === 'falling' ? '↓' : '→';

  return `${trendIcon} ${trendData.trend.toUpperCase()} (${changeStr}) - ${trendData.dataPoints} data points`;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleSet = args.find((a, i) => args[i - 1] === '--set');
  const analyzeAll = args.includes('--all');

  logger.section('LEGO Price Analyzer');

  if (dryRun) {
    logger.info('[DRY RUN] Would analyze price trends');
    logger.info('Trend indicators: rising, stable, falling');
    logger.info('Volatility indicators: low, medium, high');
    logger.info('Analysis periods: 30-day, 90-day, 365-day');
    logger.info('First-of-kind detection: enabled');
    return;
  }

  // Load data
  const priceHistory = loadPriceHistory();
  const ebayHistory = loadEbayPriceHistory();
  const portfolio = loadPortfolio();

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

  logger.info(`Analyzing ${setsToAnalyze.length} set(s)...`);

  // Analyze each set
  const results = [];
  for (const setId of setsToAnalyze) {
    try {
      // Get portfolio set info for first-of-kind detection
      const portfolioSetInfo = portfolio.sets.find(s => s.setNumber === setId);
      const analysis = analyzeSet(setId, priceHistory, ebayHistory, portfolioSetInfo);
      results.push(analysis);
      displayAnalysis(analysis);
    } catch (error) {
      logger.error(`Failed to analyze set ${setId}`, error);
    }
  }

  // Summary
  logger.section('Analysis Summary');
  const rising = results.filter(r => r.summary.trend === 'rising').length;
  const falling = results.filter(r => r.summary.trend === 'falling').length;
  const stable = results.filter(r => r.summary.trend === 'stable').length;
  const unknown = results.filter(r => r.summary.trend === 'unknown').length;
  const firstOfKindCount = results.filter(r => r.summary.firstOfKind).length;

  logger.info(`Total sets analyzed: ${results.length}`);
  logger.info(`Rising: ${rising}`);
  logger.info(`Stable: ${stable}`);
  logger.info(`Falling: ${falling}`);
  logger.info(`Unknown/Insufficient data: ${unknown}`);
  logger.info(`First-of-kind sets: ${firstOfKindCount}`);

  return results;
}

// Export functions for testing and use by other modules
module.exports = {
  loadPriceHistory,
  loadEbayPriceHistory,
  loadPortfolio,
  filterByDays,
  calculatePercentageChange,
  getTrendIndicator,
  calculateMean,
  calculateStdDev,
  calculateCoeffOfVariation,
  getVolatilityIndicator,
  calculateMovingAverage,
  analyzeTrendForPeriod,
  analyzeEbayTrendForPeriod,
  determineOverallTrend,
  detectFirstOfKind,
  analyzeSet,
  getRecommendation,
  TREND_THRESHOLDS,
  VOLATILITY_THRESHOLDS,
  THEME_INTRODUCTIONS,
  FIRST_OF_KIND_INDICATORS,
  DATA_DIR,
  PORTFOLIO_FILE,
  PRICE_HISTORY_FILE,
  EBAY_PRICE_HISTORY_FILE,
};

if (require.main === module) {
  main().catch(error => {
    logger.error('Price analyzer failed', error);
    process.exit(1);
  });
}
