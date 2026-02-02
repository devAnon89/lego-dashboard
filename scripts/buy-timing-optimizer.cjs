#!/usr/bin/env node
/**
 * Buy Timing Optimizer for LEGO Portfolio
 * Analyzes seasonal patterns and optimal buying windows for each theme.
 *
 * Usage:
 *   node scripts/buy-timing-optimizer.cjs
 */

const fs = require('fs');
const path = require('path');

// Data paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const RETIREMENT_PREDICTIONS_FILE = path.join(DATA_DIR, 'retirement-predictions.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'buy-timing.json');

/**
 * Seasonal buying patterns based on market research
 */
const SEASONAL_PATTERNS = {
  // Q1 (Jan-Mar): Post-holiday clearance, new releases
  'January': { discount: 15, reason: 'Post-holiday clearance sales', action: 'BUY' },
  'February': { discount: 10, reason: 'Continued clearance, low demand', action: 'BUY' },
  'March': { discount: 5, reason: 'Pre-spring releases', action: 'NEUTRAL' },

  // Q2 (Apr-Jun): Normal pricing, some May the 4th deals
  'April': { discount: 0, reason: 'Standard pricing period', action: 'NEUTRAL' },
  'May': { discount: 8, reason: 'May the 4th (Star Wars), Memorial Day sales', action: 'BUY' },
  'June': { discount: 5, reason: 'Early summer sales', action: 'NEUTRAL' },

  // Q3 (Jul-Sep): Summer lull, back to school
  'July': { discount: 10, reason: 'Summer clearance begins', action: 'BUY' },
  'August': { discount: 12, reason: 'Back-to-school clearance, summer wave endings', action: 'BUY' },
  'September': { discount: 5, reason: 'New fall releases arriving', action: 'NEUTRAL' },

  // Q4 (Oct-Dec): Holiday peak pricing
  'October': { discount: 0, reason: 'Holiday stock buildup', action: 'AVOID' },
  'November': { discount: -5, reason: 'Black Friday may offer deals, but limited on LEGO', action: 'WAIT' },
  'December': { discount: -10, reason: 'Peak holiday demand, highest prices', action: 'AVOID' }
};

/**
 * Theme-specific best months to buy
 */
const THEME_BEST_MONTHS = {
  'Star Wars': ['January', 'February', 'May', 'August'], // May the 4th deals
  'Speed Champions': ['January', 'February', 'August'], // After car show season
  'Seasonal': ['January', 'February'], // Post-holiday only
  'Harry Potter': ['January', 'July', 'August'], // Between movie/book releases
  'Marvel Super Heroes': ['January', 'February', 'July'], // Between MCU releases
  'Disney': ['January', 'February', 'August'], // Post-holiday
  'Technic': ['January', 'February', 'July', 'August'], // Summer/winter clearance
  'Icons': ['January', 'February', 'July'], // Large sets on clearance
  'Ideas': ['January', 'February', 'August'], // Clearance periods
  'Creator': ['January', 'February', 'July', 'August'],
  'City': ['January', 'August'], // Back-to-school
  'Friends': ['January', 'August'],
  'Super Mario': ['January', 'February', 'August'],
  'Minecraft': ['January', 'August'], // Gaming-related patterns
  'Botanicals': ['January', 'February', 'July'], // Post-Valentine's, post-Mother's Day
  'default': ['January', 'February', 'July', 'August']
};

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
 * Get base theme
 */
function getBaseTheme(theme) {
  if (!theme) return 'Unknown';
  return theme.split('/')[0].trim();
}

/**
 * Get current month name
 */
function getCurrentMonth() {
  return new Date().toLocaleString('en-US', { month: 'long' });
}

/**
 * Calculate months until target
 */
function monthsUntil(targetMonth) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const currentIdx = new Date().getMonth();
  const targetIdx = months.indexOf(targetMonth);

  if (targetIdx <= currentIdx) {
    return targetIdx + 12 - currentIdx;
  }
  return targetIdx - currentIdx;
}

/**
 * Analyze price history for seasonal patterns
 */
function analyzeHistoricalPatterns(priceHistory) {
  const monthlyPrices = {};

  // Initialize months
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  months.forEach(m => { monthlyPrices[m] = []; });

  // Aggregate prices by month
  Object.values(priceHistory?.sets || {}).forEach(setHistory => {
    (setHistory.priceHistory || []).forEach(point => {
      const date = new Date(point.date);
      const month = date.toLocaleString('en-US', { month: 'long' });
      const price = point.valueNew || point.valueUsed;
      if (price > 0) {
        monthlyPrices[month].push(price);
      }
    });
  });

  // Calculate average price index per month (relative to annual average)
  const monthlyAverages = {};
  const allPrices = Object.values(monthlyPrices).flat();
  const overallAvg = allPrices.length > 0 ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : 100;

  months.forEach(month => {
    const monthPrices = monthlyPrices[month];
    if (monthPrices.length > 0) {
      const avg = monthPrices.reduce((a, b) => a + b, 0) / monthPrices.length;
      monthlyAverages[month] = {
        priceIndex: parseFloat(((avg / overallAvg) * 100).toFixed(1)),
        sampleSize: monthPrices.length,
        avgPrice: parseFloat(avg.toFixed(2))
      };
    } else {
      monthlyAverages[month] = { priceIndex: 100, sampleSize: 0, avgPrice: 0 };
    }
  });

  return monthlyAverages;
}

/**
 * Generate buy timing recommendations for a set
 */
function generateSetRecommendation(set, retirementData) {
  const baseTheme = getBaseTheme(set.theme);
  const bestMonths = THEME_BEST_MONTHS[baseTheme] || THEME_BEST_MONTHS['default'];
  const currentMonth = getCurrentMonth();

  // Find retirement prediction for this set
  const retirement = retirementData?.predictions?.find(p => p.setNumber === set.setNumber);
  const monthsUntilRetirement = retirement?.retirementPrediction?.monthsUntil || 24;
  const urgency = retirement?.retirementPrediction?.urgency || 'none';

  // Determine if we should wait or buy now
  let recommendation;
  let reasoning;
  let optimalMonth;
  let monthsToWait;

  // Find next best month
  const sortedMonths = bestMonths.map(m => ({
    month: m,
    monthsAway: monthsUntil(m)
  })).sort((a, b) => a.monthsAway - b.monthsAway);

  optimalMonth = sortedMonths[0]?.month;
  monthsToWait = sortedMonths[0]?.monthsAway || 0;

  // Current month analysis
  const currentMonthData = SEASONAL_PATTERNS[currentMonth];

  if (urgency === 'critical' || urgency === 'high') {
    recommendation = 'BUY_NOW';
    reasoning = `Retirement imminent (${monthsUntilRetirement} months). Buy immediately before prices spike.`;
  } else if (monthsUntilRetirement < 6) {
    recommendation = 'BUY_SOON';
    reasoning = `Only ${monthsUntilRetirement} months until expected retirement. Buy within next 1-2 months.`;
  } else if (bestMonths.includes(currentMonth)) {
    recommendation = 'BUY_NOW';
    reasoning = `${currentMonth} is optimal buying month for ${baseTheme}. ${currentMonthData.reason}`;
  } else if (currentMonthData.action === 'AVOID') {
    recommendation = 'WAIT';
    reasoning = `${currentMonth} has peak pricing. Wait for ${optimalMonth} (${monthsToWait} months).`;
  } else if (monthsToWait <= 2) {
    recommendation = 'WAIT';
    reasoning = `Better prices expected in ${optimalMonth} (${monthsToWait} months). ${SEASONAL_PATTERNS[optimalMonth]?.reason || ''}`;
  } else {
    recommendation = 'NEUTRAL';
    reasoning = `No urgency. Optimal buying window: ${bestMonths.join(', ')}.`;
  }

  return {
    setNumber: set.setNumber,
    name: set.name,
    theme: set.theme,
    baseTheme,
    currentValue: set.value,
    recommendation,
    reasoning,
    timing: {
      currentMonth,
      currentMonthAction: currentMonthData.action,
      expectedDiscount: currentMonthData.discount,
      optimalMonth,
      monthsToWait,
      bestMonths
    },
    retirement: {
      monthsUntil: monthsUntilRetirement,
      urgency
    }
  };
}

/**
 * Main analysis function
 */
function analyzeBuyTiming() {
  console.log('='.repeat(60));
  console.log('BUY TIMING OPTIMIZER');
  console.log('='.repeat(60));
  console.log('');

  // Load data
  const portfolio = loadJSON(PORTFOLIO_FILE);
  const priceHistory = loadJSON(PRICE_HISTORY_FILE);
  const retirementData = loadJSON(RETIREMENT_PREDICTIONS_FILE);

  if (!portfolio) {
    console.error('Could not load portfolio data');
    process.exit(1);
  }

  const sets = portfolio.sets || [];
  const currentMonth = getCurrentMonth();
  const currentMonthData = SEASONAL_PATTERNS[currentMonth];

  // Analyze historical patterns
  const historicalPatterns = analyzeHistoricalPatterns(priceHistory);

  console.log(`📅 CURRENT MONTH: ${currentMonth}`);
  console.log(`   Action: ${currentMonthData.action}`);
  console.log(`   Expected Discount: ${currentMonthData.discount}%`);
  console.log(`   Reason: ${currentMonthData.reason}`);
  console.log('');

  // Generate recommendations for all sets
  const recommendations = sets.map(set =>
    generateSetRecommendation(set, retirementData)
  );

  // Categorize
  const buyNow = recommendations.filter(r => r.recommendation === 'BUY_NOW');
  const buySoon = recommendations.filter(r => r.recommendation === 'BUY_SOON');
  const wait = recommendations.filter(r => r.recommendation === 'WAIT');
  const neutral = recommendations.filter(r => r.recommendation === 'NEUTRAL');

  console.log('RECOMMENDATIONS SUMMARY:');
  console.log('-'.repeat(40));
  console.log(`  🟢 BUY NOW: ${buyNow.length} sets`);
  console.log(`  🟡 BUY SOON: ${buySoon.length} sets`);
  console.log(`  ⏳ WAIT: ${wait.length} sets`);
  console.log(`  ⚪ NEUTRAL: ${neutral.length} sets`);
  console.log('');

  if (buyNow.length > 0) {
    console.log('🟢 BUY NOW:');
    buyNow.forEach(r => {
      console.log(`  ${r.setNumber} - ${r.name.substring(0, 40)}`);
      console.log(`    ${r.reasoning}`);
    });
    console.log('');
  }

  if (buySoon.length > 0) {
    console.log('🟡 BUY SOON (within 1-2 months):');
    buySoon.forEach(r => {
      console.log(`  ${r.setNumber} - ${r.name.substring(0, 40)}`);
      console.log(`    ${r.reasoning}`);
    });
    console.log('');
  }

  if (wait.length > 0 && wait.length <= 10) {
    console.log('⏳ WAIT FOR BETTER PRICES:');
    wait.forEach(r => {
      console.log(`  ${r.setNumber} - Wait ${r.timing.monthsToWait} months (${r.timing.optimalMonth})`);
    });
    console.log('');
  }

  // Monthly calendar view
  console.log('📆 OPTIMAL BUYING CALENDAR:');
  console.log('-'.repeat(40));
  Object.entries(SEASONAL_PATTERNS).forEach(([month, data]) => {
    const indicator = data.action === 'BUY' ? '✅' :
                     data.action === 'AVOID' ? '❌' :
                     data.action === 'WAIT' ? '⏳' : '⚪';
    const discountStr = data.discount >= 0 ? `+${data.discount}%` : `${data.discount}%`;
    console.log(`  ${indicator} ${month.padEnd(12)} ${data.action.padEnd(8)} ${discountStr.padStart(5)} - ${data.reason.substring(0, 35)}`);
  });
  console.log('');

  // Theme recommendations
  console.log('🎯 BEST MONTHS BY THEME:');
  console.log('-'.repeat(40));
  const themes = [...new Set(sets.map(s => getBaseTheme(s.theme)))];
  themes.forEach(theme => {
    const bestMonths = THEME_BEST_MONTHS[theme] || THEME_BEST_MONTHS['default'];
    console.log(`  ${theme.padEnd(20)} ${bestMonths.join(', ')}`);
  });
  console.log('');

  // Save results
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      currentMonth,
      totalSets: sets.length
    },
    currentMonthAnalysis: {
      month: currentMonth,
      ...currentMonthData
    },
    seasonalPatterns: SEASONAL_PATTERNS,
    historicalPatterns,
    themeBestMonths: THEME_BEST_MONTHS,
    summary: {
      buyNow: buyNow.length,
      buySoon: buySoon.length,
      wait: wait.length,
      neutral: neutral.length
    },
    recommendations: {
      buyNow: buyNow.map(r => ({ setNumber: r.setNumber, name: r.name, reasoning: r.reasoning })),
      buySoon: buySoon.map(r => ({ setNumber: r.setNumber, name: r.name, reasoning: r.reasoning })),
      wait: wait.map(r => ({ setNumber: r.setNumber, name: r.name, optimalMonth: r.timing.optimalMonth, monthsToWait: r.timing.monthsToWait }))
    },
    allRecommendations: recommendations
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${OUTPUT_FILE}`);

  // Save to public folder
  const publicOutput = path.join(PUBLIC_DATA_DIR, 'buy-timing.json');
  fs.writeFileSync(publicOutput, JSON.stringify(output, null, 2));
  console.log(`Dashboard data saved to: ${publicOutput}`);

  return output;
}

// Run analysis
analyzeBuyTiming();
