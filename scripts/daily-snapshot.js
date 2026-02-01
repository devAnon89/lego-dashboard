#!/usr/bin/env node
/**
 * Daily Portfolio Snapshot Script
 * Saves a snapshot of the current portfolio value for historical tracking
 * 
 * Usage: node daily-snapshot.js
 * Can be run via cron daily
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const snapshotsDir = path.join(dataDir, 'snapshots');

// Ensure snapshots directory exists
if (!fs.existsSync(snapshotsDir)) {
  fs.mkdirSync(snapshotsDir, { recursive: true });
}

// Load current portfolio
const portfolioPath = path.join(dataDir, 'portfolio.json');
const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));

// Generate snapshot
const today = new Date().toISOString().split('T')[0];
const snapshot = {
  date: today,
  timestamp: new Date().toISOString(),
  summary: {
    totalValue: portfolio.summary.total_current,
    totalPaid: portfolio.summary.total_paid,
    totalGain: portfolio.summary.total_gain_eur,
    totalGainPct: portfolio.summary.total_gain_pct,
    setCount: Object.keys(portfolio.sets).length
  },
  setValues: {}
};

// Record individual set values
for (const [setId, setData] of Object.entries(portfolio.sets)) {
  snapshot.setValues[setId] = {
    name: setData.name,
    value: setData.value,
    qty: setData.qty_new + setData.qty_used,
    growthPct: setData.growth_pct
  };
}

// Save snapshot
const snapshotPath = path.join(snapshotsDir, `${today}.json`);
fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
console.log(`Snapshot saved: ${snapshotPath}`);

// Also update/create the history index file
const historyPath = path.join(snapshotsDir, 'history.json');
let history = [];

if (fs.existsSync(historyPath)) {
  try {
    history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
  } catch (e) {
    history = [];
  }
}

// Add today's summary to history (avoid duplicates)
const existingIndex = history.findIndex(h => h.date === today);
const historyEntry = {
  date: today,
  totalValue: snapshot.summary.totalValue,
  totalGainPct: snapshot.summary.totalGainPct,
  setCount: snapshot.summary.setCount
};

if (existingIndex >= 0) {
  history[existingIndex] = historyEntry;
} else {
  history.push(historyEntry);
}

// Sort by date
history.sort((a, b) => a.date.localeCompare(b.date));

fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
console.log(`History updated: ${historyPath}`);
console.log(`Total snapshots: ${history.length}`);
console.log(`Current portfolio value: €${snapshot.summary.totalValue.toFixed(2)}`);
