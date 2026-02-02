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
const PURCHASES_FILE = path.join(DATA_DIR, 'purchases.json');

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

function loadPurchases() {
  try {
    return JSON.parse(fs.readFileSync(PURCHASES_FILE, 'utf8'));
  } catch {
    return { purchases: [] };
  }
}

function savePurchases(data) {
  fs.writeFileSync(PURCHASES_FILE, JSON.stringify(data, null, 2));
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      flags[key] = args[i + 1];
      i++;
    }
  }
  return flags;
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

  'add-purchase': (setId, ...flagArgs) => {
    if (!setId) {
      console.log('Usage: lego add-purchase <set_id> --date YYYY-MM-DD --price <price> --qty <qty> --seller <seller> --condition <New|Used>');
      return;
    }

    const flags = parseFlags(flagArgs);

    // Validate required fields
    if (!flags.date || !flags.price || !flags.qty || !flags.seller || !flags.condition) {
      console.log('❌ Missing required fields. All of --date, --price, --qty, --seller, --condition are required.');
      return;
    }

    // Validate condition
    if (flags.condition !== 'New' && flags.condition !== 'Used') {
      console.log('❌ Condition must be either "New" or "Used"');
      return;
    }

    // Load existing purchases
    const data = loadPurchases();

    // Create purchase record
    const purchase = {
      id: Date.now().toString(),
      setId: setId,
      date: flags.date,
      price: parseFloat(flags.price),
      qty: parseInt(flags.qty),
      seller: flags.seller,
      condition: flags.condition,
      notes: flags.notes || ''
    };

    // Add to purchases array
    data.purchases.push(purchase);

    // Save
    savePurchases(data);

    console.log('✅ Purchase recorded successfully');
  },

  purchases: (setId) => {
    if (!setId) {
      console.log('Usage: lego purchases <set_id>');
      return;
    }

    const portfolio = loadPortfolio();
    const data = loadPurchases();

    // Get set name for display
    const set = portfolio.sets[setId] || portfolio.sets[setId + '-1'];
    const setName = set ? set.name : setId;

    // Filter purchases for this set
    const setPurchases = data.purchases.filter(p => p.setId === setId || p.setId === setId + '-1');

    if (setPurchases.length === 0) {
      console.log(`\n📦 ${setName}`);
      console.log('═'.repeat(50));
      console.log('No purchases recorded for this set.');
      console.log('═'.repeat(50));
      return;
    }

    // Sort by date (newest first)
    setPurchases.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Calculate totals
    const totalQty = setPurchases.reduce((sum, p) => sum + p.qty, 0);
    const totalSpent = setPurchases.reduce((sum, p) => sum + (p.price * p.qty), 0);
    const avgPrice = totalSpent / totalQty;

    console.log(`\n📦 ${setName}`);
    console.log('═'.repeat(50));
    console.log(`Total Purchases: ${setPurchases.length} | Total Qty: ${totalQty} | Total Spent: €${totalSpent.toFixed(2)}`);
    console.log(`Average Price: €${avgPrice.toFixed(2)}`);
    console.log('─'.repeat(50));

    setPurchases.forEach(p => {
      console.log(`${p.date} | €${p.price.toFixed(2)} × ${p.qty} = €${(p.price * p.qty).toFixed(2)} | ${p.condition} | ${p.seller}`);
      if (p.notes) {
        console.log(`  Notes: ${p.notes}`);
      }
    });

    console.log('═'.repeat(50));
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
  add-purchase      Record a new purchase
  purchases         View purchase history for a set
  refresh           Re-run AI analysis on all sets
  serve             Start dashboard web server
  help              Show this help

Examples:
  node lego-cli.js status
  node lego-cli.js analyze 75192
  node lego-cli.js recommendations
  node lego-cli.js add-purchase 10316-1 --date 2024-01-15 --price 414 --qty 1 --seller 'BrickLink' --condition 'New'
  node lego-cli.js purchases 10316-1
    `);
  }
};

// Main
const [,, cmd, ...args] = process.argv;
const handler = commands[cmd] || commands.help;
Promise.resolve(handler(...args)).catch(console.error);
