#!/usr/bin/env node
/**
 * Undervalue Detector for LEGO Portfolio
 * Compares sets against similar peers to identify undervalued buying opportunities.
 *
 * Usage:
 *   node scripts/undervalue-detector.cjs
 *   node scripts/undervalue-detector.cjs --threshold 0.8
 */

const fs = require('fs');
const path = require('path');

// Data paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const DEEP_ANALYSIS_FILE = path.join(DATA_DIR, 'deep-analysis.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'undervalue-analysis.json');

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
 * e.g., "Technic / Licensed" -> "Technic"
 */
function getBaseTheme(theme) {
  if (!theme) return 'Unknown';
  return theme.split('/')[0].trim();
}

/**
 * Get price tier for a set
 */
function getPriceTier(retail) {
  if (retail < 30) return 'budget';      // < €30
  if (retail < 100) return 'mid';        // €30-99
  if (retail < 250) return 'premium';    // €100-249
  return 'ultimate';                      // €250+
}

/**
 * Calculate expected growth based on set characteristics
 */
function calculateExpectedGrowth(set, themeAvg, tierAvg, licenseScore) {
  // Weighted average of different factors
  const themeWeight = 0.35;
  const tierWeight = 0.25;
  const licenseWeight = 0.25;
  const baseWeight = 0.15;

  const baseGrowth = 5; // 5% baseline for LEGO
  const licenseGrowth = (licenseScore || 5) * 2; // 0-20% based on license

  return (
    (themeAvg || baseGrowth) * themeWeight +
    (tierAvg || baseGrowth) * tierWeight +
    licenseGrowth * licenseWeight +
    baseGrowth * baseWeight
  );
}

/**
 * Main analysis function
 */
function analyzeUndervalued(threshold = 0.8) {
  console.log('='.repeat(60));
  console.log('UNDERVALUE DETECTOR');
  console.log('='.repeat(60));
  console.log(`Threshold: ${(threshold * 100).toFixed(0)}% of expected value\n`);

  // Load data
  const portfolio = loadJSON(PORTFOLIO_FILE);
  const deepAnalysis = loadJSON(DEEP_ANALYSIS_FILE);
  const priceHistory = loadJSON(PRICE_HISTORY_FILE);

  if (!portfolio) {
    console.error('Could not load portfolio data');
    process.exit(1);
  }

  const sets = portfolio.sets || [];

  // Step 1: Group sets by theme and calculate theme averages
  const themeGroups = {};
  const tierGroups = {};

  sets.forEach(set => {
    const baseTheme = getBaseTheme(set.theme);
    const tier = getPriceTier(set.retail);

    if (!themeGroups[baseTheme]) themeGroups[baseTheme] = [];
    if (!tierGroups[tier]) tierGroups[tier] = [];

    themeGroups[baseTheme].push(set);
    tierGroups[tier].push(set);
  });

  // Calculate theme average growth
  const themeAvgGrowth = {};
  Object.entries(themeGroups).forEach(([theme, themeSets]) => {
    const validGrowth = themeSets.filter(s => typeof s.growth === 'number' && !isNaN(s.growth));
    if (validGrowth.length > 0) {
      themeAvgGrowth[theme] = validGrowth.reduce((sum, s) => sum + s.growth, 0) / validGrowth.length;
    } else {
      themeAvgGrowth[theme] = 5; // default
    }
  });

  // Calculate tier average growth
  const tierAvgGrowth = {};
  Object.entries(tierGroups).forEach(([tier, tierSets]) => {
    const validGrowth = tierSets.filter(s => typeof s.growth === 'number' && !isNaN(s.growth));
    if (validGrowth.length > 0) {
      tierAvgGrowth[tier] = validGrowth.reduce((sum, s) => sum + s.growth, 0) / validGrowth.length;
    } else {
      tierAvgGrowth[tier] = 5; // default
    }
  });

  console.log('Theme Average Growth:');
  Object.entries(themeAvgGrowth).sort((a, b) => b[1] - a[1]).forEach(([theme, avg]) => {
    console.log(`  ${theme.padEnd(25)} ${avg >= 0 ? '+' : ''}${avg.toFixed(1)}%`);
  });
  console.log('');

  console.log('Price Tier Average Growth:');
  Object.entries(tierAvgGrowth).forEach(([tier, avg]) => {
    console.log(`  ${tier.padEnd(15)} ${avg >= 0 ? '+' : ''}${avg.toFixed(1)}%`);
  });
  console.log('');

  // Step 2: Analyze each set for undervaluation
  const analysis = sets.map(set => {
    const baseTheme = getBaseTheme(set.theme);
    const tier = getPriceTier(set.retail);
    const deepData = deepAnalysis?.[set.setNumber] || {};

    // Get expected growth based on peers
    const expectedGrowth = calculateExpectedGrowth(
      set,
      themeAvgGrowth[baseTheme],
      tierAvgGrowth[tier],
      deepData.license
    );

    // Current growth vs expected
    const actualGrowth = set.growth || 0;
    const growthRatio = actualGrowth / expectedGrowth;

    // Calculate expected value based on paid price and expected growth
    const expectedValue = set.paid * (1 + expectedGrowth / 100);
    const valueRatio = set.value / expectedValue;

    // Peer comparison within same theme
    const themePeers = themeGroups[baseTheme] || [];
    const peerAvgValue = themePeers.reduce((sum, p) => sum + (p.value / p.retail), 0) / themePeers.length;
    const setValueRatio = set.value / set.retail;
    const peerRatio = setValueRatio / peerAvgValue;

    // Combined undervalue score (lower = more undervalued)
    const undervalueScore = (growthRatio * 0.4 + valueRatio * 0.3 + peerRatio * 0.3);

    // Opportunity score (inverse - higher = better opportunity)
    const opportunityScore = Math.max(0, Math.min(100, (1 - undervalueScore) * 50 + 50));

    return {
      setNumber: set.setNumber,
      name: set.name,
      theme: set.theme,
      baseTheme,
      tier,
      retail: set.retail,
      paid: set.paid,
      currentValue: set.value,
      actualGrowth,
      expectedGrowth: parseFloat(expectedGrowth.toFixed(2)),
      growthRatio: parseFloat(growthRatio.toFixed(3)),
      expectedValue: parseFloat(expectedValue.toFixed(2)),
      valueRatio: parseFloat(valueRatio.toFixed(3)),
      peerRatio: parseFloat(peerRatio.toFixed(3)),
      undervalueScore: parseFloat(undervalueScore.toFixed(3)),
      opportunityScore: parseFloat(opportunityScore.toFixed(1)),
      isUndervalued: undervalueScore < threshold,
      recommendation: undervalueScore < 0.7 ? 'STRONG BUY' :
                     undervalueScore < 0.85 ? 'BUY' :
                     undervalueScore < 1.0 ? 'HOLD' :
                     undervalueScore < 1.15 ? 'WATCH' : 'OVERVALUED',
      reasoning: generateReasoning(set, undervalueScore, growthRatio, peerRatio, expectedGrowth)
    };
  });

  // Sort by opportunity score (best opportunities first)
  analysis.sort((a, b) => b.opportunityScore - a.opportunityScore);

  // Step 3: Identify buy opportunities
  const undervaluedSets = analysis.filter(a => a.isUndervalued);
  const strongBuys = analysis.filter(a => a.recommendation === 'STRONG BUY');
  const buys = analysis.filter(a => a.recommendation === 'BUY');
  const overvalued = analysis.filter(a => a.recommendation === 'OVERVALUED');

  console.log('='.repeat(60));
  console.log('ANALYSIS RESULTS');
  console.log('='.repeat(60));
  console.log(`Total sets analyzed: ${sets.length}`);
  console.log(`Undervalued sets: ${undervaluedSets.length}`);
  console.log(`Strong buy signals: ${strongBuys.length}`);
  console.log(`Buy signals: ${buys.length}`);
  console.log(`Overvalued sets: ${overvalued.length}`);
  console.log('');

  if (strongBuys.length > 0) {
    console.log('🔥 STRONG BUY OPPORTUNITIES:');
    strongBuys.slice(0, 10).forEach(s => {
      console.log(`  ${s.setNumber} - ${s.name.substring(0, 35)}`);
      console.log(`    Current: €${s.currentValue.toFixed(0)} | Expected: €${s.expectedValue.toFixed(0)} | Score: ${s.opportunityScore}`);
      console.log(`    ${s.reasoning}`);
      console.log('');
    });
  }

  if (buys.length > 0) {
    console.log('✅ BUY OPPORTUNITIES:');
    buys.slice(0, 10).forEach(s => {
      console.log(`  ${s.setNumber} - ${s.name.substring(0, 35)}`);
      console.log(`    Current: €${s.currentValue.toFixed(0)} | Expected: €${s.expectedValue.toFixed(0)} | Score: ${s.opportunityScore}`);
      console.log('');
    });
  }

  if (overvalued.length > 0) {
    console.log('⚠️ OVERVALUED (Consider Selling):');
    overvalued.slice(0, 5).forEach(s => {
      console.log(`  ${s.setNumber} - ${s.name.substring(0, 35)}`);
      console.log(`    Current: €${s.currentValue.toFixed(0)} | Expected: €${s.expectedValue.toFixed(0)}`);
      console.log('');
    });
  }

  // Step 4: Save results
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      threshold,
      totalSets: sets.length,
      undervaluedCount: undervaluedSets.length,
      strongBuyCount: strongBuys.length,
      buyCount: buys.length,
      overvaluedCount: overvalued.length
    },
    themePerformance: themeAvgGrowth,
    tierPerformance: tierAvgGrowth,
    opportunities: {
      strongBuy: strongBuys.map(s => ({
        setNumber: s.setNumber,
        name: s.name,
        theme: s.theme,
        currentValue: s.currentValue,
        expectedValue: s.expectedValue,
        opportunityScore: s.opportunityScore,
        reasoning: s.reasoning
      })),
      buy: buys.map(s => ({
        setNumber: s.setNumber,
        name: s.name,
        theme: s.theme,
        currentValue: s.currentValue,
        expectedValue: s.expectedValue,
        opportunityScore: s.opportunityScore
      })),
      overvalued: overvalued.map(s => ({
        setNumber: s.setNumber,
        name: s.name,
        theme: s.theme,
        currentValue: s.currentValue,
        expectedValue: s.expectedValue
      }))
    },
    allSets: analysis
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${OUTPUT_FILE}`);

  // Also save to public folder for dashboard
  const publicOutput = path.join(PUBLIC_DATA_DIR, 'undervalue-analysis.json');
  fs.writeFileSync(publicOutput, JSON.stringify(output, null, 2));
  console.log(`Dashboard data saved to: ${publicOutput}`);

  return output;
}

/**
 * Generate human-readable reasoning
 */
function generateReasoning(set, undervalueScore, growthRatio, peerRatio, expectedGrowth) {
  const reasons = [];

  if (growthRatio < 0.7) {
    reasons.push(`growing ${((1 - growthRatio) * 100).toFixed(0)}% slower than expected`);
  } else if (growthRatio > 1.3) {
    reasons.push(`outperforming expectations by ${((growthRatio - 1) * 100).toFixed(0)}%`);
  }

  if (peerRatio < 0.8) {
    reasons.push(`trading ${((1 - peerRatio) * 100).toFixed(0)}% below theme peers`);
  } else if (peerRatio > 1.2) {
    reasons.push(`trading ${((peerRatio - 1) * 100).toFixed(0)}% above theme peers`);
  }

  if (set.growth < 0 && expectedGrowth > 0) {
    reasons.push('negative growth despite positive category trend');
  }

  if (reasons.length === 0) {
    if (undervalueScore < 0.85) {
      reasons.push('performing below potential based on fundamentals');
    } else if (undervalueScore > 1.1) {
      reasons.push('performing above typical category expectations');
    } else {
      reasons.push('trading near fair value');
    }
  }

  return reasons.join('; ');
}

// Parse command line args
const args = process.argv.slice(2);
let threshold = 0.85;
const thresholdIdx = args.indexOf('--threshold');
if (thresholdIdx !== -1 && args[thresholdIdx + 1]) {
  threshold = parseFloat(args[thresholdIdx + 1]);
}

// Run analysis
analyzeUndervalued(threshold);
