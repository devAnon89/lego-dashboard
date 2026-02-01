#!/usr/bin/env node
/**
 * Full BrickEconomy Scraper
 * Scrapes all portfolio sets for price history and predictions
 * 
 * This script outputs commands to be run through browser automation
 */

const fs = require('fs');
const path = require('path');

// Load portfolio
const portfolioFile = path.join(__dirname, '..', 'data', 'portfolio.json');
const portfolio = JSON.parse(fs.readFileSync(portfolioFile, 'utf-8'));

// Map of set IDs to BrickEconomy URLs
// BrickEconomy URLs follow pattern: /set/{setId}/lego-{theme}-{name-slug}
const setUrls = {
  "10316-1": "https://www.brickeconomy.com/set/10316-1/lego-the-lord-of-the-rings-rivendell",
  "10330-1": "https://www.brickeconomy.com/set/10330-1/lego-mclaren-mp4-4-ayrton-senna",
  "10342-1": "https://www.brickeconomy.com/set/10342-1/lego-botanical-collection-pretty-pink-flower-bouquet",
  "21276-1": "https://www.brickeconomy.com/set/21276-1/lego-minecraft-the-creeper",
  "21279-1": "https://www.brickeconomy.com/set/21279-1/lego-minecraft-the-enderman-tower",
  "21345-1": "https://www.brickeconomy.com/set/21345-1/lego-ideas-polaroid-onestep-sx-70-camera",
  "31165-1": "https://www.brickeconomy.com/set/31165-1/lego-creator-3-in-1-wild-animals-panda-family",
  "31218-1": "https://www.brickeconomy.com/set/31218-1/lego-art-japanese-cherry-blossom-landscape",
  "40499-1": "https://www.brickeconomy.com/set/40499-1/lego-holiday-christmas-santas-sleigh",
  "40573-1": "https://www.brickeconomy.com/set/40573-1/lego-holiday-christmas-christmas-tree",
  "40674-1": "https://www.brickeconomy.com/set/40674-1/lego-brickheadz-stitch",
  "40779-1": "https://www.brickeconomy.com/set/40779-1/lego-year-of-the-snake",  // Actually year of the horse
  "40922-1": "https://www.brickeconomy.com/set/40922-1/lego-brickheadz-lilo-stitch-angel",
  "42115-1": "https://www.brickeconomy.com/set/42115-1/lego-technic-lamborghini-sian-fkp-37",
  "42143-1": "https://www.brickeconomy.com/set/42143-1/lego-technic-ferrari-daytona-sp3",
  "42161-1": "https://www.brickeconomy.com/set/42161-1/lego-technic-lamborghini-huracan-tecnica",
  "42172-1": "https://www.brickeconomy.com/set/42172-1/lego-technic-mclaren-p1",
  "42204-1": "https://www.brickeconomy.com/set/42204-1/lego-fast-furious-toyota-supra-mk4",
  "42210-1": "https://www.brickeconomy.com/set/42210-1/lego-technic-2-fast-2-furious-nissan-skyline-gt-r-r34",
  "43257-1": "https://www.brickeconomy.com/set/43257-1/lego-disney-lilo-stitch-angel",
  "71438-1": "https://www.brickeconomy.com/set/71438-1/lego-super-mario-super-mario-world-mario-yoshi",
  "72037-1": "https://www.brickeconomy.com/set/72037-1/lego-super-mario-mario-kart-mario-standard-kart",
  "72046-1": "https://www.brickeconomy.com/set/72046-1/lego-super-mario-game-boy",
  "75682-1": "https://www.brickeconomy.com/set/75682-1/lego-wicked-elphaba-glinda",
  "76191-1": "https://www.brickeconomy.com/set/76191-1/lego-marvel-super-heroes-infinity-gauntlet",
  "76223-1": "https://www.brickeconomy.com/set/76223-1/lego-marvel-super-heroes-nano-gauntlet",
  "76912-1": "https://www.brickeconomy.com/set/76912-1/lego-speed-champions-fast-furious-1970-dodge-charger-rt",
  "76917-1": "https://www.brickeconomy.com/set/76917-1/lego-speed-champions-2-fast-2-furious-nissan-skyline-gt-r-r34",
  "76922-1": "https://www.brickeconomy.com/set/76922-1/lego-speed-champions-bmw-m4-gt3-bmw-m-hybrid-v8",
  "76934-1": "https://www.brickeconomy.com/set/76934-1/lego-speed-champions-ferrari-f40",
  "77073-1": "https://www.brickeconomy.com/set/77073-1/lego-fortnite-battle-bus",
  "77237-1": "https://www.brickeconomy.com/set/77237-1/lego-speed-champions-dodge-challenger-srt-hellcat",
  "77239-1": "https://www.brickeconomy.com/set/77239-1/lego-speed-champions-porsche-911-gt3-rs",
  "77241-1": "https://www.brickeconomy.com/set/77241-1/lego-speed-champions-2-fast-2-furious-honda-s2000",
  "77253-1": "https://www.brickeconomy.com/set/77253-1/lego-speed-champions-bugatti-vision-gt",
  "77254-1": "https://www.brickeconomy.com/set/77254-1/lego-speed-champions-ferrari-sf90-xx-stradale",
  "77255-1": "https://www.brickeconomy.com/set/77255-1/lego-speed-champions-lightning-mcqueen"
};

// Output all URLs
console.log('Sets to scrape:', Object.keys(setUrls).length);
Object.entries(setUrls).forEach(([id, url]) => {
  console.log(`${id}: ${url}`);
});

module.exports = { setUrls };
