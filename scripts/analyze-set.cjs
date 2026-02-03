/**
 * Deep Set Analyzer
 * Run comprehensive analysis on a single LEGO set
 *
 * Usage: node scripts/analyze-set.cjs <set-number>
 * Example: node scripts/analyze-set.cjs 42115
 *
 * Runs:
 * 1. BrickEconomy data fetch
 * 2. OpenAI price prediction
 * 3. Monte Carlo simulation (10,000 runs)
 * 4. All 7 ensemble models
 * 5. Retirement prediction
 * 6. Undervalue detection
 * 7. Buy timing analysis
 *
 * Results cached to data/set-analysis-cache.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  simulations: 10000,
  cacheFile: path.join(__dirname, '..', 'data', 'set-analysis-cache.json'),
  publicCacheFile: path.join(__dirname, '..', 'public', 'data', 'set-analysis-cache.json'),
  portfolioFile: path.join(__dirname, '..', 'data', 'portfolio.json'),
  deepAnalysisFile: path.join(__dirname, '..', 'data', 'deep-analysis.json'),
  aiCacheFile: path.join(__dirname, '..', 'data', 'ai-predictions-cache.json'),

  // Monte Carlo params
  monteCarlo: {
    baseDrift: 0.05,
    baseVolatility: 0.20,
    jumpIntensity: 0.15,
    jumpMeanSize: 0.30,
    meanReversionSpeed: 0.20,
    degreesOfFreedom: 5
  },

  // Theme average lifespans (years)
  themeLifespans: {
    'Star Wars': 2.5,
    'Harry Potter': 2.0,
    'Marvel': 1.8,
    'DC': 2.0,
    'Technic': 2.5,
    'Creator Expert': 3.0,
    'Ideas': 2.5,
    'Architecture': 3.0,
    'City': 1.5,
    'Ninjago': 1.5,
    'Friends': 1.5,
    'Disney': 2.0,
    'Icons': 2.5,
    'default': 2.0
  },

  // Seasonal adjustments
  seasonalFactors: {
    1: 0.02,   // January - post-holiday deals
    2: 0.03,   // February - best buying month
    3: 0.01,
    4: 0,
    5: -0.01,
    6: -0.02,
    7: -0.01,
    8: 0,
    9: 0.01,
    10: 0.02,
    11: 0.03,  // Pre-holiday markup
    12: -0.02  // Holiday premium (bad for buying)
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
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr) {
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function normalizeSetNumber(input) {
  // Handle various input formats: 42115, 42115-1, "42115", etc.
  let setNum = String(input).trim();
  if (!setNum.includes('-')) {
    setNum = setNum + '-1';
  }
  return setNum;
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

function loadCache() {
  try {
    if (fs.existsSync(CONFIG.cacheFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.cacheFile, 'utf8'));
    }
  } catch (e) {
    console.log('Creating new cache...');
  }
  return { sets: {}, metadata: { created: new Date().toISOString() } };
}

function saveCache(cache) {
  cache.metadata.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONFIG.cacheFile, JSON.stringify(cache, null, 2));
  fs.writeFileSync(CONFIG.publicCacheFile, JSON.stringify(cache, null, 2));
}

function getCachedAnalysis(setNumber) {
  const cache = loadCache();
  const cached = cache.sets[setNumber];

  if (cached) {
    // Check if cache is less than 7 days old
    const cacheAge = Date.now() - new Date(cached.analyzedAt).getTime();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

    if (cacheAge < maxAge) {
      return cached;
    }
    console.log(`Cache expired for ${setNumber}, re-analyzing...`);
  }
  return null;
}

function cacheAnalysis(setNumber, analysis) {
  const cache = loadCache();
  cache.sets[setNumber] = {
    ...analysis,
    analyzedAt: new Date().toISOString()
  };
  saveCache(cache);
}

// ============================================================================
// DATA FETCHING
// ============================================================================

function getSetFromPortfolio(setNumber) {
  try {
    const portfolio = JSON.parse(fs.readFileSync(CONFIG.portfolioFile, 'utf8'));
    return portfolio.sets.find(s =>
      s.setNumber === setNumber ||
      s.id === setNumber ||
      s.setNumber === setNumber.replace('-1', '') ||
      s.id === setNumber.replace('-1', '')
    );
  } catch (e) {
    return null;
  }
}

function getDeepAnalysis(setNumber) {
  try {
    const analysis = JSON.parse(fs.readFileSync(CONFIG.deepAnalysisFile, 'utf8'));
    return analysis[setNumber] || analysis[setNumber.replace('-1', '')] || null;
  } catch (e) {
    return null;
  }
}

function getAIPrediction(setNumber) {
  try {
    const cache = JSON.parse(fs.readFileSync(CONFIG.aiCacheFile, 'utf8'));
    return cache.predictions?.[setNumber] || cache.predictions?.[setNumber.replace('-1', '')] || null;
  } catch (e) {
    return null;
  }
}

async function fetchBrickEconomyData(setNumber) {
  // Try to get from existing portfolio/analysis first
  const portfolioSet = getSetFromPortfolio(setNumber);
  const deepAnalysis = getDeepAnalysis(setNumber);

  if (portfolioSet || deepAnalysis) {
    return {
      fromCache: true,
      portfolio: portfolioSet,
      analysis: deepAnalysis
    };
  }

  // Would need web scraping for new sets - return null for now
  console.log(`  Set ${setNumber} not found in portfolio. Add it first or manually input data.`);
  return null;
}

async function fetchOpenAIPrediction(setNumber, setData) {
  // Check existing cache first
  const cached = getAIPrediction(setNumber);
  if (cached) {
    console.log(`  Using cached AI prediction from ${cached.cachedAt}`);
    return cached.prediction;
  }

  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('  No OPENAI_API_KEY set, skipping AI prediction');
    return null;
  }

  console.log('  Fetching OpenAI prediction...');

  const prompt = `Analyze this LEGO set for investment potential:

Set: ${setData.name} (${setNumber})
Theme: ${setData.theme}
Current Value: €${setData.value}
Retail Price: €${setData.retail}
Growth to Date: ${setData.growth}%

Predict the value in 1 year and 5 years. Consider:
- Theme popularity and license strength
- Retirement likelihood
- Piece count and complexity
- Historical performance of similar sets

Respond in JSON format:
{
  "1yr": {"value": <number>, "confidence": "high/medium/low"},
  "5yr": {"value": <number>, "confidence": "high/medium/low"},
  "confidence": "high/medium/low",
  "reasoning": "<brief explanation>"
}`;

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const content = response.choices?.[0]?.message?.content || '';

          // Extract JSON from response
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const prediction = JSON.parse(jsonMatch[0]);

            // Cache the prediction
            const aiCache = JSON.parse(fs.readFileSync(CONFIG.aiCacheFile, 'utf8'));
            if (!aiCache.predictions) aiCache.predictions = {};
            aiCache.predictions[setNumber] = {
              prediction,
              cachedAt: new Date().toISOString(),
              modelVersion: 'gpt-4o-mini'
            };
            fs.writeFileSync(CONFIG.aiCacheFile, JSON.stringify(aiCache, null, 2));

            resolve(prediction);
          } else {
            resolve(null);
          }
        } catch (e) {
          console.log('  Failed to parse AI response');
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });
}

// ============================================================================
// SIMULATION MODELS
// ============================================================================

function runMonteCarloSimulation(currentValue, years, setData) {
  const results = [];
  const dt = 1 / 52; // Weekly steps
  const steps = years * 52;

  const isRetiring = setData.yearsOld >= 1.5;
  const isRetired = setData.yearsOld >= 2.5;

  let drift = CONFIG.monteCarlo.baseDrift;
  let vol = CONFIG.monteCarlo.baseVolatility;

  if (isRetired) {
    drift *= 1.3;
    vol *= 0.8;
  } else if (isRetiring) {
    drift *= 1.1;
    vol *= 1.2;
  }

  const clampedGrowth = Math.max(0, Math.min(0.30, setData.historicalGrowth || 0.05));
  const fairValue = currentValue * (1 + clampedGrowth);

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;

    for (let t = 0; t < steps; t++) {
      const shock = Math.max(-4, Math.min(4, randomStudentT(CONFIG.monteCarlo.degreesOfFreedom)));

      let jump = 0;
      if (isRetiring && Math.random() < CONFIG.monteCarlo.jumpIntensity * dt * 0.5) {
        jump = CONFIG.monteCarlo.jumpMeanSize * (0.3 + Math.random() * 0.4);
      }

      const reversion = CONFIG.monteCarlo.meanReversionSpeed * (Math.log(fairValue) - Math.log(price)) * dt;
      const month = Math.floor((t / 52) * 12) % 12;
      const seasonal = [0.01, 0.015, 0.005, 0, -0.005, -0.01, -0.005, 0, 0.005, 0.01, 0.015, -0.01][month] || 0;

      const dLogPrice = (drift + seasonal) * dt + reversion + vol * Math.sqrt(dt) * shock + jump;
      price = price * Math.exp(dLogPrice);

      if (!isFinite(price) || price <= 0) price = currentValue;
      if (price > currentValue * 4) price = currentValue * 4;
      if (price < currentValue * 0.4) price = currentValue * 0.4;
    }

    results.push(price);
  }

  return results;
}

function runScenarioAnalysis(currentValue, years, setData) {
  const results = [];
  const scenarios = [
    { name: 'bull', prob: 0.25, drift: 0.12, vol: 0.15 },
    { name: 'base', prob: 0.50, drift: 0.05, vol: 0.20 },
    { name: 'bear', prob: 0.25, drift: -0.02, vol: 0.30 }
  ];

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    const r = Math.random();
    let scenario = scenarios[1]; // base
    let cumulative = 0;
    for (const s of scenarios) {
      cumulative += s.prob;
      if (r < cumulative) { scenario = s; break; }
    }

    let price = currentValue;
    let drift = scenario.drift;
    let vol = scenario.vol;

    if (setData.yearsOld >= 2) {
      drift += 0.03;
      vol *= 0.8;
    }

    for (let y = 0; y < years; y++) {
      for (let w = 0; w < 52; w++) {
        const dt = 1/52;
        price = price * Math.exp((drift * dt) + (vol * Math.sqrt(dt) * randomNormal()));
      }
    }

    results.push(Math.max(currentValue * 0.3, Math.min(currentValue * 5, price)));
  }

  return results;
}

function runGARCH(currentValue, years, setData) {
  const results = [];
  const dt = 1/52;
  const steps = years * 52;
  const drift = CONFIG.monteCarlo.baseDrift + (setData.yearsOld >= 2 ? 0.03 : 0);

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;
    let variance = 0.04; // 20% vol squared
    let lastReturn = 0;

    for (let t = 0; t < steps; t++) {
      variance = 0.0001 + 0.10 * lastReturn ** 2 + 0.85 * variance;
      const vol = Math.sqrt(Math.min(0.5, variance));
      const shock = randomNormal();
      const dLogPrice = drift * dt + vol * Math.sqrt(dt) * shock;
      lastReturn = dLogPrice;
      price = price * Math.exp(dLogPrice);
    }

    results.push(Math.max(currentValue * 0.4, Math.min(currentValue * 3, price)));
  }

  return results;
}

function runBootstrap(currentValue, years, setData) {
  const results = [];
  const annualGrowth = Math.min(0.10, Math.max(0.02, setData.historicalGrowth || 0.05));
  const monthlyDrift = annualGrowth / 12;

  // Generate synthetic historical returns
  const historicalReturns = [];
  for (let i = 0; i < 60; i++) {
    const baseReturn = monthlyDrift + randomNormal() * 0.04;
    historicalReturns.push(Math.max(-0.08, Math.min(0.08, baseReturn)));
  }

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;
    for (let m = 0; m < years * 12; m++) {
      const sampledReturn = historicalReturns[Math.floor(Math.random() * historicalReturns.length)];
      price = price * (1 + Math.max(-0.15, Math.min(0.15, sampledReturn)));
    }
    results.push(Math.max(currentValue * 0.5, Math.min(currentValue * 3, price)));
  }

  return results;
}

function runBayesian(currentValue, years, setData) {
  const results = [];
  const dt = 1/52;
  const steps = years * 52;

  const observedGrowth = Math.max(-0.10, Math.min(0.15, setData.historicalGrowth || 0.05));
  let adjustedMean = 0.3 * 0.05 + 0.7 * observedGrowth;
  if (setData.yearsOld >= 2) adjustedMean += 0.02;
  if (setData.isLicensed) adjustedMean += 0.01;
  adjustedMean = Math.max(0, Math.min(0.12, adjustedMean));

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;
    const sampledDrift = Math.max(-0.05, Math.min(0.15, adjustedMean + randomNormal() * 0.1));

    for (let t = 0; t < steps; t++) {
      const shock = randomNormal();
      price = price * Math.exp(sampledDrift * dt + 0.20 * Math.sqrt(dt) * shock);
      if (price > currentValue * 5) price = currentValue * 5;
      if (price < currentValue * 0.3) price = currentValue * 0.3;
    }

    results.push(price);
  }

  return results;
}

function runStressTest(currentValue, years, setData) {
  const results = [];
  const stressEvents = [
    { name: 'marketCrash', prob: 0.05, impact: -0.40, recovery: 2 },
    { name: 'themeCollapse', prob: 0.03, impact: -0.60, recovery: 5 },
    { name: 'boom', prob: 0.05, impact: 0.50, recovery: 3 }
  ];

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    let price = currentValue;
    let inRecovery = false;
    let recoverySteps = 0;
    let recoveryTarget = 0;

    for (let w = 0; w < years * 52; w++) {
      if (!inRecovery) {
        for (const event of stressEvents) {
          if (Math.random() < event.prob / 52) {
            price = price * (1 + event.impact * (setData.isLicensed ? 0.8 : 1.2));
            inRecovery = true;
            recoverySteps = event.recovery * 52;
            recoveryTarget = currentValue * (1 + 0.05 * (w / 52));
            break;
          }
        }
      }

      if (inRecovery && recoverySteps > 0) {
        price += (recoveryTarget - price) / recoverySteps + randomNormal() * price * 0.02;
        recoverySteps--;
        if (recoverySteps === 0) inRecovery = false;
      } else {
        price = price * Math.exp(0.05/52 + 0.20 * Math.sqrt(1/52) * randomNormal());
      }
    }

    results.push(Math.max(currentValue * 0.2, Math.min(currentValue * 4, price)));
  }

  return results;
}

function runBrickEconomyML(currentValue, years, mlPrediction) {
  const results = [];

  if (!mlPrediction) {
    // Fallback to default if no ML data
    for (let sim = 0; sim < CONFIG.simulations; sim++) {
      let price = currentValue * (1 + 0.05 * years + randomNormal() * 0.15);
      results.push(Math.max(currentValue * 0.5, Math.min(currentValue * 3, price)));
    }
    return results;
  }

  const pred1yr = mlPrediction['1yr']?.value || currentValue * 1.15;
  const pred5yr = mlPrediction['5yr']?.value || currentValue * 1.70;
  const targetValue = years <= 1 ? pred1yr : years >= 5 ? pred5yr :
    currentValue * Math.pow(pred5yr / currentValue, years / 5);

  for (let sim = 0; sim < CONFIG.simulations; sim++) {
    const noise = randomNormal() * 0.15;
    let price = currentValue;
    const annualGrowth = (targetValue / currentValue) ** (1 / years) - 1;

    for (let y = 0; y < years; y++) {
      price = price * (1 + annualGrowth + randomNormal() * 0.08);
    }

    const directPrediction = targetValue * (1 + noise);
    const blendedResult = 0.6 * directPrediction + 0.4 * price;
    results.push(Math.max(currentValue * 0.5, Math.min(currentValue * 4, blendedResult)));
  }

  return results;
}

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

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

function predictRetirement(setData) {
  const theme = setData.theme?.split(' / ')[0] || 'default';
  const expectedLifespan = CONFIG.themeLifespans[theme] || CONFIG.themeLifespans.default;
  const yearsOld = setData.yearsOld || 1;
  const remainingYears = Math.max(0, expectedLifespan - yearsOld);

  let status = 'active';
  let urgency = 'low';

  if (remainingYears <= 0) {
    status = 'retired';
    urgency = 'none';
  } else if (remainingYears <= 0.5) {
    status = 'retiring';
    urgency = 'critical';
  } else if (remainingYears <= 1) {
    status = 'retiring-soon';
    urgency = 'high';
  } else if (remainingYears <= 1.5) {
    status = 'watch';
    urgency = 'medium';
  }

  return {
    status,
    urgency,
    expectedLifespan,
    yearsOld,
    remainingYears,
    estimatedRetirementDate: new Date(Date.now() + remainingYears * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  };
}

function analyzeBuyTiming(setData) {
  const currentMonth = new Date().getMonth() + 1;
  const seasonalFactor = CONFIG.seasonalFactors[currentMonth] || 0;

  let action = 'HOLD';
  let reason = '';

  if (seasonalFactor >= 0.02) {
    action = 'BUY';
    reason = 'Optimal buying season - prices typically lower';
  } else if (seasonalFactor <= -0.01) {
    action = 'WAIT';
    reason = 'Suboptimal timing - consider waiting for better prices';
  } else {
    action = 'NEUTRAL';
    reason = 'Average timing - prices at typical levels';
  }

  return {
    currentMonth: new Date().toLocaleString('default', { month: 'long' }),
    seasonalFactor,
    action,
    reason,
    bestMonths: ['February', 'January', 'November'],
    worstMonths: ['December', 'June']
  };
}

function generateInvestmentScore(setData, stats, retirement) {
  let score = 5; // Base score

  // Growth potential (+/- 2)
  if (stats.growth.medianPct > 30) score += 2;
  else if (stats.growth.medianPct > 15) score += 1;
  else if (stats.growth.medianPct < 0) score -= 2;
  else if (stats.growth.medianPct < 10) score -= 1;

  // Risk adjustment (+/- 1.5)
  if (stats.risk.probLoss < 5) score += 1.5;
  else if (stats.risk.probLoss < 15) score += 0.5;
  else if (stats.risk.probLoss > 30) score -= 1.5;

  // Retirement timing (+/- 1)
  if (retirement.status === 'retiring') score += 1;
  else if (retirement.status === 'retiring-soon') score += 0.5;

  // Licensed theme bonus
  if (setData.isLicensed) score += 0.5;

  return Math.max(1, Math.min(10, score));
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

async function analyzeSet(setNumber) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`       DEEP SET ANALYSIS: ${setNumber}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check cache first
  const cached = getCachedAnalysis(setNumber);
  if (cached) {
    console.log(`Using cached analysis from ${cached.analyzedAt}\n`);
    printAnalysisReport(cached);
    return cached;
  }

  // Fetch data
  console.log('Fetching data...');
  const brickEconomyData = await fetchBrickEconomyData(setNumber);

  if (!brickEconomyData) {
    console.log('\nError: Could not find set data. Please add the set to your portfolio first.');
    return null;
  }

  const portfolioSet = brickEconomyData.portfolio;
  const deepAnalysis = brickEconomyData.analysis;

  // Build set data object
  const currentValue = portfolioSet?.value || 100;
  const setData = {
    setNumber,
    name: portfolioSet?.name || deepAnalysis?.name || `Set ${setNumber}`,
    theme: portfolioSet?.theme || 'Unknown',
    value: currentValue,
    retail: portfolioSet?.retail || currentValue,
    growth: portfolioSet?.growth || 0,
    yearsOld: 1.5, // Default estimate
    isLicensed: ['Star Wars', 'Harry Potter', 'Marvel', 'Disney', 'DC', 'Licensed'].some(t =>
      (portfolioSet?.theme || '').toLowerCase().includes(t.toLowerCase())
    ),
    historicalGrowth: (portfolioSet?.growth || 0) / 100
  };

  console.log(`\nSet: ${setData.name}`);
  console.log(`Theme: ${setData.theme}`);
  console.log(`Current Value: €${setData.value.toFixed(2)}`);
  console.log(`Growth to Date: ${(setData.historicalGrowth * 100).toFixed(1)}%\n`);

  // Fetch AI prediction
  console.log('Running AI analysis...');
  const aiPrediction = await fetchOpenAIPrediction(setNumber, setData);

  // Get ML prediction from deep analysis
  const mlPrediction = deepAnalysis?.predictions || null;

  // Run all simulation models
  console.log('\nRunning 7 simulation models (10,000 iterations each)...');

  console.log('  [1/7] BrickEconomy ML...');
  const brickEconomyResults = runBrickEconomyML(currentValue, 5, mlPrediction);

  console.log('  [2/7] Monte Carlo...');
  const monteCarloResults = runMonteCarloSimulation(currentValue, 5, setData);

  console.log('  [3/7] Scenario Analysis...');
  const scenarioResults = runScenarioAnalysis(currentValue, 5, setData);

  console.log('  [4/7] Stress Testing...');
  const stressResults = runStressTest(currentValue, 5, setData);

  console.log('  [5/7] Bootstrap...');
  const bootstrapResults = runBootstrap(currentValue, 5, setData);

  console.log('  [6/7] GARCH...');
  const garchResults = runGARCH(currentValue, 5, setData);

  console.log('  [7/7] Bayesian...');
  const bayesianResults = runBayesian(currentValue, 5, setData);

  // Calculate ensemble (weighted average)
  const weights = {
    brickEconomyML: 0.25,
    monteCarlo: 0.25,
    scenario: 0.12,
    stress: 0.08,
    bootstrap: 0.12,
    garch: 0.10,
    bayesian: 0.08
  };

  const ensembleResults = [];
  for (let i = 0; i < CONFIG.simulations; i++) {
    const value =
      weights.brickEconomyML * brickEconomyResults[i] +
      weights.monteCarlo * monteCarloResults[i] +
      weights.scenario * scenarioResults[i] +
      weights.stress * stressResults[i] +
      weights.bootstrap * bootstrapResults[i] +
      weights.garch * garchResults[i] +
      weights.bayesian * bayesianResults[i];
    ensembleResults.push(value);
  }

  // Calculate statistics for each model
  const modelStats = {
    brickEconomyML: calculateStatistics(brickEconomyResults, currentValue),
    monteCarlo: calculateStatistics(monteCarloResults, currentValue),
    scenario: calculateStatistics(scenarioResults, currentValue),
    stress: calculateStatistics(stressResults, currentValue),
    bootstrap: calculateStatistics(bootstrapResults, currentValue),
    garch: calculateStatistics(garchResults, currentValue),
    bayesian: calculateStatistics(bayesianResults, currentValue),
    ensemble: calculateStatistics(ensembleResults, currentValue)
  };

  // Additional analysis
  const retirement = predictRetirement(setData);
  const buyTiming = analyzeBuyTiming(setData);
  const investmentScore = generateInvestmentScore(setData, modelStats.ensemble, retirement);

  // Calculate yearly projections (quick version using ensemble approach)
  console.log('\nCalculating yearly projections...');
  const yearlyProjections = [];
  for (let year = 1; year <= 5; year++) {
    // Use a quick simulation with fewer iterations for yearly
    const quickSims = 2000;
    const yearResults = [];

    for (let sim = 0; sim < quickSims; sim++) {
      let price = currentValue;
      const drift = 0.05 + (setData.yearsOld >= 2 ? 0.03 : 0);
      const vol = 0.20;

      for (let w = 0; w < year * 52; w++) {
        const dt = 1/52;
        price = price * Math.exp((drift * dt) + (vol * Math.sqrt(dt) * randomNormal()));
      }
      yearResults.push(Math.max(currentValue * 0.4, Math.min(currentValue * 4, price)));
    }

    const yearStats = calculateStatistics(yearResults, currentValue);
    yearlyProjections.push({
      year,
      median: yearStats.median,
      growth: yearStats.growth.medianPct,
      ci80: [yearStats.percentiles.p10, yearStats.percentiles.p90],
      probLoss: yearStats.risk.probLoss
    });
  }

  // Build final analysis object
  const analysis = {
    setNumber,
    setData,
    currentValue,

    // Predictions
    predictions: {
      ai: aiPrediction,
      brickEconomyML: mlPrediction,
      ensemble: {
        median: modelStats.ensemble.median,
        mean: modelStats.ensemble.mean,
        growth: modelStats.ensemble.growth,
        percentiles: modelStats.ensemble.percentiles
      }
    },

    // Model results
    modelStats,
    yearlyProjections,

    // Risk metrics
    risk: modelStats.ensemble.risk,

    // Other analysis
    retirement,
    buyTiming,
    investmentScore,

    // Deep analysis scores if available
    scores: deepAnalysis ? {
      license: deepAnalysis.license,
      retirement: deepAnalysis.retirement,
      appeal: deepAnalysis.appeal,
      liquidity: deepAnalysis.liquidity,
      action: deepAnalysis.action,
      confidence: deepAnalysis.confidence,
      thesis: deepAnalysis.thesis
    } : null,

    // Metadata
    analyzedAt: new Date().toISOString(),
    simulationsRun: CONFIG.simulations
  };

  // Cache the analysis
  cacheAnalysis(setNumber, analysis);

  // Print report
  printAnalysisReport(analysis);

  return analysis;
}

function printAnalysisReport(analysis) {
  const { setData, currentValue, modelStats, risk, retirement, buyTiming, investmentScore, predictions, yearlyProjections, scores } = analysis;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                      ANALYSIS RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`SET: ${setData.name} (${setData.setNumber})`);
  console.log(`Theme: ${setData.theme}`);
  console.log(`Current Value: €${currentValue.toFixed(2)}`);
  console.log(`Investment Score: ${investmentScore.toFixed(1)}/10\n`);

  console.log('─────────────────────────────────────────────────────────────────');
  console.log('                    5-YEAR ENSEMBLE PREDICTION');
  console.log('─────────────────────────────────────────────────────────────────');

  const ens = modelStats.ensemble;
  console.log(`\n  Median:         €${ens.median.toFixed(0)} (${ens.growth.medianPct >= 0 ? '+' : ''}${ens.growth.medianPct.toFixed(1)}%)`);
  console.log(`  Mean:           €${ens.mean.toFixed(0)} (${ens.growth.meanPct >= 0 ? '+' : ''}${ens.growth.meanPct.toFixed(1)}%)`);
  console.log(`\n  50% CI:         €${ens.percentiles.p25.toFixed(0)} - €${ens.percentiles.p75.toFixed(0)}`);
  console.log(`  80% CI:         €${ens.percentiles.p10.toFixed(0)} - €${ens.percentiles.p90.toFixed(0)}`);
  console.log(`  90% CI:         €${ens.percentiles.p5.toFixed(0)} - €${ens.percentiles.p95.toFixed(0)}`);

  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('                        RISK METRICS');
  console.log('─────────────────────────────────────────────────────────────────');

  console.log(`\n  Value at Risk (95%):     €${risk.VaR95.toFixed(0)}`);
  console.log(`  Expected Shortfall:      €${risk.CVaR95.toFixed(0)}`);
  console.log(`  Probability of Loss:     ${risk.probLoss.toFixed(2)}%`);
  console.log(`  Probability of +50%:     ${risk.probGain50.toFixed(1)}%`);
  console.log(`  Probability of 2x:       ${risk.probDouble.toFixed(1)}%`);

  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('                    INDIVIDUAL MODEL RESULTS');
  console.log('─────────────────────────────────────────────────────────────────\n');

  for (const [model, stats] of Object.entries(modelStats)) {
    if (model === 'ensemble') continue;
    const g = stats.growth.medianPct;
    console.log(`  ${model.padEnd(15)} ${g >= 0 ? '+' : ''}${g.toFixed(1)}% → €${stats.median.toFixed(0)}`);
  }

  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('                     YEARLY PROJECTIONS');
  console.log('─────────────────────────────────────────────────────────────────\n');

  for (const y of yearlyProjections) {
    console.log(`  Year ${y.year}: €${y.median.toFixed(0)} (${y.growth >= 0 ? '+' : ''}${y.growth.toFixed(1)}%) | 80% CI: €${y.ci80[0].toFixed(0)}-€${y.ci80[1].toFixed(0)} | Loss: ${y.probLoss.toFixed(1)}%`);
  }

  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('                      RETIREMENT STATUS');
  console.log('─────────────────────────────────────────────────────────────────');

  console.log(`\n  Status:             ${retirement.status.toUpperCase()}`);
  console.log(`  Urgency:            ${retirement.urgency.toUpperCase()}`);
  console.log(`  Years in Market:    ${retirement.yearsOld.toFixed(1)}`);
  console.log(`  Expected Lifespan:  ${retirement.expectedLifespan} years`);
  console.log(`  Est. Retirement:    ${retirement.estimatedRetirementDate}`);

  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('                        BUY TIMING');
  console.log('─────────────────────────────────────────────────────────────────');

  console.log(`\n  Current Month:      ${buyTiming.currentMonth}`);
  console.log(`  Action:             ${buyTiming.action}`);
  console.log(`  Reason:             ${buyTiming.reason}`);

  if (predictions.ai) {
    console.log('\n─────────────────────────────────────────────────────────────────');
    console.log('                      AI PREDICTION');
    console.log('─────────────────────────────────────────────────────────────────');

    console.log(`\n  1-Year:             €${predictions.ai['1yr']?.value || 'N/A'}`);
    console.log(`  5-Year:             €${predictions.ai['5yr']?.value || 'N/A'}`);
    console.log(`  Confidence:         ${predictions.ai.confidence || 'N/A'}`);
    if (predictions.ai.reasoning) {
      console.log(`  Reasoning:          ${predictions.ai.reasoning}`);
    }
  }

  if (scores) {
    console.log('\n─────────────────────────────────────────────────────────────────');
    console.log('                   BRICKECONOMY SCORES');
    console.log('─────────────────────────────────────────────────────────────────');

    console.log(`\n  License:            ${scores.license}/10`);
    console.log(`  Retirement:         ${scores.retirement}/10`);
    console.log(`  Appeal:             ${scores.appeal}/10`);
    console.log(`  Liquidity:          ${scores.liquidity}/10`);
    console.log(`  Action:             ${scores.action}`);
    console.log(`  Confidence:         ${scores.confidence}`);
    if (scores.thesis) {
      console.log(`  Thesis:             ${scores.thesis}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Analysis cached to: data/set-analysis-cache.json`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node scripts/analyze-set.cjs <set-number>');
  console.log('Example: node scripts/analyze-set.cjs 42115');
  console.log('         node scripts/analyze-set.cjs 75192-1');
  process.exit(1);
}

const setNumber = normalizeSetNumber(args[0]);
analyzeSet(setNumber).catch(console.error);
