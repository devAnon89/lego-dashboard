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

// Save updated history
fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

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

console.log(`\n✅ History saved: ${historyPath}`);
