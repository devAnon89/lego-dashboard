#!/usr/bin/env node
/**
 * eBay EU Price Scraper for LEGO Portfolio
 * Scrapes sold listings from eBay EU markets for real market values using Puppeteer
 *
 * Usage:
 *   node scripts/ebay-scraper.js --set 10316-1
 *   node scripts/ebay-scraper.js --dry-run --set 10316-1
 *   node scripts/ebay-scraper.js --all
 *   node scripts/ebay-scraper.js --set 10316-1 --all-domains
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const logger = require('./logger.cjs');

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
 * @deprecated Use extractEbayListings() for detailed metadata
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
 * Parse price from text string - handles European and standard formats
 * @param {string} text - Text containing price
 * @returns {number|null} - Parsed price or null
 */
function parsePrice(text) {
  const pricePatterns = [
    /EUR\s*([\d.,]+)/gi,
    /€\s*([\d.,]+)/gi,
    /([\d.,]+)\s*€/gi,
  ];

  for (const pattern of pricePatterns) {
    const match = pattern.exec(text);
    if (match) {
      let priceStr = match[1];
      // Handle European format (1.234,56 or 123,45)
      if (priceStr.includes(',')) {
        priceStr = priceStr.replace(/\./g, '').replace(',', '.');
      }
      const price = parseFloat(priceStr);
      if (price > 5 && price < 10000) {
        return price;
      }
    }
    pattern.lastIndex = 0; // Reset regex
  }
  return null;
}

/**
 * Parse sold date from eBay date text
 * @param {string} text - Date text like "Sold Jan 15, 2026" or "15 Jan 2026"
 * @returns {string|null} - ISO date string or null
 */
function parseSoldDate(text) {
  if (!text) return null;

  // Common eBay date patterns
  const patterns = [
    // "Sold Jan 15, 2026" or "Verkauft 15. Jan. 2026"
    /(?:sold|verkauft|vendu|venduto|vendido)\s+(\d{1,2})[\.\s]+(\w+)[\.\s,]+(\d{4})/i,
    // "Jan 15, 2026"
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i,
    // "15 Jan 2026" or "15. Jan. 2026"
    /(\d{1,2})[\.\s]+(\w+)[\.\s,]+(\d{4})/i,
    // "15-01-2026" or "15.01.2026"
    /(\d{1,2})[-./](\d{1,2})[-./](\d{4})/,
  ];

  const monthMap = {
    // English
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11,
    'january': 0, 'february': 1, 'march': 2, 'april': 3, 'june': 5,
    'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
    // German
    'januar': 0, 'februar': 1, 'märz': 2, 'april': 3, 'mai': 4, 'juni': 5,
    'juli': 6, 'august': 7, 'okt': 9, 'dez': 11,
    // French
    'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
    'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11,
    // Italian
    'gennaio': 0, 'febbraio': 1, 'marzo': 2, 'aprile': 3, 'maggio': 4, 'giugno': 5,
    'luglio': 6, 'agosto': 7, 'settembre': 8, 'ottobre': 9, 'novembre': 10, 'dicembre': 11,
    // Spanish
    'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
    'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11,
  };

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      let day, month, year;

      // Check if first capture is numeric (day) or text (month)
      if (/^\d+$/.test(match[1])) {
        // Patterns like "15 Jan 2026" or "15-01-2026"
        day = parseInt(match[1], 10);
        const monthStr = match[2].toLowerCase().replace(/\.$/, '');
        month = monthMap[monthStr] !== undefined ? monthMap[monthStr] : parseInt(match[2], 10) - 1;
        year = parseInt(match[3], 10);
      } else {
        // Patterns like "Jan 15, 2026"
        const monthStr = match[1].toLowerCase().replace(/\.$/, '');
        month = monthMap[monthStr] !== undefined ? monthMap[monthStr] : 0;
        day = parseInt(match[2], 10);
        year = parseInt(match[3], 10);
      }

      if (day >= 1 && day <= 31 && month >= 0 && month <= 11 && year >= 2020 && year <= 2030) {
        const date = new Date(year, month, day);
        return date.toISOString().split('T')[0];
      }
    }
  }

  return null;
}

/**
 * Detect item condition from title and listing details
 * @param {string} title - Listing title
 * @param {string} subtitle - Optional subtitle/condition text
 * @returns {string} - 'new', 'used', or 'unknown'
 */
function detectCondition(title, subtitle = '') {
  const combinedText = `${title} ${subtitle}`.toLowerCase();

  // Indicators for NEW condition (sealed, MISB, etc.)
  const newIndicators = [
    'new', 'sealed', 'neu', 'neuf', 'nuevo', 'nuovo',
    'misb', 'nisb', 'bnib', 'mint',
    'versiegelt', 'scellé', 'sellado', 'sigillato',
    'factory sealed', 'brand new', 'unopened'
  ];

  // Indicators for USED condition
  const usedIndicators = [
    'used', 'gebraucht', 'usato', 'usado', 'utilisé',
    'opened', 'complete', 'built', 'assembled',
    'pre-owned', 'preowned', 'second hand',
    'without box', 'no box', 'loose'
  ];

  // Check for new indicators first (priority)
  for (const indicator of newIndicators) {
    if (combinedText.includes(indicator)) {
      return 'new';
    }
  }

  // Check for used indicators
  for (const indicator of usedIndicators) {
    if (combinedText.includes(indicator)) {
      return 'used';
    }
  }

  return 'unknown';
}

/**
 * Detect listing type (auction vs buy-it-now)
 * @param {Element} itemElement - The listing item DOM element
 * @returns {string} - 'auction', 'buy_it_now', or 'unknown'
 */
function detectListingType(itemElement) {
  const text = (itemElement.textContent || itemElement.innerText || '').toLowerCase();

  // Check for auction indicators
  const auctionIndicators = [
    'bid', 'bids', 'gebot', 'gebote', 'enchère', 'offerta', 'puja',
    'auction', 'auktion', 'vente aux enchères'
  ];

  // Check for buy-it-now indicators
  const binIndicators = [
    'buy it now', 'sofortkauf', 'achat immédiat', 'compralo subito', 'cómpralo ya',
    'or best offer', 'obo', 'best offer'
  ];

  for (const indicator of binIndicators) {
    if (text.includes(indicator)) {
      return 'buy_it_now';
    }
  }

  for (const indicator of auctionIndicators) {
    if (text.includes(indicator)) {
      return 'auction';
    }
  }

  return 'unknown';
}

/**
 * Extract detailed listing data from eBay sold listings page - runs in browser context
 * Returns array of sold listing objects with metadata
 * @returns {Array<{price: number, title: string, soldDate: string|null, condition: string, listingType: string}>}
 */
function extractEbayListings() {
  const listings = [];

  // Main listing container selector
  const itemSelector = '.s-item';
  const items = document.querySelectorAll(itemSelector);

  items.forEach(item => {
    try {
      // Skip "Shop on eBay" or promotional items
      const titleEl = item.querySelector('.s-item__title');
      const title = titleEl ? (titleEl.textContent || titleEl.innerText || '').trim() : '';
      if (!title || title.toLowerCase().includes('shop on ebay')) {
        return;
      }

      // Extract price
      const priceEl = item.querySelector('.s-item__price');
      const priceText = priceEl ? (priceEl.textContent || priceEl.innerText || '') : '';

      // Use inline parsePrice logic (same as defined above)
      let price = null;
      const pricePatterns = [
        /EUR\s*([\d.,]+)/gi,
        /€\s*([\d.,]+)/gi,
        /([\d.,]+)\s*€/gi,
      ];
      for (const pattern of pricePatterns) {
        const match = pattern.exec(priceText);
        if (match) {
          let priceStr = match[1];
          if (priceStr.includes(',')) {
            priceStr = priceStr.replace(/\./g, '').replace(',', '.');
          }
          const parsed = parseFloat(priceStr);
          if (parsed > 5 && parsed < 10000) {
            price = parsed;
            break;
          }
        }
        pattern.lastIndex = 0;
      }

      if (price === null) {
        return; // Skip listings without valid price
      }

      // Extract sold date
      const soldDateEl = item.querySelector('.s-item__title--tagblock, .s-item__ended-date, .s-item__endedDate');
      const soldDateText = soldDateEl ? (soldDateEl.textContent || soldDateEl.innerText || '') : '';

      // Inline parseSoldDate logic
      let soldDate = null;
      if (soldDateText) {
        const datePatterns = [
          /(?:sold|verkauft|vendu|venduto|vendido)\s+(\d{1,2})[\.\s]+(\w+)[\.\s,]+(\d{4})/i,
          /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i,
          /(\d{1,2})[\.\s]+(\w+)[\.\s,]+(\d{4})/i,
          /(\d{1,2})[-./](\d{1,2})[-./](\d{4})/,
        ];
        const monthMap = {
          'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
          'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11,
          'january': 0, 'february': 1, 'march': 2, 'april': 3, 'june': 5,
          'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
          'januar': 0, 'februar': 1, 'märz': 2, 'mai': 4, 'juni': 5,
          'juli': 6, 'okt': 9, 'dez': 11,
          'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'juin': 5,
          'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11,
          'gennaio': 0, 'febbraio': 1, 'marzo': 2, 'aprile': 3, 'maggio': 4, 'giugno': 5,
          'luglio': 6, 'agosto': 7, 'settembre': 8, 'ottobre': 9, 'dicembre': 11,
          'enero': 0, 'febrero': 1, 'abril': 3, 'mayo': 4, 'junio': 5,
          'julio': 6, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11,
        };
        for (const pattern of datePatterns) {
          const match = pattern.exec(soldDateText);
          if (match) {
            let day, month, year;
            if (/^\d+$/.test(match[1])) {
              day = parseInt(match[1], 10);
              const monthStr = match[2].toLowerCase().replace(/\.$/, '');
              month = monthMap[monthStr] !== undefined ? monthMap[monthStr] : parseInt(match[2], 10) - 1;
              year = parseInt(match[3], 10);
            } else {
              const monthStr = match[1].toLowerCase().replace(/\.$/, '');
              month = monthMap[monthStr] !== undefined ? monthMap[monthStr] : 0;
              day = parseInt(match[2], 10);
              year = parseInt(match[3], 10);
            }
            if (day >= 1 && day <= 31 && month >= 0 && month <= 11 && year >= 2020 && year <= 2030) {
              const date = new Date(year, month, day);
              soldDate = date.toISOString().split('T')[0];
              break;
            }
          }
        }
      }

      // Extract condition from title and subtitle
      const subtitleEl = item.querySelector('.s-item__subtitle, .s-item__condition');
      const subtitle = subtitleEl ? (subtitleEl.textContent || subtitleEl.innerText || '') : '';
      const combinedText = `${title} ${subtitle}`.toLowerCase();

      let condition = 'unknown';
      const newIndicators = ['new', 'sealed', 'neu', 'neuf', 'nuevo', 'nuovo', 'misb', 'nisb', 'bnib', 'mint', 'versiegelt', 'scellé', 'sellado', 'sigillato', 'factory sealed', 'brand new', 'unopened'];
      const usedIndicators = ['used', 'gebraucht', 'usato', 'usado', 'utilisé', 'opened', 'complete', 'built', 'assembled', 'pre-owned', 'preowned', 'second hand', 'without box', 'no box', 'loose'];

      for (const indicator of newIndicators) {
        if (combinedText.includes(indicator)) {
          condition = 'new';
          break;
        }
      }
      if (condition === 'unknown') {
        for (const indicator of usedIndicators) {
          if (combinedText.includes(indicator)) {
            condition = 'used';
            break;
          }
        }
      }

      // Detect listing type
      const itemText = (item.textContent || item.innerText || '').toLowerCase();
      let listingType = 'unknown';
      const binIndicators = ['buy it now', 'sofortkauf', 'achat immédiat', 'compralo subito', 'cómpralo ya', 'or best offer', 'obo', 'best offer'];
      const auctionIndicators = ['bid', 'bids', 'gebot', 'gebote', 'enchère', 'offerta', 'puja', 'auction', 'auktion', 'vente aux enchères'];

      for (const indicator of binIndicators) {
        if (itemText.includes(indicator)) {
          listingType = 'buy_it_now';
          break;
        }
      }
      if (listingType === 'unknown') {
        for (const indicator of auctionIndicators) {
          if (itemText.includes(indicator)) {
            listingType = 'auction';
            break;
          }
        }
      }

      listings.push({
        price,
        title,
        soldDate,
        condition,
        listingType
      });

    } catch (err) {
      // Skip items that fail to parse
    }
  });

  return listings;
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
async function scrapeSingleSet(setId, setData, dryRun = false, allDomains = false) {
  const domainsToTry = allDomains ? EBAY_DOMAINS : [EBAY_DOMAINS[0]];

  logger.info(`Scraping ${setId} - ${setData.name || 'Unknown'}`);

  if (allDomains) {
    logger.info(`Multi-domain mode: Will try ${domainsToTry.length} domains`);
  }

  if (dryRun) {
    const url = getEbaySearchUrl(setId, domainsToTry[0].domain);
    logger.info(`[DRY RUN] Would scrape: ${url}`);
    return {
      setId,
      name: setData.name,
      url,
      prices: [],
      listings: [],
      marketValue: null,
      skipped: true
    };
  }

  let browser;
  let allPrices = [];
  let allListings = [];
  let successfulDomains = [];
  let lastUrl = '';

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

    // Try each domain until we get valid prices or run out of domains
    for (let i = 0; i < domainsToTry.length; i++) {
      const domainConfig = domainsToTry[i];
      const url = getEbaySearchUrl(setId, domainConfig.domain);
      lastUrl = url;

      logger.info(`Trying ${domainConfig.name} (${domainConfig.domain})...`);

      try {
        // Navigate to eBay with retry logic
        await withRetry(
          async () => {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
          },
          { context: `Navigate to ${url}` }
        );

        // Wait for content to load
        await sleep(2000);

        // Extract detailed listings from page
        const listings = await page.evaluate(extractEbayListings);
        logger.info(`Found ${listings.length} sold listings on ${domainConfig.domain}`);

        if (listings.length > 0) {
          // Add domain and currency info to each listing
          const enrichedListings = listings.map(listing => ({
            ...listing,
            currency: domainConfig.currency,
            domain: domainConfig.domain,
            scrapedAt: new Date().toISOString()
          }));
          allListings.push(...enrichedListings);

          // Extract prices for backward compatibility
          const prices = listings.map(l => l.price);
          allPrices.push(...prices);
          successfulDomains.push(domainConfig.name);

          // If not using all-domains mode, stop after first successful domain
          if (!allDomains) {
            break;
          }
        } else {
          logger.warn(`No prices found on ${domainConfig.domain}`);
        }

        // Add delay between domains to avoid rate limiting
        if (allDomains && i < domainsToTry.length - 1) {
          logger.debug(`Waiting before trying next domain...`);
          await sleep(3000);
        }

      } catch (domainError) {
        logger.warn(`Failed to scrape ${domainConfig.domain}`, domainError);

        // Continue to next domain if available
        if (i < domainsToTry.length - 1) {
          logger.info(`Falling back to next domain...`);
          await sleep(2000);
        }
      }
    }

    await browser.close();

    // Calculate market value from all collected prices
    const marketValue = calculateMarketValue(allPrices);

    if (marketValue) {
      logger.info(`Market value for ${setId}: €${marketValue.toFixed(2)} (from ${successfulDomains.join(', ')})`);
    } else {
      logger.warn(`No valid prices found for ${setId} across all domains`);
    }

    return {
      setId,
      name: setData.name,
      url: lastUrl,
      domains: successfulDomains,
      prices: allPrices,
      listings: allListings,
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
      url: lastUrl,
      domains: successfulDomains,
      prices: allPrices,
      listings: allListings,
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
  const allDomains = args.includes('--all-domains');

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
  if (allDomains) {
    logger.info(`Multi-domain mode: Will try all eBay EU domains`);
  }

  // Load price history
  const priceHistory = loadPriceHistory();

  // Scrape each set
  const results = [];
  for (const [setId, setData] of Object.entries(sets)) {
    const result = await scrapeSingleSet(setId, setData, dryRun, allDomains);
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

    // Update portfolio.json with new market values
    const successfulResults = results.filter(r => r.marketValue !== null && !r.skipped);
    if (successfulResults.length > 0) {
      logger.info(`Updating portfolio.json with ${successfulResults.length} new values...`);

      // Update each set's value in the portfolio
      successfulResults.forEach(result => {
        const setIndex = portfolio.sets.findIndex(s => s.setNumber === result.setId);
        if (setIndex !== -1) {
          const oldValue = portfolio.sets[setIndex].value;
          portfolio.sets[setIndex].value = parseFloat(result.marketValue.toFixed(2));

          // Recalculate growth percentage
          const paid = portfolio.sets[setIndex].paid;
          if (paid > 0) {
            portfolio.sets[setIndex].growth = parseFloat((((portfolio.sets[setIndex].value - paid) / paid) * 100).toFixed(2));
          }

          logger.debug(`Updated ${result.setId}: €${oldValue.toFixed(2)} → €${result.marketValue.toFixed(2)}`);
        }
      });

      // Update metadata
      portfolio.metadata.lastUpdated = snapshot.timestamp;
      portfolio.metadata.source = 'eBay EU';

      // Recalculate totals
      let totalCurrentValue = 0;
      portfolio.sets.forEach(set => {
        const qty = (set.qtyNew || 0) + (set.qtyUsed || 0);
        totalCurrentValue += set.value * qty;
      });

      portfolio.metadata.totalCurrentValue = parseFloat(totalCurrentValue.toFixed(2));

      // Recalculate total gain percentage
      if (portfolio.metadata.totalPaid > 0) {
        portfolio.metadata.totalGain = parseFloat((((totalCurrentValue - portfolio.metadata.totalPaid) / portfolio.metadata.totalPaid) * 100).toFixed(2));
      }

      // Save updated portfolio
      fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
      logger.info(`Updated ${PORTFOLIO_FILE}`);
    }
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
  extractEbayListings,
  parsePrice,
  parseSoldDate,
  detectCondition,
  detectListingType,
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
