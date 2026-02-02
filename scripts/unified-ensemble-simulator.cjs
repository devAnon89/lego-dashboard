/**
 * Unified Ensemble Simulator
 * Combines multiple simulation methodologies into one comprehensive prediction engine:
 * 1. Monte Carlo (Student-t with jump diffusion)
 * 2. Scenario Analysis (Bull/Bear/Base)
 * 3. Stress Testing (Crash scenarios)
 * 4. Bootstrap Simulation (Historical resampling)
 * 5. GARCH Volatility (Clustered volatility)
 * 6. Bayesian Updating (Prior + Evidence)
 * 7. Mean Reversion Model
 *
 * Final output: Weighted ensemble combining all models
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  simulations: 10000,
  years: 5,
  stepsPerYear: 52, // Weekly

  // Model weights for ensemble (must sum to 1.0)
  // Weighted towards more stable models
  modelWeights: {
    monteCarlo: 0.35,      // Core simulation - primary model
    scenario: 0.15,        // Scenario analysis
    stress: 0.10,          // Stress testing (conservative)
    bootstrap: 0.15,       // Historical resampling
    garch: 0.15,           // Volatility clustering
    bayesian: 0.10         // Bayesian updating
  },

  // Monte Carlo params
  monteCarlo: {
    baseDrift: 0.05,
    baseVolatility: 0.20,
    jumpIntensity: 0.15,
    jumpMeanSize: 0.30,
    meanReversionSpeed: 0.20,
    degreesOfFreedom: 5
  },

  // Scenario params
  scenarios: {
    bull: { probability: 0.25, drift: 0.12, volatility: 0.15 },
    base: { probability: 0.50, drift: 0.05, volatility: 0.20 },
    bear: { probability: 0.25, drift: -0.02, volatility: 0.30 }
  },

  // Stress test params
  stressTests: {
    marketCrash: { probability: 0.05, impact: -0.40, recovery: 2 },
    themeCollapse: { probability: 0.03, impact: -0.60, recovery: 5 },
    liquidityCrisis: { probability: 0.02, impact: -0.25, recovery: 1 },
    legoIPOBoom: { probability: 0.05, impact: 0.50, recovery: 3 }
  },

  // GARCH params
  garch: {
    omega: 0.0001,    // Long-run variance constant
    alpha: 0.10,      // ARCH coefficient (recent shock impact)
    beta: 0.85,       // GARCH coefficient (persistence)
    initialVol: 0.20
  },

  // Bayesian params
  bayesian: {
    priorMean: 0.05,
    priorVariance: 0.01,
    likelihoodWeight: 0.7  // How much to weight observed data vs prior
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function randomNormal() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function randomStudentT(df) {
  const normal = randomNormal();
  let chi2 = 0;
  for (let i = 0; i < df; i++) {
    const n = randomNormal();
    chi2 += n * n;
  }
  const result = normal / Math.sqrt(chi2 / df);
  return Math.max(-10, Math.min(10, result));
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr) {
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function selectScenario() {
  const r = Math.random();
  let cumulative = 0;
  for (const [name, params] of Object.entries(CONFIG.scenarios)) {
    cumulative += params.probability;
    if (r < cumulative) return { name, ...params };
  }
  return { name: 'base', ...CONFIG.scenarios.base };
}

function checkStressEvent() {
  for (const [name, params] of Object.entries(CONFIG.stressTests)) {
    if (Math.random() < params.probability / CONFIG.stepsPerYear) {
      return { name, ...params };
    }
  }
  return null;
}

// ============================================================================
// SIMULATION MODELS
// ============================================================================

/**
 * Model 1: Enhanced Monte Carlo (from our previous implementation)
 * With proper bounds to prevent unrealistic outcomes
 */
function simulateMonteCarlo(currentValue, years, setData) {
  const results = [];
  const dt = 1 / CONFIG.stepsPerYear;
  const steps = years * CONFIG.stepsPerYear;

  const isRetiring = setData.yearsOld >= 1.5;
  const isRetired = setData.yearsOld >= 2.5;

  let drift = CONFIG.monteCarlo.baseDrift;
  let vol = CONFIG.monteCarlo.baseVolatility;

  if (isRetired) {
    drift *= 1.3;  // Retired sets appreciate slightly faster
    vol *= 0.8;   // But more predictably
  } else if (isRetiring) {
    drift *= 1.1;
    vol *= 1.2;   // Moderate uncertainty during retirement
  }

  // Fair value for mean reversion - clamp growth to reasonable range
  const clampedGrowth = Math.max(0, Math.min(0.30, setData.historicalGrowth || 0.05));
  const fairValue = currentValue * (1 + clampedGrowth);

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;

    for (let t = 0; t < steps; t++) {
      // Student-t shock (clamped)
      const shock = Math.max(-4, Math.min(4, randomStudentT(CONFIG.monteCarlo.degreesOfFreedom)));

      // Jump diffusion for retiring sets (reduced intensity)
      let jump = 0;
      if (isRetiring && Math.random() < CONFIG.monteCarlo.jumpIntensity * dt * 0.5) {
        jump = CONFIG.monteCarlo.jumpMeanSize * (0.3 + Math.random() * 0.4);
      }

      // Mean reversion
      const reversion = CONFIG.monteCarlo.meanReversionSpeed * (Math.log(fairValue) - Math.log(price)) * dt;

      // Seasonality (reduced impact)
      const month = Math.floor((t / CONFIG.stepsPerYear) * 12) % 12;
      const seasonal = [0.01, 0.015, 0.005, 0, -0.005, -0.01, -0.005, 0, 0.005, 0.01, 0.015, -0.01][month] || 0;

      // Price update
      const dLogPrice = (drift + seasonal) * dt + reversion + vol * Math.sqrt(dt) * shock + jump;
      price = price * Math.exp(dLogPrice);

      // Bounds check - prevent runaway values
      if (!isFinite(price) || price <= 0) price = currentValue;
      if (price > currentValue * 4) price = currentValue * 4;  // Max 4x over simulation
      if (price < currentValue * 0.4) price = currentValue * 0.4;  // Min 40%
    }

    results.push(price);
  }

  return results;
}

/**
 * Model 2: Scenario Analysis
 */
function simulateScenario(currentValue, years, setData) {
  const results = [];
  const dt = 1 / CONFIG.stepsPerYear;
  const steps = years * CONFIG.stepsPerYear;

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    const scenario = selectScenario();
    let price = currentValue;

    // Adjust for set characteristics
    let drift = scenario.drift;
    let vol = scenario.volatility;

    if (setData.yearsOld >= 2) {
      drift += 0.03;  // Retired bonus
      vol *= 0.8;
    }

    for (let t = 0; t < steps; t++) {
      const shock = randomNormal();
      const dLogPrice = drift * dt + vol * Math.sqrt(dt) * shock;
      price = price * Math.exp(dLogPrice);
    }

    results.push(price);
  }

  return results;
}

/**
 * Model 3: Stress Testing
 */
function simulateStress(currentValue, years, setData) {
  const results = [];
  const dt = 1 / CONFIG.stepsPerYear;
  const steps = years * CONFIG.stepsPerYear;

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;
    let inRecovery = false;
    let recoveryStepsLeft = 0;
    let recoveryTarget = 0;

    for (let t = 0; t < steps; t++) {
      // Check for stress event
      if (!inRecovery) {
        const stress = checkStressEvent();
        if (stress) {
          const impactMultiplier = setData.isLicensed ? 0.8 : 1.2; // Licensed more resilient
          price = price * (1 + stress.impact * impactMultiplier);
          inRecovery = true;
          recoveryStepsLeft = stress.recovery * CONFIG.stepsPerYear;
          recoveryTarget = currentValue * (1 + CONFIG.monteCarlo.baseDrift * (t / CONFIG.stepsPerYear));
        }
      }

      // Normal movement or recovery
      if (inRecovery && recoveryStepsLeft > 0) {
        // Gradual recovery
        const recoveryRate = (recoveryTarget - price) / recoveryStepsLeft;
        price += recoveryRate + randomNormal() * price * 0.02;
        recoveryStepsLeft--;
        if (recoveryStepsLeft === 0) inRecovery = false;
      } else {
        const shock = randomNormal();
        const dLogPrice = CONFIG.monteCarlo.baseDrift * dt + CONFIG.monteCarlo.baseVolatility * Math.sqrt(dt) * shock;
        price = price * Math.exp(dLogPrice);
      }
    }

    results.push(Math.max(price, currentValue * 0.1)); // Floor at 10% of current
  }

  return results;
}

/**
 * Model 4: Bootstrap Simulation (Historical Resampling)
 * More conservative - samples from realistic LEGO market returns
 */
function simulateBootstrap(currentValue, years, setData, historicalReturns) {
  const results = [];
  const steps = years * 12; // Monthly

  // Use provided historical returns or generate synthetic ones
  const returns = historicalReturns && historicalReturns.length > 0
    ? historicalReturns
    : generateSyntheticReturns(setData);

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;

    for (let t = 0; t < steps; t++) {
      // Randomly sample from historical returns with replacement
      const sampledReturn = returns[Math.floor(Math.random() * returns.length)];
      // Clamp extreme returns to prevent runaway values
      const clampedReturn = Math.max(-0.15, Math.min(0.15, sampledReturn));
      price = price * (1 + clampedReturn);
    }

    // Clamp final value to reasonable bounds (50% to 300% of original)
    results.push(Math.max(currentValue * 0.5, Math.min(currentValue * 3, price)));
  }

  return results;
}

function generateSyntheticReturns(setData) {
  // Generate realistic monthly returns based on LEGO market data
  // LEGO typically appreciates 3-8% annually with moderate volatility
  const returns = [];
  const annualGrowth = Math.min(0.10, Math.max(0.02, setData.historicalGrowth || 0.05));
  const monthlyDrift = annualGrowth / 12;
  const monthlyVol = 0.04; // More conservative volatility

  for (let i = 0; i < 60; i++) { // 5 years of monthly data
    // Mix of positive and negative months, slight upward bias
    const baseReturn = monthlyDrift + randomNormal() * monthlyVol;
    // Clamp individual returns
    returns.push(Math.max(-0.08, Math.min(0.08, baseReturn)));
  }

  return returns;
}

/**
 * Model 5: GARCH Volatility Model
 */
function simulateGARCH(currentValue, years, setData) {
  const results = [];
  const dt = 1 / CONFIG.stepsPerYear;
  const steps = years * CONFIG.stepsPerYear;

  const drift = CONFIG.monteCarlo.baseDrift + (setData.yearsOld >= 2 ? 0.03 : 0);

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;
    let variance = CONFIG.garch.initialVol ** 2;
    let lastReturn = 0;

    for (let t = 0; t < steps; t++) {
      // GARCH(1,1) variance update
      variance = CONFIG.garch.omega +
                 CONFIG.garch.alpha * lastReturn ** 2 +
                 CONFIG.garch.beta * variance;

      const vol = Math.sqrt(variance);
      const shock = randomNormal();

      const dLogPrice = drift * dt + vol * Math.sqrt(dt) * shock;
      lastReturn = dLogPrice;

      price = price * Math.exp(dLogPrice);
    }

    results.push(price);
  }

  return results;
}

/**
 * Model 6: Bayesian Prediction
 * Conservative implementation with bounded parameters
 */
function simulateBayesian(currentValue, years, setData) {
  const results = [];
  const dt = 1 / CONFIG.stepsPerYear;
  const steps = years * CONFIG.stepsPerYear;

  // Prior beliefs (conservative)
  let priorMean = CONFIG.bayesian.priorMean;  // 5% annual
  let priorVar = CONFIG.bayesian.priorVariance;

  // Update prior with "observed" data (set characteristics)
  // Clamp observed growth to reasonable range
  const observedGrowth = Math.max(-0.10, Math.min(0.15, setData.historicalGrowth || 0.05));
  const observedVar = 0.02;

  // Bayesian update: posterior = weighted average of prior and likelihood
  const w = CONFIG.bayesian.likelihoodWeight;
  const posteriorMean = (1 - w) * priorMean + w * observedGrowth;
  const posteriorVar = (1 - w) * priorVar + w * observedVar;

  // Adjust for set characteristics (small adjustments only)
  let adjustedMean = posteriorMean;
  if (setData.yearsOld >= 2) adjustedMean += 0.02;  // Retired bonus
  if (setData.isLicensed) adjustedMean += 0.01;

  // Clamp final drift to realistic bounds (0% to 12% annual)
  adjustedMean = Math.max(0, Math.min(0.12, adjustedMean));

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;

    // Sample drift from posterior distribution, clamped
    const sampledDrift = Math.max(-0.05, Math.min(0.15, adjustedMean + randomNormal() * Math.sqrt(posteriorVar)));
    const vol = CONFIG.monteCarlo.baseVolatility;

    for (let t = 0; t < steps; t++) {
      const shock = randomNormal();
      const dLogPrice = sampledDrift * dt + vol * Math.sqrt(dt) * shock;
      price = price * Math.exp(dLogPrice);

      // Clamp price to reasonable bounds
      if (price > currentValue * 5) price = currentValue * 5;
      if (price < currentValue * 0.3) price = currentValue * 0.3;
    }

    results.push(price);
  }

  return results;
}

// ============================================================================
// ENSEMBLE COMBINER
// ============================================================================

function combineEnsemble(modelResults, weights) {
  const combined = [];
  const numSims = modelResults.monteCarlo.length;

  for (let i = 0; i < numSims; i++) {
    let value = 0;
    for (const [model, results] of Object.entries(modelResults)) {
      if (weights[model] && results[i] !== undefined) {
        value += weights[model] * results[i];
      }
    }
    combined.push(value);
  }

  return combined;
}

function calculateStatistics(results, currentValue) {
  const sorted = [...results].sort((a, b) => a - b);
  const n = sorted.length;

  return {
    mean: mean(results),
    median: percentile(results, 0.5),
    stdDev: stdDev(results),
    min: sorted[0],
    max: sorted[n - 1],
    percentiles: {
      p5: percentile(results, 0.05),
      p10: percentile(results, 0.10),
      p25: percentile(results, 0.25),
      p50: percentile(results, 0.50),
      p75: percentile(results, 0.75),
      p90: percentile(results, 0.90),
      p95: percentile(results, 0.95)
    },
    growth: {
      meanPct: ((mean(results) / currentValue) - 1) * 100,
      medianPct: ((percentile(results, 0.5) / currentValue) - 1) * 100
    },
    risk: {
      VaR95: currentValue - percentile(results, 0.05),
      VaR99: currentValue - percentile(results, 0.01),
      CVaR95: currentValue - mean(sorted.slice(0, Math.floor(n * 0.05))),
      probLoss: sorted.filter(x => x < currentValue).length / n * 100,
      probGain50: sorted.filter(x => x > currentValue * 1.5).length / n * 100,
      probDouble: sorted.filter(x => x > currentValue * 2).length / n * 100
    }
  };
}

// ============================================================================
// MAIN SIMULATION
// ============================================================================

async function runUnifiedSimulation() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       UNIFIED ENSEMBLE SIMULATOR - LEGO PORTFOLIO');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load portfolio data
  const portfolioPath = path.join(__dirname, '..', 'data', 'portfolio.json');
  const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));

  console.log(`Loaded ${portfolio.sets.length} sets from portfolio\n`);
  console.log('Running 6 simulation models:');
  console.log('  1. Monte Carlo (Student-t + Jump Diffusion)');
  console.log('  2. Scenario Analysis (Bull/Bear/Base)');
  console.log('  3. Stress Testing (Crash scenarios)');
  console.log('  4. Bootstrap (Historical resampling)');
  console.log('  5. GARCH (Volatility clustering)');
  console.log('  6. Bayesian (Prior updating)\n');

  const results = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    portfolio: {
      totalSets: portfolio.sets.length,
      totalPieces: portfolio.sets.reduce((sum, s) => sum + (s.pieces || 0) * (s.qty || 1), 0)
    },
    sets: {},
    portfolioResults: null,
    modelComparison: {}
  };

  // Calculate total portfolio value
  // NOTE: In portfolio.json, 'value' already represents TOTAL value (not per-unit)
  // So we do NOT multiply by quantity
  let totalCurrentValue = 0;
  const setValues = [];

  for (const set of portfolio.sets) {
    // The 'value' field already includes quantity, it's the total line value
    const value = set.value || set.currentValue || set.retailPrice || set.retail || 100;
    const qty = (set.qtyNew || 0) + (set.qtyUsed || 0) || set.qty || 1;
    totalCurrentValue += value;

    const releaseDate = set.releaseDate ? new Date(set.releaseDate) : new Date(Date.now() - 365.25 * 24 * 60 * 60 * 1000); // Default 1 year old
    const yearsOld = (new Date() - releaseDate) / (365.25 * 24 * 60 * 60 * 1000);

    // Clamp growth to reasonable bounds (-50% to +100% annual)
    const rawGrowth = set.growth ? set.growth / 100 : 0.05;
    const clampedGrowth = Math.max(-0.5, Math.min(1.0, rawGrowth));

    setValues.push({
      id: set.setNumber || set.id,
      name: set.name,
      value: value,
      qty: qty,
      yearsOld: Math.max(0.5, yearsOld), // Minimum 6 months
      theme: set.theme,
      isLicensed: ['Star Wars', 'Harry Potter', 'Marvel', 'Disney', 'DC', 'Licensed'].some(t =>
        (set.theme || '').toLowerCase().includes(t.toLowerCase())
      ),
      historicalGrowth: clampedGrowth
    });
  }

  results.portfolio.totalCurrentValue = totalCurrentValue;

  console.log(`Total Portfolio Value: €${totalCurrentValue.toFixed(2)}\n`);
  console.log('Running simulations...\n');

  // Run all models for entire portfolio
  const portfolioModelResults = {
    monteCarlo: [],
    scenario: [],
    stress: [],
    bootstrap: [],
    garch: [],
    bayesian: []
  };

  // Aggregate portfolio characteristics
  const portfolioData = {
    yearsOld: mean(setValues.map(s => s.yearsOld)),
    isLicensed: setValues.filter(s => s.isLicensed).length > setValues.length / 2,
    historicalGrowth: mean(setValues.map(s => s.historicalGrowth))
  };

  // Run each model
  console.log('  [1/6] Monte Carlo...');
  portfolioModelResults.monteCarlo = simulateMonteCarlo(totalCurrentValue, CONFIG.years, portfolioData);

  console.log('  [2/6] Scenario Analysis...');
  portfolioModelResults.scenario = simulateScenario(totalCurrentValue, CONFIG.years, portfolioData);

  console.log('  [3/6] Stress Testing...');
  portfolioModelResults.stress = simulateStress(totalCurrentValue, CONFIG.years, portfolioData);

  console.log('  [4/6] Bootstrap...');
  portfolioModelResults.bootstrap = simulateBootstrap(totalCurrentValue, CONFIG.years, portfolioData, []);

  console.log('  [5/6] GARCH...');
  portfolioModelResults.garch = simulateGARCH(totalCurrentValue, CONFIG.years, portfolioData);

  console.log('  [6/6] Bayesian...');
  portfolioModelResults.bayesian = simulateBayesian(totalCurrentValue, CONFIG.years, portfolioData);

  // Calculate individual model statistics
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    INDIVIDUAL MODEL RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const [model, simResults] of Object.entries(portfolioModelResults)) {
    const stats = calculateStatistics(simResults, totalCurrentValue);
    results.modelComparison[model] = stats;

    console.log(`${model.toUpperCase()}:`);
    console.log(`  Median: €${stats.median.toFixed(0)} (${stats.growth.medianPct >= 0 ? '+' : ''}${stats.growth.medianPct.toFixed(1)}%)`);
    console.log(`  80% CI: €${stats.percentiles.p10.toFixed(0)} - €${stats.percentiles.p90.toFixed(0)}`);
    console.log(`  VaR 95%: €${stats.risk.VaR95.toFixed(0)} | Prob Loss: ${stats.risk.probLoss.toFixed(1)}%\n`);
  }

  // Combine into ensemble
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    ENSEMBLE COMBINATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Model Weights:');
  for (const [model, weight] of Object.entries(CONFIG.modelWeights)) {
    console.log(`  ${model}: ${(weight * 100).toFixed(0)}%`);
  }

  const ensembleResults = combineEnsemble(portfolioModelResults, CONFIG.modelWeights);
  const ensembleStats = calculateStatistics(ensembleResults, totalCurrentValue);

  results.portfolioResults = {
    currentValue: totalCurrentValue,
    projectedValue: ensembleStats,
    individualModels: results.modelComparison,
    ensembleWeights: CONFIG.modelWeights
  };

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                 ENSEMBLE PREDICTION (5 YEARS)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Current Portfolio Value: €${totalCurrentValue.toFixed(2)}\n`);

  console.log('PROJECTED VALUE:');
  console.log(`  Mean:     €${ensembleStats.mean.toFixed(0)} (${ensembleStats.growth.meanPct >= 0 ? '+' : ''}${ensembleStats.growth.meanPct.toFixed(1)}%)`);
  console.log(`  Median:   €${ensembleStats.median.toFixed(0)} (${ensembleStats.growth.medianPct >= 0 ? '+' : ''}${ensembleStats.growth.medianPct.toFixed(1)}%)`);

  console.log('\nCONFIDENCE INTERVALS:');
  console.log(`  50% CI: €${ensembleStats.percentiles.p25.toFixed(0)} - €${ensembleStats.percentiles.p75.toFixed(0)}`);
  console.log(`  80% CI: €${ensembleStats.percentiles.p10.toFixed(0)} - €${ensembleStats.percentiles.p90.toFixed(0)}`);
  console.log(`  90% CI: €${ensembleStats.percentiles.p5.toFixed(0)} - €${ensembleStats.percentiles.p95.toFixed(0)}`);

  console.log('\nRISK METRICS:');
  console.log(`  Value at Risk (95%):     €${ensembleStats.risk.VaR95.toFixed(0)}`);
  console.log(`  Value at Risk (99%):     €${ensembleStats.risk.VaR99.toFixed(0)}`);
  console.log(`  Expected Shortfall:      €${ensembleStats.risk.CVaR95.toFixed(0)}`);
  console.log(`  Probability of Loss:     ${ensembleStats.risk.probLoss.toFixed(2)}%`);
  console.log(`  Probability of +50%:     ${ensembleStats.risk.probGain50.toFixed(1)}%`);
  console.log(`  Probability of 2x:       ${ensembleStats.risk.probDouble.toFixed(1)}%`);

  // Model agreement analysis
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                     MODEL AGREEMENT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const medians = Object.entries(results.modelComparison).map(([model, stats]) => ({
    model,
    median: stats.median,
    growth: stats.growth.medianPct
  })).sort((a, b) => b.growth - a.growth);

  console.log('Ranked by Expected Growth:');
  medians.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.model.padEnd(12)} ${m.growth >= 0 ? '+' : ''}${m.growth.toFixed(1)}% → €${m.median.toFixed(0)}`);
  });

  const growths = medians.map(m => m.growth);
  const modelAgreement = 100 - (stdDev(growths) / mean(growths.map(Math.abs)) * 100);

  console.log(`\nModel Agreement Score: ${modelAgreement.toFixed(1)}%`);
  console.log(modelAgreement > 80 ? '  ✓ High confidence - models converge' :
              modelAgreement > 60 ? '  ⚠ Moderate confidence - some divergence' :
                                    '  ✗ Low confidence - significant model disagreement');

  // Generate yearly projections
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    YEARLY PROJECTIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const yearlyProjections = [];
  for (let year = 1; year <= 5; year++) {
    // Run quick ensemble for each year
    const yearModels = {
      monteCarlo: simulateMonteCarlo(totalCurrentValue, year, portfolioData),
      scenario: simulateScenario(totalCurrentValue, year, portfolioData),
      bootstrap: simulateBootstrap(totalCurrentValue, year, portfolioData, []),
      garch: simulateGARCH(totalCurrentValue, year, portfolioData),
      bayesian: simulateBayesian(totalCurrentValue, year, portfolioData),
      stress: simulateStress(totalCurrentValue, year, portfolioData)
    };

    const yearEnsemble = combineEnsemble(yearModels, CONFIG.modelWeights);
    const yearStats = calculateStatistics(yearEnsemble, totalCurrentValue);

    yearlyProjections.push({
      year,
      median: yearStats.median,
      growth: yearStats.growth.medianPct,
      ci80: [yearStats.percentiles.p10, yearStats.percentiles.p90],
      probLoss: yearStats.risk.probLoss
    });

    console.log(`Year ${year}: €${yearStats.median.toFixed(0)} (${yearStats.growth.medianPct >= 0 ? '+' : ''}${yearStats.growth.medianPct.toFixed(1)}%) | 80% CI: €${yearStats.percentiles.p10.toFixed(0)}-€${yearStats.percentiles.p90.toFixed(0)} | Loss prob: ${yearStats.risk.probLoss.toFixed(2)}%`);
  }

  results.yearlyProjections = yearlyProjections;

  // Investment recommendations
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                  INVESTMENT RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const riskRating = ensembleStats.risk.probLoss < 1 ? 'LOW' :
                     ensembleStats.risk.probLoss < 5 ? 'MODERATE' :
                     ensembleStats.risk.probLoss < 10 ? 'ELEVATED' : 'HIGH';

  const returnRating = ensembleStats.growth.medianPct > 30 ? 'EXCELLENT' :
                       ensembleStats.growth.medianPct > 20 ? 'GOOD' :
                       ensembleStats.growth.medianPct > 10 ? 'MODERATE' : 'LOW';

  console.log(`Overall Risk Level:   ${riskRating}`);
  console.log(`Expected Return:      ${returnRating}`);
  console.log(`Risk-Adjusted Score:  ${(ensembleStats.growth.medianPct / Math.max(ensembleStats.risk.probLoss, 0.1)).toFixed(1)}`);

  results.recommendations = {
    riskLevel: riskRating,
    returnLevel: returnRating,
    riskAdjustedScore: ensembleStats.growth.medianPct / Math.max(ensembleStats.risk.probLoss, 0.1),
    summary: generateSummary(ensembleStats, modelAgreement)
  };

  console.log(`\nSummary: ${results.recommendations.summary}`);

  // Save results
  const outputPath = path.join(__dirname, '..', 'data', 'ensemble-simulation-results.json');
  const publicPath = path.join(__dirname, '..', 'public', 'data', 'ensemble-simulation-results.json');

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  fs.writeFileSync(publicPath, JSON.stringify(results, null, 2));

  console.log(`\n✓ Results saved to data/ensemble-simulation-results.json`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return results;
}

function calculateHistoricalGrowth(priceHistory) {
  if (!priceHistory || priceHistory.length < 2) return 0.05;

  const sorted = priceHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
  const firstPrice = sorted[0].price;
  const lastPrice = sorted[sorted.length - 1].price;
  const years = (new Date(sorted[sorted.length - 1].date) - new Date(sorted[0].date)) / (365.25 * 24 * 60 * 60 * 1000);

  if (years < 0.1) return 0.05;
  return Math.pow(lastPrice / firstPrice, 1 / years) - 1;
}

function generateSummary(stats, agreement) {
  const parts = [];

  if (stats.growth.medianPct > 20) {
    parts.push('Strong growth expected');
  } else if (stats.growth.medianPct > 10) {
    parts.push('Moderate growth expected');
  } else {
    parts.push('Conservative growth expected');
  }

  if (stats.risk.probLoss < 1) {
    parts.push('with very low downside risk');
  } else if (stats.risk.probLoss < 5) {
    parts.push('with acceptable risk levels');
  } else {
    parts.push('but with notable risk exposure');
  }

  if (agreement > 80) {
    parts.push('(high model confidence)');
  } else if (agreement < 60) {
    parts.push('(models show uncertainty)');
  }

  return parts.join(' ');
}

// Run the simulation
runUnifiedSimulation().catch(console.error);
