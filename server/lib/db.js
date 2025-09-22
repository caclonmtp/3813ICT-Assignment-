const fs = require('fs');
const path = require('path');
const DatabaseSync = require('better-sqlite3');

const DB_PATH = process.env.MEAN_CHAT_DB_PATH
  ? path.resolve(process.env.MEAN_CHAT_DB_PATH)
  : path.join(__dirname, '..', 'data', 'app.db');

let db;
let initPromise;

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function runMigrations() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      password TEXT NOT NULL,
      roles TEXT NOT NULL DEFAULT '[]',
      groups TEXT NOT NULL DEFAULT '[]'
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      admins TEXT NOT NULL DEFAULT '[]',
      members TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      banned_user_ids TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );
  `);
}

function ensureDefaultSuperUser() {
  const database = getDb();
  const row = database.prepare(`SELECT COUNT(*) AS count FROM users WHERE lower(username) = 'super'`).get();
  const count = row ? Number(row.count) : 0;
  if (!count) {
    database
      .prepare(
        `INSERT INTO users (id, username, email, password, roles, groups)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('u_super', 'super', 'super@admin.com', '123', JSON.stringify(['super-admin']), JSON.stringify([]));
  }
}

async function initDb() {
  if (!initPromise) {
    initPromise = Promise.resolve().then(() => {
      if (!db) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
        db = new DatabaseSync(DB_PATH);
        db.exec('PRAGMA foreign_keys = ON');
      }
      runMigrations();
      ensureDefaultSuperUser();
      return db;
    });
  }

  await initPromise;
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
    initPromise = null;
  }
}

function withTransaction(fn) {
  const database = getDb();
  database.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

function genId(prefix = '') {
  const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return prefix + rand.slice(0, 16);
}
function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) || typeof parsed === 'object' ? parsed : fallback;
    } catch (err) {
      return fallback;
    }
  }
  return fallback;
}

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    password: row.password,
    roles: parseJson(row.roles, []),
    groups: parseJson(row.groups, [])
  };
}

function mapGroupRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    admins: parseJson(row.admins, []),
    members: parseJson(row.members, []),
    createdAt: Number(row.created_at)
  };
}

function mapChannelRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    bannedUserIds: parseJson(row.banned_user_ids, [])
  };
}

function mapMessageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    groupId: row.group_id,
    channelId: row.channel_id,
    userId: row.user_id,
    username: row.username,
    content: row.content,
    timestamp: Number(row.timestamp)
  };
}

async function listUsers() {
  await initDb();
  const rows = getDb()
    .prepare('SELECT id, username, email, password, roles, groups FROM users ORDER BY username ASC')
    .all();
  return rows.map(mapUserRow);
}

async function getUserById(id) {
  await initDb();
  const row = getDb()
    .prepare('SELECT id, username, email, password, roles, groups FROM users WHERE id = ?')
    .get(id);
  return mapUserRow(row);
}

async function findUserByUsername(usernameLower) {
  await initDb();
  const row = getDb()
    .prepare('SELECT id, username, email, password, roles, groups FROM users WHERE lower(username) = ?')
    .get(usernameLower);
  return mapUserRow(row);
}

async function findUserByCredentials(usernameLower, password) {
  await initDb();
  const row = getDb()
    .prepare(
      `SELECT id, username, email, password, roles, groups
         FROM users
        WHERE lower(username) = ? AND password = ?
        LIMIT 1`
    )
    .get(usernameLower, password);
  return mapUserRow(row);
}

async function createUser(user) {
  await initDb();
  const id = user.id || genId('u_');
  const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : ['user'];
  const groups = Array.isArray(user.groups) ? user.groups : [];
  getDb()
    .prepare(
      `INSERT INTO users (id, username, email, password, roles, groups)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, user.username, user.email, user.password, JSON.stringify(roles), JSON.stringify(groups));
  return getUserById(id);
}

async function updateUser(id, updates) {
  await initDb();
  const assignments = [];
  const params = [];
  if (Object.prototype.hasOwnProperty.call(updates, 'username')) {
    assignments.push('username = ?');
    params.push(updates.username);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
    assignments.push('email = ?');
    params.push(updates.email);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'password')) {
    assignments.push('password = ?');
    params.push(updates.password);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'roles')) {
    assignments.push('roles = ?');
    params.push(JSON.stringify(updates.roles ?? []));
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'groups')) {
    assignments.push('groups = ?');
    params.push(JSON.stringify(updates.groups ?? []));
  }
  if (!assignments.length) {
    return getUserById(id);
  }
  params.push(id);
  getDb()
    .prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`)
    .run(...params);
  return getUserById(id);
}

async function setUserRoles(id, roles) {
  return updateUser(id, { roles });
}

async function addRoleToUser(id, role) {
  const user = await getUserById(id);
  if (!user) return null;
  const roles = Array.isArray(user.roles) ? [...user.roles] : [];
  if (!roles.includes(role)) {
    roles.push(role);
    await updateUser(id, { roles });
  }
  return getUserById(id);
}

async function deleteUser(id, reassignedTo) {
  await initDb();
  return withTransaction(() => {
    const database = getDb();
    const row = database
      .prepare('SELECT id, username, email, password, roles, groups FROM users WHERE id = ?')
      .get(id);
    if (!row) return null;
    const user = mapUserRow(row);

    const groups = database
      .prepare('SELECT id, name, created_by, admins, members, created_at FROM groups')
      .all();

    for (const groupRow of groups) {
      const group = mapGroupRow(groupRow);
      const admins = group.admins.filter(a => a !== id);
      const members = group.members.filter(m => m !== id);
      const createdBy = group.createdBy === id ? reassignedTo || group.createdBy : group.createdBy;
      if (
        admins.length !== group.admins.length ||
        members.length !== group.members.length ||
        createdBy !== group.createdBy
      ) {
        database
          .prepare('UPDATE groups SET admins = ?, members = ?, created_by = ? WHERE id = ?')
          .run(JSON.stringify(admins), JSON.stringify(members), createdBy, group.id);
      }
    }

    database.prepare('DELETE FROM users WHERE id = ?').run(id);
    return user;
  });
}

async function listGroups() {
  await initDb();
  const rows = getDb()
    .prepare('SELECT id, name, created_by, admins, members, created_at FROM groups ORDER BY created_at ASC')
    .all();
  return rows.map(mapGroupRow);
}

async function listGroupsForUser(userId, includeAll = false) {
  if (includeAll) {
    return listGroups();
  }
  const groups = await listGroups();
  return groups.filter(g => g.members.includes(userId) || g.admins.includes(userId));
}

async function getGroupById(id) {
  await initDb();
  const row = getDb()
    .prepare('SELECT id, name, created_by, admins, members, created_at FROM groups WHERE id = ?')
    .get(id);
  return mapGroupRow(row);
}

async function createGroup({ name, createdBy }) {
  await initDb();
  const id = genId('g_');
  const now = Date.now();
  const payload = JSON.stringify([createdBy]);
  getDb()
    .prepare(
      `INSERT INTO groups (id, name, created_by, admins, members, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, name, createdBy, payload, payload, now);
  return getGroupById(id);
}

async function deleteGroup(groupId) {
  await initDb();
  return withTransaction(() => {
    const database = getDb();
    const row = database
      .prepare('SELECT id, name, created_by, admins, members, created_at FROM groups WHERE id = ?')
      .get(groupId);
    if (!row) return null;
    database.prepare('DELETE FROM messages WHERE group_id = ?').run(groupId);
    database.prepare('DELETE FROM channels WHERE group_id = ?').run(groupId);
    database.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
    return mapGroupRow(row);
  });
}

async function addGroupMember(groupId, userId) {
  await initDb();
  return withTransaction(() => {
    const database = getDb();
    const row = database
      .prepare('SELECT id, name, created_by, admins, members, created_at FROM groups WHERE id = ?')
      .get(groupId);
    if (!row) return null;
    const group = mapGroupRow(row);
    const members = group.members.includes(userId) ? group.members : [...group.members, userId];
    database
      .prepare('UPDATE groups SET members = ? WHERE id = ?')
      .run(JSON.stringify(members), groupId);
    return { ...group, members };
  });
}

async function removeGroupMember(groupId, userId) {
  await initDb();
  return withTransaction(() => {
    const database = getDb();
    const row = database
      .prepare('SELECT id, name, created_by, admins, members, created_at FROM groups WHERE id = ?')
      .get(groupId);
    if (!row) return null;
    const group = mapGroupRow(row);
    const members = group.members.filter(m => m !== userId);
    const admins = group.admins.filter(a => a !== userId);
    database
      .prepare('UPDATE groups SET members = ?, admins = ? WHERE id = ?')
      .run(JSON.stringify(members), JSON.stringify(admins), groupId);
    return { ...group, members, admins };
  });
}

async function listChannelsByGroupId(groupId) {
  await initDb();
  const rows = getDb()
    .prepare(
      'SELECT id, group_id, name, created_by, created_at, banned_user_ids FROM channels WHERE group_id = ? ORDER BY created_at ASC'
    )
    .all(groupId);
  return rows.map(mapChannelRow);
}

async function getChannelById(channelId) {
  await initDb();
  const row = getDb()
    .prepare('SELECT id, group_id, name, created_by, created_at, banned_user_ids FROM channels WHERE id = ?')
    .get(channelId);
  return mapChannelRow(row);
}

async function createChannel({ groupId, name, createdBy }) {
  await initDb();
  const id = genId('c_');
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO channels (id, group_id, name, created_by, created_at, banned_user_ids)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, groupId, name, createdBy, now, JSON.stringify([]));
  return getChannelById(id);
}

async function deleteChannel(channelId) {
  await initDb();
  return withTransaction(() => {
    const database = getDb();
    const row = database
      .prepare('SELECT id, group_id, name, created_by, created_at, banned_user_ids FROM channels WHERE id = ?')
      .get(channelId);
    if (!row) return null;
    database.prepare('DELETE FROM messages WHERE channel_id = ?').run(channelId);
    database.prepare('DELETE FROM channels WHERE id = ?').run(channelId);
    return mapChannelRow(row);
  });
}

async function updateChannelBans(channelId, bannedUserIds) {
  await initDb();
  getDb()
    .prepare('UPDATE channels SET banned_user_ids = ? WHERE id = ?')
    .run(JSON.stringify(bannedUserIds), channelId);
  return getChannelById(channelId);
}

async function listAllChannels() {
  await initDb();
  const rows = getDb()
    .prepare('SELECT id, group_id, name, created_by, created_at, banned_user_ids FROM channels ORDER BY created_at ASC')
    .all();
  return rows.map(mapChannelRow);
}

async function listMessages({ groupId, channelId, limit = 50 } = {}) {
  await initDb();
  const clauses = [];
  const params = [];
  if (groupId) {
    clauses.push('group_id = ?');
    params.push(groupId);
  }
  if (channelId) {
    clauses.push('channel_id = ?');
    params.push(channelId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT id, group_id, channel_id, user_id, username, content, timestamp FROM messages ${where} ORDER BY timestamp ASC`;
  const rows = getDb().prepare(sql).all(...params);
  const messages = rows.map(mapMessageRow);
  if (limit && messages.length > limit) {
    return messages.slice(messages.length - limit);
  }
  return messages;
}

async function createMessage({ groupId, channelId, userId, username, content }) {
  await initDb();
  const id = genId('m_');
  const timestamp = Date.now();
  getDb()
    .prepare(
      `INSERT INTO messages (id, group_id, channel_id, user_id, username, content, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, groupId, channelId, userId, username, content, timestamp);
  return { id, groupId, channelId, userId, username, content, timestamp };
}

async function exportData() {
  const [users, groups, channels, messages] = await Promise.all([
    listUsers(),
    listGroups(),
    listAllChannels(),
    listMessages({ limit: 0 })
  ]);
  return { users, groups, channels, messages };
}

async function importData(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid data payload');
  await initDb();
  const users = Array.isArray(data.users) ? data.users : [];
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const messages = Array.isArray(data.messages) ? data.messages : [];

  withTransaction(() => {
    const database = getDb();
    database.exec('DELETE FROM messages');
    database.exec('DELETE FROM channels');
    database.exec('DELETE FROM groups');
    database.exec('DELETE FROM users');

    for (const user of users) {
      database
        .prepare(
          `INSERT INTO users (id, username, email, password, roles, groups)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          user.id || genId('u_'),
          user.username,
          user.email,
          user.password,
          JSON.stringify(Array.isArray(user.roles) ? user.roles : []),
          JSON.stringify(Array.isArray(user.groups) ? user.groups : [])
        );
    }

    for (const group of groups) {
      database
        .prepare(
          `INSERT INTO groups (id, name, created_by, admins, members, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          group.id || genId('g_'),
          group.name,
          group.createdBy || group.created_by || 'u_super',
          JSON.stringify(Array.isArray(group.admins) ? group.admins : []),
          JSON.stringify(Array.isArray(group.members) ? group.members : []),
          Number(group.createdAt ?? group.created_at ?? Date.now())
        );
    }

    for (const channel of channels) {
      database
        .prepare(
          `INSERT INTO channels (id, group_id, name, created_by, created_at, banned_user_ids)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          channel.id || genId('c_'),
          channel.groupId || channel.group_id,
          channel.name,
          channel.createdBy || channel.created_by,
          Number(channel.createdAt ?? channel.created_at ?? Date.now()),
          JSON.stringify(
            Array.isArray(channel.bannedUserIds || channel.banned_user_ids)
              ? channel.bannedUserIds || channel.banned_user_ids
              : []
          )
        );
    }

    for (const message of messages) {
      database
        .prepare(
          `INSERT INTO messages (id, group_id, channel_id, user_id, username, content, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          message.id || genId('m_'),
          message.groupId || message.group_id,
          message.channelId || message.channel_id,
          message.userId || message.user_id,
          message.username,
          message.content,
          Number(message.timestamp ?? Date.now())
        );
    }
  });

  ensureDefaultSuperUser();
}

module.exports = {
  initDb,
  genId,
  listUsers,
  getUserById,
  findUserByUsername,
  findUserByCredentials,
  createUser,
  updateUser,
  setUserRoles,
  addRoleToUser,
  deleteUser,
  listGroups,
  listGroupsForUser,
  getGroupById,
  createGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  listChannelsByGroupId,
  getChannelById,
  createChannel,
  deleteChannel,
  updateChannelBans,
  listMessages,
  createMessage,
  exportData,
  importData,
  closeDb
};
