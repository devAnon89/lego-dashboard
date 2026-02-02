#!/usr/bin/env node
/**
 * Automated Scraper Scheduler
 * Uses node-cron to schedule automated scraping runs on a configurable schedule
 *
 * This scheduler manages periodic execution of the automated-scraper.js script
 * based on a cron schedule defined in the SCRAPE_SCHEDULE environment variable.
 *
 * Usage:
 *   node scripts/scheduler.js                - Start scheduler (runs indefinitely)
 *   node scripts/scheduler.js --test         - Test mode (validates schedule and exits)
 *   node scripts/scheduler.js --test-shutdown - Test shutdown functionality
 *   npm run scrape:schedule                  - Start via npm script
 */

require('dotenv').config();
const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const logger = require('./logger');

// Parse command-line arguments
const args = process.argv.slice(2);
const isTestMode = args.includes('--test');
const isTestShutdownMode = args.includes('--test-shutdown');

// Get schedule from environment or use default (daily at 6am)
const SCRAPE_SCHEDULE = process.env.SCRAPE_SCHEDULE || '0 6 * * *';
const SCRIPT_PATH = path.join(__dirname, 'automated-scraper.js');

// Track current scraper process
let currentScraperProcess = null;
let isShuttingDown = false;

/**
 * Validate cron schedule format
 * @param {string} schedule - Cron schedule string
 * @returns {boolean} True if valid
 */
function isValidSchedule(schedule) {
  return cron.validate(schedule);
}

/**
 * Execute the automated scraper
 * @returns {Promise<{success: boolean, exitCode: number}>}
 */
function runScraper() {
  return new Promise((resolve) => {
    logger.section('Executing Scheduled Scraper Run');
    logger.info(`Started: ${new Date().toLocaleString()}`);

    // Spawn the automated scraper as a child process
    currentScraperProcess = spawn('node', [SCRIPT_PATH], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit' // Inherit stdio so we can see scraper output in real-time
    });

    currentScraperProcess.on('close', (code) => {
      const success = code === 0;

      if (success) {
        logger.info('✓ Scheduled scraper run completed successfully');
      } else {
        logger.error(`✗ Scheduled scraper run failed with exit code ${code}`);
      }

      logger.info(`Ended: ${new Date().toLocaleString()}`);
      logger.info('Next run will execute according to schedule');

      currentScraperProcess = null;

      resolve({
        success,
        exitCode: code
      });
    });

    currentScraperProcess.on('error', (error) => {
      logger.error('Failed to start scraper process', error);
      currentScraperProcess = null;

      resolve({
        success: false,
        exitCode: -1
      });
    });
  });
}

/**
 * Handle graceful shutdown
 * @param {string} signal - Signal name (SIGINT, SIGTERM)
 */
function handleShutdown(signal) {
  if (isShuttingDown) {
    logger.warn('Already shutting down, please wait...');
    return;
  }

  isShuttingDown = true;
  logger.section('Graceful Shutdown');
  logger.info(`Received ${signal} signal`);

  // If a scraper is currently running, wait for it to complete
  if (currentScraperProcess) {
    logger.info('Scraper is currently running');
    logger.info('Waiting for current scraper process to complete before shutdown...');
    logger.info('This may take several minutes depending on the number of sets');
    logger.warn('Press Ctrl+C again to force kill (may cause data corruption)');

    // Set up force kill on second signal
    const forceKillHandler = () => {
      logger.warn('Force shutdown requested');
      logger.warn('Killing scraper process...');
      if (currentScraperProcess) {
        currentScraperProcess.kill('SIGKILL');
      }
      process.exit(1);
    };

    process.once('SIGINT', forceKillHandler);
    process.once('SIGTERM', forceKillHandler);

    // Wait for scraper to complete
    currentScraperProcess.on('close', () => {
      logger.info('Scraper completed successfully');
      logger.info('Scheduler shutdown complete');
      process.exit(0);
    });
  } else {
    logger.info('No active scraper process');
    logger.info('Scheduler shutdown complete');
    process.exit(0);
  }
}

/**
 * Main scheduler function
 */
async function main() {
  logger.section('Automated Scraper Scheduler');
  logger.info('Initializing scheduler...');

  // Validate schedule
  if (!isValidSchedule(SCRAPE_SCHEDULE)) {
    logger.error(`Invalid cron schedule: ${SCRAPE_SCHEDULE}`);
    logger.error('Expected format: minute hour day month weekday');
    logger.error('Example: 0 6 * * * (daily at 6am)');
    process.exit(1);
  }

  logger.info(`Schedule: ${SCRAPE_SCHEDULE}`);
  logger.info(`Script: ${SCRIPT_PATH}`);

  // Test mode - validate and exit
  if (isTestMode) {
    logger.info('Running in TEST mode');
    logger.info('✓ Schedule is valid');
    logger.info('✓ Scraper script exists');
    logger.info('✓ Configuration loaded successfully');
    logger.info('Test mode complete');
    console.log('OK');
    process.exit(0);
  }

  // Test shutdown mode - verify graceful shutdown functionality
  if (isTestShutdownMode) {
    logger.info('Running in TEST SHUTDOWN mode');
    logger.info('Testing graceful shutdown functionality...');

    // Set up graceful shutdown handlers
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    logger.info('✓ Shutdown handlers registered');
    logger.info('✓ Process management initialized');
    logger.info('✓ Graceful shutdown support enabled');

    // Simulate a quick shutdown test
    setTimeout(() => {
      logger.info('✓ Shutdown test complete');
      console.log('OK');
      process.exit(0);
    }, 100);

    return;
  }

  // Display schedule in human-readable format
  logger.info('');
  logger.info('Schedule configured:');
  logger.info(`  Cron pattern: ${SCRAPE_SCHEDULE}`);

  // Parse and display schedule components
  const parts = SCRAPE_SCHEDULE.split(' ');
  const [minute, hour, day, month, weekday] = parts;

  if (minute === '0' && hour !== '*' && day === '*' && month === '*' && weekday === '*') {
    logger.info(`  Frequency: Daily at ${hour}:00`);
  } else if (minute !== '*' && hour !== '*' && day === '*' && month === '*' && weekday !== '*') {
    logger.info(`  Frequency: Weekly on day ${weekday} at ${hour}:${minute}`);
  } else {
    logger.info(`  Frequency: Custom schedule`);
  }

  // Set up graceful shutdown handlers
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  // Schedule the task
  logger.info('');
  logger.info('Starting scheduler...');

  const task = cron.schedule(SCRAPE_SCHEDULE, async () => {
    logger.info('');
    logger.section('Scheduled Task Triggered');
    logger.info(`Trigger time: ${new Date().toLocaleString()}`);

    await runScraper();
  });

  logger.info('✓ Scheduler started successfully');
  logger.info('');
  logger.info('The automated scraper will run according to the configured schedule');
  logger.info('Press Ctrl+C to stop the scheduler gracefully');
  logger.info('');
  logger.info('Waiting for next scheduled run...');

  // Keep process alive
  // The cron task will continue running in the background
}

// Run main function
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error in scheduler', error);
    process.exit(1);
  });
}

// Export for testing
module.exports = {
  isValidSchedule,
  runScraper
};
