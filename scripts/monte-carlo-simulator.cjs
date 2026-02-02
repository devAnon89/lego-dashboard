#!/usr/bin/env node
/**
 * Monte Carlo Portfolio Simulator for LEGO Portfolio
 * Generates confidence intervals for portfolio value projections.
 *
 * Usage:
 *   node scripts/monte-carlo-simulator.cjs
 *   node scripts/monte-carlo-simulator.cjs --simulations 10000
 */

const fs = require('fs');
const path = require('path');

// Data paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const AI_PREDICTIONS_FILE = path.join(DATA_DIR, 'ai-predictions-cache.json');
const PRICE_HISTORY_FILE = path.join(DATA_DIR, 'price-history.json');
const THEME_PERFORMANCE_FILE = path.join(DATA_DIR, 'theme-performance.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'monte-carlo-results.json');

// Simulation parameters
const DEFAULT_SIMULATIONS = 5000;
const YEARS_TO_PROJECT = [1, 3, 5, 10];

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
 * Generate random number from normal distribution (Box-Muller transform)
 */
function randomNormal(mean = 0, stdDev = 1) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * stdDev + mean;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Extract base theme from full theme string
 */
function getBaseTheme(theme) {
  if (!theme) return 'Unknown';
  return theme.split('/')[0].trim();
}

/**
 * Calculate historical volatility from price history
 */
function calculateVolatility(setId, priceHistory) {
  const setHistory = priceHistory?.sets?.[setId];
  if (!setHistory?.priceHistory || setHistory.priceHistory.length < 3) {
    return 0.25; // Default 25% volatility
  }

  const prices = setHistory.priceHistory
    .map(p => p.valueNew || p.valueUsed)
    .filter(p => p > 0);

  if (prices.length < 3) return 0.25;

  // Calculate returns
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }

  // Calculate standard deviation of returns
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Annualize (assuming monthly data points)
  return Math.min(1.0, stdDev * Math.sqrt(12)); // Cap at 100%
}

/**
 * Get expected annual growth for a set
 */
function getExpectedGrowth(set, aiPredictions, themePerformance) {
  const aiPred = aiPredictions?.predictions?.[set.setNumber];
  const baseTheme = getBaseTheme(set.theme);
  const themePerfData = themePerformance?.themePerformance?.find(t => t.theme === baseTheme);

  // Priority: AI predictions > Theme average > Default
  if (aiPred?.prediction?.growth1yr) {
    return aiPred.prediction.growth1yr / 100; // Convert to decimal
  } else if (themePerfData?.growth?.median) {
    return themePerfData.growth.median / 100;
  } else {
    return 0.05; // Default 5% annual growth
  }
}

/**
 * Run Monte Carlo simulation for a single set
 */
function simulateSet(set, years, expectedGrowth, volatility, simulations) {
  const results = [];
  const currentValue = set.value;

  for (let i = 0; i < simulations; i++) {
    let value = currentValue;

    // Simulate year by year with random walk
    for (let y = 0; y < years; y++) {
      // Random annual return based on expected growth and volatility
      const annualReturn = randomNormal(expectedGrowth, volatility);
      value = value * (1 + annualReturn);

      // Floor at 10% of current value (sets don't go to zero)
      value = Math.max(value, currentValue * 0.1);
    }

    results.push(value);
  }

  return results;
}

/**
 * Run portfolio-wide Monte Carlo simulation
 */
function runSimulation(numSimulations = DEFAULT_SIMULATIONS) {
  console.log('='.repeat(60));
  console.log('MONTE CARLO PORTFOLIO SIMULATOR');
  console.log('='.repeat(60));
  console.log(`Running ${numSimulations.toLocaleString()} simulations...`);
  console.log('');

  // Load data
  const portfolio = loadJSON(PORTFOLIO_FILE);
  const aiPredictions = loadJSON(AI_PREDICTIONS_FILE);
  const priceHistory = loadJSON(PRICE_HISTORY_FILE);
  const themePerformance = loadJSON(THEME_PERFORMANCE_FILE);

  if (!portfolio) {
    console.error('Could not load portfolio data');
    process.exit(1);
  }

  const sets = portfolio.sets || [];
  const currentPortfolioValue = sets.reduce((sum, s) => sum + s.value, 0);

  console.log(`Current portfolio value: €${currentPortfolioValue.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`);
  console.log(`Sets in portfolio: ${sets.length}`);
  console.log('');

  // Calculate expected growth and volatility for each set
  const setParams = sets.map(set => {
    const expectedGrowth = getExpectedGrowth(set, aiPredictions, themePerformance);
    const volatility = calculateVolatility(set.setNumber, priceHistory);

    return {
      setNumber: set.setNumber,
      name: set.name,
      currentValue: set.value,
      expectedGrowth,
      volatility
    };
  });

  // Run simulations for each time horizon
  const results = {};

  YEARS_TO_PROJECT.forEach(years => {
    console.log(`Simulating ${years}-year projections...`);

    // Run portfolio simulation
    const portfolioResults = [];

    for (let sim = 0; sim < numSimulations; sim++) {
      let portfolioValue = 0;

      setParams.forEach(params => {
        // Single simulation for this set
        let value = params.currentValue;

        for (let y = 0; y < years; y++) {
          const annualReturn = randomNormal(params.expectedGrowth, params.volatility);
          value = value * (1 + annualReturn);
          value = Math.max(value, params.currentValue * 0.1);
        }

        portfolioValue += value;
      });

      portfolioResults.push(portfolioValue);
    }

    // Calculate statistics
    const sorted = [...portfolioResults].sort((a, b) => a - b);
    const mean = portfolioResults.reduce((a, b) => a + b, 0) / portfolioResults.length;

    results[`${years}yr`] = {
      years,
      simulations: numSimulations,
      currentValue: currentPortfolioValue,
      projections: {
        mean: parseFloat(mean.toFixed(2)),
        median: parseFloat(percentile(sorted, 50).toFixed(2)),
        p5: parseFloat(percentile(sorted, 5).toFixed(2)),    // 5th percentile (bear case)
        p10: parseFloat(percentile(sorted, 10).toFixed(2)),
        p25: parseFloat(percentile(sorted, 25).toFixed(2)),
        p75: parseFloat(percentile(sorted, 75).toFixed(2)),
        p90: parseFloat(percentile(sorted, 90).toFixed(2)),
        p95: parseFloat(percentile(sorted, 95).toFixed(2)),  // 95th percentile (bull case)
        min: parseFloat(sorted[0].toFixed(2)),
        max: parseFloat(sorted[sorted.length - 1].toFixed(2))
      },
      growth: {
        mean: parseFloat(((mean / currentPortfolioValue - 1) * 100).toFixed(2)),
        median: parseFloat(((percentile(sorted, 50) / currentPortfolioValue - 1) * 100).toFixed(2)),
        bearCase: parseFloat(((percentile(sorted, 10) / currentPortfolioValue - 1) * 100).toFixed(2)),
        bullCase: parseFloat(((percentile(sorted, 90) / currentPortfolioValue - 1) * 100).toFixed(2))
      },
      confidenceIntervals: {
        '80%': {
          low: parseFloat(percentile(sorted, 10).toFixed(2)),
          high: parseFloat(percentile(sorted, 90).toFixed(2))
        },
        '90%': {
          low: parseFloat(percentile(sorted, 5).toFixed(2)),
          high: parseFloat(percentile(sorted, 95).toFixed(2))
        },
        '95%': {
          low: parseFloat(percentile(sorted, 2.5).toFixed(2)),
          high: parseFloat(percentile(sorted, 97.5).toFixed(2))
        }
      }
    };
  });

  // Print results
  console.log('');
  console.log('='.repeat(60));
  console.log('SIMULATION RESULTS');
  console.log('='.repeat(60));

  YEARS_TO_PROJECT.forEach(years => {
    const r = results[`${years}yr`];
    console.log('');
    console.log(`📊 ${years}-YEAR PROJECTION:`);
    console.log('-'.repeat(40));
    console.log(`  Expected (median): €${r.projections.median.toLocaleString('de-DE')} (${r.growth.median >= 0 ? '+' : ''}${r.growth.median}%)`);
    console.log(`  Bear case (10th):  €${r.projections.p10.toLocaleString('de-DE')} (${r.growth.bearCase >= 0 ? '+' : ''}${r.growth.bearCase}%)`);
    console.log(`  Bull case (90th):  €${r.projections.p90.toLocaleString('de-DE')} (${r.growth.bullCase >= 0 ? '+' : ''}${r.growth.bullCase}%)`);
    console.log('');
    console.log(`  80% Confidence: €${r.confidenceIntervals['80%'].low.toLocaleString('de-DE')} - €${r.confidenceIntervals['80%'].high.toLocaleString('de-DE')}`);
    console.log(`  90% Confidence: €${r.confidenceIntervals['90%'].low.toLocaleString('de-DE')} - €${r.confidenceIntervals['90%'].high.toLocaleString('de-DE')}`);
  });

  // Risk metrics
  console.log('');
  console.log('='.repeat(60));
  console.log('RISK METRICS');
  console.log('='.repeat(60));

  const r5yr = results['5yr'];
  const probabilityOfLoss = (r5yr.projections.p5 < currentPortfolioValue ? 5 : 0) +
                           (r5yr.projections.p10 < currentPortfolioValue ? 5 : 0) +
                           (r5yr.projections.p25 < currentPortfolioValue ? 15 : 0);

  console.log(`  5-year probability of loss: ~${probabilityOfLoss}%`);
  console.log(`  Worst case (5th percentile, 5yr): €${r5yr.projections.p5.toLocaleString('de-DE')}`);
  console.log(`  Best case (95th percentile, 5yr): €${r5yr.projections.p95.toLocaleString('de-DE')}`);

  // Per-set risk analysis
  console.log('');
  console.log('HIGH VOLATILITY SETS (>40% annual volatility):');
  const highVolSets = setParams.filter(s => s.volatility > 0.4).sort((a, b) => b.volatility - a.volatility);
  if (highVolSets.length > 0) {
    highVolSets.slice(0, 5).forEach(s => {
      console.log(`  ${s.setNumber}: ${(s.volatility * 100).toFixed(0)}% volatility - ${s.name.substring(0, 30)}`);
    });
  } else {
    console.log('  None (portfolio volatility is well-managed)');
  }

  // Save results
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      simulations: numSimulations,
      currentPortfolioValue,
      setCount: sets.length
    },
    projections: results,
    riskMetrics: {
      probabilityOfLoss5yr: probabilityOfLoss,
      highVolatilitySets: highVolSets.map(s => ({
        setNumber: s.setNumber,
        name: s.name,
        volatility: parseFloat((s.volatility * 100).toFixed(1))
      }))
    },
    setParameters: setParams.map(s => ({
      setNumber: s.setNumber,
      name: s.name,
      currentValue: s.currentValue,
      expectedAnnualGrowth: parseFloat((s.expectedGrowth * 100).toFixed(2)),
      annualVolatility: parseFloat((s.volatility * 100).toFixed(1))
    }))
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log('');
  console.log(`Results saved to: ${OUTPUT_FILE}`);

  // Save to public folder
  const publicOutput = path.join(PUBLIC_DATA_DIR, 'monte-carlo-results.json');
  fs.writeFileSync(publicOutput, JSON.stringify(output, null, 2));
  console.log(`Dashboard data saved to: ${publicOutput}`);

  return output;
}

// Parse command line args
const args = process.argv.slice(2);
let simulations = DEFAULT_SIMULATIONS;
const simIdx = args.indexOf('--simulations');
if (simIdx !== -1 && args[simIdx + 1]) {
  simulations = parseInt(args[simIdx + 1], 10);
}

// Run simulation
runSimulation(simulations);
