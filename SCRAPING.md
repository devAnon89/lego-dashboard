# SCRAPING.md - Technical Documentation

## Overview

This document provides technical details on the automated data scraping pipeline for LEGO portfolio tracking. The system uses headless browser automation via Puppeteer to extract pricing data from BrickEconomy and eBay without manual intervention.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Scheduler (node-cron)                   │
│                   scripts/scheduler.js                      │
└─────────────────────┬───────────────────────────────────────┘
                      │ Triggers on cron schedule
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Master Orchestrator                            │
│            scripts/automated-scraper.js                     │
│  • Loads portfolio                                          │
│  • Runs scrapers sequentially                              │
│  • Generates snapshots                                      │
│  • Logs comprehensive results                              │
└──────┬────────────────────────┬─────────────────────────────┘
       │                        │
       ▼                        ▼
┌──────────────────┐   ┌──────────────────┐
│  BrickEconomy    │   │  eBay Scraper    │
│     Scraper      │   │                  │
│ scrape-brick     │   │ ebay-scraper.js  │
│ economy.js       │   │                  │
└──────────────────┘   └──────────────────┘
       │                        │
       └────────┬───────────────┘
                ▼
      ┌─────────────────────┐
      │   Data Directory    │
      │   • portfolio.json  │
      │   • price-history   │
      │   • scraper-logs    │
      └─────────────────────┘
```

## Core Scripts

### 1. automated-scraper.js

**Purpose:** Master orchestration script that coordinates the entire scraping pipeline.

**Key Features:**
- Sequential execution of all scrapers
- Command-line argument parsing
- Comprehensive logging and error tracking
- Dry-run mode for testing
- Selective scraping (single set, specific source)
- Run history tracking

**Usage:**
```bash
# Full pipeline
node scripts/automated-scraper.js

# Dry run (no actual scraping)
node scripts/automated-scraper.js --dry-run

# Single set
node scripts/automated-scraper.js --set 10316-1

# Specific source
node scripts/automated-scraper.js --source brickeconomy
node scripts/automated-scraper.js --source ebay

# Combined filters
node scripts/automated-scraper.js --source ebay --set 10316-1
```

**Exit Codes:**
- `0`: Success - all scrapers completed successfully
- `1`: Failure - one or more scrapers failed

**Execution Flow:**
1. Parse command-line arguments
2. Load portfolio from `data/portfolio.json`
3. Run BrickEconomy scraper (unless filtered)
4. Run eBay scraper (unless filtered)
5. Generate daily snapshot (full pipeline only)
6. Save run results to `data/scraper-logs.json`
7. Save last run to `data/last-scrape-results.json`
8. Exit with appropriate status code

**Data Structures:**

Run results object:
```javascript
{
  runId: "run-1234567890",
  mode: "production",
  startTime: "2025-01-15T06:00:00.000Z",
  endTime: "2025-01-15T06:15:32.123Z",
  durationMs: 932123,
  status: "success|failed",
  portfolio: {
    loaded: true,
    setsCount: 37,
    timestamp: "2025-01-15T06:00:01.000Z"
  },
  brickeconomy: {
    success: true,
    exitCode: 0,
    output: "...",
    startTime: "2025-01-15T06:00:05.000Z",
    endTime: "2025-01-15T06:08:30.000Z",
    durationMs: 205000
  },
  ebay: {
    success: true,
    exitCode: 0,
    output: "...",
    startTime: "2025-01-15T06:08:30.000Z",
    endTime: "2025-01-15T06:12:45.000Z",
    durationMs: 255000
  },
  snapshot: {
    success: true,
    exitCode: 0,
    output: "...",
    startTime: "2025-01-15T06:12:45.000Z",
    endTime: "2025-01-15T06:15:32.000Z",
    durationMs: 167000
  },
  errors: []
}
```

### 2. scrape-brickeconomy.js

**Purpose:** Scrapes price history and future predictions from BrickEconomy.com using Puppeteer.

**Data Extracted:**
- Historical price data (date, new value, used value)
- Current market value
- ML-based price predictions (1-year, 5-year)
- Set metadata (name, theme)

**URL Pattern:**
```
https://www.brickeconomy.com/set/{setId}/lego-{slug}
Example: https://www.brickeconomy.com/set/10316-1/lego-the-lord-of-the-rings-rivendell
```

**Key Functions:**

**`extractSetDataFromPage()`** - Browser-side extraction function
- Runs in page context via `page.evaluate()`
- Locates price history table by heuristics
- Parses date/price cells from table rows
- Separates historical data from predictions
- Extracts current value from page text
- Returns structured data object

**`scrapeSet(setId, options)`** - Main scraping function
- Launches Puppeteer browser
- Navigates to BrickEconomy URL
- Executes extraction function
- Validates data completeness
- Returns scraped data with metadata

**`withRetry(fn, options)`** - Retry wrapper with exponential backoff
- Implements configurable retry logic
- Exponential backoff: `delay * 2^(attempt-1)`
- Default: 3 retries, 2000ms initial delay
- Logs retry attempts via logger

**Retry Logic:**
```javascript
// Attempt 1: 2000ms delay
// Attempt 2: 4000ms delay
// Attempt 3: 8000ms delay
```

**Data Output:**

Individual set file (`data/brickeconomy/{setId}.json`):
```json
{
  "setId": "10316-1",
  "url": "https://www.brickeconomy.com/set/10316-1/...",
  "scrapedAt": "2025-01-15T06:05:23.456Z",
  "currentValue": 420.50,
  "priceHistory": [
    {
      "date": "2023-03-01",
      "newValue": 399.99,
      "usedValue": 350.00
    },
    {
      "date": "2023-04-01",
      "newValue": 405.00,
      "usedValue": 355.00
    }
  ],
  "predictions": {
    "1yr": {
      "value": 445.00,
      "date": "2026-01-15"
    },
    "5yr": {
      "value": 550.00,
      "date": "2030-01-15"
    }
  },
  "setInfo": {
    "name": "The Lord of the Rings Rivendell"
  }
}
```

Centralized file (`data/price-history.json`):
```json
{
  "metadata": {
    "lastUpdated": "2025-01-15T06:08:30.000Z",
    "source": "BrickEconomy",
    "currency": "EUR",
    "note": "Prices scraped from BrickEconomy. Future dates are ML-based predictions."
  },
  "sets": {
    "10316-1": {
      "name": "The Lord of the Rings Rivendell",
      "currentValue": 420.50,
      "priceHistory": [...],
      "predictions": {...}
    }
  }
}
```

**Configuration:**
```bash
MAX_RETRIES=3          # Retry attempts
RETRY_DELAY=2000       # Initial retry delay (ms)
```

**Command-line Options:**
```bash
--set <setId>      # Scrape single set
--all              # Scrape all sets in setUrls map
--dry-run          # Test mode
--no-headless      # Show browser (debugging)
```

**Set URL Mapping:**

The scraper maintains a hardcoded map of 37 sets:
```javascript
const setUrls = {
  "10316-1": "https://www.brickeconomy.com/set/10316-1/lego-the-lord-of-the-rings-rivendell",
  "10330-1": "https://www.brickeconomy.com/set/10330-1/lego-mclaren-mp4-4-ayrton-senna",
  // ... 35 more sets
};
```

**Error Handling:**
- Invalid set ID: Throws error with available set count
- Page structure changes: Throws error if no data found
- Network errors: Caught and retried
- Browser launch failures: Caught and retried

### 3. ebay-scraper.js

**Purpose:** Scrapes sold listings from eBay EU markets to determine real market values using Puppeteer.

**Data Sources:**
- eBay Germany (ebay.de) - primary
- eBay France (ebay.fr)
- eBay Italy (ebay.it)
- eBay Spain (ebay.es)
- eBay Netherlands (ebay.nl)

**Search Strategy:**
```
Query: "LEGO {setNumber} new sealed"
Filters: LH_Complete=1 (completed), LH_Sold=1 (sold only)
Sort: _sop=13 (recently listed)
```

**URL Pattern:**
```
https://www.ebay.de/sch/i.html?_nkw=LEGO+10316+new+sealed&LH_Complete=1&LH_Sold=1&_sop=13
```

**Key Functions:**

**`extractEbayPrices()`** - Browser-side price extraction
- Runs in page context via `page.evaluate()`
- Searches multiple CSS selectors: `.s-item__price`, `.lvprice`, `.bold`
- Matches price patterns: `EUR 123,45`, `€123.45`, `123,45 €`
- Handles European number format (1.234,56)
- Filters reasonable price range: €5 - €10,000
- Returns deduplicated array of prices

**`calculateMarketValue(prices)`** - Statistical analysis
- Sorts prices ascending
- Removes top/bottom 10% as outliers
- Returns median of trimmed dataset
- Handles edge cases (empty, single price)

**`scrapeSingleSet(setId, setData, dryRun, allDomains)`** - Multi-domain scraper
- Tries domains in priority order
- Stops after first success (default)
- Tries all domains if `--all-domains` flag set
- Sets stealth user agent
- Adds 2-3s delays between domains
- Returns aggregated results

**Bot Detection Avoidance:**
- User agent spoofing: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`
- Random delays: 2-3s between requests
- Headless mode with standard args: `--no-sandbox`, `--disable-setuid-sandbox`
- Sequential requests (no parallelization)

**Domain Fallback:**
```javascript
// Default mode: Stop after first success
ebay.de → Found 12 prices → STOP

// All-domains mode: Try all markets
ebay.de → Found 12 prices → CONTINUE
ebay.fr → Found 8 prices → CONTINUE
ebay.it → Found 5 prices → CONTINUE
ebay.es → Found 0 prices → CONTINUE
ebay.nl → Found 3 prices → STOP

// Result: 28 total prices from 4 domains
```

**Data Output:**

Price history file (`data/ebay-price-history.json`):
```json
{
  "snapshots": [
    {
      "timestamp": "2025-01-15T06:12:45.000Z",
      "source": "eBay EU",
      "data": [
        {
          "setId": "10316-1",
          "name": "The Lord of the Rings Rivendell",
          "url": "https://www.ebay.de/sch/...",
          "domains": ["Germany"],
          "prices": [399.99, 410.00, 395.00, 425.50],
          "marketValue": 405.00,
          "timestamp": "2025-01-15T06:12:45.000Z"
        }
      ]
    }
  ],
  "lastUpdate": "2025-01-15T06:12:45.000Z"
}
```

Portfolio update (`data/portfolio.json`):
```javascript
// Updates each set's value field
portfolio.sets[i].value = marketValue;

// Recalculates growth percentage
portfolio.sets[i].growth = ((value - paid) / paid) * 100;

// Updates metadata
portfolio.metadata.lastUpdated = timestamp;
portfolio.metadata.totalCurrentValue = sum(value * qty);
portfolio.metadata.totalGain = ((totalCurrentValue - totalPaid) / totalPaid) * 100;
```

**Configuration:**
```bash
MAX_RETRIES=3          # Retry attempts
RETRY_DELAY=2000       # Initial retry delay (ms)
```

**Command-line Options:**
```bash
--set <setId>      # Scrape single set
--all              # Scrape all sets from portfolio
--dry-run          # Test mode
--all-domains      # Try all eBay EU markets
```

**Error Handling:**
- Set not in portfolio: Logs error and exits
- No prices found: Logs warning, continues
- Domain failure: Falls back to next domain
- Browser launch failures: Caught and retried

### 4. scheduler.js

**Purpose:** Cron-based scheduler for automated scraping runs using node-cron.

**Features:**
- Configurable cron schedule via environment variable
- Graceful shutdown handling
- Process management (tracks running scraper)
- Test modes for validation
- Inherits stdio for real-time output

**Cron Schedule Format:**
```
┌────────────── minute (0-59)
│ ┌──────────── hour (0-23)
│ │ ┌────────── day (1-31)
│ │ │ ┌──────── month (1-12)
│ │ │ │ ┌────── weekday (0-7, 0=Sunday)
│ │ │ │ │
* * * * *
```

**Common Schedules:**
```bash
0 6 * * *       # Daily at 6:00 AM
0 */12 * * *    # Every 12 hours
0 6 * * 1       # Every Monday at 6:00 AM
0 0 1 * *       # Monthly on the 1st at midnight
30 8 * * 1-5    # Weekdays at 8:30 AM
```

**Graceful Shutdown:**
```
SIGINT/SIGTERM received
  │
  ├─ Scraper running?
  │  ├─ Yes: Wait for completion (may take minutes)
  │  │       Press Ctrl+C again to force kill
  │  └─ No:  Exit immediately
  │
  └─ Exit with code 0
```

**Usage:**
```bash
# Start scheduler (runs indefinitely)
node scripts/scheduler.js

# Test mode (validates config and exits)
node scripts/scheduler.js --test

# Test shutdown functionality
node scripts/scheduler.js --test-shutdown

# Via npm script
npm run scrape:schedule
```

**Configuration:**
```bash
SCRAPE_SCHEDULE=0 6 * * *   # Cron pattern (default: daily at 6am)
```

**Process Management:**
- Spawns automated-scraper.js as child process
- Inherits stdio for real-time output
- Tracks current scraper process
- Prevents multiple simultaneous runs
- Handles process cleanup on exit

### 5. logger.js

**Purpose:** Shared logging utility for consistent output across all scripts.

**Log Levels:**
- `INFO`: General information messages
- `WARN`: Warning messages for non-critical issues
- `ERROR`: Error messages for failures
- `DEBUG`: Verbose debugging (only shown if `LOG_LEVEL=DEBUG`)

**Features:**
- Timestamp prefixing: `[2025-01-15T06:00:00.000Z]`
- Level tagging: `[INFO]`, `[WARN]`, `[ERROR]`, `[DEBUG]`
- Structured data formatting (JSON objects, errors with stack traces)
- Optional file logging to `data/logs/scraper.log`
- Section dividers for visual organization

**Usage:**
```javascript
const logger = require('./logger');

logger.info('Operation completed');
logger.warn('Potential issue detected', { detail: 'value' });
logger.error('Operation failed', error);
logger.debug('Verbose info', { data: {...} });
logger.section('Pipeline Summary Report');
```

**Output Format:**
```
[2025-01-15T06:00:00.123Z] [INFO] Operation completed
[2025-01-15T06:00:01.456Z] [WARN] Potential issue detected
  Data: {"detail":"value"}
[2025-01-15T06:00:02.789Z] [ERROR] Operation failed
  Error: Connection timeout
  Stack: Error: Connection timeout
    at scrapeSet (/path/to/file.js:123:45)
```

**Configuration:**
```bash
LOG_LEVEL=info         # Logging verbosity (debug|info|warn|error)
LOG_TO_FILE=true       # Enable file logging
```

## Data Flow

### Complete Pipeline Flow

```
1. Scheduler triggers at cron time
   │
   ▼
2. automated-scraper.js starts
   │
   ├─> Load portfolio.json
   │   └─> Get list of sets to scrape
   │
   ├─> Run scrape-brickeconomy.js
   │   ├─> For each set in setUrls:
   │   │   ├─> Launch Puppeteer browser
   │   │   ├─> Navigate to BrickEconomy URL
   │   │   ├─> Extract price history from table
   │   │   ├─> Extract predictions from future dates
   │   │   ├─> Save to data/brickeconomy/{setId}.json
   │   │   └─> Close browser
   │   └─> Update data/price-history.json
   │
   ├─> Run ebay-scraper.js
   │   ├─> For each set in portfolio:
   │   │   ├─> Launch Puppeteer browser
   │   │   ├─> Try ebay.de search
   │   │   ├─> Extract sold prices
   │   │   ├─> Calculate median market value
   │   │   ├─> Fallback to ebay.fr if needed
   │   │   └─> Close browser
   │   ├─> Update data/ebay-price-history.json
   │   └─> Update data/portfolio.json with new values
   │
   ├─> Run daily-snapshot.js
   │   └─> Generate portfolio snapshot
   │
   └─> Save results
       ├─> data/last-scrape-results.json
       └─> data/scraper-logs.json (append, keep last 100)
```

### File Locations

**Configuration:**
- `.env` - Environment configuration
- `.env.example` - Configuration template

**Data Files:**
```
data/
├── portfolio.json              # Main portfolio data (updated by eBay scraper)
├── price-history.json          # BrickEconomy historical data
├── ebay-price-history.json     # eBay market data snapshots
├── last-scrape-results.json    # Latest run results (for debugging)
├── scraper-logs.json           # Historical run logs (last 100 runs)
│
├── brickeconomy/               # Individual set data from BrickEconomy
│   ├── 10316-1.json
│   ├── 10330-1.json
│   └── ...
│
└── logs/                       # Optional file logs
    └── scraper.log
```

**Public Data (for dashboard):**
```
public/data/
├── portfolio.json              # Copied from data/
├── analysis.json               # Generated by daily-snapshot
└── price-history.json          # Copied from data/
```

## Anti-Bot Measures

### Detection Avoidance Techniques

**1. User Agent Spoofing**
```javascript
await page.setUserAgent(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
);
```

**2. Rate Limiting**
- Sequential requests (no parallelization)
- 1-2s delay between page loads
- 3s delay between different data sources
- Random jitter can be added for stealth

**3. Headless Detection Prevention**
- Standard Puppeteer args: `--no-sandbox`, `--disable-setuid-sandbox`
- Can add puppeteer-extra-plugin-stealth (already installed)

**4. Retry Strategy**
- Exponential backoff on failures
- Maximum 3 retries by default
- Prevents rapid hammering on errors

**5. Browser Fingerprinting**
- Realistic viewport: 1920x1080
- Standard Chrome user agent
- Natural page load timing (waitUntil: 'networkidle2')

### Future Enhancements

**Stealth Plugin Usage (optional):**
```javascript
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const browser = await puppeteer.launch({...});
```

**Proxy Rotation (if needed):**
```javascript
const browser = await puppeteer.launch({
  args: ['--proxy-server=http://proxy:port']
});
```

**Cookie Management:**
```javascript
// Save cookies after first run
const cookies = await page.cookies();
fs.writeFileSync('cookies.json', JSON.stringify(cookies));

// Restore cookies for subsequent runs
const cookies = JSON.parse(fs.readFileSync('cookies.json'));
await page.setCookie(...cookies);
```

## Performance Optimization

### Current Performance

**Typical Scraping Times (37 sets):**
- BrickEconomy scraper: ~3-5 minutes
- eBay scraper: ~4-6 minutes
- Daily snapshot: ~2-3 minutes
- **Total pipeline**: ~10-15 minutes

**Per-Set Timings:**
- BrickEconomy: 5-10 seconds per set
- eBay: 7-12 seconds per set (with domain fallback)

### Optimization Strategies

**1. Parallel Scraping (Not Implemented)**
```javascript
// Current: Sequential
for (const setId of setIds) {
  await scrapeSet(setId);
}

// Potential: Parallel with limit
const limit = 3; // Max concurrent
await Promise.all(
  chunk(setIds, limit).map(chunk =>
    Promise.all(chunk.map(scrapeSet))
  )
);
```

**Risk:** Increased bot detection, rate limiting

**2. Browser Reuse (Not Implemented)**
```javascript
// Current: Launch/close per set
const browser = await puppeteer.launch();
const data = await scrapeSet(browser, setId);
await browser.close();

// Potential: Single browser, multiple pages
const browser = await puppeteer.launch();
for (const setId of setIds) {
  const page = await browser.newPage();
  await scrapePage(page, setId);
  await page.close();
}
await browser.close();
```

**Benefit:** Faster startup, reduced overhead

**3. Caching (Not Implemented)**
```javascript
// Skip recently scraped sets
const lastScraped = getLastScraped(setId);
if (Date.now() - lastScraped < 6 * 60 * 60 * 1000) {
  logger.debug(`Skipping ${setId} - scraped ${timeSince} ago`);
  return cachedData;
}
```

**Benefit:** Faster runs, reduced load on target sites

**4. Incremental Updates**
```bash
# Current: Full scrape daily
npm run scrape:now

# Potential: Quick update (only changed sets)
npm run scrape:quick
```

## Error Handling

### Retry Logic

**Exponential Backoff Implementation:**
```javascript
async function withRetry(fn, options) {
  const { maxRetries = 3, retryDelay = 2000 } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1);
        logger.warn(`Retry ${attempt}/${maxRetries} in ${delay}ms`, error);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}
```

**Retry Schedule:**
```
Attempt 1: Execute immediately
  ↓ (fails)
Attempt 2: Wait 2000ms (2s)
  ↓ (fails)
Attempt 3: Wait 4000ms (4s)
  ↓ (fails)
Attempt 4: Wait 8000ms (8s)
  ↓ (fails)
Give up, throw error
```

### Error Categories

**1. Network Errors**
- Timeout after 30s
- Connection refused
- DNS resolution failure
- **Handling:** Retry with exponential backoff

**2. Page Structure Changes**
- Selectors not found
- Table format changed
- Price format changed
- **Handling:** Log error, skip set, notify maintainer

**3. Bot Detection**
- CAPTCHA challenge
- Rate limiting (429 status)
- IP blocking
- **Handling:** Exponential backoff, potentially pause scraping

**4. Data Validation**
- No prices found
- Invalid price format
- Out-of-range values
- **Handling:** Log warning, use fallback value or skip

**5. File System Errors**
- Disk full
- Permission denied
- Corrupt JSON
- **Handling:** Log error, exit with failure code

### Logging Strategy

**Error Severity Levels:**

**DEBUG:** Verbose details for development
```javascript
logger.debug(`Navigating to ${url}`);
logger.debug(`Found ${prices.length} prices`);
```

**INFO:** Normal operation events
```javascript
logger.info('Pipeline started');
logger.info(`Successfully scraped ${setId}`);
logger.info('Pipeline completed successfully');
```

**WARN:** Non-critical issues
```javascript
logger.warn('No prices found on ebay.de, trying ebay.fr');
logger.warn(`Set ${setId} not in URL map, skipping`);
```

**ERROR:** Critical failures
```javascript
logger.error('Failed to load portfolio', error);
logger.error(`Scraping failed after ${maxRetries} attempts`, error);
```

## Testing & Validation

### Testing Modes

**1. Dry Run Mode**
```bash
npm run scrape:dry-run
# or
node scripts/automated-scraper.js --dry-run
```

**Behavior:**
- Validates configuration
- Logs what would be scraped
- Does not launch browsers
- Does not modify data files
- Exits quickly

**Use cases:**
- Verify setup before first run
- Test after configuration changes
- Validate cron schedule syntax

**2. Test Single Set**
```bash
node scripts/automated-scraper.js --set 10316-1
```

**Behavior:**
- Scrapes only specified set
- Uses production scraping code
- Updates data files normally
- Faster iteration for debugging

**3. Test Specific Source**
```bash
node scripts/automated-scraper.js --source brickeconomy
node scripts/automated-scraper.js --source ebay
```

**Behavior:**
- Runs only one scraper
- Skips snapshot generation
- Useful for isolated testing

**4. Scheduler Test Mode**
```bash
node scripts/scheduler.js --test
```

**Behavior:**
- Validates cron schedule
- Checks scraper script exists
- Loads configuration
- Exits without scheduling

### Validation Checks

**Pre-execution:**
- [ ] Portfolio file exists and is valid JSON
- [ ] Environment variables loaded
- [ ] Puppeteer can launch browser
- [ ] Data directory is writable

**During execution:**
- [ ] Browser launches successfully
- [ ] Page loads without timeout
- [ ] Data extracted matches expected structure
- [ ] Prices are in reasonable range (€5-€10,000)
- [ ] Dates are valid ISO format

**Post-execution:**
- [ ] Data files written successfully
- [ ] JSON files are valid and parseable
- [ ] Portfolio totals recalculated correctly
- [ ] Run logged to scraper-logs.json

### Manual Testing Checklist

**Initial Setup:**
```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env

# 3. Test dry run
npm run scrape:dry-run

# 4. Test single set
node scripts/automated-scraper.js --set 10316-1

# 5. Review output files
cat data/brickeconomy/10316-1.json
cat data/last-scrape-results.json

# 6. Test scheduler validation
node scripts/scheduler.js --test

# 7. Test full pipeline
npm run scrape:now
```

**Regression Testing:**
```bash
# Before code changes
npm run scrape:now > output-before.log

# After code changes
npm run scrape:now > output-after.log

# Compare
diff output-before.log output-after.log

# Validate data integrity
node scripts/validate-data.js  # (if exists)
```

## Troubleshooting

### Common Issues

**1. "Failed to launch browser"**

**Symptoms:**
```
Error: Failed to launch the browser process
```

**Causes:**
- Missing system dependencies (Linux)
- Insufficient permissions
- Insufficient memory

**Solutions:**
```bash
# Linux: Install dependencies
sudo apt-get install -y \
  gconf-service libasound2 libatk1.0-0 libc6 libcairo2 \
  libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 \
  libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 \
  libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
  libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
  libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
  libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 \
  libnss3 lsb-release xdg-utils wget

# Or: Use puppeteer with bundled Chromium
npm install puppeteer  # (not puppeteer-core)
```

**2. "No prices found"**

**Symptoms:**
```
WARN: No prices found on ebay.de
```

**Causes:**
- Page structure changed
- Bot detection triggered
- Search returned no results
- Network timeout

**Solutions:**
```bash
# Enable visible browser to debug
node scripts/ebay-scraper.js --set 10316-1 --no-headless

# Check if set number is correct
node scripts/ebay-scraper.js --set 10316-1 --dry-run

# Increase delays to avoid rate limiting
# Edit .env:
PAGE_DELAY=3000
SOURCE_DELAY=5000
```

**3. "Page structure changed"**

**Symptoms:**
```
ERROR: No price data found on page - page may have changed structure
```

**Causes:**
- Target website updated HTML structure
- JavaScript failed to execute
- Anti-bot measures blocking content

**Solutions:**
1. Inspect page manually:
```bash
# Open browser and check current HTML structure
node scripts/scrape-brickeconomy.js --set 10316-1 --no-headless
```

2. Update extraction logic in `extractSetDataFromPage()`:
```javascript
// Check current selectors still work
const priceTable = document.querySelector('table.price-history');
```

3. Add fallback selectors:
```javascript
const selectors = ['.s-item__price', '.lvprice', '.price'];
for (const selector of selectors) {
  const elements = document.querySelectorAll(selector);
  if (elements.length > 0) return extractPrices(elements);
}
```

**4. "CAPTCHA detected"**

**Symptoms:**
- Browser hangs on page load
- Extraction returns no data
- Page title contains "Robot Check"

**Causes:**
- Too many requests from same IP
- Bot detection triggered
- Headless browser detected

**Solutions:**
```bash
# Add stealth plugin
# Edit scraper to use puppeteer-extra with stealth

# Increase delays
PAGE_DELAY=5000
SOURCE_DELAY=10000

# Use proxy rotation (advanced)
# Requires proxy service configuration
```

**5. "File system error"**

**Symptoms:**
```
ERROR: Failed to save scraper log
ENOSPC: no space left on device
```

**Causes:**
- Disk full
- Permission denied
- Corrupt file system

**Solutions:**
```bash
# Check disk space
df -h

# Check permissions
ls -la data/

# Fix permissions
chmod 755 data/
chmod 644 data/*.json

# Clean old logs
rm data/logs/*.log
```

**6. "Scheduler not running"**

**Symptoms:**
- Cron jobs not triggering
- No scraping activity at scheduled time

**Causes:**
- Invalid cron syntax
- Process killed
- System timezone mismatch

**Solutions:**
```bash
# Validate cron schedule
node scripts/scheduler.js --test

# Check process is running
ps aux | grep scheduler

# Run with verbose logging
LOG_LEVEL=debug npm run scrape:schedule

# Check timezone
echo $TZ
# Set if needed: export TZ="Europe/Berlin"
```

### Debug Mode

**Enable verbose logging:**
```bash
# Temporary (current session)
export LOG_LEVEL=debug
npm run scrape:now

# Permanent (.env file)
LOG_LEVEL=debug
LOG_TO_FILE=true
```

**View detailed logs:**
```bash
# Console output
npm run scrape:now

# File logs
tail -f data/logs/scraper.log

# Run history
cat data/scraper-logs.json | jq '.[] | {runId, status, errors}'

# Last run details
cat data/last-scrape-results.json | jq '.'
```

**Browser debugging:**
```bash
# Show browser window (disable headless)
# Edit .env:
HEADLESS_MODE=false

# Then run scraper
node scripts/ebay-scraper.js --set 10316-1
```

## Security Considerations

### Data Privacy

**No Personal Data:**
- System scrapes public data only
- No login credentials required
- No personal information stored
- No cookies/session tracking (currently)

**Data Storage:**
- All scraped data stored locally
- No external API calls except to target websites
- No analytics or tracking
- No cloud uploads (unless explicitly configured)

### Safe Practices

**1. Environment Variables**
```bash
# Never commit .env file
echo ".env" >> .gitignore

# Use .env.example for templates
cp .env.example .env.example.backup
```

**2. Rate Limiting**
- Respect target site's robots.txt
- Use reasonable delays (2-5s between requests)
- Implement backoff on errors
- Avoid parallel scraping by default

**3. Error Logging**
```javascript
// Don't log sensitive data
logger.error('Scraping failed', {
  setId: setId,
  error: error.message
  // ❌ Don't log: full HTML, cookies, headers
});
```

**4. Update Dependencies**
```bash
# Check for security vulnerabilities
npm audit

# Fix automatically
npm audit fix

# Update Puppeteer regularly
npm update puppeteer
```

### Legal Considerations

**Terms of Service:**
- Review target website's ToS
- Respect robots.txt directives
- Implement rate limiting
- Add delays between requests

**Fair Use:**
- Scraping for personal use only
- Non-commercial application
- No reselling of scraped data
- Attribution to data sources

**Robots.txt Compliance:**
```bash
# Check robots.txt
curl https://www.brickeconomy.com/robots.txt
curl https://www.ebay.de/robots.txt

# Respect crawl-delay if specified
# Respect disallowed paths
```

## Maintenance

### Regular Tasks

**Daily:**
- [ ] Monitor scheduler is running (`ps aux | grep scheduler`)
- [ ] Check latest run status (`cat data/last-scrape-results.json`)

**Weekly:**
- [ ] Review error logs for patterns
- [ ] Check data file sizes growing normally
- [ ] Validate scraped data accuracy

**Monthly:**
- [ ] Update dependencies (`npm update`)
- [ ] Review and clean old logs
- [ ] Verify target sites haven't changed structure
- [ ] Backup data directory

**Quarterly:**
- [ ] Review and optimize retry strategies
- [ ] Analyze scraping performance trends
- [ ] Update set URL mappings (new sets)
- [ ] Security audit (`npm audit`)

### Adding New Sets

**1. BrickEconomy:**

Edit `scripts/scrape-brickeconomy.js`:
```javascript
const setUrls = {
  // Existing sets...
  "12345-1": "https://www.brickeconomy.com/set/12345-1/lego-new-set-name",
};
```

**2. Portfolio:**

Edit `data/portfolio.json`:
```json
{
  "sets": [
    {
      "setNumber": "12345-1",
      "name": "New Set Name",
      "theme": "Theme",
      "value": 0,
      "paid": 99.99,
      "qtyNew": 1,
      "qtyUsed": 0
    }
  ]
}
```

**3. Test:**
```bash
node scripts/automated-scraper.js --set 12345-1
```

### Updating Extraction Logic

**When to Update:**
- Target website changes HTML structure
- New data points become available
- Better extraction method discovered
- Anti-bot measures increase

**Update Process:**
1. Create branch: `git checkout -b fix/scraper-update`
2. Test changes with single set: `--set 10316-1`
3. Run dry-run on full portfolio: `--dry-run --all`
4. Review output data format
5. Update tests if applicable
6. Commit and merge

**Example Update:**

```javascript
// Before: Simple selector
const priceEl = document.querySelector('.price');

// After: Multiple fallbacks
function extractPrice() {
  const selectors = [
    '.price-current',
    '.item-price',
    '.price',
    '[data-price]'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return parsePrice(el.textContent);
  }

  return null;
}
```

## Advanced Configuration

### Environment Variables Reference

**Scheduling:**
```bash
SCRAPE_SCHEDULE=0 6 * * *       # Cron pattern (default: daily 6am)
```

**Browser:**
```bash
HEADLESS_MODE=true              # Show browser? (true/false)
VIEWPORT_WIDTH=1920             # Browser width (pixels)
VIEWPORT_HEIGHT=1080            # Browser height (pixels)
USER_AGENT=                     # Custom user agent (optional)
```

**Scraping Behavior:**
```bash
MAX_RETRIES=3                   # Retry attempts (1-10)
RETRY_DELAY=2000                # Initial retry delay (ms)
PAGE_DELAY=1000                 # Delay between pages (ms)
SOURCE_DELAY=3000               # Delay between sources (ms)
REQUEST_TIMEOUT=30000           # Request timeout (ms)
```

**Data Sources:**
```bash
ENABLE_BRICKECONOMY=true        # Enable BrickEconomy scraper
ENABLE_EBAY=true                # Enable eBay scraper
ENABLE_BRICKLINK=false          # Enable BrickLink scraper
EBAY_DOMAINS=ebay.de,ebay.fr    # eBay domains (comma-separated)
```

**Performance:**
```bash
MAX_CONCURRENT_PAGES=1          # Concurrent browser pages (1-5)
STEALTH_MODE=true               # Use stealth mode (true/false)
```

**Logging:**
```bash
LOG_LEVEL=info                  # Log level (debug|info|warn|error)
LOG_TO_FILE=true                # Enable file logging (true/false)
LOG_FILE_PATH=./data/logs/scraper.log  # Log file location
```

### Custom Schedules

**Development (every 15 minutes):**
```bash
SCRAPE_SCHEDULE=*/15 * * * *
```

**Conservative (weekly):**
```bash
SCRAPE_SCHEDULE=0 6 * * 0       # Sundays at 6am
```

**High-frequency (every 6 hours):**
```bash
SCRAPE_SCHEDULE=0 */6 * * *
```

**Business hours only (weekdays 9am-5pm, hourly):**
```bash
SCRAPE_SCHEDULE=0 9-17 * * 1-5
```

## Performance Metrics

### Benchmarks (37 sets)

**Production Environment:**
- Server: Ubuntu 20.04, 2 CPU, 4GB RAM
- Network: ~50ms latency to target sites
- Node.js: v18.x

**Timing Breakdown:**
```
Portfolio load:           <1s
BrickEconomy scraping:    3-5 min   (5-8s per set)
eBay scraping:           4-6 min   (6-10s per set)
Daily snapshot:          2-3 min
Total:                   10-15 min
```

**Resource Usage:**
- CPU: 5-15% average (spikes to 40% during page load)
- Memory: 200-400MB per browser instance
- Disk I/O: Minimal (<1MB/s)
- Network: 1-5 Mbps (page loads)

**Bottlenecks:**
1. Network latency (page loads)
2. Page render time (waitUntil: 'networkidle2')
3. Sequential execution (no parallelization)

### Monitoring

**Key Metrics to Track:**
- Scrape success rate (should be >95%)
- Average duration per set
- Total pipeline duration
- Error frequency by type
- Data completeness (sets with valid prices)

**Monitoring Script (example):**
```bash
#!/bin/bash
# monitor-scraper.sh

LOG_FILE="data/scraper-logs.json"

# Get last 10 runs
RECENT_RUNS=$(cat $LOG_FILE | jq '.[-10:]')

# Calculate success rate
SUCCESS_COUNT=$(echo $RECENT_RUNS | jq '[.[] | select(.status=="success")] | length')
TOTAL_COUNT=$(echo $RECENT_RUNS | jq 'length')
SUCCESS_RATE=$(echo "scale=2; $SUCCESS_COUNT / $TOTAL_COUNT * 100" | bc)

echo "=== Scraper Health ==="
echo "Recent runs: $TOTAL_COUNT"
echo "Successful: $SUCCESS_COUNT"
echo "Success rate: $SUCCESS_RATE%"
echo ""

# Check last run
LAST_RUN=$(cat data/last-scrape-results.json)
LAST_STATUS=$(echo $LAST_RUN | jq -r '.status')
LAST_DURATION=$(echo $LAST_RUN | jq -r '.durationMs')
LAST_DURATION_MIN=$(echo "scale=2; $LAST_DURATION / 60000" | bc)

echo "=== Last Run ==="
echo "Status: $LAST_STATUS"
echo "Duration: ${LAST_DURATION_MIN} minutes"
echo ""

# Check errors
ERROR_COUNT=$(echo $LAST_RUN | jq '.errors | length')
if [ $ERROR_COUNT -gt 0 ]; then
  echo "⚠️  Errors detected: $ERROR_COUNT"
  echo $LAST_RUN | jq '.errors'
else
  echo "✅ No errors"
fi
```

## Future Enhancements

### Planned Features

**1. BrickLink Scraper**
- API integration (requires API key)
- Market price extraction
- Inventory availability

**2. Parallel Scraping**
- Configurable concurrency limit
- Smart queuing with rate limiting
- Reduced total runtime

**3. Intelligent Caching**
- Skip recently scraped sets
- Configurable staleness threshold
- Force refresh flag

**4. Webhook Notifications**
- Discord/Slack integration
- Email alerts on failures
- Success/failure summaries

**5. Data Validation**
- Price anomaly detection
- Data completeness checks
- Historical trend validation

**6. Dashboard Integration**
- Real-time scraping progress
- Live error monitoring
- Manual trigger buttons

**7. Cloud Deployment**
- Docker containerization
- Kubernetes manifests
- Serverless functions (AWS Lambda)

### Contributing

**Setup Development Environment:**
```bash
git clone <repo-url>
cd lego-dashboard
npm install
cp .env.example .env
```

**Run Tests:**
```bash
npm run scrape:dry-run
npm run scrape:now -- --set 10316-1
```

**Submit Changes:**
1. Create feature branch
2. Make changes
3. Test thoroughly
4. Update documentation
5. Submit pull request

## Support

**Documentation:**
- README.md - User guide
- SCRAPING.md - This document (technical reference)
- .env.example - Configuration reference

**Debugging:**
```bash
# Enable debug mode
LOG_LEVEL=debug npm run scrape:now

# View logs
cat data/logs/scraper.log
cat data/scraper-logs.json | jq '.'
```

**Common Commands:**
```bash
# Quick test
npm run scrape:dry-run

# Full scrape
npm run scrape:now

# Single set
node scripts/automated-scraper.js --set 10316-1

# Start scheduler
npm run scrape:schedule

# Help
npm run scrape:help
```

---

**Document Version:** 1.0
**Last Updated:** 2025-01-15
**Maintained By:** Development Team
