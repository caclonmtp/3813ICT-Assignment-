const provider = (process.env.MEAN_CHAT_DB_PROVIDER || 'mongo').trim().toLowerCase();

if (provider && provider !== 'mongo') {
  console.warn(`[db] Provider "${provider}" is no longer supported. Defaulting to MongoDB.`);
}

let implementation;
try {
  implementation = require('./db-mongo');
} catch (err) {
  console.error(`[db] Failed to load MongoDB provider: ${err?.message || err}`);
  throw err;
}

module.exports = implementation;
