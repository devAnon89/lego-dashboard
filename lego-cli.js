#!/usr/bin/env node
/**
 * LEGO Investment Portfolio CLI
 * AI-powered investment analysis for LEGO sets
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');
const ANALYSIS_FILE = path.join(DATA_DIR, 'deep-analysis.json');

// Load data
function loadPortfolio() {
  return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8'));
}

function loadAnalysis() {
  try {
    return JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Commands
const commands = {
  status: () => {
    const portfolio = loadPortfolio();
    const analysis = loadAnalysis();
    const sets = Object.entries(portfolio.sets);
    
    let totalValue = 0, totalPaid = 0, totalUnits = 0;
    sets.forEach(([id, s]) => {
      const qty = (s.qty_new || 0) + (s.qty_used || 0);
      totalValue += (s.value || 0) * qty;
      totalPaid += (s.paid || 0) * qty;
      totalUnits += qty;
    });
    
    const gain = totalValue - totalPaid;
    const gainPct = totalPaid > 0 ? (gain / totalPaid * 100).toFixed(1) : 0;
    
    const buys = Object.values(analysis).filter(a => a.action === 'BUY').length;
    const holds = Object.values(analysis).filter(a => a.action === 'HOLD').length;
    const sells = Object.values(analysis).filter(a => a.action === 'SELL').length;
    
    console.log('\n🧱 LEGO INVESTMENT PORTFOLIO');
    console.log('═'.repeat(50));
    console.log(`📦 Sets: ${sets.length} unique (${totalUnits} units)`);
    console.log(`💰 Value: €${totalValue.toFixed(2)}`);
    console.log(`💵 Invested: €${totalPaid.toFixed(2)}`);
    console.log(`📈 Gain: €${gain.toFixed(2)} (${gain >= 0 ? '+' : ''}${gainPct}%)`);
    console.log('─'.repeat(50));
    console.log(`🟢 BUY: ${buys}  |  ⏳ HOLD: ${holds}  |  🔴 SELL: ${sells}`);
    console.log('═'.repeat(50));
  },

  analyze: (setId) => {
    if (!setId) {
      console.log('Usage: lego analyze <set_id>');
      return;
    }
    
    const portfolio = loadPortfolio();
    const analysis = loadAnalysis();
    
    const set = portfolio.sets[setId] || portfolio.sets[setId + '-1'];
    const aiAnalysis = analysis[setId] || analysis[setId + '-1'];
    
    if (!set) {
      console.log(`❌ Set ${setId} not found in portfolio`);
      return;
    }
    
    const qty = (set.qty_new || 0) + (set.qty_used || 0);
    const totalValue = (set.value || 0) * qty;
    const totalPaid = (set.paid || 0) * qty;
    const gain = totalValue - totalPaid;
    
    console.log(`\n🧱 ${set.name}`);
    console.log('═'.repeat(50));
    console.log(`Theme: ${set.theme}`);
    console.log(`Retail: €${set.retail} | Paid: €${set.paid} | Value: €${set.value}`);
    console.log(`Qty: ${set.qty_new || 0} new, ${set.qty_used || 0} used`);
    console.log(`P&L: €${gain.toFixed(2)} (${set.growth_pct?.toFixed(1) || 0}%)`);
    
    if (aiAnalysis) {
      console.log('─'.repeat(50));
      console.log('🤖 AI ANALYSIS');
      console.log(`License Strength: ${aiAnalysis.license}/10`);
      console.log(`Retirement Risk: ${aiAnalysis.retirement}/10`);
      console.log(`Collector Appeal: ${aiAnalysis.appeal}/10`);
      console.log(`Market Liquidity: ${aiAnalysis.liquidity}/10`);
      console.log(`Entry Point: ${aiAnalysis.entry}`);
      console.log(`Recommendation: ${aiAnalysis.action} (${aiAnalysis.confidence})`);
      console.log(`Thesis: ${aiAnalysis.thesis}`);
    }
    console.log('═'.repeat(50));
  },

  recommendations: () => {
    const portfolio = loadPortfolio();
    const analysis = loadAnalysis();
    
    const sorted = Object.entries(analysis)
      .map(([id, a]) => ({
        id,
        name: portfolio.sets[id]?.name || id,
        ...a,
        score: ((a.license||0) + (a.retirement||0) + (a.appeal||0) + (a.liquidity||0)) / 4
      }))
      .sort((a, b) => b.score - a.score);
    
    const buys = sorted.filter(a => a.action === 'BUY');
    const sells = sorted.filter(a => a.action === 'SELL');
    
    console.log('\n📊 AI RECOMMENDATIONS');
    console.log('═'.repeat(60));
    
    if (buys.length) {
      console.log('\n🟢 BUY:');
      buys.forEach(a => console.log(`  • ${a.name}: ${a.thesis}`));
    }
    
    if (sells.length) {
      console.log('\n🔴 SELL:');
      sells.forEach(a => console.log(`  • ${a.name}: ${a.thesis}`));
    }
    
    console.log('\n🏆 TOP 5 SCORES:');
    sorted.slice(0, 5).forEach((a, i) => {
      console.log(`  ${i+1}. ${a.name} (${a.score.toFixed(1)}/10)`);
    });
    
    console.log('═'.repeat(60));
  },

  themes: () => {
    const portfolio = loadPortfolio();
    const themes = {};
    
    Object.values(portfolio.sets).forEach(s => {
      const theme = s.theme || 'Unknown';
      if (!themes[theme]) themes[theme] = { count: 0, value: 0 };
      const qty = (s.qty_new || 0) + (s.qty_used || 0);
      themes[theme].count += qty;
      themes[theme].value += (s.value || 0) * qty;
    });
    
    console.log('\n📊 PORTFOLIO BY THEME');
    console.log('═'.repeat(50));
    
    const sorted = Object.entries(themes).sort((a, b) => b[1].value - a[1].value);
    sorted.forEach(([theme, data]) => {
      console.log(`${theme}: ${data.count} sets, €${data.value.toFixed(2)}`);
    });
  },

  refresh: async () => {
    console.log('🔄 Running AI analysis...');
    const { execSync } = require('child_process');
    execSync('node deep-analysis.js', {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env }
    });
  },

  deals: async () => {
    console.log('🔍 Scanning for marketplace deals...');
    const { execSync } = require('child_process');
    execSync('node scripts/deal-finder.js', {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env }
    });
  },

  serve: () => {
    const http = require('http');
    const PORT = process.env.PORT || 3456;
    
    const server = http.createServer((req, res) => {
      let filePath;
      if (req.url === '/' || req.url === '/index.html') {
        filePath = path.join(__dirname, 'public', 'index.html');
      } else if (req.url.startsWith('/data/')) {
        filePath = path.join(__dirname, req.url);
      } else {
        filePath = path.join(__dirname, 'public', req.url);
      }
      
      const ext = path.extname(filePath);
      const contentTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json'
      };
      
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 
          'Content-Type': contentTypes[ext] || 'text/plain',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
      });
    });
    
    server.listen(PORT, () => {
      console.log(`🧱 LEGO Dashboard running at http://localhost:${PORT}`);
    });
  },

  help: () => {
    console.log(`
🧱 LEGO Investment Portfolio CLI

Commands:
  status            Portfolio overview with metrics
  analyze <set_id>  Deep analysis of a specific set
  recommendations   AI-powered buy/sell/hold advice
  themes            Portfolio breakdown by theme
  refresh           Re-run AI analysis on all sets
  deals             Scan marketplaces for watchlist deals
  serve             Start dashboard web server
  help              Show this help

Examples:
  node lego-cli.js status
  node lego-cli.js analyze 75192
  node lego-cli.js recommendations
  node lego-cli.js deals
    `);
  }
};

// Main
const [,, cmd, ...args] = process.argv;
const handler = commands[cmd] || commands.help;
Promise.resolve(handler(...args)).catch(console.error);
