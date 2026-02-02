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
 * Score a deal based on discount, seller rating, and condition match
 * @param {object} listing - Listing from scraper with price, rating, condition
 * @param {object} watchItem - Watchlist item with target_price and preferred_condition
 * @returns {number} Score from 0-100 (50% discount, 25% rating, 25% condition)
 */
function scoreDeal(listing, watchItem) {
  if (!listing || !watchItem) return 0;

  let score = 0;

  // 1. Price discount component (50 points max)
  if (listing.price && watchItem.target_price) {
    const discountPct = calculateDiscount(listing.price, watchItem.target_price);

    // Scale discount to 0-50 points
    // 0% discount = 0 points
    // 20% discount = 25 points
    // 40% discount = 40 points
    // 50%+ discount = 50 points (capped)
    const discountScore = Math.min(50, (discountPct / 50) * 50);
    score += Math.max(0, discountScore);
  }

  // 2. Seller rating component (25 points max)
  if (listing.rating !== undefined && listing.rating !== null) {
    // Rating is typically 0-100 scale
    // Scale to 0-25 points
    const ratingScore = (listing.rating / 100) * 25;
    score += Math.max(0, Math.min(25, ratingScore));
  }

  // 3. Condition match component (25 points max)
  if (watchItem.preferred_condition && listing.condition) {
    const preferredCondition = watchItem.preferred_condition.toLowerCase();
    const listingCondition = listing.condition.toLowerCase();

    if (preferredCondition === listingCondition) {
      // Perfect match
      score += 25;
    } else if (preferredCondition === 'new' && listingCondition === 'used') {
      // User wants new but got used = low score
      score += 5;
    } else if (preferredCondition === 'used' && listingCondition === 'new') {
      // User wants used but got new = better than nothing
      score += 15;
    } else {
      // Other partial matches
      score += 10;
    }
  } else if (listing.condition) {
    // No preference specified, give partial points for any condition info
    score += 15;
  }

  // Ensure score is within 0-100 range
  return Math.max(0, Math.min(100, Math.round(score)));
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
 * Update deal status with timestamp tracking
 * @param {object} deal - Deal object to update
 * @param {string} newStatus - New status: 'active', 'expired', 'purchased', 'ignored'
 * @returns {object} Updated deal object with status history
 */
function updateDealStatus(deal, newStatus) {
  const validStatuses = ['active', 'expired', 'purchased', 'ignored'];

  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`);
  }

  const previousStatus = deal.status;
  deal.status = newStatus;
  deal.statusUpdatedAt = new Date().toISOString();

  // Initialize status history if it doesn't exist
  if (!deal.statusHistory) {
    deal.statusHistory = [];
  }

  // Add status change to history
  deal.statusHistory.push({
    from: previousStatus,
    to: newStatus,
    timestamp: deal.statusUpdatedAt,
  });

  return deal;
}

/**
 * Mark deals as expired based on age or criteria
 * @param {array} deals - Array of deal objects
 * @param {number} maxAgeHours - Maximum age in hours before marking expired
 * @returns {number} Number of deals marked as expired
 */
function markExpiredDeals(deals, maxAgeHours = 72) {
  let expiredCount = 0;
  const now = new Date();

  for (const deal of deals) {
    if (deal.status !== 'active') continue;

    const foundAt = new Date(deal.foundAt);
    const ageHours = (now - foundAt) / (1000 * 60 * 60);

    if (ageHours > maxAgeHours) {
      updateDealStatus(deal, 'expired');
      expiredCount++;
    }
  }

  return expiredCount;
}

/**
 * Get deal statistics by status
 * @param {array} deals - Array of deal objects
 * @returns {object} Statistics object with counts per status
 */
function getDealStats(deals) {
  const stats = {
    active: 0,
    expired: 0,
    purchased: 0,
    ignored: 0,
    total: deals.length,
  };

  for (const deal of deals) {
    const status = deal.status || 'active';
    if (stats[status] !== undefined) {
      stats[status]++;
    }
  }

  return stats;
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

      // Check for duplicates
      if (!isDuplicateDeal(existingDeals.deals, mockDeal)) {
        console.log(`  ✓ Would find deal: €${mockDeal.price} (${mockDeal.discount}% off)`);
        newDeals.push(mockDeal);
      } else {
        console.log(`  ⏭️  Deal already tracked (duplicate detected)`);
      }
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

  // Save new deals (including dry-run deals for duplicate detection testing)
  if (newDeals.length > 0) {
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

  if (newDeals.length > 0) {
    if (dryRun) {
      console.log(`\n💾 Mock deals saved to: ${DEALS_FILE} (for duplicate detection testing)`);
    } else {
      console.log(`\n💾 Deals saved to: ${DEALS_FILE}`);
    }
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
  scoreDeal,
  findDealsForSet,
  isDuplicateDeal,
  updateDealStatus,
  markExpiredDeals,
  getDealStats,
  WATCHLIST_FILE,
  DEALS_FILE,
};

if (require.main === module) {
  main().catch(console.error);
}
