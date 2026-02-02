#!/usr/bin/env node
/**
 * Test Script: Verify AI Prediction Cache Behavior
 *
 * This script tests that:
 * 1. Cache hit returns cached prediction without calling OpenAI API
 * 2. Cache TTL is respected (24hr standard, 12hr volatile)
 * 3. Proper log message "Using cached prediction for..." is displayed
 *
 * Usage:
 *   node scripts/test-cache-behavior.cjs
 */

const fs = require('fs');
const path = require('path');

// Import the AI price predictor module for testing
const aiPredictor = require('./ai-price-predictor.cjs');
const priceAnalyzer = require('./price-analyzer.cjs');
const logger = require('./logger.cjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AI_PREDICTIONS_CACHE_FILE = path.join(DATA_DIR, 'ai-predictions-cache.json');

// Track test results
let testsPassed = 0;
let testsFailed = 0;

function pass(testName) {
  testsPassed++;
  console.log(`✅ PASS: ${testName}`);
}

function fail(testName, reason) {
  testsFailed++;
  console.log(`❌ FAIL: ${testName}`);
  console.log(`   Reason: ${reason}`);
}

/**
 * Test 1: Verify cache functions exist and work correctly
 */
function testCacheFunctions() {
  logger.section('Test 1: Cache Functions Exist');

  // Check exported functions
  const requiredFunctions = [
    'loadPredictionsCache',
    'savePredictionsCache',
    'isVolatileSet',
    'isCacheValid',
    'getCachedPrediction',
    'cachePrediction'
  ];

  for (const fn of requiredFunctions) {
    if (typeof aiPredictor[fn] === 'function') {
      pass(`${fn} function exists`);
    } else {
      fail(`${fn} function exists`, 'Function not exported or not a function');
    }
  }
}

/**
 * Test 2: Verify cache TTL constants
 */
function testCacheTTLConstants() {
  logger.section('Test 2: Cache TTL Constants');

  const expectedStandardTTL = 24 * 60 * 60 * 1000; // 24 hours in ms
  const expectedVolatileTTL = 12 * 60 * 60 * 1000; // 12 hours in ms

  if (aiPredictor.CACHE_TTL_STANDARD === expectedStandardTTL) {
    pass(`Standard TTL is 24 hours (${expectedStandardTTL}ms)`);
  } else {
    fail(`Standard TTL is 24 hours`, `Got ${aiPredictor.CACHE_TTL_STANDARD}ms instead`);
  }

  if (aiPredictor.CACHE_TTL_VOLATILE === expectedVolatileTTL) {
    pass(`Volatile TTL is 12 hours (${expectedVolatileTTL}ms)`);
  } else {
    fail(`Volatile TTL is 12 hours`, `Got ${aiPredictor.CACHE_TTL_VOLATILE}ms instead`);
  }
}

/**
 * Test 3: Verify isCacheValid function
 */
function testIsCacheValid() {
  logger.section('Test 3: isCacheValid Function');

  const now = new Date();

  // Test valid cache (cached 1 hour ago)
  const validCacheEntry = {
    cachedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString() // 1 hour ago
  };

  if (aiPredictor.isCacheValid(validCacheEntry, false)) {
    pass('Valid cache entry (1 hour old) is recognized as valid');
  } else {
    fail('Valid cache entry (1 hour old) is recognized as valid', 'isCacheValid returned false');
  }

  // Test expired cache (cached 25 hours ago for standard)
  const expiredCacheEntry = {
    cachedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString() // 25 hours ago
  };

  if (!aiPredictor.isCacheValid(expiredCacheEntry, false)) {
    pass('Expired cache entry (25 hours old) is recognized as expired');
  } else {
    fail('Expired cache entry (25 hours old) is recognized as expired', 'isCacheValid returned true');
  }

  // Test volatile cache (cached 13 hours ago - should be expired)
  const expiredVolatileEntry = {
    cachedAt: new Date(now.getTime() - 13 * 60 * 60 * 1000).toISOString() // 13 hours ago
  };

  if (!aiPredictor.isCacheValid(expiredVolatileEntry, true)) {
    pass('Expired volatile cache entry (13 hours old) is recognized as expired');
  } else {
    fail('Expired volatile cache entry (13 hours old) is recognized as expired', 'isCacheValid returned true for volatile set');
  }

  // Test null/undefined cache
  if (!aiPredictor.isCacheValid(null, false)) {
    pass('Null cache entry is recognized as invalid');
  } else {
    fail('Null cache entry is recognized as invalid', 'isCacheValid returned true for null');
  }

  if (!aiPredictor.isCacheValid({}, false)) {
    pass('Cache entry without cachedAt is recognized as invalid');
  } else {
    fail('Cache entry without cachedAt is recognized as invalid', 'isCacheValid returned true for entry without cachedAt');
  }
}

/**
 * Test 4: Verify getCachedPrediction returns cached data when valid
 */
function testGetCachedPrediction() {
  logger.section('Test 4: getCachedPrediction Function');

  const now = new Date();

  // Create a mock cache with a fresh entry
  const mockCache = {
    '10316-1': {
      setId: '10316-1',
      setName: 'Test Set',
      cachedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      prediction: { confidence: 'high' }
    }
  };

  // Create a mock price analysis (non-volatile)
  const mockPriceAnalysis = {
    summary: { volatility: 'low' },
    brickEconomy: { trend30d: { percentChange: 5 } }
  };

  // Test cache hit
  const cachedResult = aiPredictor.getCachedPrediction('10316-1', mockCache, mockPriceAnalysis);

  if (cachedResult && cachedResult.setId === '10316-1') {
    pass('getCachedPrediction returns cached data for valid cache');
  } else {
    fail('getCachedPrediction returns cached data for valid cache', 'Returned null or wrong data');
  }

  // Test cache miss (set not in cache)
  const missResult = aiPredictor.getCachedPrediction('99999-1', mockCache, mockPriceAnalysis);

  if (missResult === null) {
    pass('getCachedPrediction returns null for non-existent set');
  } else {
    fail('getCachedPrediction returns null for non-existent set', 'Did not return null');
  }
}

/**
 * Test 5: Verify isVolatileSet function
 */
function testIsVolatileSet() {
  logger.section('Test 5: isVolatileSet Function');

  // High volatility from summary
  const highVolatility = {
    summary: { volatility: 'high' }
  };

  if (aiPredictor.isVolatileSet(highVolatility)) {
    pass('Set with high volatility summary is recognized as volatile');
  } else {
    fail('Set with high volatility summary is recognized as volatile', 'isVolatileSet returned false');
  }

  // High price change in 30 days
  const highPriceChange = {
    brickEconomy: { trend30d: { percentChange: 15 } }
  };

  if (aiPredictor.isVolatileSet(highPriceChange)) {
    pass('Set with >10% 30-day price change is recognized as volatile');
  } else {
    fail('Set with >10% 30-day price change is recognized as volatile', 'isVolatileSet returned false');
  }

  // Low volatility
  const lowVolatility = {
    summary: { volatility: 'low' },
    brickEconomy: { trend30d: { percentChange: 3 } }
  };

  if (!aiPredictor.isVolatileSet(lowVolatility)) {
    pass('Set with low volatility is not recognized as volatile');
  } else {
    fail('Set with low volatility is not recognized as volatile', 'isVolatileSet returned true');
  }
}

/**
 * Test 6: Full integration - verify cache is used on second call
 */
function testCacheIntegration() {
  logger.section('Test 6: Cache Integration Test');

  // Load the actual cache file
  const cache = aiPredictor.loadPredictionsCache();
  const predictions = cache.predictions || cache;

  // Check if cache has predictions
  const predictionKeys = Object.keys(predictions).filter(k => k !== 'metadata');

  if (predictionKeys.length > 0) {
    pass(`Cache file contains ${predictionKeys.length} predictions`);

    // Check first prediction has required fields
    const firstKey = predictionKeys[0];
    const firstPrediction = predictions[firstKey];

    if (firstPrediction.cachedAt) {
      pass(`Prediction for ${firstKey} has cachedAt timestamp`);
    } else {
      fail(`Prediction for ${firstKey} has cachedAt timestamp`, 'cachedAt missing');
    }

    if (firstPrediction.prediction) {
      pass(`Prediction for ${firstKey} has prediction data`);
    } else {
      fail(`Prediction for ${firstKey} has prediction data`, 'prediction object missing');
    }
  } else {
    fail('Cache file contains predictions', 'No predictions found in cache');
  }
}

/**
 * Test 7: Verify the log message format for cache hit
 */
function testCacheHitLogMessage() {
  logger.section('Test 7: Cache Hit Log Message Format');

  // Intercept logger.info to capture log messages
  const originalInfo = logger.info;
  let capturedMessages = [];

  logger.info = function(message) {
    capturedMessages.push(message);
    // Don't actually log during this test
  };

  const now = new Date();

  // Create a mock cache with a fresh entry
  const mockCache = {
    '10316-1': {
      setId: '10316-1',
      setName: 'Test Set',
      cachedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      prediction: { confidence: 'high' }
    }
  };

  const mockPriceAnalysis = {
    summary: { volatility: 'low' },
    brickEconomy: { trend30d: { percentChange: 5 } }
  };

  // Call getCachedPrediction which should log
  aiPredictor.getCachedPrediction('10316-1', mockCache, mockPriceAnalysis);

  // Restore original logger
  logger.info = originalInfo;

  // Check if the expected message was logged
  const expectedPattern = /Using cached prediction for 10316-1/;
  const foundMessage = capturedMessages.some(msg => expectedPattern.test(msg));

  if (foundMessage) {
    pass('Cache hit logs "Using cached prediction for..." message');
    console.log(`   Captured: "${capturedMessages.find(msg => expectedPattern.test(msg))}"`);
  } else {
    fail('Cache hit logs "Using cached prediction for..." message',
         `Messages captured: ${JSON.stringify(capturedMessages)}`);
  }
}

/**
 * Test 8: Simulate running twice - verify cache prevents API call
 */
function testSecondRunUsesCache() {
  logger.section('Test 8: Second Run Uses Cache (Simulation)');

  // This test simulates what happens when ai-price-predictor.cjs is run twice
  // for the same set. On the second run, the cache should be used.

  const now = new Date();
  const cache = {};

  // Simulate first run: cache prediction
  const prediction = {
    setId: '10316-1',
    setName: 'Test Set',
    prediction: { '1yr': { value: 500 }, confidence: 'high' }
  };

  const priceAnalysis = {
    summary: { volatility: 'low' },
    brickEconomy: { trend30d: { percentChange: 5 } }
  };

  const isVolatile = aiPredictor.isVolatileSet(priceAnalysis);

  // Cache the prediction (simulating first run)
  const cachedPrediction = aiPredictor.cachePrediction('10316-1', prediction, cache, isVolatile);

  if (cachedPrediction.cachedAt && cachedPrediction.ttlType) {
    pass('First run caches prediction with metadata');
  } else {
    fail('First run caches prediction with metadata', 'Missing cachedAt or ttlType');
  }

  // Simulate second run: should get from cache
  const secondRunResult = aiPredictor.getCachedPrediction('10316-1', cache, priceAnalysis);

  if (secondRunResult && secondRunResult.setId === '10316-1') {
    pass('Second run retrieves prediction from cache');
    console.log('   ✓ OpenAI API would NOT be called on second run');
  } else {
    fail('Second run retrieves prediction from cache', 'Cache miss on second run');
  }
}

/**
 * Main test runner
 */
function runTests() {
  logger.section('AI Prediction Cache Behavior Tests');
  console.log('Testing that cache hit behavior works correctly...\n');

  testCacheFunctions();
  testCacheTTLConstants();
  testIsCacheValid();
  testGetCachedPrediction();
  testIsVolatileSet();
  testCacheIntegration();
  testCacheHitLogMessage();
  testSecondRunUsesCache();

  // Summary
  logger.section('Test Summary');
  console.log(`\nTotal: ${testsPassed + testsFailed} tests`);
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n✅ All cache behavior tests passed!');
    console.log('\nVerification Complete:');
    console.log('  ✓ Cache functions are properly implemented');
    console.log('  ✓ Cache TTL (24hr standard, 12hr volatile) is correct');
    console.log('  ✓ Second load uses cached prediction (no OpenAI API call)');
    console.log('  ✓ Console output shows "Using cached prediction for..."');
    return 0;
  } else {
    console.log('\n❌ Some tests failed - see details above');
    return 1;
  }
}

// Run tests
const exitCode = runTests();
process.exit(exitCode);
