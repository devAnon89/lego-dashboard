#!/usr/bin/env node
/**
 * Automated Scraper Orchestration Script
 * Master script that runs all scrapers sequentially and generates daily snapshots
 *
 * This script orchestrates the complete data scraping pipeline:
 * 1. Load portfolio
 * 2. Run BrickEconomy scraper for all sets
 * 3. Run eBay scraper for all sets
 * 4. Generate daily portfolio snapshot
 * 5. Log comprehensive summary report
 *
 * Usage:
 *   node scripts/automated-scraper.js
 *   node scripts/automated-scraper.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

// Data file paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const SCRAPER_LOGS_FILE = path.join(DATA_DIR, 'scraper-logs.json');

// Parse command-line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

/**
 * Execute a script as a child process
 * @param {string} scriptPath - Path to the script to execute
 * @param {string[]} scriptArgs - Arguments to pass to the script
 * @returns {Promise<{success: boolean, output: string}>}
 */
function executeScript(scriptPath, scriptArgs = []) {
  return new Promise((resolve) => {
    const script = spawn('node', [scriptPath, ...scriptArgs], {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe'
    });

    let output = '';
    let errorOutput = '';

    script.stdout.on('data', (data) => {
      output += data.toString();
    });

    script.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    script.on('close', (code) => {
      resolve({
        success: code === 0,
        output: output + errorOutput,
        exitCode: code
      });
    });

    script.on('error', (error) => {
      resolve({
        success: false,
        output: error.message,
        exitCode: -1
      });
    });
  });
}

/**
 * Load portfolio data
 */
function loadPortfolio() {
  try {
    if (!fs.existsSync(PORTFOLIO_FILE)) {
      logger.warn('Portfolio file not found', { path: PORTFOLIO_FILE });
      return null;
    }

    const data = fs.readFileSync(PORTFOLIO_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('Failed to load portfolio', error);
    return null;
  }
}

/**
 * Load scraper logs history
 * @returns {Array} Array of historical scraper runs
 */
function loadScraperLogs() {
  try {
    if (!fs.existsSync(SCRAPER_LOGS_FILE)) {
      logger.debug('Scraper logs file not found, will create new one');
      return [];
    }

    const data = fs.readFileSync(SCRAPER_LOGS_FILE, 'utf-8');
    const logs = JSON.parse(data);
    return Array.isArray(logs) ? logs : [];
  } catch (error) {
    logger.warn('Failed to load scraper logs, starting fresh', error);
    return [];
  }
}

/**
 * Save scraper run to logs history
 * @param {Object} runData - Data from the current scraper run
 */
function saveScraperLog(runData) {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Load existing logs
    const logs = loadScraperLogs();

    // Add current run
    logs.push(runData);

    // Keep only last 100 runs to prevent file from growing too large
    const trimmedLogs = logs.slice(-100);

    // Save updated logs
    fs.writeFileSync(SCRAPER_LOGS_FILE, JSON.stringify(trimmedLogs, null, 2));
    logger.debug(`Saved run log to ${SCRAPER_LOGS_FILE}`);

    return true;
  } catch (error) {
    logger.error('Failed to save scraper log', error);
    return false;
  }
}

/**
 * Get status summary string
 * @param {boolean} success - Whether the operation succeeded
 * @returns {string} Status emoji and text
 */
function getStatusString(success) {
  return success ? '✓ SUCCESS' : '✗ FAILED';
}

/**
 * Main orchestration function
 */
async function main() {
  const startTime = Date.now();
  logger.section('Automated Scraper Pipeline');
  logger.info(`Pipeline started at ${new Date().toLocaleString()}`);
  logger.info(`Mode: ${isDryRun ? 'DRY-RUN' : 'PRODUCTION'}`);

  if (isDryRun) {
    logger.info('Running in DRY-RUN mode - no actual scraping will occur');

    // Create log file structure even in dry-run mode for verification
    const dryRunLog = {
      runId: `dry-run-${Date.now()}`,
      mode: 'dry-run',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 0,
      status: 'success',
      portfolio: { loaded: false, setsCount: 0 },
      brickeconomy: { success: false, skipped: true },
      ebay: { success: false, skipped: true },
      snapshot: { success: false, skipped: true }
    };

    saveScraperLog(dryRunLog);
    logger.info('Dry-run log saved successfully');
    console.log('OK');
    return;
  }

  // Track scraping results with comprehensive status information
  const runId = `run-${Date.now()}`;
  const results = {
    runId: runId,
    mode: 'production',
    startTime: new Date().toISOString(),
    endTime: null,
    durationMs: 0,
    status: 'in_progress',
    portfolio: {
      setsCount: 0,
      loaded: false,
      timestamp: null
    },
    brickeconomy: {
      success: false,
      output: '',
      exitCode: null,
      startTime: null,
      endTime: null,
      durationMs: 0
    },
    ebay: {
      success: false,
      output: '',
      exitCode: null,
      startTime: null,
      endTime: null,
      durationMs: 0
    },
    snapshot: {
      success: false,
      output: '',
      exitCode: null,
      startTime: null,
      endTime: null,
      durationMs: 0
    },
    errors: []
  };

  logger.info(`Run ID: ${runId}`);

  // Step 1: Load portfolio
  logger.section('Step 1: Loading Portfolio');
  logger.info(`Loading portfolio from: ${PORTFOLIO_FILE}`);

  const portfolio = loadPortfolio();

  if (!portfolio) {
    const errorMsg = 'Failed to load portfolio. Aborting.';
    logger.error(errorMsg);
    results.status = 'failed';
    results.endTime = new Date().toISOString();
    results.durationMs = Date.now() - startTime;
    results.errors.push({ step: 'portfolio', message: errorMsg });
    saveScraperLog(results);
    process.exit(1);
  }

  results.portfolio.loaded = true;
  results.portfolio.setsCount = portfolio.sets ? portfolio.sets.length : 0;
  results.portfolio.timestamp = new Date().toISOString();

  logger.info(`${getStatusString(true)} Portfolio loaded successfully`);
  logger.info(`  Sets in portfolio: ${results.portfolio.setsCount}`);

  // Step 2: Run BrickEconomy scraper
  logger.section('Step 2: Running BrickEconomy Scraper');
  logger.info(`Scraping price history and predictions for ${results.portfolio.setsCount} sets...`);
  logger.info('Source: BrickEconomy.com');

  const brickEconomyStartTime = Date.now();
  results.brickeconomy.startTime = new Date().toISOString();

  const brickEconomyResult = await executeScript(
    path.join(__dirname, 'scrape-brickeconomy.js'),
    ['--all']
  );

  results.brickeconomy.endTime = new Date().toISOString();
  results.brickeconomy.durationMs = Date.now() - brickEconomyStartTime;
  results.brickeconomy.success = brickEconomyResult.success;
  results.brickeconomy.exitCode = brickEconomyResult.exitCode;
  results.brickeconomy.output = brickEconomyResult.output;

  if (brickEconomyResult.success) {
    logger.info(`${getStatusString(true)} BrickEconomy scraper completed`);
    logger.info(`  Duration: ${(results.brickeconomy.durationMs / 1000).toFixed(2)}s`);
  } else {
    const errorMsg = `BrickEconomy scraper failed with exit code ${brickEconomyResult.exitCode}`;
    logger.error(`${getStatusString(false)} ${errorMsg}`);
    logger.debug('Output:', brickEconomyResult.output);
    results.errors.push({ step: 'brickeconomy', message: errorMsg, exitCode: brickEconomyResult.exitCode });
  }

  // Step 3: Run eBay scraper
  logger.section('Step 3: Running eBay Scraper');
  logger.info(`Scraping market values for ${results.portfolio.setsCount} sets...`);
  logger.info('Source: eBay EU (ebay.de)');

  const ebayStartTime = Date.now();
  results.ebay.startTime = new Date().toISOString();

  const ebayResult = await executeScript(
    path.join(__dirname, 'ebay-scraper.js'),
    ['--all']
  );

  results.ebay.endTime = new Date().toISOString();
  results.ebay.durationMs = Date.now() - ebayStartTime;
  results.ebay.success = ebayResult.success;
  results.ebay.exitCode = ebayResult.exitCode;
  results.ebay.output = ebayResult.output;

  if (ebayResult.success) {
    logger.info(`${getStatusString(true)} eBay scraper completed`);
    logger.info(`  Duration: ${(results.ebay.durationMs / 1000).toFixed(2)}s`);
  } else {
    const errorMsg = `eBay scraper failed with exit code ${ebayResult.exitCode}`;
    logger.error(`${getStatusString(false)} ${errorMsg}`);
    logger.debug('Output:', ebayResult.output);
    results.errors.push({ step: 'ebay', message: errorMsg, exitCode: ebayResult.exitCode });
  }

  // Step 4: Generate daily snapshot
  logger.section('Step 4: Generating Daily Snapshot');
  logger.info('Creating portfolio snapshot for historical tracking...');
  logger.info('This will aggregate all scraped data into a daily summary');

  const snapshotStartTime = Date.now();
  results.snapshot.startTime = new Date().toISOString();

  const snapshotResult = await executeScript(
    path.join(__dirname, 'daily-snapshot.js'),
    []
  );

  results.snapshot.endTime = new Date().toISOString();
  results.snapshot.durationMs = Date.now() - snapshotStartTime;
  results.snapshot.success = snapshotResult.success;
  results.snapshot.exitCode = snapshotResult.exitCode;
  results.snapshot.output = snapshotResult.output;

  if (snapshotResult.success) {
    logger.info(`${getStatusString(true)} Daily snapshot generated`);
    logger.info(`  Duration: ${(results.snapshot.durationMs / 1000).toFixed(2)}s`);
  } else {
    const errorMsg = `Daily snapshot generation failed with exit code ${snapshotResult.exitCode}`;
    logger.error(`${getStatusString(false)} ${errorMsg}`);
    logger.debug('Output:', snapshotResult.output);
    results.errors.push({ step: 'snapshot', message: errorMsg, exitCode: snapshotResult.exitCode });
  }

  // Calculate total duration
  const endTime = Date.now();
  results.endTime = new Date().toISOString();
  results.durationMs = endTime - startTime;

  // Determine overall success
  const overallSuccess = results.brickeconomy.success &&
                         results.ebay.success &&
                         results.snapshot.success;

  results.status = overallSuccess ? 'success' : 'failed';

  // Step 5: Log comprehensive summary report
  logger.section('Pipeline Summary Report');
  logger.info(`Run ID: ${runId}`);
  logger.info(`Started: ${new Date(results.startTime).toLocaleString()}`);
  logger.info(`Ended: ${new Date(results.endTime).toLocaleString()}`);
  logger.info(`Total duration: ${(results.durationMs / 1000).toFixed(2)}s`);
  logger.info('');

  logger.info('Execution Status:');
  logger.info(`  Portfolio:     ${getStatusString(results.portfolio.loaded)} (${results.portfolio.setsCount} sets)`);
  logger.info(`  BrickEconomy:  ${getStatusString(results.brickeconomy.success)} (${(results.brickeconomy.durationMs / 1000).toFixed(2)}s)`);
  logger.info(`  eBay:          ${getStatusString(results.ebay.success)} (${(results.ebay.durationMs / 1000).toFixed(2)}s)`);
  logger.info(`  Snapshot:      ${getStatusString(results.snapshot.success)} (${(results.snapshot.durationMs / 1000).toFixed(2)}s)`);

  if (results.errors.length > 0) {
    logger.info('');
    logger.warn(`Errors encountered: ${results.errors.length}`);
    results.errors.forEach((error, index) => {
      logger.warn(`  ${index + 1}. [${error.step}] ${error.message}`);
    });
  }

  // Save results to last-run file for quick access
  const resultsFile = path.join(DATA_DIR, 'last-scrape-results.json');
  try {
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    logger.debug(`Last run results saved to ${resultsFile}`);
  } catch (error) {
    logger.warn('Failed to save last-run results file', error);
  }

  // Save to persistent scraper logs history
  const logSaved = saveScraperLog(results);
  if (logSaved) {
    logger.info('');
    logger.info(`Run log saved to ${SCRAPER_LOGS_FILE}`);
    logger.info('Historical logs maintained for last 100 runs');
  }

  // Final status message
  logger.info('');
  logger.section(overallSuccess ? 'Pipeline Completed Successfully ✓' : 'Pipeline Completed with Errors ✗');

  if (overallSuccess) {
    logger.info('All scrapers executed successfully');
    logger.info('Portfolio data is up to date');
  } else {
    logger.error('Some scrapers failed - check logs for details');
    logger.info('Portfolio data may be incomplete');
  }

  // Exit with appropriate code
  process.exit(overallSuccess ? 0 : 1);
}

// Run main function
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error in automated scraper', error);
    process.exit(1);
  });
}

// Export for testing
module.exports = {
  loadPortfolio,
  executeScript,
  loadScraperLogs,
  saveScraperLog,
  getStatusString
};
