#!/usr/bin/env node
/**
 * BrickEconomy Scraper Script
 * Extracts price history and future predictions from BrickEconomy set pages using Puppeteer
 *
 * Usage:
 *   node scripts/scrape-brickeconomy.js --set 10316-1
 *   node scripts/scrape-brickeconomy.js --dry-run --set 10316-1
 *   node scripts/scrape-brickeconomy.js --all
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const logger = require('./logger');

// Configuration from environment
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '2000', 10);

// Data file paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');

// Map of set IDs to BrickEconomy URLs
const setUrls = {
  "10316-1": "https://www.brickeconomy.com/set/10316-1/lego-the-lord-of-the-rings-rivendell",
  "10330-1": "https://www.brickeconomy.com/set/10330-1/lego-mclaren-mp4-4-ayrton-senna",
  "10342-1": "https://www.brickeconomy.com/set/10342-1/lego-botanical-collection-pretty-pink-flower-bouquet",
  "21276-1": "https://www.brickeconomy.com/set/21276-1/lego-minecraft-the-creeper",
  "21279-1": "https://www.brickeconomy.com/set/21279-1/lego-minecraft-the-enderman-tower",
  "21345-1": "https://www.brickeconomy.com/set/21345-1/lego-ideas-polaroid-onestep-sx-70-camera",
  "31165-1": "https://www.brickeconomy.com/set/31165-1/lego-creator-3-in-1-wild-animals-panda-family",
  "31218-1": "https://www.brickeconomy.com/set/31218-1/lego-art-japanese-cherry-blossom-landscape",
  "40499-1": "https://www.brickeconomy.com/set/40499-1/lego-holiday-christmas-santas-sleigh",
  "40573-1": "https://www.brickeconomy.com/set/40573-1/lego-holiday-christmas-christmas-tree",
  "40674-1": "https://www.brickeconomy.com/set/40674-1/lego-brickheadz-stitch",
  "40779-1": "https://www.brickeconomy.com/set/40779-1/lego-year-of-the-snake",
  "40922-1": "https://www.brickeconomy.com/set/40922-1/lego-brickheadz-lilo-stitch-angel",
  "42115-1": "https://www.brickeconomy.com/set/42115-1/lego-technic-lamborghini-sian-fkp-37",
  "42143-1": "https://www.brickeconomy.com/set/42143-1/lego-technic-ferrari-daytona-sp3",
  "42161-1": "https://www.brickeconomy.com/set/42161-1/lego-technic-lamborghini-huracan-tecnica",
  "42172-1": "https://www.brickeconomy.com/set/42172-1/lego-technic-mclaren-p1",
  "42204-1": "https://www.brickeconomy.com/set/42204-1/lego-fast-furious-toyota-supra-mk4",
  "42210-1": "https://www.brickeconomy.com/set/42210-1/lego-technic-2-fast-2-furious-nissan-skyline-gt-r-r34",
  "43257-1": "https://www.brickeconomy.com/set/43257-1/lego-disney-lilo-stitch-angel",
  "71438-1": "https://www.brickeconomy.com/set/71438-1/lego-super-mario-super-mario-world-mario-yoshi",
  "72037-1": "https://www.brickeconomy.com/set/72037-1/lego-super-mario-mario-kart-mario-standard-kart",
  "72046-1": "https://www.brickeconomy.com/set/72046-1/lego-super-mario-game-boy",
  "75682-1": "https://www.brickeconomy.com/set/75682-1/lego-wicked-elphaba-glinda",
  "76191-1": "https://www.brickeconomy.com/set/76191-1/lego-marvel-super-heroes-infinity-gauntlet",
  "76223-1": "https://www.brickeconomy.com/set/76223-1/lego-marvel-super-heroes-nano-gauntlet",
  "76912-1": "https://www.brickeconomy.com/set/76912-1/lego-speed-champions-fast-furious-1970-dodge-charger-rt",
  "76917-1": "https://www.brickeconomy.com/set/76917-1/lego-speed-champions-2-fast-2-furious-nissan-skyline-gt-r-r34",
  "76922-1": "https://www.brickeconomy.com/set/76922-1/lego-speed-champions-bmw-m4-gt3-bmw-m-hybrid-v8",
  "76934-1": "https://www.brickeconomy.com/set/76934-1/lego-speed-champions-ferrari-f40",
  "77073-1": "https://www.brickeconomy.com/set/77073-1/lego-fortnite-battle-bus",
  "77237-1": "https://www.brickeconomy.com/set/77237-1/lego-speed-champions-dodge-challenger-srt-hellcat",
  "77239-1": "https://www.brickeconomy.com/set/77239-1/lego-speed-champions-porsche-911-gt3-rs",
  "77241-1": "https://www.brickeconomy.com/set/77241-1/lego-speed-champions-2-fast-2-furious-honda-s2000",
  "77253-1": "https://www.brickeconomy.com/set/77253-1/lego-speed-champions-bugatti-vision-gt",
  "77254-1": "https://www.brickeconomy.com/set/77254-1/lego-speed-champions-ferrari-sf90-xx-stradale",
  "77255-1": "https://www.brickeconomy.com/set/77255-1/lego-speed-champions-lightning-mcqueen"
};

/**
 * Extract data from BrickEconomy page - runs in browser context
 * Returns: { priceHistory: [], predictions: {}, currentValue: number, setInfo: {} }
 */
function extractSetDataFromPage() {
  const data = {
    priceHistory: [],
    predictions: {},
    currentValue: null,
    setInfo: {}
  };

  // Find the price history table
  const chartTables = document.querySelectorAll('table');
  let priceTable = null;

  for (const table of chartTables) {
    const rows = table.querySelectorAll('tr');
    if (rows.length > 10) {
      const firstCell = rows[1]?.querySelector('td')?.textContent || '';
      if (firstCell.match(/\w+ \d+, \d{4}/)) {
        priceTable = table;
        break;
      }
    }
  }

  if (priceTable) {
    const rows = priceTable.querySelectorAll('tbody tr');
    const today = new Date();

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 5) {
        const dateStr = cells[0]?.textContent?.trim();
        const retailPrice = parseFloat(cells[1]?.textContent?.replace(/[^0-9.]/g, '')) || null;
        const rrp = parseFloat(cells[2]?.textContent?.replace(/[^0-9.]/g, '')) || null;
        const newSealedValue = parseFloat(cells[3]?.textContent?.replace(/[^0-9.]/g, '')) || null;
        const usedValue = parseFloat(cells[4]?.textContent?.replace(/[^0-9.]/g, '')) || null;

        // Parse date
        if (dateStr) {
          const parsedDate = new Date(dateStr);
          if (!isNaN(parsedDate.getTime())) {
            const entry = {
              date: parsedDate.toISOString().split('T')[0],
              newValue: newSealedValue,
              usedValue: usedValue
            };

            // Check if this is future data (prediction)
            if (parsedDate > today) {
              const monthsFromNow = Math.round((parsedDate - today) / (30 * 24 * 60 * 60 * 1000));
              if (monthsFromNow <= 12) {
                data.predictions['1yr'] = { value: newSealedValue, date: entry.date };
              } else if (monthsFromNow <= 60) {
                data.predictions['5yr'] = { value: newSealedValue, date: entry.date };
              }
            } else {
              data.priceHistory.push(entry);
            }
          }
        }
      }
    });
  }

  // Get current value from the "Today" line
  const todayText = document.body.innerText;
  const todayMatch = todayText.match(/Today €([\d,]+(?:\.\d+)?)/);
  if (todayMatch) {
    data.currentValue = parseFloat(todayMatch[1].replace(',', '.'));
  }

  // Get set info
  const h1 = document.querySelector('h1');
  if (h1) {
    data.setInfo.name = h1.textContent.replace(/^\d+\s+LEGO\s+\w+\s+/, '');
  }

  return data;
}

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
 * Load price history from centralized file
 */
function loadPriceHistory() {
  try {
    return JSON.parse(fs.readFileSync(PRICE_HISTORY_FILE, 'utf-8'));
  } catch {
    return {
      metadata: {
        lastUpdated: null,
        source: 'BrickEconomy',
        currency: 'EUR',
        note: 'Prices scraped from BrickEconomy. Future dates are ML-based predictions.'
      },
      sets: {}
    };
  }
}

/**
 * Save price history to centralized file
 */
function savePriceHistory(history) {
  fs.writeFileSync(PRICE_HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Scrape a single BrickEconomy set page using Puppeteer
 */
async function scrapeSet(setId, options = {}) {
  const { dryRun = false, headless = true } = options;

  if (!setUrls[setId]) {
    const error = new Error(`Unknown set ID: ${setId}. Please check the set ID and try again.`);
    logger.error('Invalid set ID requested', { setId, availableCount: Object.keys(setUrls).length });
    throw error;
  }

  const url = setUrls[setId];

  if (dryRun) {
    logger.info(`Dry run mode: would scrape ${setId}`);
    return {
      setId,
      url,
      message: 'Dry run - would scrape this URL',
      success: true
    };
  }

  // Wrap the entire scraping operation in retry logic
  return await withRetry(async () => {
    const browser = await puppeteer.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      logger.debug(`Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Execute extraction in browser context
      const data = await page.evaluate(extractSetDataFromPage);

      // Validate that we got some data
      if (!data || (!data.priceHistory.length && !data.currentValue)) {
        throw new Error('No price data found on page - page may have changed structure');
      }

      // Add metadata
      data.setId = setId;
      data.url = url;
      data.scrapedAt = new Date().toISOString();

      logger.info(`Successfully scraped ${setId}`, {
        priceHistoryEntries: data.priceHistory.length,
        currentValue: data.currentValue
      });

      return data;
    } catch (error) {
      throw new Error(`Failed to scrape ${setId}: ${error.message}`);
    } finally {
      await browser.close();
    }
  }, {
    maxRetries: MAX_RETRIES,
    retryDelay: RETRY_DELAY,
    context: `Scraping ${setId}`
  });
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    setId: null,
    all: false,
    headless: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--set' && args[i + 1]) {
      options.setId = args[i + 1];
      i++;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--no-headless') {
      options.headless = false;
    }
  }

  return options;
}

/**
 * Main execution
 */
async function main() {
  const options = parseArgs();

  if (!options.setId && !options.all) {
    console.error('Error: Must specify --set <setId> or --all');
    console.error('');
    console.error('Usage:');
    console.error('  node scripts/scrape-brickeconomy.js --set 10316-1');
    console.error('  node scripts/scrape-brickeconomy.js --dry-run --set 10316-1');
    console.error('  node scripts/scrape-brickeconomy.js --all');
    console.error('');
    console.error('Available sets:', Object.keys(setUrls).length);
    process.exit(1);
  }

  try {
    if (options.setId) {
      // Scrape single set
      try {
        const result = await scrapeSet(options.setId, options);

        if (options.dryRun) {
          console.error('DRY RUN MODE');
          console.error('Set:', result.setId);
          console.error('URL:', result.url);
          console.error('Status:', result.message);
        } else {
          // Output JSON result
          console.error(`Successfully scraped ${result.setId}`);
          console.error(`Price history entries: ${result.priceHistory.length}`);
          console.error(`Current value: €${result.currentValue}`);
          console.error(`Predictions: ${Object.keys(result.predictions).length}`);

          // Save to data directory
          const dataDir = path.join(__dirname, '..', 'data', 'brickeconomy');
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
          }

          const outputPath = path.join(dataDir, `${result.setId}.json`);
          fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
          console.error(`Data saved to: ${outputPath}`);

          // Update centralized price-history.json
          const priceHistory = loadPriceHistory();
          priceHistory.metadata.lastUpdated = new Date().toISOString();
          priceHistory.sets[result.setId] = {
            name: result.setInfo.name || 'Unknown',
            currentValue: result.currentValue,
            priceHistory: result.priceHistory,
            predictions: result.predictions
          };
          savePriceHistory(priceHistory);
          console.error(`Updated price-history.json`);
        }

        process.exit(0);
      } catch (error) {
        logger.error('Scraping failed', error);
        console.error('Error:', error.message);
        process.exit(1);
      }
    } else if (options.all) {
      // Scrape all sets
      const setIds = Object.keys(setUrls);
      logger.info(`Starting bulk scrape of ${setIds.length} sets`);
      console.error(`Scraping ${setIds.length} sets...`);

      let successCount = 0;
      let failureCount = 0;
      const failures = [];
      const priceHistory = loadPriceHistory();

      for (const setId of setIds) {
        try {
          const result = await scrapeSet(setId, options);
          if (!options.dryRun) {
            const dataDir = path.join(__dirname, '..', 'data', 'brickeconomy');
            if (!fs.existsSync(dataDir)) {
              fs.mkdirSync(dataDir, { recursive: true });
            }

            const outputPath = path.join(dataDir, `${result.setId}.json`);
            fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

            // Update centralized price history
            priceHistory.sets[result.setId] = {
              name: result.setInfo.name || 'Unknown',
              currentValue: result.currentValue,
              priceHistory: result.priceHistory,
              predictions: result.predictions
            };

            console.error(`✓ ${setId}: Saved to ${outputPath}`);
          } else {
            console.error(`✓ ${setId}: ${result.message}`);
          }
          successCount++;
        } catch (error) {
          console.error(`✗ ${setId}: ${error.message}`);
          failureCount++;
          failures.push({ setId, error: error.message });
        }
      }

      // Save centralized price history after all scraping
      if (!options.dryRun && successCount > 0) {
        priceHistory.metadata.lastUpdated = new Date().toISOString();
        savePriceHistory(priceHistory);
        console.error(`Updated price-history.json with ${successCount} sets`);
      }

      logger.info('Bulk scrape completed', {
        total: setIds.length,
        success: successCount,
        failures: failureCount
      });

      console.error('\nDone!');
      console.error(`Success: ${successCount}, Failures: ${failureCount}`);

      if (failures.length > 0) {
        console.error('\nFailed sets:');
        failures.forEach(f => console.error(`  - ${f.setId}: ${f.error}`));
      }

      process.exit(failureCount > 0 ? 1 : 0);
    }
  } catch (error) {
    logger.error('Fatal error in main', error);
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Export for use as module
module.exports = {
  extractSetDataFromPage,
  scrapeSet,
  setUrls,
  withRetry,
  sleep,
  loadPriceHistory,
  savePriceHistory,
  DATA_DIR,
  PRICE_HISTORY_FILE
};

// Run if executed directly
if (require.main === module) {
  main();
}
