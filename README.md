# LEGO Portfolio Dashboard 🧱📊

Investment-grade LEGO set portfolio tracker with multi-source pricing, historical analysis, and market insights.

## Features

- **Multi-source pricing**: BrickEconomy, BrickLink, eBay sold data
- **Historical tracking**: Price history with trend analysis
- **Portfolio valuation**: Track ROI across your entire collection
- **Market analysis**: Retirement predictions, demand indicators
- **CAGR calculations**: 5-year and 10-year compound growth rates
- **Interactive dashboard**: Real-time portfolio visualization

## Live Dashboard

[View Dashboard](https://lego-portfolio.vercel.app) _(if deployed)_

## Data Sources

| Source       | Data Type                | Method           |
| ------------ | ------------------------ | ---------------- |
| BrickEconomy | Price history, trends    | Browser scraping |
| BrickLink    | Market prices, inventory | API/scraping     |
| eBay         | Sold prices, demand      | Search scraping  |

## Structure

```
├── public/
│   ├── index.html        # Main dashboard
│   └── data/             # Portfolio data (JSON)
├── scripts/
│   ├── scrape-brickeconomy.cjs
│   ├── ebay-scraper.cjs
│   ├── daily-snapshot.cjs
│   └── full-scrape.cjs
├── data/                 # Source data
│   ├── portfolio.json    # Your sets
│   ├── analysis.json     # Market analysis
│   └── price-history.json
├── lego-cli.cjs          # CLI tool
├── dashboard.html        # Standalone dashboard
└── vercel.json           # Deployment config
```

## Prerequisites

- Node.js >= 18.0.0
- npm

## Setup

```bash
# Install dependencies
npm install
```

## Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint

# Format code
npm run format
```

## Scripts

```bash
# Run CLI
node lego-cli.cjs --help

# Scrape prices
node scripts/full-scrape.cjs
```

## Automated Scraping

The dashboard includes a fully automated data scraping pipeline that can run on a schedule or on-demand.

### Initial Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   # Copy example configuration
   cp .env.example .env

   # Edit .env to customize settings (optional)
   # Default: Daily scraping at 6:00 AM
   ```

3. **Test configuration**
   ```bash
   npm run scrape:help
   ```

### Running the Scraper

**Run immediately:**
```bash
npm run scrape:now
```

**Test without scraping (dry-run):**
```bash
npm run scrape:dry-run
```

**Start scheduled automation:**
```bash
npm run scrape:schedule
```

**Scrape specific set:**
```bash
node scripts/automated-scraper.js --set 10316-1
```

**Scrape specific source:**
```bash
node scripts/automated-scraper.js --source brickeconomy
```

### Configuration Options

Edit `.env` to customize automation behavior:

**Scheduling:**
```bash
# Cron format: minute hour day month weekday
SCRAPE_SCHEDULE=0 6 * * *    # Daily at 6:00 AM (default)
# SCRAPE_SCHEDULE=0 */12 * * *  # Every 12 hours
# SCRAPE_SCHEDULE=0 6 * * 1     # Every Monday at 6:00 AM
```

**Browser Settings:**
```bash
HEADLESS_MODE=true           # false to see browser (debugging)
VIEWPORT_WIDTH=1920
VIEWPORT_HEIGHT=1080
```

**Scraping Behavior:**
```bash
MAX_RETRIES=3                # Retry attempts for failed scrapes
RETRY_DELAY=2000             # Delay between retries (ms)
PAGE_DELAY=1000              # Delay between page loads (ms)
SOURCE_DELAY=3000            # Delay between data sources (ms)
REQUEST_TIMEOUT=30000        # Request timeout (ms)
```

**Data Sources:**
```bash
ENABLE_BRICKECONOMY=true     # Enable/disable BrickEconomy
ENABLE_EBAY=true             # Enable/disable eBay
ENABLE_BRICKLINK=false       # Enable/disable BrickLink
EBAY_DOMAINS=ebay.de,ebay.fr # eBay domains to try
```

**Performance:**
```bash
MAX_CONCURRENT_PAGES=1       # Browser pages to run in parallel
STEALTH_MODE=true            # Avoid bot detection
LOG_LEVEL=info               # debug, info, warn, error
LOG_TO_FILE=true             # Save logs to data/scraper-logs.json
```

### How It Works

The automated scraper:
1. Loads your portfolio from `data/portfolio.json`
2. Scrapes BrickEconomy for current prices and trends
3. Scrapes eBay for sold prices and demand data
4. Generates daily snapshot with ROI calculations
5. Updates `public/data/` for dashboard display
6. Logs detailed results to `data/scraper-logs.json`

### Logs & Monitoring

View scraping logs:
```bash
cat data/scraper-logs.json | jq '.'
```

Monitor scheduled runs:
```bash
# Scheduler outputs real-time progress
npm run scrape:schedule

# Graceful shutdown with Ctrl+C
# Force kill with Ctrl+C twice (may corrupt data)
```

### Production Deployment

For continuous automation on a server:

**Using PM2 (recommended):**
```bash
npm install -g pm2
pm2 start scripts/scheduler.js --name lego-scraper
pm2 save
pm2 startup
```

**Using systemd:**
```bash
# Create /etc/systemd/system/lego-scraper.service
[Unit]
Description=LEGO Portfolio Scraper
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/lego-dashboard
ExecStart=/usr/bin/node scripts/scheduler.js
Restart=always

[Install]
WantedBy=multi-user.target
```

**Using Docker:**
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "scrape:schedule"]
```

## Portfolio JSON Format

```json
{
  "sets": {
    "75192": {
      "name": "Millennium Falcon",
      "theme": "Star Wars",
      "year": 2017,
      "rrp": 799.99,
      "purchase_price": 699.99,
      "condition": "NISB",
      "quantity": 1
    }
  }
}
```

## Deployment

Deploy to Vercel:

```bash
vercel --prod
```

## License

MIT
