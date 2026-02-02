#!/usr/bin/env node
/**
 * eBay EU Price Scraper for LEGO Portfolio
 * Scrapes sold listings from eBay EU markets for real market values
 *
 * ============================================================================
 * HOW TO POPULATE ebay-price-history.json
 * ============================================================================
 *
 * This script requires MANUAL browser scraping due to eBay's anti-bot measures.
 * The script generates URLs and provides a structured workflow for data collection.
 *
 * STEP 1: Generate URLs
 * ---------------------
 * Run the script to generate eBay sold listing URLs:
 *
 *   node ebay-scraper.js --all           # All sets in portfolio
 *   node ebay-scraper.js --set 10316-1   # Single set
 *   node ebay-scraper.js --dry-run       # Preview without saving
 *
 * STEP 2: Manual Browser Scraping
 * --------------------------------
 * For each URL output by the script:
 *
 * 1. Open the URL in a web browser
 * 2. Review the "Sold Items" section showing completed sales
 * 3. Note the sold prices (typically displayed as "EUR XX,XX")
 * 4. Record prices from the most recent 10-20 sales
 * 5. Ignore obvious outliers (damaged boxes, incomplete sets, etc.)
 *
 * STEP 3: Update Price History
 * -----------------------------
 * The script will automatically:
 *
 * 1. Calculate median market value from collected prices
 * 2. Remove outliers (top/bottom 10%)
 * 3. Create a snapshot entry in ebay-price-history.json
 * 4. Update the timestamp for tracking data freshness
 *
 * DATA FORMAT (ebay-price-history.json):
 * ---------------------------------------
 * {
 *   "snapshots": [
 *     {
 *       "timestamp": "2024-01-15T10:30:00Z",
 *       "setId": "10316-1",
 *       "name": "The Lord of the Rings: Rivendell",
 *       "prices": [459.99, 475.00, 449.00, 470.00, 465.00],
 *       "marketValue": 465.00,
 *       "sources": ["ebay.de", "ebay.fr"],
 *       "sampleSize": 5
 *     }
 *   ],
 *   "lastUpdate": "2024-01-15T10:30:00Z"
 * }
 *
 * WHY MANUAL SCRAPING?
 * --------------------
 * - eBay blocks automated scrapers with CAPTCHA challenges
 * - Real browser usage ensures accurate, up-to-date pricing data
 * - Allows manual verification of listing quality (new/sealed condition)
 * - Complies with eBay's Terms of Service (personal research use)
 *
 * REFRESH FREQUENCY:
 * ------------------
 * - High-value sets (>€300): Weekly
 * - Medium-value sets (€100-300): Bi-weekly
 * - Low-value sets (<€100): Monthly
 *
 * TROUBLESHOOTING:
 * ----------------
 * - If no sold listings found: Try different eBay domain (ebay.fr, ebay.it)
 * - If prices seem off: Check for regional pricing differences
 * - If snapshot fails: Ensure prices array contains valid numbers
 *
 * ============================================================================
 *
 * Run: node ebay-scraper.js [--set 10316-1] [--all] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

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
 * Parse prices from eBay sold listings page
 * Returns array of sold prices in EUR
 */
function parseEbayPrices(pageContent) {
  const prices = [];
  
  // Match patterns like "EUR 123,45" or "€123.45" or "123,45 €"
  const pricePatterns = [
    /EUR\s*([\d.,]+)/gi,
    /€\s*([\d.,]+)/gi,
    /([\d.,]+)\s*€/gi,
  ];
  
  for (const pattern of pricePatterns) {
    let match;
    while ((match = pattern.exec(pageContent)) !== null) {
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
  
  return [...new Set(prices)];  // Remove duplicates
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
 * Main scraper - outputs commands for Clawdbot browser automation
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleSet = args.find((a, i) => args[i-1] === '--set');
  
  const portfolio = JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf-8'));
  const sets = singleSet 
    ? { [singleSet]: portfolio.sets[singleSet] }
    : portfolio.sets;
  
  console.log('=== eBay EU Price Scraper ===\n');
  console.log(`Sets to scrape: ${Object.keys(sets).length}`);
  console.log(`Dry run: ${dryRun}\n`);
  
  // Output URLs for browser automation
  console.log('--- URLs to scrape ---');
  for (const [setId, setData] of Object.entries(sets)) {
    const url = getEbaySearchUrl(setId);
    console.log(JSON.stringify({
      setId,
      name: setData.name,
      currentValue: setData.value,
      qty: (setData.qty_new || 0) + (setData.qty_used || 0),
      url,
    }));
  }
  
  console.log('\n--- Scraping instructions ---');
  console.log('1. Use browser tool to open each URL');
  console.log('2. Wait for page load, extract sold prices');
  console.log('3. Calculate median value');
  console.log('4. Update portfolio.json with new values');
}

// Export functions for use by Clawdbot
module.exports = {
  getEbaySearchUrl,
  parseEbayPrices,
  calculateMarketValue,
  loadPriceHistory,
  savePriceHistory,
  EBAY_DOMAINS,
  PORTFOLIO_FILE,
  DATA_DIR,
};

if (require.main === module) {
  main().catch(console.error);
}
