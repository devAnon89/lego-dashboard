#!/usr/bin/env node
/**
 * eBay EU Price Scraper for LEGO Portfolio
 * Scrapes sold listings from eBay EU markets for real market values using Puppeteer
 *
 * Usage:
 *   node scripts/ebay-scraper.js --set 10316-1
 *   node scripts/ebay-scraper.js --dry-run --set 10316-1
 *   node scripts/ebay-scraper.js --all
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
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'ebay-price-history.json');

// eBay EU domains to check (prioritized)
const EBAY_DOMAINS = [
  { domain: 'ebay.de', name: 'Germany', currency: 'EUR' },
  { domain: 'ebay.fr', name: 'France', currency: 'EUR' },
  { domain: 'ebay.it', name: 'Italy', currency: 'EUR' },
  { domain: 'ebay.es', name: 'Spain', currency: 'EUR' },
  { domain: 'ebay.nl', name: 'Netherlands', currency: 'EUR' },
];

/**
 * Generate eBay search URL for sold listings
 */
function getEbaySearchUrl(setId, domain = 'ebay.de') {
  const cleanId = setId.replace('-1', '');
  const query = encodeURIComponent(`LEGO ${cleanId} new sealed`);
  // LH_Complete=1 = completed listings, LH_Sold=1 = sold only
  return `https://www.${domain}/sch/i.html?_nkw=${query}&LH_Complete=1&LH_Sold=1&_sop=13`;
}

/**
 * Extract prices from eBay sold listings page - runs in browser context
 * Returns array of sold prices in EUR
 */
function extractEbayPrices() {
  const prices = [];

  // Find all sold listing price elements
  // eBay uses various selectors for sold listings
  const priceSelectors = [
    '.s-item__price',
    '.lvprice',
    '.bold',
  ];

  for (const selector of priceSelectors) {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
      const text = el.textContent || el.innerText || '';

      // Match patterns like "EUR 123,45" or "€123.45" or "123,45 €"
      const pricePatterns = [
        /EUR\s*([\d.,]+)/gi,
        /€\s*([\d.,]+)/gi,
        /([\d.,]+)\s*€/gi,
      ];

      for (const pattern of pricePatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          let priceStr = match[1];
          // Handle European format (1.234,56 or 123,45)
          if (priceStr.includes(',')) {
            priceStr = priceStr.replace(/\./g, '').replace(',', '.');
          }
          const price = parseFloat(priceStr);
          if (price > 5 && price < 10000) {  // Reasonable LEGO price range
            prices.push(price);
          }
        }
      }
    });
  }

  return [...new Set(prices)];  // Remove duplicates
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
 * Calculate market value from sold prices
 * Uses median of recent sales, removing outliers
 */
function calculateMarketValue(prices) {
  if (!prices || prices.length === 0) return null;
  
  // Sort prices
  const sorted = [...prices].sort((a, b) => a - b);
  
  // Remove top and bottom 10% as outliers
  const trim = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(trim, sorted.length - trim || undefined);
  
  if (trimmed.length === 0) return sorted[Math.floor(sorted.length / 2)];
  
  // Return median
  const mid = Math.floor(trimmed.length / 2);
  return trimmed.length % 2 === 0 
    ? (trimmed[mid - 1] + trimmed[mid]) / 2 
    : trimmed[mid];
}

/**
 * Load price history
 */
function loadPriceHistory() {
  try {
    return JSON.parse(fs.readFileSync(PRICE_HISTORY_FILE, 'utf-8'));
  } catch {
    return { snapshots: [], lastUpdate: null };
  }
}

/**
 * Save price history
 */
function savePriceHistory(history) {
  fs.writeFileSync(PRICE_HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Scrape a single set from eBay
 */
async function scrapeSingleSet(setId, setData, dryRun = false) {
  const url = getEbaySearchUrl(setId);
  logger.info(`Scraping ${setId} - ${setData.name || 'Unknown'}`);
  logger.debug(`URL: ${url}`);

  if (dryRun) {
    logger.info(`[DRY RUN] Would scrape: ${url}`);
    return {
      setId,
      name: setData.name,
      url,
      prices: [],
      marketValue: null,
      skipped: true
    };
  }

  let browser;
  try {
    // Launch browser with retry logic
    browser = await withRetry(
      async () => await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }),
      { context: `Launch browser for ${setId}` }
    );

    const page = await browser.newPage();

    // Set user agent to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to eBay with retry logic
    await withRetry(
      async () => {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      },
      { context: `Navigate to ${url}` }
    );

    // Wait for content to load
    await sleep(2000);

    // Extract prices from page
    const prices = await page.evaluate(extractEbayPrices);
    logger.info(`Found ${prices.length} sold listings for ${setId}`);

    // Calculate market value
    const marketValue = calculateMarketValue(prices);

    if (marketValue) {
      logger.info(`Market value for ${setId}: €${marketValue.toFixed(2)}`);
    } else {
      logger.warn(`No valid prices found for ${setId}`);
    }

    await browser.close();

    return {
      setId,
      name: setData.name,
      url,
      prices,
      marketValue,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    logger.error(`Failed to scrape ${setId}`, error);
    if (browser) {
      await browser.close();
    }
    return {
      setId,
      name: setData.name,
      url,
      prices: [],
      marketValue: null,
      error: error.message
    };
  }
}

/**
 * Main scraper - scrapes eBay sold listings using Puppeteer
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleSet = args.find((a, i) => args[i-1] === '--set');
  const scrapeAll = args.includes('--all');

  logger.section('eBay EU Price Scraper');

  // Load portfolio
  const portfolio = JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf-8'));

  // Convert array to object for easier lookup
  const allSets = {};
  portfolio.sets.forEach(set => {
    allSets[set.setNumber] = {
      name: set.name,
      value: set.value,
      qty_new: set.qtyNew || 0,
      qty_used: set.qtyUsed || 0
    };
  });

  const sets = singleSet
    ? (allSets[singleSet] ? { [singleSet]: allSets[singleSet] } : {})
    : scrapeAll
    ? allSets
    : {};

  if (Object.keys(sets).length === 0) {
    logger.error('No sets to scrape. Use --set <setId> or --all');
    if (singleSet) {
      logger.error(`Set ${singleSet} not found in portfolio`);
    }
    process.exit(1);
  }

  logger.info(`Sets to scrape: ${Object.keys(sets).length}`);
  logger.info(`Dry run: ${dryRun}`);

  // Load price history
  const priceHistory = loadPriceHistory();

  // Scrape each set
  const results = [];
  for (const [setId, setData] of Object.entries(sets)) {
    const result = await scrapeSingleSet(setId, setData, dryRun);
    results.push(result);

    // Add delay between requests to avoid rate limiting
    if (!dryRun && Object.keys(sets).length > 1) {
      await sleep(3000);
    }
  }

  // Save results to price history
  if (!dryRun) {
    const snapshot = {
      timestamp: new Date().toISOString(),
      source: 'eBay EU',
      data: results
    };

    priceHistory.snapshots = priceHistory.snapshots || [];
    priceHistory.snapshots.push(snapshot);
    priceHistory.lastUpdate = snapshot.timestamp;

    savePriceHistory(priceHistory);
    logger.info(`Saved results to ${PRICE_HISTORY_FILE}`);
  }

  // Summary
  logger.section('Scraping Summary');
  const successful = results.filter(r => r.marketValue !== null).length;
  const failed = results.filter(r => r.error).length;
  const skipped = results.filter(r => r.skipped).length;

  logger.info(`Total sets: ${results.length}`);
  logger.info(`Successful: ${successful}`);
  logger.info(`Failed: ${failed}`);
  logger.info(`Skipped (dry run): ${skipped}`);
}

// Export functions for testing
module.exports = {
  getEbaySearchUrl,
  extractEbayPrices,
  calculateMarketValue,
  loadPriceHistory,
  savePriceHistory,
  scrapeSingleSet,
  EBAY_DOMAINS,
  PORTFOLIO_FILE,
  DATA_DIR,
};

if (require.main === module) {
  main().catch(console.error);
}
