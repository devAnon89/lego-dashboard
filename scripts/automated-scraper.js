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
 * Main orchestration function
 */
async function main() {
  const startTime = Date.now();
  logger.section('Automated Scraper Pipeline');

  if (isDryRun) {
    logger.info('Running in DRY-RUN mode - no actual scraping will occur');
    console.log('OK');
    return;
  }

  // Track scraping results
  const results = {
    startTime: new Date().toISOString(),
    endTime: null,
    durationMs: 0,
    portfolio: {
      setsCount: 0,
      loaded: false
    },
    brickeconomy: {
      success: false,
      output: '',
      exitCode: null
    },
    ebay: {
      success: false,
      output: '',
      exitCode: null
    },
    snapshot: {
      success: false,
      output: '',
      exitCode: null
    }
  };

  // Step 1: Load portfolio
  logger.section('Step 1: Loading Portfolio');
  const portfolio = loadPortfolio();

  if (!portfolio) {
    logger.error('Failed to load portfolio. Aborting.');
    process.exit(1);
  }

  results.portfolio.loaded = true;
  results.portfolio.setsCount = portfolio.sets ? portfolio.sets.length : 0;
  logger.info(`Portfolio loaded: ${results.portfolio.setsCount} sets`);

  // Step 2: Run BrickEconomy scraper
  logger.section('Step 2: Running BrickEconomy Scraper');
  logger.info('Scraping price history and predictions from BrickEconomy...');

  const brickEconomyResult = await executeScript(
    path.join(__dirname, 'scrape-brickeconomy.js'),
    ['--all']
  );

  results.brickeconomy = brickEconomyResult;

  if (brickEconomyResult.success) {
    logger.info('BrickEconomy scraper completed successfully');
  } else {
    logger.error('BrickEconomy scraper failed', {
      exitCode: brickEconomyResult.exitCode
    });
  }

  // Step 3: Run eBay scraper
  logger.section('Step 3: Running eBay Scraper');
  logger.info('Scraping market values from eBay EU...');

  const ebayResult = await executeScript(
    path.join(__dirname, 'ebay-scraper.js'),
    ['--all']
  );

  results.ebay = ebayResult;

  if (ebayResult.success) {
    logger.info('eBay scraper completed successfully');
  } else {
    logger.error('eBay scraper failed', {
      exitCode: ebayResult.exitCode
    });
  }

  // Step 4: Generate daily snapshot
  logger.section('Step 4: Generating Daily Snapshot');
  logger.info('Creating portfolio snapshot for historical tracking...');

  const snapshotResult = await executeScript(
    path.join(__dirname, 'daily-snapshot.js'),
    []
  );

  results.snapshot = snapshotResult;

  if (snapshotResult.success) {
    logger.info('Daily snapshot generated successfully');
  } else {
    logger.error('Daily snapshot generation failed', {
      exitCode: snapshotResult.exitCode
    });
  }

  // Calculate total duration
  const endTime = Date.now();
  results.endTime = new Date().toISOString();
  results.durationMs = endTime - startTime;

  // Step 5: Log summary report
  logger.section('Pipeline Summary Report');
  logger.info(`Total duration: ${(results.durationMs / 1000).toFixed(2)}s`);
  logger.info('');
  logger.info('Results:');
  logger.info(`  Portfolio: ${results.portfolio.loaded ? 'Loaded' : 'Failed'} (${results.portfolio.setsCount} sets)`);
  logger.info(`  BrickEconomy: ${results.brickeconomy.success ? 'Success' : 'Failed'}`);
  logger.info(`  eBay: ${results.ebay.success ? 'Success' : 'Failed'}`);
  logger.info(`  Snapshot: ${results.snapshot.success ? 'Success' : 'Failed'}`);

  // Determine overall success
  const overallSuccess = results.brickeconomy.success &&
                         results.ebay.success &&
                         results.snapshot.success;

  logger.section(overallSuccess ? 'Pipeline Completed Successfully' : 'Pipeline Completed with Errors');

  // Save results to log file for programmatic access
  const resultsFile = path.join(DATA_DIR, 'last-scrape-results.json');
  try {
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    logger.info(`Results saved to ${resultsFile}`);
  } catch (error) {
    logger.warn('Failed to save results file', error);
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
  executeScript
};
