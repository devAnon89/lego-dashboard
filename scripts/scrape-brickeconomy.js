#!/usr/bin/env node
/**
 * BrickEconomy Scraper Script
 * Extracts price history and future predictions from BrickEconomy set pages
 * 
 * Usage: Run from the browser console while on a set page, or use with Puppeteer
 */

const fs = require('fs');
const path = require('path');

// Portfolio set IDs
const portfolioFile = path.join(__dirname, '..', 'data', 'portfolio.json');
const portfolio = JSON.parse(fs.readFileSync(portfolioFile, 'utf-8'));
const setIds = Object.keys(portfolio.sets);

/**
 * Extract data from BrickEconomy page - meant to be run in browser context
 * Returns: { priceHistory: [], predictions: {}, currentValue: number }
 */
function extractSetDataFromPage() {
  const data = {
    priceHistory: [],
    predictions: {},
    currentValue: null,
    setInfo: {}
  };
  
  // Find the price history table
  const chartTables = document.querySelectorAll('table');
  let priceTable = null;
  
  for (const table of chartTables) {
    const rows = table.querySelectorAll('tr');
    if (rows.length > 10) {
      const firstCell = rows[1]?.querySelector('td')?.textContent || '';
      if (firstCell.match(/\w+ \d+, \d{4}/)) {
        priceTable = table;
        break;
      }
    }
  }
  
  if (priceTable) {
    const rows = priceTable.querySelectorAll('tbody tr');
    const today = new Date();
    
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 5) {
        const dateStr = cells[0]?.textContent?.trim();
        const retailPrice = parseFloat(cells[1]?.textContent?.replace(/[^0-9.]/g, '')) || null;
        const rrp = parseFloat(cells[2]?.textContent?.replace(/[^0-9.]/g, '')) || null;
        const newSealedValue = parseFloat(cells[3]?.textContent?.replace(/[^0-9.]/g, '')) || null;
        const usedValue = parseFloat(cells[4]?.textContent?.replace(/[^0-9.]/g, '')) || null;
        
        // Parse date
        if (dateStr) {
          const parsedDate = new Date(dateStr);
          if (!isNaN(parsedDate.getTime())) {
            const entry = {
              date: parsedDate.toISOString().split('T')[0],
              newValue: newSealedValue,
              usedValue: usedValue
            };
            
            // Check if this is future data (prediction)
            if (parsedDate > today) {
              const monthsFromNow = Math.round((parsedDate - today) / (30 * 24 * 60 * 60 * 1000));
              if (monthsFromNow <= 12) {
                data.predictions['1yr'] = { value: newSealedValue, date: entry.date };
              } else if (monthsFromNow <= 60) {
                data.predictions['5yr'] = { value: newSealedValue, date: entry.date };
              }
            } else {
              data.priceHistory.push(entry);
            }
          }
        }
      }
    });
  }
  
  // Get current value from the "Today" line
  const todayText = document.body.innerText;
  const todayMatch = todayText.match(/Today €([\d,]+(?:\.\d+)?)/);
  if (todayMatch) {
    data.currentValue = parseFloat(todayMatch[1].replace(',', '.'));
  }
  
  // Get set info
  const h1 = document.querySelector('h1');
  if (h1) {
    data.setInfo.name = h1.textContent.replace(/^\d+\s+LEGO\s+\w+\s+/, '');
  }
  
  return data;
}

// Export for use as module
module.exports = { extractSetDataFromPage, setIds };

// If run directly, output set IDs
if (require.main === module) {
  console.log('Portfolio sets to scrape:');
  setIds.forEach(id => {
    const set = portfolio.sets[id];
    const baseId = id.replace('-1', '');
    const nameSlug = set.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const url = `https://www.brickeconomy.com/set/${id}/lego-${nameSlug}`;
    console.log(`${id}: ${set.name}`);
    console.log(`  URL: ${url}`);
  });
}
