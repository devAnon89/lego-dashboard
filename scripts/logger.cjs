/**
 * Shared Logger Utility
 * Provides consistent logging across all scraper scripts with timestamps and log levels
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('Operation completed');
 *   logger.warn('Potential issue detected');
 *   logger.error('Operation failed', error);
 */

const fs = require('fs');
const path = require('path');

// Log levels
const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

// Get log level from environment or default to INFO
const currentLogLevel = process.env.LOG_LEVEL || 'INFO';

// Determine if file logging is enabled
const fileLoggingEnabled = process.env.LOG_TO_FILE === 'true';
const logDir = path.join(__dirname, '..', 'data', 'logs');
const logFile = path.join(logDir, 'scraper.log');

// Ensure log directory exists if file logging is enabled
if (fileLoggingEnabled && !fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Format a log message with timestamp and level
 */
function formatMessage(level, message, data) {
  const timestamp = new Date().toISOString();
  let formatted = `[${timestamp}] [${level}] ${message}`;

  if (data) {
    if (data instanceof Error) {
      formatted += `\n  Error: ${data.message}`;
      if (data.stack) {
        formatted += `\n  Stack: ${data.stack}`;
      }
    } else if (typeof data === 'object') {
      formatted += `\n  Data: ${JSON.stringify(data, null, 2)}`;
    } else {
      formatted += ` ${data}`;
    }
  }

  return formatted;
}

/**
 * Write log message to file if enabled
 */
function writeToFile(message) {
  if (fileLoggingEnabled) {
    try {
      fs.appendFileSync(logFile, message + '\n');
    } catch (error) {
      // Fail silently for file logging errors to avoid recursion
      console.error('Failed to write to log file:', error.message);
    }
  }
}

/**
 * Log an info message
 */
function info(message, data) {
  const formatted = formatMessage(LOG_LEVELS.INFO, message, data);
  console.log(formatted);
  writeToFile(formatted);
}

/**
 * Log a warning message
 */
function warn(message, data) {
  const formatted = formatMessage(LOG_LEVELS.WARN, message, data);
  console.warn(formatted);
  writeToFile(formatted);
}

/**
 * Log an error message
 */
function error(message, data) {
  const formatted = formatMessage(LOG_LEVELS.ERROR, message, data);
  console.error(formatted);
  writeToFile(formatted);
}

/**
 * Log a debug message (only if LOG_LEVEL is DEBUG)
 */
function debug(message, data) {
  if (currentLogLevel === 'DEBUG') {
    const formatted = formatMessage(LOG_LEVELS.DEBUG, message, data);
    console.log(formatted);
    writeToFile(formatted);
  }
}

/**
 * Create a section divider for better log readability
 */
function section(title) {
  const divider = '='.repeat(60);
  const formatted = `\n${divider}\n${title}\n${divider}`;
  console.log(formatted);
  writeToFile(formatted);
}

// Export logger methods
module.exports = {
  info,
  warn,
  error,
  debug,
  section,
  LOG_LEVELS
};
