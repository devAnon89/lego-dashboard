#!/usr/bin/env node
/**
 * BrickLink Price Scraper for LEGO Portfolio
 * Scrapes current listings from BrickLink to get inventory and pricing data.
 *
 * Usage:
 *   node scripts/bricklink-scraper.cjs
 *   node scripts/bricklink-scraper.cjs --set 10316-1
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Data paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'bricklink-prices.json');

// Scraper configuration
const DELAY_BETWEEN_REQUESTS = 3000; // 3 seconds between requests
const MAX_RETRIES = 2;

/**
 * Load JSON file safely
 */
function loadJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convert set number to BrickLink format (remove -1 suffix)
 */
function toBrickLinkId(setNumber) {
  return setNumber.replace(/-\d+$/, '');
}

/**
 * Build BrickLink price guide URL
 */
function buildPriceGuideUrl(setNumber, condition = 'N') {
  const blId = toBrickLinkId(setNumber);
  // N = New, U = Used
  return `https://www.bricklink.com/catalogPG.asp?S=${blId}-1&ColorID=0&viewExclude=Y&v=D&cID=&sortBy=P&sortAsc=A&st=${condition}`;
}

/**
 * Build BrickLink inventory search URL
 */
function buildInventoryUrl(setNumber, condition = 'N') {
  const blId = toBrickLinkId(setNumber);
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${blId}-1#T=S&C=0&O={%22cond%22:%22${condition}%22,%22iconly%22:0}`;
}

/**
 * Scrape price data from BrickLink
 */
async function scrapeBrickLinkPrices(browser, setNumber) {
  const page = await browser.newPage();

  try {
    // Set user agent to avoid blocks
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const blId = toBrickLinkId(setNumber);
    const priceGuideUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${blId}-1#T=P`;

    console.log(`  Fetching: ${priceGuideUrl}`);
    await page.goto(priceGuideUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for page to load
    await sleep(2000);

    // Try to extract price data
    const priceData = await page.evaluate(() => {
      const data = {
        newPrices: {},
        usedPrices: {},
        inventoryNew: 0,
        inventoryUsed: 0
      };

      // Try to find price guide table
      const tables = document.querySelectorAll('table');
      tables.forEach(table => {
        const text = table.innerText.toLowerCase();

        // Look for "items for sale" counts
        const forSaleMatch = text.match(/(\d+)\s*items?\s*for\s*sale/);
        if (forSaleMatch) {
          data.inventoryNew = parseInt(forSaleMatch[1], 10);
        }

        // Look for price statistics
        const minMatch = text.match(/min[:\s]*(?:€|£|\$)?\s*([\d,\.]+)/i);
        const maxMatch = text.match(/max[:\s]*(?:€|£|\$)?\s*([\d,\.]+)/i);
        const avgMatch = text.match(/avg[:\s]*(?:€|£|\$)?\s*([\d,\.]+)/i);

        if (minMatch) data.newPrices.min = parseFloat(minMatch[1].replace(',', '.'));
        if (maxMatch) data.newPrices.max = parseFloat(maxMatch[1].replace(',', '.'));
        if (avgMatch) data.newPrices.avg = parseFloat(avgMatch[1].replace(',', '.'));
      });

      // Also try to get from specific elements
      const priceElements = document.querySelectorAll('[id*="price"], .pspPGMain, .pcipgSummaryTable');
      priceElements.forEach(el => {
        const text = el.innerText;
        const priceMatch = text.match(/(?:€|£|\$)\s*([\d,\.]+)/g);
        if (priceMatch && priceMatch.length > 0) {
          data.foundPrices = priceMatch.map(p => parseFloat(p.replace(/[€£$,]/g, '').replace(',', '.')));
        }
      });

      return data;
    });

    await page.close();
    return priceData;

  } catch (error) {
    console.error(`  Error scraping ${setNumber}: ${error.message}`);
    await page.close();
    return null;
  }
}

/**
 * Generate BrickLink URLs and estimated data for a set
 * This is a fallback when scraping fails
 */
function generateBrickLinkData(set, ebayData) {
  const blId = toBrickLinkId(set.setNumber);

  // Estimate BrickLink prices based on eBay data (BrickLink typically 5-15% higher)
  const ebayPrice = ebayData?.value || set.value;
  const blPremium = 1.10; // BrickLink typically 10% higher than eBay

  return {
    setNumber: set.setNumber,
    brickLinkId: blId,
    name: set.name,
    urls: {
      priceGuide: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${blId}-1#T=P`,
      inventoryNew: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${blId}-1#T=S&O={%22cond%22:%22N%22}`,
      inventoryUsed: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${blId}-1#T=S&O={%22cond%22:%22U%22}`
    },
    estimatedPrices: {
      new: {
        estimated: parseFloat((ebayPrice * blPremium).toFixed(2)),
        source: 'Estimated from eBay (BrickLink +10%)'
      }
    },
    comparison: {
      ebayPrice: ebayPrice,
      brickLinkEstimate: parseFloat((ebayPrice * blPremium).toFixed(2)),
      arbitrageOpportunity: false
    },
    lastUpdated: new Date().toISOString(),
    dataSource: 'estimated'
  };
}

/**
 * Main scraper function
 */
async function scrapeBrickLink(targetSet = null) {
  console.log('='.repeat(60));
  console.log('BRICKLINK PRICE SCRAPER');
  console.log('='.repeat(60));
  console.log('');

  // Load portfolio
  const portfolio = loadJSON(PORTFOLIO_FILE);
  if (!portfolio) {
    console.error('Could not load portfolio data');
    process.exit(1);
  }

  const sets = portfolio.sets || [];
  const setsToScrape = targetSet
    ? sets.filter(s => s.setNumber === targetSet)
    : sets;

  console.log(`Sets to process: ${setsToScrape.length}`);
  console.log('');

  // Load existing data
  let existingData = loadJSON(OUTPUT_FILE) || { sets: {}, metadata: {} };

  // Try to launch browser for scraping
  let browser = null;
  let scrapingEnabled = false;

  try {
    console.log('Launching browser for BrickLink scraping...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    scrapingEnabled = true;
    console.log('Browser launched successfully');
  } catch (error) {
    console.warn(`Browser launch failed: ${error.message}`);
    console.warn('Falling back to URL generation only (no live scraping)');
  }

  const results = [];

  for (const set of setsToScrape) {
    console.log(`\nProcessing: ${set.setNumber} - ${set.name}`);

    let setData;

    if (scrapingEnabled && browser) {
      // Try to scrape actual data
      const scrapedData = await scrapeBrickLinkPrices(browser, set.setNumber);

      if (scrapedData && (scrapedData.newPrices.min || scrapedData.foundPrices)) {
        const blId = toBrickLinkId(set.setNumber);
        setData = {
          setNumber: set.setNumber,
          brickLinkId: blId,
          name: set.name,
          urls: {
            priceGuide: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${blId}-1#T=P`,
            inventoryNew: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${blId}-1#T=S&O={%22cond%22:%22N%22}`,
            inventoryUsed: `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${blId}-1#T=S&O={%22cond%22:%22U%22}`
          },
          prices: {
            new: scrapedData.newPrices,
            used: scrapedData.usedPrices
          },
          inventory: {
            new: scrapedData.inventoryNew,
            used: scrapedData.inventoryUsed
          },
          comparison: {
            ebayPrice: set.value,
            brickLinkMin: scrapedData.newPrices.min,
            brickLinkAvg: scrapedData.newPrices.avg,
            arbitrageOpportunity: scrapedData.newPrices.min && scrapedData.newPrices.min < set.value * 0.9
          },
          lastUpdated: new Date().toISOString(),
          dataSource: 'scraped'
        };
        console.log(`  ✓ Scraped: Min €${scrapedData.newPrices.min || 'N/A'}, Avg €${scrapedData.newPrices.avg || 'N/A'}`);
      } else {
        // Fallback to estimation
        setData = generateBrickLinkData(set, null);
        console.log(`  ⚠ Scrape incomplete, using estimates`);
      }

      await sleep(DELAY_BETWEEN_REQUESTS);
    } else {
      // Generate URLs and estimates without scraping
      setData = generateBrickLinkData(set, null);
      console.log(`  → Generated URLs and estimates`);
    }

    results.push(setData);
    existingData.sets[set.setNumber] = setData;
  }

  // Close browser if opened
  if (browser) {
    await browser.close();
  }

  // Calculate summary statistics
  const scrapedCount = results.filter(r => r.dataSource === 'scraped').length;
  const estimatedCount = results.filter(r => r.dataSource === 'estimated').length;
  const arbitrageOpportunities = results.filter(r => r.comparison?.arbitrageOpportunity);

  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total sets processed: ${results.length}`);
  console.log(`  Scraped successfully: ${scrapedCount}`);
  console.log(`  Estimated (fallback): ${estimatedCount}`);
  console.log(`  Arbitrage opportunities: ${arbitrageOpportunities.length}`);

  if (arbitrageOpportunities.length > 0) {
    console.log('');
    console.log('💰 ARBITRAGE OPPORTUNITIES (BrickLink < eBay):');
    arbitrageOpportunities.forEach(a => {
      console.log(`  ${a.setNumber}: BrickLink €${a.comparison.brickLinkMin} vs eBay €${a.comparison.ebayPrice}`);
    });
  }

  // Save results
  existingData.metadata = {
    lastUpdated: new Date().toISOString(),
    totalSets: Object.keys(existingData.sets).length,
    scrapedCount,
    estimatedCount,
    arbitrageCount: arbitrageOpportunities.length
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existingData, null, 2));
  console.log('');
  console.log(`Results saved to: ${OUTPUT_FILE}`);

  // Save to public folder
  const publicOutput = path.join(PUBLIC_DATA_DIR, 'bricklink-prices.json');
  fs.writeFileSync(publicOutput, JSON.stringify(existingData, null, 2));
  console.log(`Dashboard data saved to: ${publicOutput}`);

  return existingData;
}

// Parse command line args
const args = process.argv.slice(2);
let targetSet = null;
const setIdx = args.indexOf('--set');
if (setIdx !== -1 && args[setIdx + 1]) {
  targetSet = args[setIdx + 1];
}

// Run scraper
scrapeBrickLink(targetSet);
