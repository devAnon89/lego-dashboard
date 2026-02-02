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
│   ├── scrape-brickeconomy.js
│   ├── ebay-scraper.js
│   ├── daily-snapshot.js
│   └── full-scrape.js
├── data/                 # Source data
│   ├── portfolio.json    # Your sets
│   ├── analysis.json     # Market analysis
│   └── price-history.json
├── lego-cli.js           # CLI tool
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
node lego-cli.js --help

# Scrape prices
node scripts/full-scrape.js
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
