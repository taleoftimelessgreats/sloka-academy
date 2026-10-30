'use strict';

const path = require('node:path');
const { PROJECT_ROOT } = require('./config');

// Load ./.env with Node's built-in loader if it exists (no dotenv dependency).
// Variables already set in the real environment take precedence.
function loadDotEnv() {
  try {
    process.loadEnvFile(path.join(PROJECT_ROOT, '.env'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { loadDotEnv };
