console.log('[cypress] Loading custom config');
const { defineConfig } = require('cypress');
const { MongoMemoryServer } = require('mongodb-memory-server');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../../server/lib/db');
let mongoServer;
let uploadRoot;
let serverModule;
let serverStarted = false;

async function startServer() {
  if (serverStarted) {
    return;
  }
  mongoServer = await MongoMemoryServer.create();
  process.env.MEAN_CHAT_MONGO_URI = mongoServer.getUri();
  process.env.MEAN_CHAT_DB_PROVIDER = 'mongo';
  process.env.MEAN_CHAT_MEDIA_SECRET = 'test-secret';
  process.env.MEAN_CHAT_MONGO_DB = `mean-chat-e2e-${Date.now()}`;
  uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mean-chat-uploads-'));
  process.env.MEAN_CHAT_UPLOAD_ROOT = uploadRoot;

  serverModule = require('../../server/server');
  await serverModule.start();
  serverStarted = true;
}

async function stopServer() {
  if (!serverStarted) {
    return;
  }
  if (serverModule && typeof serverModule.stop === 'function') {
    await serverModule.stop();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
  if (uploadRoot) {
    fs.rmSync(uploadRoot, { recursive: true, force: true });
    uploadRoot = null;
  }
  delete process.env.MEAN_CHAT_MONGO_URI;
  delete process.env.MEAN_CHAT_DB_PROVIDER;
  delete process.env.MEAN_CHAT_MEDIA_SECRET;
  delete process.env.MEAN_CHAT_UPLOAD_ROOT;
  delete process.env.MEAN_CHAT_MONGO_DB;
  serverModule = undefined;
  serverStarted = false;
}

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://127.0.0.1:3000',
    supportFile: false,
    video: false,
    async setupNodeEvents(on) {
      await startServer();

      on('task', {
        async resetDb() {
          await startServer();
          process.env.MEAN_CHAT_MONGO_DB = `mean-chat-e2e-${Date.now()}`;
          await db.closeDb();
          await db.initDb();
          return null;
        }
      });

      on('after:run', async () => {
        await stopServer();
      });
    }
  }
});
