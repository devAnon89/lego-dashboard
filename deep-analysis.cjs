const fs = require('fs');
const path = require('path');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const portfolio = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/portfolio.json'), 'utf8'));

async function analyzeBatch(sets) {
  const setsInfo = sets.map(([id, d]) => 
    `• ${d.name} (${id}): Theme=${d.theme}, Retail=€${d.retail}, Paid=€${d.paid}, Value=€${d.value}, Qty=${d.qty_new}new/${d.qty_used}used, Growth=${d.growth_pct.toFixed(1)}%`
  ).join('\n');

  const prompt = `You are a LEGO investment analyst. Analyze these ${sets.length} LEGO sets:

${setsInfo}

For EACH set, provide:
1. LICENSE_STRENGTH (0-10): IP strength - Disney/LOTR/Ferrari = strong
2. RETIREMENT_RISK (0-10): Higher = likely retiring soon = good
3. COLLECTOR_APPEAL (0-10): Display value, nostalgia, rarity
4. MARKET_LIQUIDITY (0-10): Ease of sale
5. PRICE_ENTRY: excellent/good/fair/poor based on paid vs retail
6. ACTION: BUY/HOLD/SELL with confidence (high/medium/low)
7. RETIREMENT_WINDOW: Estimated quarter when set will retire (Q1 2026, Q2 2026, etc.) based on retirement_risk - higher risk = sooner window
8. RETIREMENT_CONFIDENCE: Confidence in retirement prediction (high/medium/low) - based on data quality and market signals
9. ONE_LINER: Brief investment thesis

Return JSON object with set IDs as keys:
{
  "SET_ID": {
    "license": 7,
    "retirement": 5,
    "appeal": 8,
    "liquidity": 6,
    "entry": "good",
    "action": "HOLD",
    "confidence": "high",
    "retirement_window": "Q3 2026",
    "retirement_confidence": "medium",
    "thesis": "..."
  }
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return JSON.parse(data.choices[0].message.content);
}

async function main() {
  const sets = Object.entries(portfolio.sets);
  const BATCH_SIZE = 10;
  const results = {};

  // Dry-run mode for verification
  if (process.argv.includes('--dry-run')) {
    const sampleResult = {
      "75252": {
        "license": 9,
        "retirement": 7,
        "appeal": 9,
        "liquidity": 8,
        "entry": "good",
        "action": "HOLD",
        "confidence": "high",
        "retirement_window": "Q2 2026",
        "retirement_confidence": "medium",
        "thesis": "Strong Star Wars UCS set with high collector appeal",
        "last_updated": new Date().toISOString(),
        "confidence_level": "medium"
      }
    };
    console.log(JSON.stringify(sampleResult, null, 2));
    return;
  }

  console.log(`🔍 Analyzing ${sets.length} sets in batches of ${BATCH_SIZE}...\n`);
  
  for (let i = 0; i < sets.length; i += BATCH_SIZE) {
    const batch = sets.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(sets.length / BATCH_SIZE);
    
    process.stdout.write(`[Batch ${batchNum}/${totalBatches}] Analyzing ${batch.length} sets... `);
    
    try {
      const batchResults = await analyzeBatch(batch);
      // Add timestamp and map retirement_confidence to confidence_level
      const timestamp = new Date().toISOString();
      Object.keys(batchResults).forEach(setId => {
        batchResults[setId].last_updated = timestamp;
        batchResults[setId].confidence_level = batchResults[setId].retirement_confidence;
      });
      Object.assign(results, batchResults);
      console.log('✓');
    } catch (err) {
      console.log(`✗ ${err.message}`);
    }
    
    if (i + BATCH_SIZE < sets.length) await new Promise(r => setTimeout(r, 500));
  }
  
  // Save results
  const outputPath = path.join(__dirname, 'data/deep-analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ Saved to ${outputPath}`);
  
  // Generate summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 DEEP ANALYSIS SUMMARY');
  console.log('='.repeat(60));
  
  const analyzed = Object.entries(results).map(([id, a]) => ({
    id,
    name: portfolio.sets[id]?.name || id,
    ...a,
    avgScore: ((a.license || 0) + (a.retirement || 0) + (a.appeal || 0) + (a.liquidity || 0)) / 4
  })).sort((a, b) => b.avgScore - a.avgScore);
  
  // Strong buys
  const buys = analyzed.filter(a => a.action === 'BUY');
  if (buys.length) {
    console.log('\n🟢 BUY RECOMMENDATIONS:');
    buys.forEach(a => console.log(`  • ${a.name} (${a.confidence}): ${a.thesis}`));
  }
  
  // Sells
  const sells = analyzed.filter(a => a.action === 'SELL');
  if (sells.length) {
    console.log('\n🔴 SELL RECOMMENDATIONS:');
    sells.forEach(a => console.log(`  • ${a.name}: ${a.thesis}`));
  }
  
  // Top 5 by score
  console.log('\n🏆 TOP 5 INVESTMENT SCORES:');
  analyzed.slice(0, 5).forEach((a, i) => {
    console.log(`  ${i + 1}. ${a.name} (${a.avgScore.toFixed(1)}/10) - ${a.thesis}`);
  });
  
  // Bottom 3
  console.log('\n⚠️ WEAKEST POSITIONS:');
  analyzed.slice(-3).forEach(a => {
    console.log(`  • ${a.name} (${a.avgScore.toFixed(1)}/10) - ${a.thesis}`);
  });
  
  // Holds
  const holds = analyzed.filter(a => a.action === 'HOLD');
  console.log(`\n⏳ HOLD: ${holds.length} sets`);
}

main().catch(console.error);
