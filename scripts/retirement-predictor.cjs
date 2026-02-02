#!/usr/bin/env node
/**
 * Enhanced Retirement Predictor for LEGO Portfolio
 * Predicts set retirement timing based on theme lifespans, production signals, and patterns.
 *
 * Usage:
 *   node scripts/retirement-predictor.cjs
 */

const fs = require('fs');
const path = require('path');

// Data paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const DEEP_ANALYSIS_FILE = path.join(DATA_DIR, 'deep-analysis.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'retirement-predictions.json');

/**
 * Theme average lifespans (years) based on historical data
 */
const THEME_LIFESPANS = {
  'Speed Champions': { avg: 2.5, min: 1.5, max: 3.5 },
  'BrickHeadz': { avg: 2, min: 1, max: 3 },
  'Seasonal': { avg: 1.5, min: 1, max: 2 },
  'Friends': { avg: 2, min: 1.5, max: 3 },
  'City': { avg: 2.5, min: 2, max: 4 },
  'Technic': { avg: 3, min: 2, max: 5 },
  'Creator': { avg: 3, min: 2, max: 4 },
  'Ideas': { avg: 2.5, min: 2, max: 4 },
  'Icons': { avg: 3, min: 2, max: 5 },
  'Marvel Super Heroes': { avg: 2, min: 1.5, max: 3 },
  'Disney': { avg: 2.5, min: 2, max: 4 },
  'Super Mario': { avg: 2, min: 1.5, max: 3 },
  'Minecraft': { avg: 2.5, min: 2, max: 3.5 },
  'Star Wars': { avg: 2.5, min: 1.5, max: 4 },
  'Harry Potter': { avg: 2.5, min: 2, max: 3.5 },
  'Botanicals': { avg: 3, min: 2, max: 4 },
  'LEGO Art': { avg: 2.5, min: 2, max: 3.5 },
  'default': { avg: 2.5, min: 1.5, max: 4 }
};

/**
 * Price tier adjustments (larger sets tend to have longer lifespans)
 */
const PRICE_TIER_ADJUSTMENTS = {
  'budget': -0.5,      // < €30: retire faster
  'mid': 0,            // €30-99: baseline
  'premium': 0.5,      // €100-249: slightly longer
  'ultimate': 1.0      // €250+: longest lifespans
};

/**
 * License strength adjustments
 */
const LICENSE_ADJUSTMENTS = {
  'high': 0.5,         // Strong licenses (Star Wars, Marvel) = longer support
  'medium': 0,
  'low': -0.3,
  'none': 0
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
 * Extract base theme from full theme string
 */
function getBaseTheme(theme) {
  if (!theme) return 'Unknown';
  return theme.split('/')[0].trim();
}

/**
 * Get price tier
 */
function getPriceTier(retail) {
  if (retail < 30) return 'budget';
  if (retail < 100) return 'mid';
  if (retail < 250) return 'premium';
  return 'ultimate';
}

/**
 * Estimate release date from available data
 */
function estimateReleaseDate(set, priceHistory) {
  // Try to get from price history
  const setHistory = priceHistory?.sets?.[set.setNumber];
  if (setHistory?.priceHistory?.length > 0) {
    const firstDate = new Date(setHistory.priceHistory[0].date);
    // Price history usually starts a few months after release
    firstDate.setMonth(firstDate.getMonth() - 3);
    return firstDate;
  }

  // Default to 1 year ago
  const defaultDate = new Date();
  defaultDate.setFullYear(defaultDate.getFullYear() - 1);
  return defaultDate;
}

/**
 * Detect retirement signals from price patterns
 */
function detectRetirementSignals(set, priceHistory) {
  const signals = [];
  let signalScore = 0;

  const setHistory = priceHistory?.sets?.[set.setNumber];
  if (!setHistory?.priceHistory || setHistory.priceHistory.length < 3) {
    return { signals, signalScore };
  }

  const history = setHistory.priceHistory;
  const recentPrices = history.slice(-6); // Last 6 data points

  // Signal 1: Rapid price increase (>20% in recent period)
  if (recentPrices.length >= 2) {
    const oldPrice = recentPrices[0].valueNew || recentPrices[0].valueUsed;
    const newPrice = recentPrices[recentPrices.length - 1].valueNew || recentPrices[recentPrices.length - 1].valueUsed;
    if (oldPrice > 0 && newPrice > oldPrice * 1.2) {
      signals.push('Rapid price increase detected (>20%)');
      signalScore += 2;
    }
  }

  // Signal 2: Price above retail (often indicates scarcity)
  if (set.value > set.retail * 1.1) {
    signals.push('Trading above retail price');
    signalScore += 1;
  }

  // Signal 3: High growth rate
  if (set.growth > 30) {
    signals.push('High growth rate (>30%)');
    signalScore += 2;
  }

  // Signal 4: Approaching typical theme lifespan
  const baseTheme = getBaseTheme(set.theme);
  const themeLifespan = THEME_LIFESPANS[baseTheme] || THEME_LIFESPANS['default'];
  const releaseDate = estimateReleaseDate(set, priceHistory);
  const ageYears = (Date.now() - releaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  if (ageYears > themeLifespan.avg * 0.8) {
    signals.push(`Approaching typical ${baseTheme} lifespan`);
    signalScore += 2;
  }

  if (ageYears > themeLifespan.avg) {
    signals.push('Past typical theme lifespan');
    signalScore += 3;
  }

  return { signals, signalScore };
}

/**
 * Calculate confidence level based on data quality
 */
function calculateConfidence(set, priceHistory, signalScore) {
  let confidence = 50; // Base confidence

  // More data = higher confidence
  const setHistory = priceHistory?.sets?.[set.setNumber];
  if (setHistory?.priceHistory?.length > 12) {
    confidence += 15;
  } else if (setHistory?.priceHistory?.length > 6) {
    confidence += 10;
  }

  // More signals = higher confidence
  confidence += signalScore * 5;

  // Cap at 95%
  return Math.min(95, confidence);
}

/**
 * Generate retirement prediction for a set
 */
function predictRetirement(set, deepAnalysis, priceHistory) {
  const baseTheme = getBaseTheme(set.theme);
  const themeLifespan = THEME_LIFESPANS[baseTheme] || THEME_LIFESPANS['default'];
  const priceTier = getPriceTier(set.retail);
  const deepData = deepAnalysis?.[set.setNumber] || {};

  // Calculate adjusted lifespan
  let adjustedLifespan = themeLifespan.avg;

  // Adjust for price tier
  adjustedLifespan += PRICE_TIER_ADJUSTMENTS[priceTier];

  // Adjust for license strength
  const licenseScore = deepData.license || 5;
  if (licenseScore >= 8) {
    adjustedLifespan += LICENSE_ADJUSTMENTS['high'];
  } else if (licenseScore >= 5) {
    adjustedLifespan += LICENSE_ADJUSTMENTS['medium'];
  } else if (licenseScore > 0) {
    adjustedLifespan += LICENSE_ADJUSTMENTS['low'];
  }

  // Estimate release date and calculate retirement window
  const releaseDate = estimateReleaseDate(set, priceHistory);
  const ageYears = (Date.now() - releaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  // Calculate expected retirement date
  const expectedRetirementDate = new Date(releaseDate);
  expectedRetirementDate.setFullYear(expectedRetirementDate.getFullYear() + Math.round(adjustedLifespan));

  // Calculate retirement window
  const earlyRetirement = new Date(releaseDate);
  earlyRetirement.setFullYear(earlyRetirement.getFullYear() + Math.round(themeLifespan.min + PRICE_TIER_ADJUSTMENTS[priceTier]));

  const lateRetirement = new Date(releaseDate);
  lateRetirement.setFullYear(lateRetirement.getFullYear() + Math.round(themeLifespan.max + PRICE_TIER_ADJUSTMENTS[priceTier]));

  // Detect retirement signals
  const { signals, signalScore } = detectRetirementSignals(set, priceHistory);

  // Determine retirement status
  let status;
  let urgency;
  const now = new Date();

  if (now > lateRetirement) {
    status = 'LIKELY_RETIRED';
    urgency = 'critical';
  } else if (now > expectedRetirementDate) {
    status = 'RETIRING_SOON';
    urgency = 'high';
  } else if (now > earlyRetirement) {
    status = 'RETIREMENT_WINDOW';
    urgency = 'medium';
  } else if (signalScore >= 4) {
    status = 'EARLY_SIGNALS';
    urgency = 'low';
  } else {
    status = 'ACTIVE';
    urgency = 'none';
  }

  // Calculate months until expected retirement
  const monthsUntilRetirement = Math.max(0, Math.round((expectedRetirementDate - now) / (30 * 24 * 60 * 60 * 1000)));

  // Calculate confidence
  const confidence = calculateConfidence(set, priceHistory, signalScore);

  return {
    setNumber: set.setNumber,
    name: set.name,
    theme: set.theme,
    baseTheme,
    retail: set.retail,
    currentValue: set.value,
    priceTier,
    ageYears: parseFloat(ageYears.toFixed(1)),
    estimatedRelease: releaseDate.toISOString().split('T')[0],
    themeLifespan: {
      typical: themeLifespan.avg,
      adjusted: parseFloat(adjustedLifespan.toFixed(1)),
      range: `${themeLifespan.min}-${themeLifespan.max} years`
    },
    retirementPrediction: {
      expected: expectedRetirementDate.toISOString().split('T')[0],
      window: {
        earliest: earlyRetirement.toISOString().split('T')[0],
        latest: lateRetirement.toISOString().split('T')[0]
      },
      monthsUntil: monthsUntilRetirement,
      status,
      urgency
    },
    signals,
    signalScore,
    confidence,
    recommendation: generateRecommendation(status, signalScore, set, monthsUntilRetirement)
  };
}

/**
 * Generate actionable recommendation
 */
function generateRecommendation(status, signalScore, set, monthsUntil) {
  switch (status) {
    case 'LIKELY_RETIRED':
      return 'Set likely retired. Prices may spike - consider selling if you have multiple copies.';
    case 'RETIRING_SOON':
      return `Retirement imminent. Buy additional units now if interested. Expected price increase post-retirement.`;
    case 'RETIREMENT_WINDOW':
      return `In retirement window. Monitor for clearance sales and stock depletion signals.`;
    case 'EARLY_SIGNALS':
      return `Early retirement signals detected. Good time to acquire at retail if planning to hold.`;
    case 'ACTIVE':
      if (monthsUntil < 12) {
        return `Active but approaching retirement (~${monthsUntil} months). Consider buying before retirement.`;
      }
      return `Active with ${monthsUntil}+ months expected availability. No urgency to buy.`;
    default:
      return 'Insufficient data for recommendation.';
  }
}

/**
 * Main analysis function
 */
function analyzeRetirements() {
  console.log('='.repeat(60));
  console.log('RETIREMENT PREDICTOR');
  console.log('='.repeat(60));
  console.log('');

  // Load data
  const portfolio = loadJSON(PORTFOLIO_FILE);
  const deepAnalysis = loadJSON(DEEP_ANALYSIS_FILE);
  const priceHistory = loadJSON(PRICE_HISTORY_FILE);

  if (!portfolio) {
    console.error('Could not load portfolio data');
    process.exit(1);
  }

  const sets = portfolio.sets || [];

  // Generate predictions for all sets
  const predictions = sets.map(set =>
    predictRetirement(set, deepAnalysis, priceHistory)
  );

  // Sort by urgency
  const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
  predictions.sort((a, b) =>
    urgencyOrder[a.retirementPrediction.urgency] - urgencyOrder[b.retirementPrediction.urgency] ||
    a.retirementPrediction.monthsUntil - b.retirementPrediction.monthsUntil
  );

  // Categorize results
  const critical = predictions.filter(p => p.retirementPrediction.urgency === 'critical');
  const high = predictions.filter(p => p.retirementPrediction.urgency === 'high');
  const medium = predictions.filter(p => p.retirementPrediction.urgency === 'medium');
  const low = predictions.filter(p => p.retirementPrediction.urgency === 'low');
  const active = predictions.filter(p => p.retirementPrediction.urgency === 'none');

  // Print summary
  console.log('RETIREMENT STATUS SUMMARY:');
  console.log('-'.repeat(40));
  console.log(`  🔴 Critical (likely retired): ${critical.length}`);
  console.log(`  🟠 High (retiring soon): ${high.length}`);
  console.log(`  🟡 Medium (retirement window): ${medium.length}`);
  console.log(`  🟢 Low (early signals): ${low.length}`);
  console.log(`  ⚪ Active (no urgency): ${active.length}`);
  console.log('');

  if (critical.length > 0) {
    console.log('🔴 LIKELY RETIRED:');
    critical.forEach(p => {
      console.log(`  ${p.setNumber} - ${p.name.substring(0, 35)}`);
      console.log(`    Age: ${p.ageYears}yr | Signals: ${p.signals.length} | ${p.recommendation.substring(0, 60)}`);
    });
    console.log('');
  }

  if (high.length > 0) {
    console.log('🟠 RETIRING SOON (Act Now):');
    high.forEach(p => {
      console.log(`  ${p.setNumber} - ${p.name.substring(0, 35)}`);
      console.log(`    Expected: ${p.retirementPrediction.expected} | Confidence: ${p.confidence}%`);
      console.log(`    ${p.recommendation}`);
    });
    console.log('');
  }

  if (medium.length > 0) {
    console.log('🟡 IN RETIREMENT WINDOW:');
    medium.slice(0, 10).forEach(p => {
      console.log(`  ${p.setNumber} - ${p.name.substring(0, 35)}`);
      console.log(`    Window: ${p.retirementPrediction.window.earliest} to ${p.retirementPrediction.window.latest}`);
    });
    console.log('');
  }

  console.log('📅 UPCOMING RETIREMENTS (Next 12 Months):');
  console.log('-'.repeat(40));
  const upcoming = predictions
    .filter(p => p.retirementPrediction.monthsUntil <= 12 && p.retirementPrediction.monthsUntil > 0)
    .sort((a, b) => a.retirementPrediction.monthsUntil - b.retirementPrediction.monthsUntil);

  if (upcoming.length > 0) {
    upcoming.forEach(p => {
      console.log(`  ${p.retirementPrediction.monthsUntil.toString().padStart(2)} months: ${p.setNumber} - ${p.name.substring(0, 40)}`);
    });
  } else {
    console.log('  No sets expected to retire in next 12 months');
  }
  console.log('');

  // Save results
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalSets: sets.length
    },
    summary: {
      critical: critical.length,
      high: high.length,
      medium: medium.length,
      low: low.length,
      active: active.length
    },
    urgentActions: [...critical, ...high].map(p => ({
      setNumber: p.setNumber,
      name: p.name,
      urgency: p.retirementPrediction.urgency,
      recommendation: p.recommendation
    })),
    upcomingRetirements: upcoming.map(p => ({
      setNumber: p.setNumber,
      name: p.name,
      monthsUntil: p.retirementPrediction.monthsUntil,
      expected: p.retirementPrediction.expected,
      confidence: p.confidence
    })),
    predictions
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${OUTPUT_FILE}`);

  // Save to public folder
  const publicOutput = path.join(PUBLIC_DATA_DIR, 'retirement-predictions.json');
  fs.writeFileSync(publicOutput, JSON.stringify(output, null, 2));
  console.log(`Dashboard data saved to: ${publicOutput}`);

  return output;
}

// Run analysis
analyzeRetirements();
