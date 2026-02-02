#!/usr/bin/env node
/**
 * AI Price Predictor for LEGO Portfolio
 * Uses OpenAI to generate intelligent price predictions based on historical data,
 * eBay sold listings, similar sets analysis, and market factors.
 *
 * Usage:
 *   node scripts/ai-price-predictor.cjs --set 10316-1
 *   node scripts/ai-price-predictor.cjs --set 10316-1 --dry-run
 *   node scripts/ai-price-predictor.cjs --all
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger.cjs');
const priceAnalyzer = require('./price-analyzer.cjs');
const similarSetsMatcher = require('./similar-sets-matcher.cjs');

// Configuration from environment
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '2000', 10);

// Data file paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const EBAY_PRICE_HISTORY_FILE = path.join(DATA_DIR, 'ebay-price-history.json');
const DEEP_ANALYSIS_FILE = path.join(DATA_DIR, 'deep-analysis.json');
const AI_PREDICTIONS_CACHE_FILE = path.join(DATA_DIR, 'ai-predictions-cache.json');

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 */
async function withRetry(fn, options = {}) {
  const { maxRetries = MAX_RETRIES, retryDelay = RETRY_DELAY, context = '' } = options;

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        logger.warn(`${context} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, error);
        await sleep(delay);
      } else {
        logger.error(`${context} failed after ${maxRetries} attempts`, error);
      }
    }
  }

  throw lastError;
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
 * Load deep analysis data
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
 * Build structured prompt for OpenAI
 * @param {Object} setData - Set data from portfolio
 * @param {Object} priceAnalysis - Price analysis results
 * @param {Object} similarSets - Similar sets analysis
 * @param {Object} deepAnalysis - Deep analysis data for the set
 * @param {Object} ebayData - eBay sold listings data
 * @returns {string} Structured prompt
 */
function buildPrompt(setData, priceAnalysis, similarSets, deepAnalysis, ebayData) {
  // Format historical data
  const brickEconomyTrends = priceAnalysis.brickEconomy
    ? `30-day: ${priceAnalysis.brickEconomy.trend30d.trend} (${priceAnalysis.brickEconomy.trend30d.percentChange || 'N/A'}%)
90-day: ${priceAnalysis.brickEconomy.trend90d.trend} (${priceAnalysis.brickEconomy.trend90d.percentChange || 'N/A'}%)
365-day: ${priceAnalysis.brickEconomy.trend365d.trend} (${priceAnalysis.brickEconomy.trend365d.percentChange || 'N/A'}%)`
    : 'No historical data available';

  // Format eBay data
  let ebayListings = 'No eBay sold listings available';
  if (ebayData && ebayData.statistics && ebayData.statistics.count > 0) {
    ebayListings = `Median Price: €${ebayData.statistics.median}
Mean Price: €${ebayData.statistics.mean}
Price Range: €${ebayData.statistics.min} - €${ebayData.statistics.max}
Sample Size: ${ebayData.statistics.count} listings
Standard Deviation: €${ebayData.statistics.stdDev}`;
  }

  // Format similar sets data
  let similarSetsData = 'No similar sets data available';
  if (similarSets && similarSets.similarSets && similarSets.similarSets.length > 0) {
    const setsInfo = similarSets.similarSets.map(s =>
      `• ${s.name} (${s.setNumber}): Retail=€${s.retail}, Value=€${s.value}, Growth=${s.growth?.toFixed(1) || 'N/A'}%`
    ).join('\n');
    const metrics = similarSets.performanceMetrics;
    similarSetsData = `${setsInfo}

Similar Sets Average Performance:
- Average Growth: ${metrics.avgGrowth?.toFixed(1) || 'N/A'}%
- Growth Range: ${metrics.growthRange.min?.toFixed(1) || 'N/A'}% to ${metrics.growthRange.max?.toFixed(1) || 'N/A'}%
- Sample Size: ${metrics.sampleSize} sets`;
  }

  // Format first-of-kind status
  const firstOfKind = priceAnalysis.firstOfKind && priceAnalysis.firstOfKind.isFirstOfKind
    ? `Yes - ${priceAnalysis.firstOfKind.reason} (${priceAnalysis.firstOfKind.introductionYear})`
    : 'No';

  // Get license score from deep analysis or estimate
  const licenseScore = deepAnalysis?.license || 0;

  // Determine retirement status based on growth and market signals
  let retirementStatus = 'Active';
  if (deepAnalysis?.retirement >= 7) {
    retirementStatus = 'Likely retiring soon';
  } else if (deepAnalysis?.retirement >= 5) {
    retirementStatus = 'May retire within 1-2 years';
  }

  const prompt = `You are a LEGO market price analyst. Analyze the following data and predict the market value.

Set: ${setData.name} (${setData.setNumber})
Theme: ${setData.theme}
Retail Price: €${setData.retail}
Current Market Price: €${setData.value}
Current Growth: ${setData.growth?.toFixed(1) || 'N/A'}%
Quantity Held: ${setData.qtyNew || 0} new, ${setData.qtyUsed || 0} used

Historical Data (BrickEconomy):
${brickEconomyTrends}

Recent eBay Sold Listings (last 30 days):
${ebayListings}

Similar Sets Performance:
${similarSetsData}

Additional Factors:
- Retirement Status: ${retirementStatus}
- First of Kind: ${firstOfKind}
- License Strength: ${licenseScore}/10
- Overall Trend: ${priceAnalysis.summary?.trend || 'unknown'}
- Volatility: ${priceAnalysis.summary?.volatility || 'unknown'}

Provide:
1. 1-year price prediction (value in EUR)
2. 5-year price prediction (value in EUR)
3. Confidence level (low/medium/high)
4. Brief reasoning (2-3 sentences)

Respond in JSON format:
{
  "prediction1yr": <number>,
  "prediction5yr": <number>,
  "confidence": "<low|medium|high>",
  "reasoning": "<string>"
}`;

  return prompt;
}

/**
 * Call OpenAI API to generate price prediction
 * @param {string} prompt - Structured prompt
 * @returns {Object} Parsed prediction response
 */
async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message);
  }

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid response from OpenAI API');
  }

  return JSON.parse(data.choices[0].message.content);
}

/**
 * Generate AI prediction for a single set
 * @param {string} setId - Set identifier
 * @param {Object} portfolio - Portfolio data
 * @param {Object} ebayHistory - eBay price history
 * @param {Object} deepAnalysis - Deep analysis data
 * @param {Object} priceHistory - BrickEconomy price history
 * @returns {Object} AI prediction result
 */
async function generatePrediction(setId, portfolio, ebayHistory, deepAnalysis, priceHistory) {
  // Find set in portfolio
  const setData = portfolio.sets.find(s => s.setNumber === setId);
  if (!setData) {
    throw new Error(`Set ${setId} not found in portfolio`);
  }

  logger.info(`Generating prediction for ${setId} - ${setData.name}`);

  // Get price analysis
  const priceAnalysis = priceAnalyzer.analyzeSet(setId, priceHistory, ebayHistory, setData);

  // Get similar sets
  let similarSets = null;
  try {
    similarSets = similarSetsMatcher.findSimilarSets(setId, portfolio, deepAnalysis);
  } catch (error) {
    logger.warn(`Could not find similar sets for ${setId}`, error);
  }

  // Get eBay data for this set
  const ebayData = ebayHistory.soldListings?.[setId] || null;

  // Get deep analysis for this set
  const setDeepAnalysis = deepAnalysis[setId] || null;

  // Build prompt
  const prompt = buildPrompt(setData, priceAnalysis, similarSets, setDeepAnalysis, ebayData);

  // Call OpenAI with retry logic
  const aiResponse = await withRetry(
    async () => await callOpenAI(prompt),
    { context: `OpenAI prediction for ${setId}` }
  );

  // Calculate prediction dates
  const now = new Date();
  const oneYearLater = new Date(now);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  const fiveYearsLater = new Date(now);
  fiveYearsLater.setFullYear(fiveYearsLater.getFullYear() + 5);

  // Calculate growth percentages
  const currentValue = setData.value || setData.retail;
  const growth1yr = currentValue > 0
    ? ((aiResponse.prediction1yr - currentValue) / currentValue) * 100
    : null;
  const growth5yr = currentValue > 0
    ? ((aiResponse.prediction5yr - currentValue) / currentValue) * 100
    : null;

  return {
    setId,
    setName: setData.name,
    theme: setData.theme,
    currentValue,
    prediction: {
      '1yr': {
        value: parseFloat(aiResponse.prediction1yr.toFixed(2)),
        date: oneYearLater.toISOString().split('T')[0],
        source: 'OpenAI GPT-4'
      },
      '5yr': {
        value: parseFloat(aiResponse.prediction5yr.toFixed(2)),
        date: fiveYearsLater.toISOString().split('T')[0],
        source: 'OpenAI GPT-4'
      },
      growth1yr: growth1yr !== null ? parseFloat(growth1yr.toFixed(2)) : null,
      growth5yr: growth5yr !== null ? parseFloat(growth5yr.toFixed(2)) : null,
      confidence: aiResponse.confidence,
      reasoning: aiResponse.reasoning
    },
    analyzedAt: now.toISOString(),
    inputSummary: {
      ebayListingsCount: ebayData?.statistics?.count || 0,
      similarSetsCount: similarSets?.similarSets?.length || 0,
      hasHistoricalData: priceAnalysis.brickEconomy?.dataPointsTotal > 0,
      firstOfKind: priceAnalysis.firstOfKind?.isFirstOfKind || false
    }
  };
}

/**
 * Generate dry-run sample prediction
 * @param {string} setId - Set identifier
 * @returns {Object} Sample prediction for verification
 */
function generateDryRunPrediction(setId) {
  const now = new Date();
  const oneYearLater = new Date(now);
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
  const fiveYearsLater = new Date(now);
  fiveYearsLater.setFullYear(fiveYearsLater.getFullYear() + 5);

  return {
    setId,
    setName: 'Sample Set (Dry Run)',
    theme: 'Icons / Licensed',
    currentValue: 500.00,
    prediction: {
      '1yr': {
        value: 575.00,
        date: oneYearLater.toISOString().split('T')[0],
        source: 'OpenAI GPT-4 (dry-run)'
      },
      '5yr': {
        value: 850.00,
        date: fiveYearsLater.toISOString().split('T')[0],
        source: 'OpenAI GPT-4 (dry-run)'
      },
      growth1yr: 15.00,
      growth5yr: 70.00,
      confidence: 'medium',
      reasoning: 'This is a dry-run prediction. In production, AI analysis would consider historical data, eBay listings, similar sets performance, and market factors.'
    },
    analyzedAt: now.toISOString(),
    inputSummary: {
      ebayListingsCount: 25,
      similarSetsCount: 4,
      hasHistoricalData: true,
      firstOfKind: false
    }
  };
}

/**
 * Display prediction results
 * @param {Object} prediction - Prediction result
 */
function displayPrediction(prediction) {
  logger.section(`AI Prediction: ${prediction.setId} - ${prediction.setName}`);

  logger.info(`Theme: ${prediction.theme}`);
  logger.info(`Current Value: €${prediction.currentValue.toFixed(2)}`);
  logger.info('');
  logger.info('Predictions:');
  logger.info(`  1-Year: €${prediction.prediction['1yr'].value.toFixed(2)} (${prediction.prediction.growth1yr > 0 ? '+' : ''}${prediction.prediction.growth1yr?.toFixed(1) || 'N/A'}%)`);
  logger.info(`  5-Year: €${prediction.prediction['5yr'].value.toFixed(2)} (${prediction.prediction.growth5yr > 0 ? '+' : ''}${prediction.prediction.growth5yr?.toFixed(1) || 'N/A'}%)`);
  logger.info('');
  logger.info(`Confidence: ${prediction.prediction.confidence.toUpperCase()}`);
  logger.info(`Reasoning: ${prediction.prediction.reasoning}`);
  logger.info('');
  logger.info('Input Data Summary:');
  logger.info(`  eBay Listings: ${prediction.inputSummary.ebayListingsCount}`);
  logger.info(`  Similar Sets: ${prediction.inputSummary.similarSetsCount}`);
  logger.info(`  Historical Data: ${prediction.inputSummary.hasHistoricalData ? 'Yes' : 'No'}`);
  logger.info(`  First of Kind: ${prediction.inputSummary.firstOfKind ? 'Yes' : 'No'}`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleSet = args.find((a, i) => args[i - 1] === '--set');
  const predictAll = args.includes('--all');

  logger.section('AI Price Predictor');

  // Dry-run mode for verification
  if (dryRun) {
    const setId = singleSet || '10316-1';
    logger.info(`[DRY RUN] Would generate AI prediction for ${setId}`);
    logger.info('');
    logger.info('Configuration:');
    logger.info(`  OpenAI Model: gpt-4o`);
    logger.info(`  Max Retries: ${MAX_RETRIES}`);
    logger.info(`  Retry Delay: ${RETRY_DELAY}ms`);
    logger.info('');

    const samplePrediction = generateDryRunPrediction(setId);
    displayPrediction(samplePrediction);

    // Output JSON for verification
    logger.info('');
    logger.info('Sample JSON Output:');
    console.log(JSON.stringify(samplePrediction, null, 2));
    return;
  }

  // Check for OpenAI API key
  if (!OPENAI_API_KEY) {
    logger.error('OPENAI_API_KEY environment variable is not set');
    logger.info('Please set the OPENAI_API_KEY in your .env file or environment');
    process.exit(1);
  }

  // Load data
  const portfolio = loadPortfolio();
  const ebayHistory = loadEbayPriceHistory();
  const deepAnalysis = loadDeepAnalysis();
  const priceHistory = priceAnalyzer.loadPriceHistory();

  // Determine which sets to predict
  let setsToPredictIds = [];

  if (singleSet) {
    const portfolioSet = portfolio.sets.find(s => s.setNumber === singleSet);
    if (!portfolioSet) {
      logger.error(`Set ${singleSet} not found in portfolio`);
      process.exit(1);
    }
    setsToPredictIds = [singleSet];
  } else if (predictAll) {
    setsToPredictIds = portfolio.sets.map(s => s.setNumber);
  } else {
    logger.error('Please specify --set <setId> or --all');
    process.exit(1);
  }

  logger.info(`Generating predictions for ${setsToPredictIds.length} set(s)...`);
  logger.info('');

  // Generate predictions
  const predictions = [];
  for (const setId of setsToPredictIds) {
    try {
      const prediction = await generatePrediction(setId, portfolio, ebayHistory, deepAnalysis, priceHistory);
      predictions.push(prediction);
      displayPrediction(prediction);

      // Add delay between API calls to avoid rate limiting
      if (setsToPredictIds.length > 1) {
        await sleep(500);
      }
    } catch (error) {
      logger.error(`Failed to generate prediction for ${setId}`, error);
    }
  }

  // Summary
  logger.section('Prediction Summary');
  const successful = predictions.length;
  const failed = setsToPredictIds.length - predictions.length;

  logger.info(`Total sets: ${setsToPredictIds.length}`);
  logger.info(`Successful predictions: ${successful}`);
  logger.info(`Failed: ${failed}`);

  if (predictions.length > 0) {
    const avgGrowth1yr = predictions.reduce((sum, p) => sum + (p.prediction.growth1yr || 0), 0) / predictions.length;
    const avgGrowth5yr = predictions.reduce((sum, p) => sum + (p.prediction.growth5yr || 0), 0) / predictions.length;

    logger.info('');
    logger.info('Portfolio Outlook:');
    logger.info(`  Average 1-Year Growth Prediction: ${avgGrowth1yr > 0 ? '+' : ''}${avgGrowth1yr.toFixed(1)}%`);
    logger.info(`  Average 5-Year Growth Prediction: ${avgGrowth5yr > 0 ? '+' : ''}${avgGrowth5yr.toFixed(1)}%`);

    // Count by confidence level
    const highConfidence = predictions.filter(p => p.prediction.confidence === 'high').length;
    const mediumConfidence = predictions.filter(p => p.prediction.confidence === 'medium').length;
    const lowConfidence = predictions.filter(p => p.prediction.confidence === 'low').length;

    logger.info('');
    logger.info('Confidence Distribution:');
    logger.info(`  High: ${highConfidence}`);
    logger.info(`  Medium: ${mediumConfidence}`);
    logger.info(`  Low: ${lowConfidence}`);
  }

  return predictions;
}

// Export functions for testing and use by other modules
module.exports = {
  loadPortfolio,
  loadEbayPriceHistory,
  loadDeepAnalysis,
  buildPrompt,
  callOpenAI,
  generatePrediction,
  generateDryRunPrediction,
  withRetry,
  sleep,
  DATA_DIR,
  PORTFOLIO_FILE,
  EBAY_PRICE_HISTORY_FILE,
  DEEP_ANALYSIS_FILE,
  AI_PREDICTIONS_CACHE_FILE,
};

if (require.main === module) {
  main().catch(error => {
    logger.error('AI price predictor failed', error);
    process.exit(1);
  });
}
