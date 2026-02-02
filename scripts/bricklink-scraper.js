#!/usr/bin/env node
/**
 * BrickLink Marketplace Scraper for LEGO Portfolio
 * Scrapes marketplace listings from BrickLink for deal finding
 *
 * Run: node bricklink-scraper.js [--set 10316-1] [--test-url 10316-1] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'bricklink-price-history.json');

// BrickLink regions to check (prioritized)
const BRICKLINK_REGIONS = [
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'UK', name: 'United Kingdom', currency: 'GBP' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' },
];

/**
 * Generate BrickLink marketplace search URL
 * @param {string} setId - Set ID like "10316-1"
 * @param {object} options - Search options
 * @param {string} options.condition - "N" (new), "U" (used), or "" (both)
 * @param {string} options.country - Country code like "US", "DE"
 * @param {number} options.minRating - Minimum seller rating (0-100)
 * @returns {string} BrickLink marketplace URL
 */
function getBrickLinkSearchUrl(setId, options = {}) {
  const cleanId = setId.replace('-1', '');

  // Base marketplace URL for set
  let url = `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${cleanId}#T=S&O=`;

  // Build options object for URL
  const urlOptions = {
    iconly: 0,  // Include items and sets
  };

  // Add condition filter
  if (options.condition === 'N') {
    urlOptions.condition = 'N';
  } else if (options.condition === 'U') {
    urlOptions.condition = 'U';
  }

  // Add country filter
  if (options.country) {
    urlOptions.loc = options.country;
  }

  // Add minimum seller rating filter
  if (options.minRating) {
    urlOptions.minrating = options.minRating;
  }

  // Encode options as JSON in URL
  url += encodeURIComponent(JSON.stringify(urlOptions));

  return url;
}

/**
 * Parse prices from BrickLink marketplace page
 * Returns array of listing objects with price and details
 */
function parseBrickLinkListings(pageContent) {
  const listings = [];

  // BrickLink listing patterns to extract:
  // - Price
  // - Seller name
  // - Seller rating
  // - Condition (New/Used)
  // - Location
  // - Listing URL

  // Price patterns like "$123.45" or "€123,45" or "£123.45"
  const pricePatterns = [
    /\$\s*([\d.,]+)/gi,
    /€\s*([\d.,]+)/gi,
    /£\s*([\d.,]+)/gi,
    /USD\s*([\d.,]+)/gi,
    /EUR\s*([\d.,]+)/gi,
    /GBP\s*([\d.,]+)/gi,
  ];

  for (const pattern of pricePatterns) {
    let match;
    while ((match = pattern.exec(pageContent)) !== null) {
      let priceStr = match[1];
      // Handle European format (1.234,56 or 123,45)
      if (priceStr.includes(',')) {
        priceStr = priceStr.replace(/\./g, '').replace(',', '.');
      } else {
        // Handle US format (1,234.56)
        priceStr = priceStr.replace(/,/g, '');
      }
      const price = parseFloat(priceStr);
      if (price > 5 && price < 50000) {  // Reasonable LEGO price range
        listings.push({
          price,
          currency: match[0].substring(0, 3),
          // Additional fields would be extracted from actual HTML parsing
          seller: null,
          rating: null,
          condition: null,
          location: null,
          url: null,
        });
      }
    }
  }

  return listings;
}

/**
 * Calculate market value from BrickLink listings
 * Uses median of available prices, removing outliers
 */
function calculateMarketValue(listings) {
  if (!listings || listings.length === 0) return null;

  const prices = listings.map(l => l.price);
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
 * Main scraper - outputs commands for browser automation
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleSet = args.find((a, i) => args[i-1] === '--set');
  const testUrl = args.find((a, i) => args[i-1] === '--test-url');

  // Handle --test-url flag for verification
  if (testUrl) {
    const url = getBrickLinkSearchUrl(testUrl);
    console.log('URL generated');
    console.log(url);
    return;
  }

  // Load watchlist or portfolio
  let sets = {};
  try {
    const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
    sets = singleSet
      ? { [singleSet]: watchlist.sets[singleSet] }
      : watchlist.sets;
  } catch {
    // Fallback to portfolio if watchlist doesn't exist
    const portfolio = JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf-8'));
    sets = singleSet
      ? { [singleSet]: portfolio.sets[singleSet] }
      : portfolio.sets;
  }

  console.log('=== BrickLink Marketplace Scraper ===\n');
  console.log(`Sets to scrape: ${Object.keys(sets).length}`);
  console.log(`Dry run: ${dryRun}\n`);

  // Output URLs for browser automation
  console.log('--- URLs to scrape ---');
  for (const [setId, setData] of Object.entries(sets)) {
    const options = {
      condition: setData.preferred_condition === 'new' ? 'N' :
                 setData.preferred_condition === 'used' ? 'U' : '',
      country: setData.location_filter || '',
      minRating: setData.min_seller_rating || 0,
    };

    const url = getBrickLinkSearchUrl(setId, options);
    console.log(JSON.stringify({
      setId,
      name: setData.name,
      targetPrice: setData.target_price || setData.value,
      maxPrice: setData.max_price || setData.value,
      condition: options.condition || 'any',
      url,
    }));
  }

  console.log('\n--- Scraping instructions ---');
  console.log('1. Use browser tool to open each URL');
  console.log('2. Wait for page load, extract marketplace listings');
  console.log('3. Parse seller info, prices, conditions, ratings');
  console.log('4. Filter by target price and save to deals-found.json');
}

// Export functions for use by deal finder
module.exports = {
  getBrickLinkSearchUrl,
  parseBrickLinkListings,
  calculateMarketValue,
  loadPriceHistory,
  savePriceHistory,
  BRICKLINK_REGIONS,
  WATCHLIST_FILE,
  PORTFOLIO_FILE,
  DATA_DIR,
};

if (require.main === module) {
  main().catch(console.error);
}
