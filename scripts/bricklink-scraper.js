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

  // BrickLink typically structures listings in table rows or divs
  // Split content into potential listing blocks
  const listingBlocks = pageContent.split(/(?=<tr|<div[^>]*class="[^"]*listing)/i);

  for (const block of listingBlocks) {
    const listing = extractListingData(block);
    if (listing && listing.price) {
      listings.push(listing);
    }
  }

  return listings;
}

/**
 * Extract listing data from a single listing block
 * @param {string} block - HTML block containing one listing
 * @returns {object|null} Listing object or null if invalid
 */
function extractListingData(block) {
  const listing = {
    price: null,
    currency: null,
    seller: null,
    rating: null,
    condition: null,
    location: null,
    url: null,
  };

  // Extract price with currency
  const pricePatterns = [
    { pattern: /US\s*\$\s*([\d.,]+)|USD\s*([\d.,]+)|\$\s*([\d.,]+)/i, currency: 'USD' },
    { pattern: /€\s*([\d.,]+)|EUR\s*([\d.,]+)/i, currency: 'EUR' },
    { pattern: /£\s*([\d.,]+)|GBP\s*([\d.,]+)/i, currency: 'GBP' },
  ];

  for (const { pattern, currency } of pricePatterns) {
    const match = block.match(pattern);
    if (match) {
      let priceStr = match[1] || match[2] || match[3];
      // Handle European format (1.234,56 or 123,45)
      if (priceStr.includes(',')) {
        priceStr = priceStr.replace(/\./g, '').replace(',', '.');
      } else {
        // Handle US format (1,234.56)
        priceStr = priceStr.replace(/,/g, '');
      }
      const price = parseFloat(priceStr);
      if (price > 5 && price < 50000) {  // Reasonable LEGO price range
        listing.price = price;
        listing.currency = currency;
        break;
      }
    }
  }

  // Extract seller name
  // BrickLink patterns: store links with names, store text
  const sellerPatterns = [
    /<a[^>]*href="[^"]*store\.asp[^"]*"[^>]*>([^<]+)<\/a>/i,
    /<a[^>]*href="[^"]*v2\/catalog[^"]*"[^>]*>([^<]+)<\/a>/i,
    /Store:\s*([^\n<]+)/i,
    /seller[^>]*>([^<]+)</i,
  ];

  for (const pattern of sellerPatterns) {
    const match = block.match(pattern);
    if (match && match[1]) {
      const seller = match[1].trim();
      // Skip if it looks like a number (store ID)
      if (!/^\d+$/.test(seller)) {
        listing.seller = seller;
        break;
      }
    }
  }

  // Extract seller rating
  // Patterns: "98%", "Rating: 98", "(98.5%)"
  const ratingPatterns = [
    /(\d+(?:\.\d+)?)\s*%/,
    /rating[:\s]+(\d+(?:\.\d+)?)/i,
    /\((\d+(?:\.\d+)?)%?\)/,
  ];

  for (const pattern of ratingPatterns) {
    const match = block.match(pattern);
    if (match && match[1]) {
      const rating = parseFloat(match[1]);
      if (rating >= 0 && rating <= 100) {
        listing.rating = rating;
        break;
      }
    }
  }

  // Extract condition
  // Patterns: "New", "Used", "N", "U"
  if (/\b(New|N)\b/i.test(block) && !/Used/i.test(block)) {
    listing.condition = 'New';
  } else if (/\b(Used|U)\b/i.test(block)) {
    listing.condition = 'Used';
  }

  // Extract location/country
  // Patterns: "US", "DE", "UK", country names
  const locationPatterns = [
    /\b(US|DE|UK|FR|NL|IT|ES|CA|AU)\b/,
    /country[:\s]+([A-Z]{2})/i,
    /location[:\s]+([A-Z]{2})/i,
  ];

  for (const pattern of locationPatterns) {
    const match = block.match(pattern);
    if (match && match[1]) {
      listing.location = match[1].toUpperCase();
      break;
    }
  }

  // Extract listing URL
  // BrickLink listing URLs typically contain /store.asp or /v2/catalog
  const urlPatterns = [
    /href=["']([^"']*store\.asp[^"']*)["']/i,
    /href=["']([^"']*v2\/catalog[^"']*)["']/i,
    /href=["']([^"']*invNew\.asp[^"']*)["']/i,
    /url[:\s]+["']([^"']+)["']/i,
  ];

  for (const pattern of urlPatterns) {
    const match = block.match(pattern);
    if (match && match[1]) {
      let url = match[1];
      // Make relative URLs absolute
      if (url.startsWith('/')) {
        url = 'https://www.bricklink.com' + url;
      } else if (!url.startsWith('http')) {
        url = 'https://www.bricklink.com/' + url;
      }
      listing.url = url;
      break;
    }
  }

  // Only return listing if it has at least a price
  return listing.price ? listing : null;
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
 * Test the parsing function with sample HTML
 */
function testParsing() {
  console.log('=== Testing BrickLink Listing Parser ===\n');

  // Sample BrickLink HTML listing block
  const sampleHtml = `
    <tr>
      <td>
        <a href="/store.asp?sID=12345">BrickMaster Store</a>
        Rating: 99.2%
      </td>
      <td>New</td>
      <td>US $149.99</td>
      <td>US</td>
    </tr>
    <tr>
      <td>
        <a href="/v2/catalog/catalogitem.page?S=10316#T=S&O=">LegoDeals123</a>
        (98%)
      </td>
      <td>Used</td>
      <td>€125,50</td>
      <td>DE</td>
    </tr>
    <tr>
      <td>Store: BrickBargains</td>
      <td>N</td>
      <td>£135.00</td>
      <td>UK</td>
      <td>Rating: 97</td>
    </tr>
  `;

  const listings = parseBrickLinkListings(sampleHtml);

  console.log(`Extracted ${listings.length} listings:\n`);
  listings.forEach((listing, i) => {
    console.log(`Listing ${i + 1}:`);
    console.log(`  Price: ${listing.currency} ${listing.price}`);
    console.log(`  Seller: ${listing.seller || 'N/A'}`);
    console.log(`  Rating: ${listing.rating !== null ? listing.rating + '%' : 'N/A'}`);
    console.log(`  Condition: ${listing.condition || 'N/A'}`);
    console.log(`  Location: ${listing.location || 'N/A'}`);
    console.log(`  URL: ${listing.url || 'N/A'}`);
    console.log('');
  });

  // Verify all fields are extracted
  const allFieldsExtracted = listings.every(l =>
    l.price && l.currency && l.seller && l.rating !== null &&
    l.condition && l.location
  );

  if (allFieldsExtracted) {
    console.log('✓ All required fields extracted successfully!');
  } else {
    console.log('⚠ Warning: Some fields missing from extracted listings');
  }
}

/**
 * Main scraper - outputs commands for browser automation
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleSet = args.find((a, i) => args[i-1] === '--set');
  const testUrl = args.find((a, i) => args[i-1] === '--test-url');
  const testParse = args.includes('--test-parse');

  // Handle --test-parse flag for verification
  if (testParse) {
    testParsing();
    return;
  }

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
  extractListingData,
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
