// Import dependencies
import Chart from 'chart.js/auto';
import './styles.css';

// Make Chart available globally for the dashboard code
window.Chart = Chart;

// Data stores
let portfolio = null;
let analysis = null;
let priceHistory = null;
let aiPredictions = null;
let ebayPriceHistory = null;
let currentTab = 'all';
let currentFilter = '';
let historyChart = null;

// Transform new data format to expected format
function transformPortfolio(data) {
  // If already in old format (sets is object), return as-is
  if (data.summary && !Array.isArray(data.sets)) return data;

  // Transform new format (sets is array, metadata instead of summary)
  const setsObj = {};
  (data.sets || []).forEach((set) => {
    const id = set.setNumber || set.id;
    setsObj[id] = {
      name: set.name,
      theme: set.theme,
      retail: set.retail,
      paid: set.paid,
      value: set.value,
      qty_new: set.qtyNew,
      qty_used: set.qtyUsed,
      growth_pct: set.growth,
    };
  });

  const meta = data.metadata || {};
  return {
    sets: setsObj,
    summary: {
      total_current: meta.totalCurrentValue || 0,
      total_paid: meta.totalPaid || 0,
      total_gain_eur: (meta.totalCurrentValue || 0) - (meta.totalPaid || 0),
      total_gain_pct: meta.totalGain || 0,
      total_sets: meta.totalSets || Object.keys(setsObj).length,
      total_units: meta.totalUnits || 0,
      last_updated: meta.lastUpdated || new Date().toISOString(),
    },
  };
}

// Load data
async function loadData() {
  try {
    let rawPortfolio = await fetch('data/portfolio.json').then((r) => r.json());
    portfolio = transformPortfolio(rawPortfolio);
    analysis = await fetch('data/deep-analysis.json').then((r) => r.json());
    try {
      priceHistory = await fetch('data/price-history.json').then((r) =>
        r.json()
      );
    } catch (e) {
      priceHistory = null;
    }
    try {
      aiPredictions = await fetch('data/ai-predictions-cache.json').then((r) =>
        r.json()
      );
    } catch (e) {
      aiPredictions = null;
    }
    try {
      ebayPriceHistory = await fetch('data/ebay-price-history.json').then((r) =>
        r.json()
      );
    } catch (e) {
      ebayPriceHistory = null;
    }
    renderDashboard();
  } catch (e) {
    document.getElementById('setsGrid').innerHTML =
      '<div class="text-red-400">Failed to load portfolio data</div>';
  }
}

// Get AI prediction for a set, merging with BrickEconomy predictions
function getSetPredictions(setId, analysisData) {
  const brickEconomyPredictions = analysisData.predictions || {};

  // Check for AI predictions cache
  if (aiPredictions && aiPredictions.predictions && aiPredictions.predictions[setId]) {
    const aiCache = aiPredictions.predictions[setId];
    const aiPred = aiCache.prediction || {};

    // Merge AI predictions with BrickEconomy, AI takes priority when available
    return {
      ...brickEconomyPredictions,
      '1yr': aiPred['1yr'] || brickEconomyPredictions['1yr'],
      '5yr': aiPred['5yr'] || brickEconomyPredictions['5yr'],
      growth1yr: aiPred['1yr']
        ? ((aiPred['1yr'].value - (analysisData.currentValue || 0)) / (analysisData.currentValue || 1)) * 100
        : brickEconomyPredictions.growth1yr,
      growth5yr: aiPred['5yr']
        ? ((aiPred['5yr'].value - (analysisData.currentValue || 0)) / (analysisData.currentValue || 1)) * 100
        : brickEconomyPredictions.growth5yr,
      aiConfidence: aiPred.confidence || null,
      aiReasoning: aiPred.reasoning || null,
      aiSource: aiCache.modelVersion ? `OpenAI ${aiCache.modelVersion}` : 'AI Prediction',
      aiCachedAt: aiCache.cachedAt || null,
    };
  }

  return brickEconomyPredictions;
}

// Get eBay market stats for a set
function getEbayMarketStats(setId) {
  if (!ebayPriceHistory) return null;

  // Check soldListings first (detailed data)
  if (ebayPriceHistory.soldListings && ebayPriceHistory.soldListings[setId]) {
    const listing = ebayPriceHistory.soldListings[setId];
    return {
      marketValue: listing.statistics?.median || null,
      min: listing.statistics?.min || null,
      max: listing.statistics?.max || null,
      mean: listing.statistics?.mean || null,
      count: listing.statistics?.count || 0,
      lastUpdate: listing.lastUpdate || null,
      source: 'eBay Sold Listings',
    };
  }

  // Fall back to snapshots data
  if (ebayPriceHistory.snapshots && ebayPriceHistory.snapshots.length > 0) {
    // Get the most recent snapshot with data for this set
    for (let i = ebayPriceHistory.snapshots.length - 1; i >= 0; i--) {
      const snapshot = ebayPriceHistory.snapshots[i];
      const setData = snapshot.data?.find((d) => d.setId === setId);
      if (setData && setData.prices && setData.prices.length > 0) {
        // Calculate stats from raw prices (filter outliers)
        const prices = setData.prices.filter((p) => p > 50 && p < 2000).sort((a, b) => a - b);
        if (prices.length === 0) continue;

        const median = prices[Math.floor(prices.length / 2)];
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        return {
          marketValue: setData.marketValue || median,
          min: prices[0],
          max: prices[prices.length - 1],
          mean: mean,
          count: prices.length,
          lastUpdate: snapshot.timestamp,
          source: snapshot.source || 'eBay',
        };
      }
    }
  }

  return null;
}

function renderDashboard() {
  if (!portfolio || !analysis) return;

  // Calculate enriched data
  const sets = Object.entries(portfolio.sets).map(([id, data]) => {
    const a = analysis[id] || {};
    const avgScore =
      ((a.license || 0) +
        (a.retirement || 0) +
        (a.appeal || 0) +
        (a.liquidity || 0)) /
      4;
    // Merge AI predictions with existing predictions
    const predictions = getSetPredictions(id, { ...a, currentValue: data.value });
    return { id, ...data, analysis: a, avgScore, predictions };
  });

  // Summary
  document.getElementById('totalValue').textContent =
    '€' +
    portfolio.summary.total_current.toLocaleString('de-DE', {
      minimumFractionDigits: 2,
    });
  document.getElementById('totalPaid').textContent =
    'Paid: €' +
    portfolio.summary.total_paid.toLocaleString('de-DE', {
      minimumFractionDigits: 2,
    });

  const gain = portfolio.summary.total_gain_eur;
  const gainPct = portfolio.summary.total_gain_pct;
  const gainEl = document.getElementById('totalGain');
  const gainPctEl = document.getElementById('totalGainPct');
  gainEl.textContent =
    (gain >= 0 ? '+' : '') +
    '€' +
    gain.toLocaleString('de-DE', { minimumFractionDigits: 2 });
  gainEl.className =
    'text-2xl font-bold ' + (gain >= 0 ? 'text-green-400' : 'text-red-400');
  gainPctEl.textContent = (gainPct >= 0 ? '+' : '') + gainPct.toFixed(2) + '%';
  gainPctEl.className =
    'text-sm ' + (gainPct >= 0 ? 'text-green-400' : 'text-red-400');

  const totalUnits = sets.reduce(
    (sum, s) => sum + (s.qty_new || 0) + (s.qty_used || 0),
    0
  );
  document.getElementById('totalSets').textContent = sets.length;
  document.getElementById('totalUnits').textContent =
    totalUnits + ' total units';

  const avgScore = sets.reduce((sum, s) => sum + s.avgScore, 0) / sets.length;
  document.getElementById('avgScore').textContent = avgScore.toFixed(1);

  // Calculate portfolio projections
  // Note: s.value already includes quantity (it's the total value for that line item)
  // AI predictions also predict total value (not per-unit), so no qty multiplication needed
  let projected1yr = 0;
  let projected5yr = 0;
  sets.forEach((s) => {
    const pred = s.predictions;
    if (pred && pred['1yr']) {
      projected1yr += pred['1yr'].value || s.value;
    } else {
      projected1yr += s.value * 1.15; // Default 15% growth estimate
    }
    if (pred && pred['5yr']) {
      projected5yr += pred['5yr'].value || s.value;
    } else {
      projected5yr += s.value * 1.8; // Default 80% growth estimate over 5yr
    }
  });

  const currentTotal = portfolio.summary.total_current;
  const growth1yr = ((projected1yr - currentTotal) / currentTotal) * 100;
  const growth5yr = ((projected5yr - currentTotal) / currentTotal) * 100;

  const change1yr = projected1yr - currentTotal;
  const change5yr = projected5yr - currentTotal;
  const color1yr = change1yr >= 0 ? 'text-green-400' : 'text-red-400';
  const color5yr = change5yr >= 0 ? 'text-green-400' : 'text-red-400';
  const sign1yr = change1yr >= 0 ? '+' : '';
  const sign5yr = change5yr >= 0 ? '+' : '';

  document.getElementById('forecast1yr').textContent =
    '€' + projected1yr.toLocaleString('de-DE', { minimumFractionDigits: 0 });
  document.getElementById('forecast1yrGrowth').textContent =
    sign1yr + growth1yr.toFixed(1) + '% projected';

  document.getElementById('projection1yr').textContent =
    '€' + projected1yr.toLocaleString('de-DE', { minimumFractionDigits: 0 });
  document.getElementById('projection1yrChange').innerHTML =
    `<span class="${color1yr}">${sign1yr}€${Math.abs(change1yr).toLocaleString('de-DE', { minimumFractionDigits: 0 })}</span> <span class="text-gray-400">(${sign1yr}${growth1yr.toFixed(1)}%)</span>`;

  document.getElementById('projection5yr').textContent =
    '€' + projected5yr.toLocaleString('de-DE', { minimumFractionDigits: 0 });
  document.getElementById('projection5yrChange').innerHTML =
    `<span class="${color5yr}">${sign5yr}€${Math.abs(change5yr).toLocaleString('de-DE', { minimumFractionDigits: 0 })}</span> <span class="text-gray-400">(${sign5yr}${growth5yr.toFixed(1)}%)</span>`;

  // Top/Bottom projected
  const sortedByProjected = [...sets].sort((a, b) => {
    const aGrowth = a.predictions?.growth1yr || 15;
    const bGrowth = b.predictions?.growth1yr || 15;
    return bGrowth - aGrowth;
  });
  renderProjectedPerformers(
    'topProjected',
    sortedByProjected.slice(0, 5),
    true
  );
  renderProjectedPerformers(
    'bottomProjected',
    sortedByProjected.slice(-5).reverse(),
    false
  );

  // Action counts
  const buys = sets.filter((s) => s.analysis.action === 'BUY');
  const holds = sets.filter((s) => s.analysis.action === 'HOLD');
  const sells = sets.filter((s) => s.analysis.action === 'SELL');

  document.getElementById('buyCount').textContent = buys.length;
  document.getElementById('holdCount').textContent = holds.length;
  document.getElementById('sellCount').textContent = sells.length;

  document.getElementById('buyThesis').textContent =
    buys.length > 0 ? buys[0].name : 'No buy recommendations';
  document.getElementById('sellThesis').textContent =
    sells.length > 0
      ? `${sells.length} sets to consider selling`
      : 'No sell recommendations';
  document.getElementById('holdThesis').textContent =
    `${holds.length} sets performing as expected`;

  // Top/Bottom performers
  const sorted = [...sets].sort((a, b) => b.avgScore - a.avgScore);
  renderPerformers('topPerformers', sorted.slice(0, 5), true);
  renderPerformers('bottomPerformers', sorted.slice(-5).reverse(), false);

  // Theme filter
  const themes = [...new Set(sets.map((s) => s.theme.split(' / ')[0]))].sort();
  const themeSelect = document.getElementById('themeFilter');
  themeSelect.innerHTML =
    '<option value="">All Themes</option>' +
    themes.map((t) => `<option value="${t}">${t}</option>`).join('');

  // Last updated
  document.getElementById('lastUpdated').textContent =
    'Updated: ' + new Date(portfolio.summary.last_updated).toLocaleString();

  // Render history chart
  renderHistoryChart();

  // Render AI prediction summary
  renderAIPredictionSummary(sets);

  // Render sets
  filterSets();
}

function renderHistoryChart() {
  if (!priceHistory) {
    document.getElementById('historyChart').parentElement.innerHTML =
      '<div class="text-gray-400 h-64 flex items-center justify-center">No price history data available</div>';
    return;
  }

  const range = document.getElementById('historyRange').value;
  const months = range === 'all' ? 999 : parseInt(range);

  // Aggregate portfolio value by month
  const monthlyData = {};

  // Get all unique dates across all sets
  const allDates = new Set();
  Object.values(priceHistory.sets).forEach((set) => {
    if (set.priceHistory) {
      set.priceHistory.forEach((p) => allDates.add(p.date.substring(0, 7)));
    }
  });

  const sortedDates = Array.from(allDates).sort();
  const recentDates = sortedDates.slice(-months);

  recentDates.forEach((month) => {
    let totalValue = 0;
    Object.entries(portfolio.sets).forEach(([setId, setData]) => {
      const qty = (setData.qty_new || 0) + (setData.qty_used || 0);
      const historySet = priceHistory.sets[setId];
      if (historySet && historySet.priceHistory) {
        const monthData = historySet.priceHistory.find((p) =>
          p.date.startsWith(month)
        );
        if (monthData) {
          totalValue += monthData.newValue * qty;
        } else {
          totalValue += setData.value; // fallback to current value
        }
      } else {
        totalValue += setData.value; // fallback
      }
    });
    monthlyData[month] = totalValue;
  });

  const labels = Object.keys(monthlyData);
  const values = Object.values(monthlyData);

  const ctx = document.getElementById('historyChart').getContext('2d');

  if (historyChart) historyChart.destroy();

  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.map((d) => {
        const [y, m] = d.split('-');
        return new Date(y, m - 1).toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit',
        });
      }),
      datasets: [
        {
          label: 'Portfolio Value (€)',
          data: values,
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 2,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              '€' +
              ctx.raw.toLocaleString('de-DE', { minimumFractionDigits: 2 }),
          },
        },
      },
      scales: {
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#9ca3af',
            callback: (v) => '€' + v.toLocaleString(),
          },
        },
        x: {
          grid: { display: false },
          ticks: { color: '#9ca3af' },
        },
      },
    },
  });
}

function updateHistoryChart() {
  renderHistoryChart();
}

function renderAIPredictionSummary(sets) {
  // Get AI prediction data
  const setsWithAI = sets.filter(
    (s) => s.predictions?.aiConfidence || s.predictions?.aiReasoning
  );

  const aiSection = document.getElementById('aiPredictionSection');
  if (!aiSection) return;

  if (setsWithAI.length === 0) {
    // No AI predictions available
    document.getElementById('aiSetsAnalyzed').textContent = '0';
    document.getElementById('aiAvgConfidence').textContent = 'N/A';
    document.getElementById('aiDataSource').textContent = 'No data';
    document.getElementById('aiLastUpdated').textContent = 'Never';
    document.getElementById('aiConfidenceBadge').className =
      'px-3 py-1 rounded-full text-xs font-medium bg-gray-700/50 text-gray-400';
    document.getElementById('aiConfidenceBadge').textContent = 'No AI Data';
    return;
  }

  // Count confidence levels
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  setsWithAI.forEach((s) => {
    const confidence = (s.predictions?.aiConfidence || '').toLowerCase();
    if (confidence === 'high') highCount++;
    else if (confidence === 'medium') mediumCount++;
    else lowCount++;
  });

  const total = setsWithAI.length;

  // Update counts and progress bars
  document.getElementById('aiHighCount').textContent = highCount;
  document.getElementById('aiMediumCount').textContent = mediumCount;
  document.getElementById('aiLowCount').textContent = lowCount;

  document.getElementById('aiHighBar').style.width =
    ((highCount / total) * 100).toFixed(1) + '%';
  document.getElementById('aiMediumBar').style.width =
    ((mediumCount / total) * 100).toFixed(1) + '%';
  document.getElementById('aiLowBar').style.width =
    ((lowCount / total) * 100).toFixed(1) + '%';

  // Determine overall confidence
  let overallConfidence = 'medium';
  if (highCount > mediumCount && highCount > lowCount) {
    overallConfidence = 'high';
  } else if (lowCount > mediumCount && lowCount > highCount) {
    overallConfidence = 'low';
  }

  // Update confidence badge
  const confidenceBadge = document.getElementById('aiConfidenceBadge');
  const badgeColors = {
    high: 'bg-green-500/20 text-green-400 border border-green-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    low: 'bg-red-500/20 text-red-400 border border-red-500/30',
  };
  confidenceBadge.className =
    'px-3 py-1 rounded-full text-xs font-medium ' + badgeColors[overallConfidence];
  confidenceBadge.textContent =
    overallConfidence.charAt(0).toUpperCase() + overallConfidence.slice(1) + ' Confidence';

  // Update stats
  document.getElementById('aiSetsAnalyzed').textContent = setsWithAI.length;
  document.getElementById('aiAvgConfidence').textContent =
    overallConfidence.charAt(0).toUpperCase() + overallConfidence.slice(1);

  // Get source and timestamp from cache
  if (aiPredictions && aiPredictions.metadata) {
    document.getElementById('aiDataSource').textContent =
      aiPredictions.metadata.source || 'OpenAI';
    if (aiPredictions.metadata.lastUpdated) {
      document.getElementById('aiLastUpdated').textContent = new Date(
        aiPredictions.metadata.lastUpdated
      ).toLocaleString();
    }
  } else if (setsWithAI[0]?.predictions?.aiSource) {
    document.getElementById('aiDataSource').textContent =
      setsWithAI[0].predictions.aiSource;
    if (setsWithAI[0].predictions.aiCachedAt) {
      document.getElementById('aiLastUpdated').textContent = new Date(
        setsWithAI[0].predictions.aiCachedAt
      ).toLocaleString();
    }
  }

  // Create reasoning summary from top predictions
  const reasoningSamples = setsWithAI
    .filter((s) => s.predictions?.aiReasoning)
    .slice(0, 3)
    .map((s) => `• ${s.name}: ${(s.predictions.aiReasoning || '').slice(0, 100)}...`);

  if (reasoningSamples.length > 0) {
    document.getElementById('aiReasoningSummary').innerHTML =
      '<strong>Recent AI insights:</strong><br>' +
      reasoningSamples.join('<br>') +
      '<br><span class="text-gray-400 text-xs mt-1 block">Click on any set for detailed AI reasoning.</span>';
  }
}

function renderProjectedPerformers(containerId, sets, isTop) {
  const container = document.getElementById(containerId);
  container.innerHTML = sets
    .map((s, i) => {
      const growth = s.predictions?.growth1yr || 15;
      const color =
        growth > 20
          ? 'text-green-400'
          : growth > 10
            ? 'text-yellow-400'
            : 'text-red-400';
      const value1yr = s.predictions?.['1yr']?.value || s.value * 1.15;
      return `
      <div class="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-700/50 transition" onclick="showDetail('${s.id}')">
        <div class="flex items-center gap-3">
          <span class="text-gray-500 text-sm w-5">${i + 1}</span>
          <div>
            <div class="font-medium text-sm">${s.name}</div>
            <div class="text-xs text-gray-400">Current: €${s.value.toFixed(0)}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-bold ${color}">+${growth.toFixed(1)}%</div>
          <div class="text-xs text-purple-400">→ €${value1yr.toFixed(0)}</div>
        </div>
      </div>
    `;
    })
    .join('');
}

function renderPerformers(containerId, sets, isTop) {
  const container = document.getElementById(containerId);
  container.innerHTML = sets
    .map((s, i) => {
      const color = isTop ? 'text-green-400' : 'text-red-400';
      const icon = isTop ? '↑' : '↓';
      return `
      <div class="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-700/50 transition" onclick="showDetail('${s.id}')">
        <div class="flex items-center gap-3">
          <span class="text-gray-500 text-sm w-5">${isTop ? i + 1 : ''}</span>
          <div>
            <div class="font-medium text-sm">${s.name}</div>
            <div class="text-xs text-gray-400">${s.analysis.thesis?.slice(0, 50)}...</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-bold ${color}">${s.avgScore.toFixed(1)}/10</div>
          <div class="text-xs ${s.growth_pct >= 0 ? 'text-green-400' : 'text-red-400'}">${icon} ${s.growth_pct.toFixed(1)}%</div>
        </div>
      </div>
    `;
    })
    .join('');
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.classList.remove('tab-active', 'text-blue-400');
    btn.classList.add('text-gray-400');
  });
  document.querySelector(`[data-tab="${tab}"]`).classList.add('tab-active');
  document
    .querySelector(`[data-tab="${tab}"]`)
    .classList.remove('text-gray-400');
  filterSets();
}

function filterByAction(action) {
  currentTab = action.toLowerCase();
  switchTab(currentTab);
}

function filterSets() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const theme = document.getElementById('themeFilter').value;
  const sortBy = document.getElementById('sortBy').value;

  let sets = Object.entries(portfolio.sets).map(([id, data]) => {
    const a = analysis[id] || {};
    const avgScore =
      ((a.license || 0) +
        (a.retirement || 0) +
        (a.appeal || 0) +
        (a.liquidity || 0)) /
      4;
    // Merge AI predictions with existing predictions
    const predictions = getSetPredictions(id, { ...a, currentValue: data.value });
    return { id, ...data, analysis: a, avgScore, predictions };
  });

  // Filter by tab
  if (currentTab !== 'all') {
    sets = sets.filter((s) => s.analysis.action?.toLowerCase() === currentTab);
  }

  // Filter by search
  if (search) {
    sets = sets.filter(
      (s) =>
        s.name.toLowerCase().includes(search) ||
        s.theme.toLowerCase().includes(search)
    );
  }

  // Filter by theme
  if (theme) {
    sets = sets.filter((s) => s.theme.startsWith(theme));
  }

  // Sort
  if (sortBy === 'score') sets.sort((a, b) => b.avgScore - a.avgScore);
  else if (sortBy === 'growth')
    sets.sort((a, b) => b.growth_pct - a.growth_pct);
  else if (sortBy === 'projected')
    sets.sort(
      (a, b) =>
        (b.predictions?.growth1yr || 15) - (a.predictions?.growth1yr || 15)
    );
  else if (sortBy === 'value') sets.sort((a, b) => b.value - a.value);
  else if (sortBy === 'name') sets.sort((a, b) => a.name.localeCompare(b.name));

  renderSets(sets);
}

function renderSets(sets) {
  const grid = document.getElementById('setsGrid');
  grid.innerHTML = sets
    .map((s) => {
      const action = s.analysis.action || 'UNKNOWN';
      const actionColors = {
        BUY: 'bg-green-500/20 text-green-400 border-green-500/30',
        HOLD: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        SELL: 'bg-red-500/20 text-red-400 border-red-500/30',
      };
      const actionIcons = { BUY: '🟢', HOLD: '⏳', SELL: '🔴' };
      const growthColor = s.growth_pct >= 0 ? 'text-green-400' : 'text-red-400';
      const entryColors = {
        excellent: 'text-green-400',
        good: 'text-blue-400',
        fair: 'text-yellow-400',
        poor: 'text-red-400',
      };
      const projected1yr = s.predictions?.['1yr']?.value || s.value * 1.15;
      const projectedGrowth = s.predictions?.growth1yr || 15;

      return `
      <div class="card rounded-xl p-4 cursor-pointer hover:bg-white/10 transition" onclick="showDetail('${s.id}')">
        <div class="flex justify-between items-start mb-3">
          <div class="flex-1">
            <h3 class="font-semibold text-white">${s.name}</h3>
            <p class="text-xs text-gray-400">${s.theme}</p>
          </div>
          <span class="px-2 py-1 rounded-full text-xs font-medium border ${actionColors[action] || 'bg-gray-500/20'}">
            ${actionIcons[action] || '❓'} ${action}
          </span>
        </div>

        <div class="grid grid-cols-3 gap-2 mb-3">
          <div>
            <div class="text-xs text-gray-400">Value</div>
            <div class="font-bold text-sm">€${s.value.toLocaleString('de-DE', { minimumFractionDigits: 0 })}</div>
          </div>
          <div>
            <div class="text-xs text-gray-400">Growth</div>
            <div class="font-bold text-sm ${growthColor}">${s.growth_pct >= 0 ? '+' : ''}${s.growth_pct.toFixed(1)}%</div>
          </div>
          <div>
            <div class="text-xs text-purple-400 flex items-center gap-1">🔮 1yr</div>
            <div class="font-bold text-sm text-purple-400">+${projectedGrowth.toFixed(0)}%</div>
          </div>
        </div>

        <div class="flex items-center justify-between text-sm">
          <div class="flex items-center gap-2">
            <span class="text-gray-400">Score:</span>
            <span class="font-bold text-blue-400">${s.avgScore.toFixed(1)}/10</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-gray-400">Entry:</span>
            <span class="${entryColors[s.analysis.entry] || 'text-gray-400'}">${s.analysis.entry || '-'}</span>
          </div>
        </div>

        <div class="mt-3 pt-3 border-t border-gray-700">
          <p class="text-xs text-gray-400 line-clamp-2">${s.analysis.thesis || 'No analysis available'}</p>
        </div>
      </div>
    `;
    })
    .join('');
}

function showDetail(id) {
  const s = { id, ...portfolio.sets[id], analysis: analysis[id] || {} };
  const avgScore =
    ((s.analysis.license || 0) +
      (s.analysis.retirement || 0) +
      (s.analysis.appeal || 0) +
      (s.analysis.liquidity || 0)) /
    4;
  // Merge AI predictions with existing predictions
  const predictions = getSetPredictions(id, { ...s.analysis, currentValue: s.value });
  // Get eBay market stats
  const ebayStats = getEbayMarketStats(id);

  const actionColors = {
    BUY: 'bg-green-500 text-white',
    HOLD: 'bg-yellow-500 text-black',
    SELL: 'bg-red-500 text-white',
  };
  const entryColors = {
    excellent: 'bg-green-500/20 text-green-400',
    good: 'bg-blue-500/20 text-blue-400',
    fair: 'bg-yellow-500/20 text-yellow-400',
    poor: 'bg-red-500/20 text-red-400',
  };
  const growthColor = s.growth_pct >= 0 ? 'text-green-400' : 'text-red-400';

  // BrickEconomy predictions (from deep-analysis.json)
  const brickEconomyPred = s.analysis.predictions || {};
  const bePred1yr = brickEconomyPred['1yr']?.value || s.value * 1.15;
  const bePred5yr = brickEconomyPred['5yr']?.value || s.value * 1.8;
  const beGrowth1yr = brickEconomyPred.growth1yr || ((bePred1yr - s.value) / s.value) * 100;
  const beGrowth5yr = brickEconomyPred.growth5yr || ((bePred5yr - s.value) / s.value) * 100;

  // AI predictions (from ai-predictions-cache.json, merged via getSetPredictions)
  const hasAiPrediction = predictions.aiConfidence || predictions.aiReasoning;
  const aiPred1yr = predictions['1yr']?.value || bePred1yr;
  const aiPred5yr = predictions['5yr']?.value || bePred5yr;
  const aiGrowth1yr = predictions.growth1yr || beGrowth1yr;
  const aiGrowth5yr = predictions.growth5yr || beGrowth5yr;

  // Build AI Prediction section HTML
  let aiPredictionSection = '';
  if (hasAiPrediction) {
    const confidenceColors = {
      high: 'bg-green-500/20 text-green-400 border-green-500/30',
      medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      low: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
    const confidenceLevel = (predictions.aiConfidence || 'medium').toLowerCase();
    aiPredictionSection = `
    <!-- AI Prediction Section -->
    <div class="bg-gradient-to-br from-cyan-900/30 to-blue-900/30 rounded-xl p-4 mb-6 border border-cyan-500/20">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="text-xl">🤖</span>
          <h3 class="font-semibold">AI Price Prediction</h3>
          <span class="px-2 py-0.5 rounded-full text-xs border ${confidenceColors[confidenceLevel]}">${predictions.aiConfidence || 'Medium'} Confidence</span>
        </div>
        <span class="text-xs text-gray-400">${predictions.aiSource || 'OpenAI'}</span>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="bg-black/20 rounded-lg p-3">
          <div class="text-xs text-cyan-300">AI 1-Year Estimate</div>
          <div class="text-2xl font-bold text-white">€${aiPred1yr.toFixed(0)}</div>
          <div class="text-sm text-green-400">+${aiGrowth1yr.toFixed(1)}% projected</div>
        </div>
        <div class="bg-black/20 rounded-lg p-3">
          <div class="text-xs text-blue-300">AI 5-Year Estimate</div>
          <div class="text-2xl font-bold text-white">€${aiPred5yr.toFixed(0)}</div>
          <div class="text-sm text-green-400">+${aiGrowth5yr.toFixed(1)}% projected</div>
        </div>
      </div>
      ${predictions.aiReasoning ? `
      <div class="mt-3 p-3 bg-black/20 rounded-lg">
        <div class="text-xs text-cyan-400 mb-1">AI Reasoning:</div>
        <p class="text-sm text-gray-300">${predictions.aiReasoning}</p>
      </div>
      ` : ''}
      <p class="text-xs text-gray-400 mt-3">
        AI prediction powered by ${predictions.aiSource || 'OpenAI'}.
        ${predictions.aiCachedAt ? `Last updated: ${new Date(predictions.aiCachedAt).toLocaleDateString()}` : ''}
      </p>
    </div>
    `;
  }

  // Build eBay Market Stats section HTML
  let ebaySection = '';
  if (ebayStats && ebayStats.count > 0) {
    ebaySection = `
    <!-- eBay Market Stats Section -->
    <div class="bg-gradient-to-br from-orange-900/30 to-red-900/30 rounded-xl p-4 mb-6 border border-orange-500/20">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="text-xl">🛒</span>
          <h3 class="font-semibold">eBay Market Data</h3>
          <span class="px-2 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30">Live Data</span>
        </div>
        <span class="text-xs text-gray-400">${ebayStats.count} sold listings</span>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="bg-black/20 rounded-lg p-3">
          <div class="text-xs text-orange-300">Market Value</div>
          <div class="text-xl font-bold text-white">€${ebayStats.marketValue?.toFixed(0) || 'N/A'}</div>
        </div>
        <div class="bg-black/20 rounded-lg p-3">
          <div class="text-xs text-orange-300">Average</div>
          <div class="text-xl font-bold text-white">€${ebayStats.mean?.toFixed(0) || 'N/A'}</div>
        </div>
        <div class="bg-black/20 rounded-lg p-3">
          <div class="text-xs text-green-300">Low</div>
          <div class="text-xl font-bold text-green-400">€${ebayStats.min?.toFixed(0) || 'N/A'}</div>
        </div>
        <div class="bg-black/20 rounded-lg p-3">
          <div class="text-xs text-red-300">High</div>
          <div class="text-xl font-bold text-red-400">€${ebayStats.max?.toFixed(0) || 'N/A'}</div>
        </div>
      </div>
      <p class="text-xs text-gray-400 mt-3">
        ${ebayStats.source || 'eBay'} sold listings data.
        ${ebayStats.lastUpdate ? `Last scraped: ${new Date(ebayStats.lastUpdate).toLocaleDateString()}` : ''}
      </p>
    </div>
    `;
  }

  const content = `
    <div class="flex justify-between items-start mb-6">
      <div>
        <h2 class="text-2xl font-bold">${s.name}</h2>
        <p class="text-gray-400">${s.theme} • ${s.id}</p>
      </div>
      <button onclick="closeModal()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="text-xs text-gray-400">Current Value</div>
        <div class="text-xl font-bold">€${s.value.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="text-xs text-gray-400">Paid</div>
        <div class="text-xl font-bold">€${s.paid.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="text-xs text-gray-400">Growth</div>
        <div class="text-xl font-bold ${growthColor}">${s.growth_pct >= 0 ? '+' : ''}${s.growth_pct.toFixed(2)}%</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="text-xs text-gray-400">Quantity</div>
        <div class="text-xl font-bold">${s.qty_new} new / ${s.qty_used} used</div>
      </div>
    </div>

    ${ebaySection}

    ${aiPredictionSection}

    <!-- BrickEconomy Predictions Section -->
    <div class="bg-gradient-to-br from-purple-900/30 to-indigo-900/30 rounded-xl p-4 mb-6 border border-purple-500/20">
      <div class="flex items-center gap-2 mb-4">
        <span class="text-xl">🔮</span>
        <h3 class="font-semibold">BrickEconomy ML Predictions</h3>
        <span class="prediction-badge px-2 py-0.5 rounded-full text-xs">Data-driven estimates</span>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="bg-black/20 rounded-lg p-3">
          <div class="text-xs text-purple-300">1-Year Estimate</div>
          <div class="text-2xl font-bold text-white">€${bePred1yr.toFixed(0)}</div>
          <div class="text-sm text-green-400">+${beGrowth1yr.toFixed(1)}% projected</div>
        </div>
        <div class="bg-black/20 rounded-lg p-3">
          <div class="text-xs text-indigo-300">5-Year Estimate</div>
          <div class="text-2xl font-bold text-white">€${bePred5yr.toFixed(0)}</div>
          <div class="text-sm text-green-400">+${beGrowth5yr.toFixed(1)}% projected</div>
        </div>
      </div>
      <p class="text-xs text-gray-400 mt-3">
        Predictions based on BrickEconomy's machine learning model trained on historical LEGO market data.
        Not financial advice.
      </p>
    </div>

    <div class="flex gap-3 mb-6">
      <span class="px-4 py-2 rounded-lg font-bold ${actionColors[s.analysis.action] || 'bg-gray-500'}">${s.analysis.action || 'N/A'}</span>
      <span class="px-4 py-2 rounded-lg ${entryColors[s.analysis.entry] || 'bg-gray-500/20'}">Entry: ${s.analysis.entry || '-'}</span>
      <span class="px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400">Confidence: ${s.analysis.confidence || '-'}</span>
    </div>

    <div class="bg-gray-800 rounded-lg p-4 mb-6">
      <h3 class="font-semibold mb-2">🧠 Analysis Summary</h3>
      <p class="text-gray-300">${s.analysis.thesis || 'No analysis available'}</p>
    </div>

    <div class="mb-6">
      <h3 class="font-semibold mb-3">📊 Score Breakdown</h3>
      <div class="space-y-3">
        ${renderScoreBar('License Strength', s.analysis.license)}
        ${renderScoreBar('Retirement Risk', s.analysis.retirement)}
        ${renderScoreBar('Collector Appeal', s.analysis.appeal)}
        ${renderScoreBar('Market Liquidity', s.analysis.liquidity)}
      </div>
      <div class="mt-4 p-3 bg-blue-500/20 rounded-lg flex justify-between items-center">
        <span class="font-semibold">Overall Investment Score</span>
        <span class="text-2xl font-bold text-blue-400">${avgScore.toFixed(1)}/10</span>
      </div>
    </div>

    ${s.purchaseDate ? `<div class="bg-gray-800 rounded-lg p-4 mb-4"><span class="text-gray-400">📅 Purchase Date:</span> <span class="text-white">${s.purchaseDate}</span></div>` : ''}
    ${s.notes ? `<div class="bg-gray-800 rounded-lg p-4"><h3 class="font-semibold mb-2">📝 Notes</h3><p class="text-gray-300">${s.notes}</p></div>` : ''}
  `;

  document.getElementById('modalContent').innerHTML = content;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
}

function renderScoreBar(label, value) {
  const pct = ((value || 0) / 10) * 100;
  const color =
    value >= 7 ? 'bg-green-500' : value >= 4 ? 'bg-yellow-500' : 'bg-red-500';
  return `
    <div class="flex items-center gap-3">
      <span class="text-sm text-gray-400 w-32">${label}</span>
      <div class="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
        <div class="${color} h-full rounded-full" style="width: ${pct}%"></div>
      </div>
      <span class="text-sm font-bold w-8">${value || 0}</span>
    </div>
  `;
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal').classList.remove('flex');
}

function refreshData() {
  loadData();
}

// Make functions available globally for onclick handlers in HTML
window.showDetail = showDetail;
window.closeModal = closeModal;
window.refreshData = refreshData;
window.switchTab = switchTab;
window.filterByAction = filterByAction;
window.filterSets = filterSets;
window.updateHistoryChart = updateHistoryChart;

// Close modal on background click
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Initialize
loadData();
