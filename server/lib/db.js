const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'bd.json');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      users: [
        {
          id: 'u_super',
          username: 'super',
          email: 'super@admin.com',
          password: '123',
          roles: ['super-admin'],
          groups: []
        }
      ],
      groups: [],
      channels: [],
      messages: []
    };
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readDB() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function genId(prefix = '') {
  const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return prefix + rand.slice(0, 16);
}

module.exports = { readDB, writeDB, genId, DB_PATH };

