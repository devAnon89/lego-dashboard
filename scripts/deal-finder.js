#!/usr/bin/env node
/**
 * Marketplace Deal Finder for LEGO Portfolio
 * Scans BrickLink and eBay for deals based on watchlist target prices
 *
 * Run: node deal-finder.js [--dry-run] [--set 10316-1]
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');
const DEALS_FILE = path.join(DATA_DIR, 'deals-found.json');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');

// Import scraper utilities
const bricklinkScraper = require('./bricklink-scraper.js');
const ebayScraper = require('./ebay-scraper.js');

/**
 * Load watchlist data
 */
function loadWatchlist() {
  try {
    return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
  } catch {
    return { metadata: { totalSets: 0 }, sets: [] };
  }
}

/**
 * Load existing deals
 */
function loadDeals() {
  try {
    return JSON.parse(fs.readFileSync(DEALS_FILE, 'utf-8'));
  } catch {
    return { metadata: { lastUpdated: null }, deals: [] };
  }
}

/**
 * Save deals to file
 */
function saveDeals(dealsData) {
  fs.writeFileSync(DEALS_FILE, JSON.stringify(dealsData, null, 2));
}

/**
 * Check if a listing meets watchlist criteria
 * @param {object} listing - Listing from scraper
 * @param {object} watchItem - Watchlist item with target criteria
 * @returns {boolean} True if listing qualifies as a deal
 */
function meetsTargetCriteria(listing, watchItem) {
  // Price must be below target price
  if (!listing.price || !watchItem.target_price) return false;
  if (listing.price > watchItem.target_price) return false;

  // Check max price if specified
  if (watchItem.max_price && listing.price > watchItem.max_price) return false;

  // Check condition preference
  if (watchItem.preferred_condition) {
    const preferredCondition = watchItem.preferred_condition.toLowerCase();
    const listingCondition = (listing.condition || '').toLowerCase();

    if (preferredCondition === 'new' && listingCondition !== 'new') return false;
    if (preferredCondition === 'used' && listingCondition !== 'used') return false;
  }

  // Check seller rating
  if (watchItem.min_seller_rating && listing.rating) {
    if (listing.rating < watchItem.min_seller_rating) return false;
  }

  // Check location filter
  if (watchItem.location_filters && watchItem.location_filters.length > 0) {
    if (!listing.location) return false;
    const locationMatch = watchItem.location_filters.some(loc =>
      listing.location.toUpperCase().includes(loc.toUpperCase())
    );
    if (!locationMatch) return false;
  }

  return true;
}

/**
 * Calculate discount percentage
 */
function calculateDiscount(listingPrice, targetPrice) {
  if (!targetPrice || targetPrice === 0) return 0;
  return ((targetPrice - listingPrice) / targetPrice * 100);
}

/**
 * Find deals for a specific watchlist item
 * @param {string} setId - Set ID like "10316-1"
 * @param {object} watchItem - Watchlist item configuration
 * @param {boolean} dryRun - If true, only simulate finding deals
 * @returns {array} Array of deal objects
 */
function findDealsForSet(setId, watchItem, dryRun = false) {
  const deals = [];

  if (dryRun) {
    // In dry run, just report what would be scanned
    return [{
      setId,
      name: watchItem.name || setId,
      source: 'BrickLink',
      status: 'DRY_RUN',
      targetPrice: watchItem.target_price,
      message: 'Would scan BrickLink for listings below target price',
    }];
  }

  // In real implementation, this would:
  // 1. Call getBrickLinkSearchUrl() with watchItem preferences
  // 2. Use browser automation to scrape the page
  // 3. Parse listings with parseBrickLinkListings()
  // 4. Filter results with meetsTargetCriteria()
  // 5. Return qualified deals

  // For now, return placeholder indicating scraping is needed
  return [];
}

/**
 * Check if a deal already exists in the deals list
 */
function isDuplicateDeal(existingDeals, newDeal) {
  return existingDeals.some(deal =>
    deal.setId === newDeal.setId &&
    deal.listingUrl === newDeal.listingUrl &&
    deal.status === 'active'
  );
}

/**
 * Main deal finder logic
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleSet = args.find((a, i) => args[i-1] === '--set');

  console.log('=== Marketplace Deal Finder ===\n');

  // Load data
  const watchlist = loadWatchlist();
  const existingDeals = loadDeals();

  // Get sets to scan
  let setsToScan = watchlist.sets || [];

  // Handle array format (from watchlist.json structure)
  if (Array.isArray(setsToScan)) {
    // Convert array to object keyed by setNumber
    const setsObj = {};
    setsToScan.forEach(set => {
      if (set.setNumber) {
        setsObj[set.setNumber] = set;
      }
    });
    setsToScan = setsObj;
  }

  // Filter to single set if specified
  if (singleSet) {
    const setData = setsToScan[singleSet];
    if (setData) {
      setsToScan = { [singleSet]: setData };
    } else {
      console.log(`❌ Set ${singleSet} not found in watchlist`);
      return;
    }
  }

  const setIds = Object.keys(setsToScan);
  console.log(`Watchlist sets: ${setIds.length}`);
  console.log(`Dry run: ${dryRun}\n`);

  if (setIds.length === 0) {
    console.log('⚠️  Watchlist is empty. Add sets to data/watchlist.json first.');
    console.log('\nExample watchlist entry:');
    console.log(JSON.stringify({
      setNumber: '10316-1',
      name: 'Rivendell',
      theme: 'Icons',
      target_price: 400,
      max_price: 450,
      preferred_condition: 'new',
      location_filters: ['US', 'DE'],
      min_seller_rating: 95,
    }, null, 2));
    return;
  }

  // Scan each set for deals
  const newDeals = [];
  let totalScanned = 0;

  for (const [setId, watchItem] of Object.entries(setsToScan)) {
    totalScanned++;

    console.log(`\n[${totalScanned}/${setIds.length}] Scanning ${watchItem.name || setId}...`);
    console.log(`  Target: €${watchItem.target_price || 'N/A'}`);
    console.log(`  Condition: ${watchItem.preferred_condition || 'any'}`);

    if (dryRun) {
      // Generate URLs that would be scraped
      const blUrl = bricklinkScraper.getBrickLinkSearchUrl(setId, {
        condition: watchItem.preferred_condition === 'new' ? 'N' :
                   watchItem.preferred_condition === 'used' ? 'U' : '',
        country: watchItem.location_filters?.[0] || '',
        minRating: watchItem.min_seller_rating || 0,
      });

      console.log(`  📋 BrickLink URL: ${blUrl}`);

      // Simulate finding a deal
      const mockDeal = {
        setId,
        name: watchItem.name || setId,
        source: 'BrickLink',
        price: watchItem.target_price ? watchItem.target_price * 0.9 : 100,
        targetPrice: watchItem.target_price || 0,
        discount: 10,
        condition: watchItem.preferred_condition || 'new',
        seller: 'MockSeller',
        sellerRating: watchItem.min_seller_rating || 98,
        location: watchItem.location_filters?.[0] || 'US',
        listingUrl: blUrl,
        foundAt: new Date().toISOString(),
        status: 'active',
      };

      console.log(`  ✓ Would find deal: €${mockDeal.price} (${mockDeal.discount}% off)`);
      newDeals.push(mockDeal);
    } else {
      // Real implementation would scrape here
      const deals = findDealsForSet(setId, watchItem, false);

      for (const deal of deals) {
        if (!isDuplicateDeal(existingDeals.deals, deal)) {
          newDeals.push(deal);
          console.log(`  ✓ New deal found: €${deal.price} (${deal.discount}% off)`);
        } else {
          console.log(`  ⏭️  Deal already tracked`);
        }
      }

      if (deals.length === 0) {
        console.log(`  ℹ️  No deals found below target price`);
      }
    }
  }

  // Save new deals
  if (newDeals.length > 0 && !dryRun) {
    existingDeals.deals.push(...newDeals);
    existingDeals.metadata.lastUpdated = new Date().toISOString();
    saveDeals(existingDeals);
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('SCAN COMPLETE');
  console.log('═'.repeat(50));
  console.log(`Sets scanned: ${totalScanned}`);
  console.log(`New deals found: ${newDeals.length}`);
  console.log(`Total active deals: ${(existingDeals.deals || []).filter(d => d.status === 'active').length + newDeals.length}`);

  if (newDeals.length > 0) {
    console.log('\n🎉 New deals:');
    newDeals.forEach(deal => {
      const discount = calculateDiscount(deal.price, deal.targetPrice).toFixed(1);
      console.log(`  • ${deal.name}: €${deal.price} (${discount}% off) - ${deal.source}`);
    });
  }

  if (!dryRun && newDeals.length > 0) {
    console.log(`\n💾 Deals saved to: ${DEALS_FILE}`);
  }

  console.log('═'.repeat(50));
  console.log('\n📊 View deals: node lego-cli.js serve → http://localhost:3456/deals.html');
  console.log('🔄 To refresh: node scripts/deal-finder.js\n');
}

// Export functions for testing and use by other modules
module.exports = {
  loadWatchlist,
  loadDeals,
  saveDeals,
  meetsTargetCriteria,
  calculateDiscount,
  findDealsForSet,
  isDuplicateDeal,
  WATCHLIST_FILE,
  DEALS_FILE,
};

if (require.main === module) {
  main().catch(console.error);
}
