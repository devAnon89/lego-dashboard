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
 * @returns {Object} Complete analysis results
 */
function analyzeSet(setId, priceHistoryData, ebayHistoryData) {
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

  return {
    setId,
    setName: setData?.name || 'Unknown',
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
    summary: {
      trend: overallTrend,
      volatility: overallVolatilityIndicator,
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

  logger.info(`Current Value: ${analysis.currentValue ? '€' + analysis.currentValue.toFixed(2) : 'N/A'}`);
  logger.info(`Overall Trend: ${analysis.summary.trend.toUpperCase()}`);
  logger.info(`Volatility: ${analysis.summary.volatility.toUpperCase()}`);
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
      const analysis = analyzeSet(setId, priceHistory, ebayHistory);
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

  logger.info(`Total sets analyzed: ${results.length}`);
  logger.info(`Rising: ${rising}`);
  logger.info(`Stable: ${stable}`);
  logger.info(`Falling: ${falling}`);
  logger.info(`Unknown/Insufficient data: ${unknown}`);

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
  analyzeSet,
  getRecommendation,
  TREND_THRESHOLDS,
  VOLATILITY_THRESHOLDS,
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
