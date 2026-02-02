#!/usr/bin/env node
/**
 * Retirement Alerts Script
 * Detects significant retirement risk changes and generates actionable alerts
 *
 * Usage: node scripts/retirement-alerts.js
 * Alert Types:
 *   - risk_increase: >2 point increase in retirement score
 *   - window_shortened: retirement window moved closer (e.g., 1yr → 6mo)
 *   - announcement_detected: retirement score = 10 (official announcement)
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

// Load retirement history
const historyPath = path.join(dataDir, 'retirement-history.json');
if (!fs.existsSync(historyPath)) {
  console.error('Error: retirement-history.json not found. Run retirement-tracker.js first.');
  process.exit(1);
}

let history = {};
try {
  history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
} catch (e) {
  console.error('Error: Could not parse retirement-history.json');
  process.exit(1);
}

// Load deep analysis for additional context
const deepAnalysisPath = path.join(dataDir, 'deep-analysis.json');
let deepAnalysis = {};
if (fs.existsSync(deepAnalysisPath)) {
  try {
    deepAnalysis = JSON.parse(fs.readFileSync(deepAnalysisPath, 'utf-8'));
  } catch (e) {
    console.error('Warning: Could not parse deep-analysis.json');
  }
}

// Generate alerts
const alerts = [];
const today = new Date().toISOString().split('T')[0];
const timestamp = new Date().toISOString();

// Helper function to parse retirement window into months for comparison
function parseWindowToMonths(window) {
  if (!window) return null;

  const lower = window.toLowerCase();

  // Q1, Q2, Q3, Q4 format
  if (lower.match(/q[1-4]\s+\d{4}/)) {
    const year = parseInt(lower.match(/\d{4}/)[0]);
    const quarter = parseInt(lower.match(/q(\d)/)[1]);
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const quarterMonth = (quarter - 1) * 3 + 2; // Middle month of quarter
    const targetYear = year;

    const monthsDiff = (targetYear - currentYear) * 12 + (quarterMonth - currentMonth);
    return monthsDiff;
  }

  // H1, H2 format (first half, second half)
  if (lower.match(/h[12]\s+\d{4}/)) {
    const year = parseInt(lower.match(/\d{4}/)[0]);
    const half = parseInt(lower.match(/h(\d)/)[1]);
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const halfMonth = half === 1 ? 3 : 9; // March or September
    const targetYear = year;

    const monthsDiff = (targetYear - currentYear) * 12 + (halfMonth - currentMonth);
    return monthsDiff;
  }

  // Direct month patterns like "< 6 months", "6-12 months", "12-24 months", "2+ years"
  if (lower.includes('month')) {
    if (lower.includes('<') || lower.includes('less than')) {
      const num = parseInt(lower.match(/\d+/)?.[0] || '6');
      return num / 2; // Conservative estimate
    }
    if (lower.includes('-')) {
      const nums = lower.match(/\d+/g);
      if (nums && nums.length >= 2) {
        return parseInt(nums[1]); // Use upper bound
      }
    }
    const num = parseInt(lower.match(/\d+/)?.[0] || '12');
    return num;
  }

  if (lower.includes('year')) {
    const num = parseInt(lower.match(/\d+/)?.[0] || '2');
    return num * 12;
  }

  return null;
}

// Process each set in history
for (const [setId, data] of Object.entries(history)) {
  const setHistory = data.history || [];

  // Need at least 2 entries to detect changes
  if (setHistory.length < 2) {
    // Check for announcement detection on first entry
    const current = setHistory[0];
    if (current && current.retirement_score === 10) {
      const setData = deepAnalysis[setId] || {};
      alerts.push({
        id: `${setId}-announcement-${today}`,
        type: 'announcement_detected',
        severity: 'critical',
        set_id: setId,
        set_name: data.name || setId,
        message: `Official LEGO retirement announcement detected for ${data.name || setId}`,
        current_score: current.retirement_score,
        current_window: current.retirement_window,
        confidence: current.retirement_confidence,
        date: today,
        timestamp: timestamp,
        action: 'BUY NOW - Set officially retiring',
        context: setData.thesis || null
      });
    }
    continue;
  }

  // Get the two most recent entries
  const current = setHistory[setHistory.length - 1];
  const previous = setHistory[setHistory.length - 2];

  // Skip if current entry is not from today (no new changes)
  if (current.date !== today) continue;

  const setData = deepAnalysis[setId] || {};

  // ALERT TYPE 1: Risk increase > 2 points
  const scoreDiff = current.retirement_score - previous.retirement_score;
  if (scoreDiff > 2) {
    const severity = scoreDiff >= 5 ? 'critical' : scoreDiff >= 3 ? 'high' : 'medium';
    alerts.push({
      id: `${setId}-risk-increase-${today}`,
      type: 'risk_increase',
      severity: severity,
      set_id: setId,
      set_name: data.name || setId,
      message: `Retirement risk increased significantly for ${data.name || setId}`,
      previous_score: previous.retirement_score,
      current_score: current.retirement_score,
      score_change: scoreDiff,
      current_window: current.retirement_window,
      confidence: current.retirement_confidence,
      date: today,
      timestamp: timestamp,
      action: scoreDiff >= 5 ? 'URGENT: Consider buying immediately' : 'Monitor closely for buy opportunity',
      context: setData.thesis || null
    });
  }

  // ALERT TYPE 2: Window shortened
  const prevMonths = parseWindowToMonths(previous.retirement_window);
  const currMonths = parseWindowToMonths(current.retirement_window);

  if (prevMonths !== null && currMonths !== null && currMonths < prevMonths) {
    const monthsShortened = prevMonths - currMonths;
    // Only alert if shortened by at least 3 months
    if (monthsShortened >= 3) {
      const severity = currMonths <= 6 ? 'critical' : currMonths <= 12 ? 'high' : 'medium';
      alerts.push({
        id: `${setId}-window-shortened-${today}`,
        type: 'window_shortened',
        severity: severity,
        set_id: setId,
        set_name: data.name || setId,
        message: `Retirement window shortened for ${data.name || setId}`,
        previous_window: previous.retirement_window,
        current_window: current.retirement_window,
        months_shortened: monthsShortened,
        current_score: current.retirement_score,
        confidence: current.retirement_confidence,
        date: today,
        timestamp: timestamp,
        action: severity === 'critical' ? 'URGENT: Retiring soon' : 'Plan purchase within window',
        context: setData.thesis || null
      });
    }
  }

  // ALERT TYPE 3: Announcement detected (score = 10)
  if (current.retirement_score === 10 && previous.retirement_score < 10) {
    alerts.push({
      id: `${setId}-announcement-${today}`,
      type: 'announcement_detected',
      severity: 'critical',
      set_id: setId,
      set_name: data.name || setId,
      message: `Official LEGO retirement announcement detected for ${data.name || setId}`,
      previous_score: previous.retirement_score,
      current_score: current.retirement_score,
      current_window: current.retirement_window,
      confidence: current.retirement_confidence,
      date: today,
      timestamp: timestamp,
      action: 'BUY NOW - Set officially retiring',
      context: setData.thesis || null
    });
  }
}

// Sort alerts by severity (critical > high > medium)
const severityOrder = { critical: 0, high: 1, medium: 2 };
alerts.sort((a, b) => {
  const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
  if (severityDiff !== 0) return severityDiff;
  // Within same severity, sort by score_change or current_score
  const aScore = a.score_change || a.current_score || 0;
  const bScore = b.score_change || b.current_score || 0;
  return bScore - aScore;
});

// Save alerts
const alertsPath = path.join(dataDir, 'retirement-alerts.json');
const alertsOutput = {
  metadata: {
    generated_at: timestamp,
    generated_date: today,
    alert_count: alerts.length,
    critical_count: alerts.filter(a => a.severity === 'critical').length,
    high_count: alerts.filter(a => a.severity === 'high').length,
    medium_count: alerts.filter(a => a.severity === 'medium').length
  },
  alerts: alerts
};

fs.writeFileSync(alertsPath, JSON.stringify(alertsOutput, null, 2));

// Generate summary output
console.log('🚨 Retirement Alerts System');
console.log('='.repeat(50));
console.log(`Date: ${today}`);
console.log(`Total alerts: ${alerts.length}`);
console.log(`  Critical: ${alertsOutput.metadata.critical_count}`);
console.log(`  High: ${alertsOutput.metadata.high_count}`);
console.log(`  Medium: ${alertsOutput.metadata.medium_count}`);

if (alerts.length === 0) {
  console.log('\n✅ No new alerts detected today');
} else {
  console.log('\n⚠️  ACTIVE ALERTS:');

  // Show critical alerts
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  if (criticalAlerts.length > 0) {
    console.log('\n🔴 CRITICAL:');
    criticalAlerts.forEach(alert => {
      console.log(`  • ${alert.set_name}`);
      console.log(`    ${alert.message}`);
      console.log(`    Action: ${alert.action}`);
      if (alert.type === 'risk_increase') {
        console.log(`    Score: ${alert.previous_score} → ${alert.current_score} (+${alert.score_change})`);
      } else if (alert.type === 'window_shortened') {
        console.log(`    Window: ${alert.previous_window} → ${alert.current_window}`);
      } else if (alert.type === 'announcement_detected') {
        console.log(`    Score: ${alert.previous_score || 'N/A'} → ${alert.current_score}`);
      }
      if (alert.current_window) {
        console.log(`    Est. Retirement: ${alert.current_window}`);
      }
      console.log('');
    });
  }

  // Show high priority alerts
  const highAlerts = alerts.filter(a => a.severity === 'high');
  if (highAlerts.length > 0) {
    console.log('🟠 HIGH PRIORITY:');
    highAlerts.forEach(alert => {
      console.log(`  • ${alert.set_name}`);
      console.log(`    ${alert.message}`);
      if (alert.type === 'risk_increase') {
        console.log(`    Score: ${alert.previous_score} → ${alert.current_score} (+${alert.score_change})`);
      } else if (alert.type === 'window_shortened') {
        console.log(`    Window: ${alert.previous_window} → ${alert.current_window}`);
      }
      console.log('');
    });
  }

  // Show medium priority alerts (summarized if many)
  const mediumAlerts = alerts.filter(a => a.severity === 'medium');
  if (mediumAlerts.length > 0) {
    console.log('🟡 MEDIUM PRIORITY:');
    const displayCount = Math.min(5, mediumAlerts.length);
    mediumAlerts.slice(0, displayCount).forEach(alert => {
      console.log(`  • ${alert.set_name}: ${alert.message}`);
    });
    if (mediumAlerts.length > displayCount) {
      console.log(`  ... and ${mediumAlerts.length - displayCount} more`);
    }
  }
}

console.log(`\n✅ Alerts saved: ${alertsPath}`);

// Copy files to public/data for web serving
const publicDataDir = path.join(__dirname, '..', 'public', 'data');
if (!fs.existsSync(publicDataDir)) {
  fs.mkdirSync(publicDataDir, { recursive: true });
}

const publicAlertsPath = path.join(publicDataDir, 'retirement-alerts.json');
const publicHistoryPath = path.join(publicDataDir, 'retirement-history.json');

fs.copyFileSync(alertsPath, publicAlertsPath);
fs.copyFileSync(historyPath, publicHistoryPath);

console.log(`✅ Files copied to public/data/`);
console.log(`   - retirement-alerts.json`);
console.log(`   - retirement-history.json`);
