# LEGO Portfolio Investment Tracker

Investment-grade LEGO set portfolio management with multi-source pricing, historical tracking, and market analysis.

## Data Sources

### Primary Sources
1. **BrickEconomy** - Comprehensive price history, market trends, retirement dates
2. **BrickLink** - Real marketplace data, sold listings, inventory levels
3. **eBay** - Actual sold prices, demand indicators

### Data Collection
- Browser automation for BrickEconomy (via clawd browser)
- BrickLink API (if available) or scraping
- eBay sold listings search

## Portfolio Data Structure

### `/data/portfolio.json` - Master Portfolio
```json
{
  "sets": {
    "75192": {
      "name": "Millennium Falcon",
      "theme": "Star Wars",
      "year": 2017,
      "pieces": 7541,
      "rrp": 799.99,
      "rrp_currency": "EUR",
      "purchase_price": 699.99,
      "purchase_date": "2023-01-15",
      "condition": "NISB",
      "quantity": 1,
      "status": "available",
      "notes": "Black Friday deal"
    }
  },
  "last_updated": "2025-01-27T12:00:00Z"
}
```

### `/data/prices.json` - Price History
```json
{
  "75192": {
    "current": {
      "brickeconomy": { "new": 1250, "used": 890, "date": "2025-01-27" },
      "bricklink": { "new_avg": 1180, "new_min": 1050, "used_avg": 820, "date": "2025-01-27" },
      "ebay": { "new_sold_avg": 1200, "new_sold_count": 12, "date": "2025-01-27" }
    },
    "history": [
      { "date": "2025-01-20", "new": 1230, "used": 870, "source": "brickeconomy" }
    ]
  }
}
```

### `/data/market.json` - Market Intelligence
```json
{
  "75192": {
    "retirement_status": "active",
    "retirement_date": null,
    "retirement_predicted": "2026-Q4",
    "availability": {
      "lego_com": true,
      "amazon": true,
      "target": false
    },
    "investment_score": 8.5,
    "liquidity_score": 9.2,
    "appreciation_1y": 15.3,
    "appreciation_3y": 42.1
  }
}
```

## Investment Metrics

### Per-Set Metrics
- **Current Value**: Weighted average from all sources
- **ROI**: (Current - Purchase) / Purchase × 100
- **CAGR**: Compound Annual Growth Rate since purchase
- **Unrealized P&L**: Current value - purchase price
- **Days Held**: Time in portfolio
- **Appreciation Rate**: Annual % increase
- **Liquidity Score**: Based on eBay sold volume (1-10)

### Portfolio Metrics
- **Total Investment**: Sum of all purchase prices
- **Current Value**: Sum of all current values
- **Total ROI**: Portfolio-level return
- **Best/Worst Performers**: Ranked by ROI
- **Theme Allocation**: % by theme
- **Risk Score**: Diversification + liquidity weighted

## Commands

### Portfolio Management
- `lego status` - Full portfolio overview with metrics
- `lego add <set_id> [price] [date]` - Add set to portfolio
- `lego remove <set_id>` - Remove set
- `lego update` - Refresh all prices from sources

### Analysis
- `lego analyze <set_id>` - Deep dive on single set
- `lego performance` - ROI/gains breakdown
- `lego recommendations` - Buy/sell/hold advice
- `lego watchlist` - Sets to consider buying

### Data
- `lego sync` - Full sync from all sources
- `lego history <set_id>` - Price history chart
- `lego export` - Export to CSV/Excel

## Price Fetching Strategy

### BrickEconomy (Primary)
1. Navigate to set page: `https://www.brickeconomy.com/set/{set_id}`
2. Extract: current new/used prices, price history, EOL status
3. Parse investment metrics they calculate

### BrickLink
1. Price guide: `https://www.bricklink.com/v2/catalog/catalogitem.page?S={set_id}-1`
2. Extract: 6-month avg, min, max for new/used
3. Current inventory count (supply indicator)

### eBay Sold
1. Search: `LEGO {set_id} {name} sealed -instructions -minifig`
2. Filter: Sold items, last 30 days
3. Calculate: Average, median, volume

## Investment Analysis

### Set Scoring (1-10)
- **Growth Potential**: Theme popularity + retirement timing
- **Liquidity**: Trading volume + demand
- **Risk**: Price volatility + market saturation
- **Overall Score**: Weighted combination

### Recommendations Engine
- **BUY**: High score + below fair value
- **HOLD**: Good fundamentals + appreciating
- **SELL**: Poor liquidity + peaked value
- **WATCH**: Upcoming retirement + good entry point

## Automated Price Updates (eBay EU)

### Configuration
File: `/data/ebay-price-history.json`
- `updateIntervalHours`: 24 (daily updates)
- `minChangeThreshold`: 0.05 (report changes >5%)
- `primaryMarket`: ebay.de (best EU prices)

### Update Process
1. Clawdbot checks HEARTBEAT.md daily (~9AM or on request)
2. For each set with `qty_new > 0`:
   - Search eBay.de sold listings: `LEGO [setNumber] new sealed`
   - Filter: Completed/Sold only, sorted by recent
   - Extract prices, calculate median (removing outliers)
3. Update portfolio.json with new values
4. Report changes >5% to owner via Telegram

### Manual Trigger
Ask Clawdbot: "Update LEGO portfolio prices" or "Check LEGO prices on eBay"

### Scripts
- `scripts/ebay-scraper.js` - Generate search URLs, parse prices
- `scripts/full-scrape.js` - BrickEconomy URLs reference
- `scripts/daily-snapshot.js` - Save daily snapshots

## Scheduled Tasks

Consider setting up cron jobs:
- Daily: Price check from eBay EU (automated via HEARTBEAT.md)
- Weekly: Full multi-source sync (BrickEconomy + BrickLink)
- Monthly: Portfolio performance report
