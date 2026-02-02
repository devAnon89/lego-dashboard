#!/usr/bin/env node
/**
 * Retirement Tracker Script
 * Compares current deep-analysis with previous snapshots to track retirement risk changes
 *
 * Usage: node retirement-tracker.js
 * Tracks retirement_risk, retirement_window, and retirement_confidence over time
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

/**
 * Calculate accuracy metrics by comparing predictions with actual retirement status
 * @param {Object} history - Historical retirement tracking data
 * @param {Object} currentAnalysis - Current deep analysis data
 * @param {string} today - Today's date in ISO format
 * @returns {Object} Accuracy metrics
 */
function calculateAccuracyMetrics(history, currentAnalysis, today) {
  const metrics = {
    last_updated: today,
    total_predictions: 0,
    correct_predictions: 0,
    false_positives: 0,
    still_monitoring: 0,
    retired_sets: 0,
    prediction_hit_rate: 0,
    details: []
  };

  // Get list of currently available sets
  const currentSetIds = new Set(
    Object.keys(currentAnalysis).filter(id => id !== 'metadata' && id !== 'accuracy_metrics')
  );

  // Check each set in history
  for (const [setId, data] of Object.entries(history)) {
    // Skip special keys
    if (setId === 'accuracy_metrics' || setId === 'metadata') continue;

    if (!data.history || data.history.length === 0) continue;

    // Find predictions with high retirement risk (score >= 7) or specific retirement window
    for (let i = 0; i < data.history.length; i++) {
      const entry = data.history[i];

      // Consider it a prediction if retirement score >= 7 or has a retirement window
      if (entry.retirement_score >= 7 || entry.retirement_window) {
        metrics.total_predictions++;

        const predictionDate = new Date(entry.date);
        const daysSincePrediction = Math.floor((new Date(today) - predictionDate) / (1000 * 60 * 60 * 24));

        // Determine expected retirement timeframe in days
        let expectedDays = 365; // Default to 1 year
        if (entry.retirement_window) {
          const window = entry.retirement_window.toLowerCase();
          if (window.includes('q1') || window.includes('q2') || window.includes('q3') || window.includes('q4')) {
            expectedDays = 180; // 6 months for quarterly predictions
          } else if (window.includes('month')) {
            const months = parseInt(window.match(/\d+/)?.[0] || '6');
            expectedDays = months * 30;
          }
        }

        // Check if set has retired (no longer in current analysis)
        const hasRetired = !currentSetIds.has(setId);

        if (hasRetired) {
          metrics.retired_sets++;
          // Check if it retired within the predicted window
          if (daysSincePrediction <= expectedDays) {
            metrics.correct_predictions++;
            metrics.details.push({
              set_id: setId,
              name: data.name,
              prediction_date: entry.date,
              retirement_score: entry.retirement_score,
              retirement_window: entry.retirement_window,
              status: 'correct',
              days_to_retirement: daysSincePrediction
            });
          }
        } else {
          // Still available
          if (daysSincePrediction > expectedDays) {
            // Predicted to retire but didn't within window
            metrics.false_positives++;
            metrics.details.push({
              set_id: setId,
              name: data.name,
              prediction_date: entry.date,
              retirement_score: entry.retirement_score,
              retirement_window: entry.retirement_window,
              status: 'false_positive',
              days_since_prediction: daysSincePrediction
            });
          } else {
            // Still within prediction window
            metrics.still_monitoring++;
          }
        }

        // Only count the most recent high-risk prediction for each set
        break;
      }
    }
  }

  // Calculate hit rate
  if (metrics.total_predictions > 0) {
    const completedPredictions = metrics.correct_predictions + metrics.false_positives;
    if (completedPredictions > 0) {
      metrics.prediction_hit_rate = Math.round((metrics.correct_predictions / completedPredictions) * 100);
    }
  }

  // Limit details to most recent 20 entries
  metrics.details = metrics.details.slice(-20);

  return metrics;
}

// Load current deep analysis
const deepAnalysisPath = path.join(dataDir, 'deep-analysis.json');
if (!fs.existsSync(deepAnalysisPath)) {
  console.error('Error: deep-analysis.json not found. Run deep-analysis.js first.');
  process.exit(1);
}

const deepAnalysis = JSON.parse(fs.readFileSync(deepAnalysisPath, 'utf-8'));

// Load or create retirement history
const historyPath = path.join(dataDir, 'retirement-history.json');
let history = {};

if (fs.existsSync(historyPath)) {
  try {
    history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
  } catch (e) {
    console.error('Warning: Could not parse retirement-history.json, starting fresh');
    history = {};
  }
}

// Generate today's tracking data
const today = new Date().toISOString().split('T')[0];
const timestamp = new Date().toISOString();

let changesDetected = 0;
let newSetsTracked = 0;

// Process each set in deep analysis
for (const [setId, analysis] of Object.entries(deepAnalysis)) {
  // Skip metadata
  if (setId === 'metadata') continue;

  // Initialize history for this set if it doesn't exist
  if (!history[setId]) {
    history[setId] = {
      name: analysis.name || setId,
      history: []
    };
    newSetsTracked++;
  }

  // Extract retirement metrics
  const retirementScore = analysis.retirement || 0;
  const retirementWindow = analysis.retirement_window || null;
  const retirementConfidence = analysis.retirement_confidence || analysis.confidence_level || null;

  // Check if this is a new entry or has changed
  const lastEntry = history[setId].history[history[setId].history.length - 1];

  let hasChanged = false;
  if (!lastEntry) {
    hasChanged = true;
  } else {
    // Detect significant changes
    const scoreDiff = Math.abs(lastEntry.retirement_score - retirementScore);
    const windowChanged = lastEntry.retirement_window !== retirementWindow;
    const confidenceChanged = lastEntry.retirement_confidence !== retirementConfidence;

    hasChanged = scoreDiff >= 1 || windowChanged || confidenceChanged;
  }

  // Add entry if changed or first time
  if (hasChanged) {
    history[setId].history.push({
      date: today,
      timestamp: timestamp,
      retirement_score: retirementScore,
      retirement_window: retirementWindow,
      retirement_confidence: retirementConfidence
    });

    if (lastEntry) {
      changesDetected++;
    }
  }
}

// Calculate accuracy metrics
const accuracyMetrics = calculateAccuracyMetrics(history, deepAnalysis, today);

// Prepare history with metadata
const historyToSave = {};

// Add accuracy_metrics first
historyToSave.accuracy_metrics = accuracyMetrics;

// Add all set histories
for (const [setId, data] of Object.entries(history)) {
  if (setId !== 'accuracy_metrics' && setId !== 'metadata') {
    historyToSave[setId] = data;
  }
}

// Save updated history
fs.writeFileSync(historyPath, JSON.stringify(historyToSave, null, 2));

// Generate summary
console.log('🔍 Retirement Tracker Results');
console.log('='.repeat(50));
console.log(`Date: ${today}`);
console.log(`Sets tracked: ${Object.keys(history).length}`);
console.log(`New sets: ${newSetsTracked}`);
console.log(`Changes detected: ${changesDetected}`);

// Show sets with high retirement risk (>= 7)
const highRiskSets = [];
for (const [setId, data] of Object.entries(history)) {
  // Skip special keys
  if (setId === 'accuracy_metrics' || setId === 'metadata') continue;

  const lastEntry = data.history[data.history.length - 1];
  if (lastEntry && lastEntry.retirement_score >= 7) {
    highRiskSets.push({
      id: setId,
      name: data.name,
      score: lastEntry.retirement_score,
      window: lastEntry.retirement_window,
      confidence: lastEntry.retirement_confidence
    });
  }
}

if (highRiskSets.length > 0) {
  console.log('\n⚠️  HIGH RETIREMENT RISK SETS (score >= 7):');
  highRiskSets.sort((a, b) => b.score - a.score);
  highRiskSets.forEach(set => {
    const window = set.window ? ` - Est. ${set.window}` : '';
    const conf = set.confidence ? ` (${set.confidence} confidence)` : '';
    console.log(`  • ${set.name}: ${set.score}/10${window}${conf}`);
  });
}

// Show recent changes if any
if (changesDetected > 0) {
  console.log('\n📊 RECENT CHANGES:');
  let changesShown = 0;
  for (const [setId, data] of Object.entries(history)) {
    if (data.history.length >= 2) {
      const current = data.history[data.history.length - 1];
      const previous = data.history[data.history.length - 2];

      if (current.date === today) {
        const scoreDiff = current.retirement_score - previous.retirement_score;
        if (scoreDiff !== 0) {
          const arrow = scoreDiff > 0 ? '↑' : '↓';
          const color = scoreDiff > 0 ? '🔴' : '🟢';
          console.log(`  ${color} ${data.name}: ${previous.retirement_score} → ${current.retirement_score} ${arrow}`);
          changesShown++;
          if (changesShown >= 10) break;
        }
      }
    }
  }
}

// Display accuracy metrics
if (accuracyMetrics.total_predictions > 0) {
  console.log('\n📈 PREDICTION ACCURACY:');
  console.log(`  Total predictions made: ${accuracyMetrics.total_predictions}`);
  console.log(`  Correct predictions: ${accuracyMetrics.correct_predictions}`);
  console.log(`  False positives: ${accuracyMetrics.false_positives}`);
  console.log(`  Still monitoring: ${accuracyMetrics.still_monitoring}`);
  console.log(`  Sets retired: ${accuracyMetrics.retired_sets}`);

  if (accuracyMetrics.prediction_hit_rate > 0) {
    const emoji = accuracyMetrics.prediction_hit_rate >= 70 ? '🎯' : accuracyMetrics.prediction_hit_rate >= 50 ? '✓' : '⚠️';
    console.log(`  ${emoji} Hit rate: ${accuracyMetrics.prediction_hit_rate}%`);
  }

  // Show recent correct predictions
  const correctPredictions = accuracyMetrics.details.filter(d => d.status === 'correct');
  if (correctPredictions.length > 0) {
    console.log('\n  ✅ Recent correct predictions:');
    correctPredictions.slice(-5).forEach(detail => {
      console.log(`    • ${detail.name}: predicted ${detail.prediction_date}, retired after ${detail.days_to_retirement} days`);
    });
  }

  // Show false positives
  const falsePredictions = accuracyMetrics.details.filter(d => d.status === 'false_positive');
  if (falsePredictions.length > 0) {
    console.log('\n  ❌ False positives (still available):');
    falsePredictions.slice(-5).forEach(detail => {
      console.log(`    • ${detail.name}: predicted ${detail.prediction_date}, still available after ${detail.days_since_prediction} days`);
    });
  }
}

console.log(`\n✅ History saved: ${historyPath}`);
