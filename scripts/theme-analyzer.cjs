#!/usr/bin/env node
/**
 * Theme Performance Analyzer for LEGO Portfolio
 * Analyzes which themes/categories appreciate fastest for portfolio allocation.
 *
 * Usage:
 *   node scripts/theme-analyzer.cjs
 */

const fs = require('fs');
const path = require('path');

// Data paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const DEEP_ANALYSIS_FILE = path.join(DATA_DIR, 'deep-analysis.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'theme-performance.json');

/**
 * Load JSON file safely
 */
function loadJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch (e) {
    console.warn(`Could not load ${filepath}`);
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
 * Calculate statistics for an array of numbers
 */
function calculateStats(values) {
  if (!values || values.length === 0) {
    return { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)];

  const squaredDiffs = sorted.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / count;
  const stdDev = Math.sqrt(variance);

  return {
    mean: parseFloat(mean.toFixed(2)),
    median: parseFloat(median.toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(2)),
    min: parseFloat(sorted[0].toFixed(2)),
    max: parseFloat(sorted[count - 1].toFixed(2)),
    count
  };
}

/**
 * Calculate historical CAGR from price history
 */
function calculateCAGR(setId, priceHistory) {
  const setHistory = priceHistory?.sets?.[setId];
  if (!setHistory?.priceHistory || setHistory.priceHistory.length < 2) {
    return null;
  }

  const history = setHistory.priceHistory;
  const firstPrice = history[0].valueNew || history[0].valueUsed;
  const lastPrice = history[history.length - 1].valueNew || history[history.length - 1].valueUsed;

  if (!firstPrice || !lastPrice || firstPrice <= 0) return null;

  const firstDate = new Date(history[0].date);
  const lastDate = new Date(history[history.length - 1].date);
  const years = (lastDate - firstDate) / (365.25 * 24 * 60 * 60 * 1000);

  if (years < 0.1) return null; // Need at least ~1 month of data

  const cagr = (Math.pow(lastPrice / firstPrice, 1 / years) - 1) * 100;
  return parseFloat(cagr.toFixed(2));
}

/**
 * Main analysis function
 */
function analyzeThemePerformance() {
  console.log('='.repeat(60));
  console.log('THEME PERFORMANCE ANALYZER');
  console.log('='.repeat(60));
  console.log('');

  // Load data
  const portfolio = loadJSON(PORTFOLIO_FILE);
  const priceHistory = loadJSON(PRICE_HISTORY_FILE);
  const deepAnalysis = loadJSON(DEEP_ANALYSIS_FILE);

  if (!portfolio) {
    console.error('Could not load portfolio data');
    process.exit(1);
  }

  const sets = portfolio.sets || [];

  // Group sets by theme
  const themeData = {};
  const tierData = {
    budget: { sets: [], values: [], growths: [], cagrs: [] },      // < €30
    mid: { sets: [], values: [], growths: [], cagrs: [] },         // €30-99
    premium: { sets: [], values: [], growths: [], cagrs: [] },     // €100-249
    ultimate: { sets: [], values: [], growths: [], cagrs: [] }     // €250+
  };

  const licenseData = {
    licensed: { sets: [], values: [], growths: [], cagrs: [] },
    original: { sets: [], values: [], growths: [], cagrs: [] }
  };

  sets.forEach(set => {
    const baseTheme = getBaseTheme(set.theme);
    const deepData = deepAnalysis?.[set.setNumber] || {};
    const cagr = calculateCAGR(set.setNumber, priceHistory);

    // Initialize theme if not exists
    if (!themeData[baseTheme]) {
      themeData[baseTheme] = {
        sets: [],
        values: [],
        growths: [],
        cagrs: [],
        totalValue: 0,
        totalPaid: 0
      };
    }

    // Add to theme data
    themeData[baseTheme].sets.push(set);
    themeData[baseTheme].values.push(set.value);
    themeData[baseTheme].totalValue += set.value;
    themeData[baseTheme].totalPaid += set.paid;
    if (typeof set.growth === 'number' && !isNaN(set.growth)) {
      themeData[baseTheme].growths.push(set.growth);
    }
    if (cagr !== null) {
      themeData[baseTheme].cagrs.push(cagr);
    }

    // Add to tier data
    let tier;
    if (set.retail < 30) tier = 'budget';
    else if (set.retail < 100) tier = 'mid';
    else if (set.retail < 250) tier = 'premium';
    else tier = 'ultimate';

    tierData[tier].sets.push(set);
    tierData[tier].values.push(set.value);
    if (typeof set.growth === 'number' && !isNaN(set.growth)) {
      tierData[tier].growths.push(set.growth);
    }
    if (cagr !== null) {
      tierData[tier].cagrs.push(cagr);
    }

    // Add to license data
    const isLicensed = set.theme?.toLowerCase().includes('licensed') ||
                       (deepData.license && deepData.license >= 6);
    if (isLicensed) {
      licenseData.licensed.sets.push(set);
      licenseData.licensed.values.push(set.value);
      if (typeof set.growth === 'number') licenseData.licensed.growths.push(set.growth);
      if (cagr !== null) licenseData.licensed.cagrs.push(cagr);
    } else {
      licenseData.original.sets.push(set);
      licenseData.original.values.push(set.value);
      if (typeof set.growth === 'number') licenseData.original.growths.push(set.growth);
      if (cagr !== null) licenseData.original.cagrs.push(cagr);
    }
  });

  // Calculate theme statistics
  const themeStats = Object.entries(themeData).map(([theme, data]) => {
    const growthStats = calculateStats(data.growths);
    const cagrStats = calculateStats(data.cagrs);
    const roi = data.totalPaid > 0 ? ((data.totalValue - data.totalPaid) / data.totalPaid) * 100 : 0;

    return {
      theme,
      setCount: data.sets.length,
      totalValue: parseFloat(data.totalValue.toFixed(2)),
      totalPaid: parseFloat(data.totalPaid.toFixed(2)),
      roi: parseFloat(roi.toFixed(2)),
      growth: {
        mean: growthStats.mean,
        median: growthStats.median,
        stdDev: growthStats.stdDev,
        min: growthStats.min,
        max: growthStats.max,
        sampleSize: growthStats.count
      },
      cagr: {
        mean: cagrStats.mean,
        median: cagrStats.median,
        stdDev: cagrStats.stdDev,
        sampleSize: cagrStats.count
      },
      volatility: growthStats.stdDev > 30 ? 'high' : growthStats.stdDev > 15 ? 'medium' : 'low',
      recommendation: getThemeRecommendation(growthStats, cagrStats, data.sets.length)
    };
  }).sort((a, b) => b.growth.median - a.growth.median);

  // Calculate tier statistics
  const tierStats = Object.entries(tierData).map(([tier, data]) => {
    const growthStats = calculateStats(data.growths);
    const cagrStats = calculateStats(data.cagrs);

    return {
      tier,
      priceRange: tier === 'budget' ? '< €30' :
                  tier === 'mid' ? '€30-99' :
                  tier === 'premium' ? '€100-249' : '€250+',
      setCount: data.sets.length,
      growth: {
        mean: growthStats.mean,
        median: growthStats.median,
        stdDev: growthStats.stdDev
      },
      cagr: {
        mean: cagrStats.mean,
        median: cagrStats.median
      }
    };
  });

  // Calculate license statistics
  const licenseStats = Object.entries(licenseData).map(([type, data]) => {
    const growthStats = calculateStats(data.growths);
    const cagrStats = calculateStats(data.cagrs);

    return {
      type,
      setCount: data.sets.length,
      growth: {
        mean: growthStats.mean,
        median: growthStats.median,
        stdDev: growthStats.stdDev
      },
      cagr: {
        mean: cagrStats.mean,
        median: cagrStats.median
      }
    };
  });

  // Print results
  console.log('THEME PERFORMANCE RANKINGS (by median growth):');
  console.log('-'.repeat(60));
  themeStats.forEach((t, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const sign = t.growth.median >= 0 ? '+' : '';
    console.log(`${medal} ${(i + 1).toString().padStart(2)}. ${t.theme.padEnd(22)} ${sign}${t.growth.median.toFixed(1)}% median | ${t.setCount} sets | ${t.volatility} volatility`);
  });
  console.log('');

  console.log('PRICE TIER PERFORMANCE:');
  console.log('-'.repeat(60));
  tierStats.forEach(t => {
    const sign = t.growth.median >= 0 ? '+' : '';
    console.log(`  ${t.tier.padEnd(10)} (${t.priceRange.padEnd(10)}): ${sign}${t.growth.median.toFixed(1)}% median | ${t.setCount} sets`);
  });
  console.log('');

  console.log('LICENSED vs ORIGINAL:');
  console.log('-'.repeat(60));
  licenseStats.forEach(l => {
    const sign = l.growth.median >= 0 ? '+' : '';
    console.log(`  ${l.type.padEnd(10)}: ${sign}${l.growth.median.toFixed(1)}% median | ${l.setCount} sets`);
  });
  console.log('');

  // Portfolio allocation recommendation
  console.log('PORTFOLIO ALLOCATION RECOMMENDATIONS:');
  console.log('-'.repeat(60));
  const topThemes = themeStats.filter(t => t.setCount >= 2 && t.growth.median > 0).slice(0, 5);
  topThemes.forEach(t => {
    console.log(`  ✅ ${t.theme}: ${t.recommendation}`);
  });
  const bottomThemes = themeStats.filter(t => t.growth.median < -10);
  bottomThemes.forEach(t => {
    console.log(`  ⚠️ ${t.theme}: Consider reducing exposure (${t.growth.median.toFixed(1)}% median growth)`);
  });
  console.log('');

  // Save results
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalSets: sets.length,
      totalThemes: themeStats.length
    },
    themePerformance: themeStats,
    tierPerformance: tierStats,
    licensePerformance: licenseStats,
    insights: {
      topPerformingTheme: themeStats[0]?.theme,
      worstPerformingTheme: themeStats[themeStats.length - 1]?.theme,
      bestPriceTier: tierStats.sort((a, b) => b.growth.median - a.growth.median)[0]?.tier,
      licensedVsOriginal: licenseStats[0].growth.median > licenseStats[1].growth.median ? 'Licensed outperforms' : 'Original outperforms'
    },
    recommendations: {
      increase: topThemes.map(t => t.theme),
      decrease: bottomThemes.map(t => t.theme),
      optimalAllocation: generateOptimalAllocation(themeStats)
    }
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${OUTPUT_FILE}`);

  // Save to public folder
  const publicOutput = path.join(PUBLIC_DATA_DIR, 'theme-performance.json');
  fs.writeFileSync(publicOutput, JSON.stringify(output, null, 2));
  console.log(`Dashboard data saved to: ${publicOutput}`);

  return output;
}

/**
 * Generate theme recommendation
 */
function getThemeRecommendation(growthStats, cagrStats, setCount) {
  if (setCount < 2) return 'Insufficient data for recommendation';

  const medianGrowth = growthStats.median;
  const volatility = growthStats.stdDev;

  if (medianGrowth > 20 && volatility < 30) {
    return 'Strong performer - increase allocation';
  } else if (medianGrowth > 10) {
    return 'Good performer - maintain allocation';
  } else if (medianGrowth > 0) {
    return 'Stable - selective buying opportunities';
  } else if (medianGrowth > -10) {
    return 'Underperforming - hold existing, avoid new purchases';
  } else {
    return 'Poor performer - consider reducing exposure';
  }
}

/**
 * Generate optimal portfolio allocation based on performance
 */
function generateOptimalAllocation(themeStats) {
  const allocation = {};
  const performingThemes = themeStats.filter(t => t.setCount >= 2);

  // Calculate weights based on risk-adjusted returns
  let totalWeight = 0;
  performingThemes.forEach(t => {
    // Higher growth = more weight, but penalize high volatility
    const riskAdjusted = t.growth.median / (1 + t.growth.stdDev / 100);
    const weight = Math.max(0, riskAdjusted + 20); // Shift to positive
    allocation[t.theme] = weight;
    totalWeight += weight;
  });

  // Normalize to percentages
  Object.keys(allocation).forEach(theme => {
    allocation[theme] = parseFloat(((allocation[theme] / totalWeight) * 100).toFixed(1));
  });

  return allocation;
}

// Run analysis
analyzeThemePerformance();
