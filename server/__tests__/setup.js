const os = require('os');
const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let uploadRoot;

async function globalBefore() {
  mongoServer = await MongoMemoryServer.create();
  process.env.MEAN_CHAT_MONGO_URI = mongoServer.getUri();
  process.env.MEAN_CHAT_DB_PROVIDER = 'mongo';
  process.env.MEAN_CHAT_MEDIA_SECRET = 'test-secret';

  uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mean-chat-uploads-'));
  process.env.MEAN_CHAT_UPLOAD_ROOT = uploadRoot;
}

async function globalAfter() {
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
  delete process.env.MEAN_CHAT_UPLOAD_ROOT;
}

module.exports = {
  mochaHooks: {
    beforeAll() {
      this.timeout?.(60000);
      return globalBefore();
    },
    afterAll() {
      this.timeout?.(30000);
      return globalAfter();
    }
  }
};
