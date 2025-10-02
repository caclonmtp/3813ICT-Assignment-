const { MongoClient } = require('mongodb');
const crypto = require('crypto');

function resolveMongoUri() {
  return process.env.MEAN_CHAT_MONGO_URI || 'mongodb://127.0.0.1:27017';
}

function resolveMongoDb() {
  return process.env.MEAN_CHAT_MONGO_DB || 'mean_chat';
}

let client;
let database;
let initPromise;

const PASSWORD_SIGNATURE = 'pbkdf2';
const PBKDF2_ITERATIONS = Number(process.env.MEAN_CHAT_PBKDF2_ITERATIONS || 120000);
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

function hashPassword(password) {
  if (typeof password !== 'string' || !password.trim()) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  return `${PASSWORD_SIGNATURE}$${PBKDF2_ITERATIONS}$${salt}$${derived}`;
}

function isHashedPassword(password) {
  return typeof password === 'string' && password.startsWith(`${PASSWORD_SIGNATURE}$`);
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored) {
    return false;
  }
  if (!isHashedPassword(stored)) {
    return stored === password;
  }
  const [, iterStr, salt, hash] = stored.split('$');
  const iterations = Number(iterStr) || PBKDF2_ITERATIONS;
  const derived = crypto
    .pbkdf2Sync(password, salt, iterations, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

function genId(prefix = '') {
  const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return prefix + rand.slice(0, 16);
}

function getDb() {
  if (!database) {
    throw new Error('Database not initialized');
  }
  return database;
}

async function initDb() {
  if (!initPromise) {
    initPromise = (async () => {
      const uri = resolveMongoUri();
      client = new MongoClient(uri, {
        maxPoolSize: Number(process.env.MEAN_CHAT_MONGO_MAX_POOL || 10),
        serverSelectionTimeoutMS: Number(process.env.MEAN_CHAT_MONGO_TIMEOUT || 5000)
      });
      await client.connect();
      const dbName = resolveMongoDb();
      database = client.db(dbName);

      await configureIndexes();
      await ensureDefaultSuperUser();
      return database;
    })();
  }

  await initPromise;
  return database;
}

async function configureIndexes() {
  const db = getDb();
  await Promise.all([
    db.collection('users').createIndex({ usernameLower: 1 }, { unique: true }),
    db.collection('users').createIndex(
      { emailLower: 1 },
      {
        unique: true,
        name: 'emailLower_unique',
        partialFilterExpression: { emailLower: { $exists: true, $type: 'string' } }
      }
    ),
    db.collection('groups').createIndex({ id: 1 }, { unique: true }),
    db.collection('channels').createIndex({ id: 1 }, { unique: true }),
    db.collection('channels').createIndex({ groupId: 1 }),
    db.collection('groups').createIndex({ members: 1 }),
    db.collection('groups').createIndex({ admins: 1 }),
    db.collection('groups').createIndex({ createdAt: -1 }),
    db.collection('messages').createIndex({ channelId: 1, timestamp: -1 }),
    db.collection('messages').createIndex({ groupId: 1, timestamp: -1 }),
    db.collection('messages').createIndex({ userId: 1, timestamp: -1 })
  ]);
}

async function ensureDefaultSuperUser() {
  const db = getDb();
  const existing = await db.collection('users').findOne({ usernameLower: 'super' });
  const superPayload = {
    id: 'u_super',
    username: 'super',
    usernameLower: 'super',
    email: 'super@admin.com',
    emailLower: 'super@admin.com',
    password: hashPassword('123'),
    roles: ['super-admin'],
    groups: [],
    avatarUrl: null,
    createdAt: Date.now()
  };
  if (!existing) {
    await db.collection('users').insertOne(superPayload);
  } else if (!isHashedPassword(existing.password)) {
    await db.collection('users').updateOne(
      { id: existing.id },
      {
        $set: {
          password: superPayload.password,
          emailLower: existing.email ? existing.email.toLowerCase() : null
        }
      }
    );
  }
}

function mapUser(doc) {
  if (!doc) return null;
  const { _id, usernameLower, emailLower, password, ...rest } = doc;
  return rest;
}

function mapGroup(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

function mapChannel(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

function mapMessage(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

async function listUsers() {
  await initDb();
  const users = await getDb()
    .collection('users')
    .find({}, { projection: { _id: 0 } })
    .sort({ usernameLower: 1 })
    .toArray();
  return users.map(mapUser);
}

async function getUserById(id) {
  await initDb();
  const doc = await getDb()
    .collection('users')
    .findOne({ id }, { projection: { _id: 0 } });
  return mapUser(doc);
}

async function findUserByUsername(usernameLower) {
  await initDb();
  const doc = await getDb()
    .collection('users')
    .findOne({ usernameLower }, { projection: { _id: 0 } });
  return mapUser(doc);
}

async function findUserByEmail(emailLower) {
  if (!emailLower) return null;
  await initDb();
  const doc = await getDb()
    .collection('users')
    .findOne({ emailLower }, { projection: { _id: 0 } });
  return mapUser(doc);
}

async function findUserByCredentials(usernameLower, password) {
  await initDb();
  const userCollection = getDb().collection('users');
  const doc = await userCollection.findOne({ usernameLower });
  if (!doc) {
    return null;
  }

  if (!verifyPassword(password, doc.password)) {
    return null;
  }

  if (!isHashedPassword(doc.password)) {
    const hashed = hashPassword(password);
    const setPayload = { password: hashed };
    if (doc.email && !doc.emailLower) {
      setPayload.emailLower = doc.email.toLowerCase();
    }
    await userCollection.updateOne({ id: doc.id }, { $set: setPayload });
    doc.password = hashed;
    doc.emailLower = doc.email ? doc.email.toLowerCase() : undefined;
  }

  return mapUser(doc);
}

async function createUser(user) {
  await initDb();
  const id = user.id || genId('u_');
  const emailLower = typeof user.email === 'string' ? user.email.toLowerCase() : null;
  const payload = {
    id,
    username: user.username,
    usernameLower: String(user.username).toLowerCase(),
    email: user.email,
    password: hashPassword(user.password),
    roles: Array.isArray(user.roles) && user.roles.length ? user.roles : ['user'],
    groups: Array.isArray(user.groups) ? user.groups : [],
    avatarUrl:
      typeof user.avatarUrl === 'string' && user.avatarUrl.trim() ? user.avatarUrl.trim() : null,
    avatarKey: user.avatarKey || null,
    createdAt: Date.now()
  };
  if (emailLower) {
    payload.emailLower = emailLower;
  }
  await getDb().collection('users').insertOne(payload);
  return getUserById(id);
}

async function updateUser(id, updates) {
  await initDb();
  const payload = { ...updates };
  if (typeof payload.username === 'string') {
    payload.usernameLower = payload.username.toLowerCase();
  }
  if (typeof payload.email === 'string') {
    payload.emailLower = payload.email.toLowerCase();
  }
  if (typeof payload.password === 'string') {
    payload.password = hashPassword(payload.password);
  }
  if (payload.avatarKey === undefined) {
    delete payload.avatarKey;
  } else if (typeof payload.avatarKey === 'string' && payload.avatarKey.trim()) {
    payload.avatarKey = payload.avatarKey.trim();
  } else {
    payload.avatarKey = null;
  }
  if (payload.avatarUrl !== undefined) {
    delete payload.avatarUrl;
  }
  const updateDoc = {
    $set: payload
  };
  if (payload.roles === undefined) delete payload.roles;
  if (payload.groups === undefined) delete payload.groups;
  if (payload.avatarKey === undefined) delete payload.avatarKey;
  if (payload.emailLower === undefined) delete payload.emailLower;
  if (payload.password === undefined) delete payload.password;

  await getDb()
    .collection('users')
    .updateOne({ id }, updateDoc);
  return getUserById(id);
}

async function setUserRoles(id, roles) {
  await initDb();
  await getDb()
    .collection('users')
    .updateOne({ id }, { $set: { roles } });
  return getUserById(id);
}

async function addRoleToUser(id, role) {
  await initDb();
  await getDb()
    .collection('users')
    .updateOne({ id }, { $addToSet: { roles: role } });
  return getUserById(id);
}

async function deleteUser(id, reassignedTo) {
  await initDb();
  const db = getDb();
  const user = await getUserById(id);
  if (!user) return null;

  const groups = await db.collection('groups').find({}).toArray();
  await Promise.all(
    groups.map(async group => {
      const updatedAdmins = (group.admins || []).filter(a => a !== id);
      const updatedMembers = (group.members || []).filter(m => m !== id);
      const createdBy = group.createdBy === id ? reassignedTo || group.createdBy : group.createdBy;
      if (
        updatedAdmins.length !== (group.admins || []).length ||
        updatedMembers.length !== (group.members || []).length ||
        createdBy !== group.createdBy
      ) {
        await db.collection('groups').updateOne(
          { id: group.id },
          {
            $set: {
              admins: updatedAdmins,
              members: updatedMembers,
              createdBy
            }
          }
        );
      }
    })
  );

  await db.collection('users').deleteOne({ id });
  return user;
}

async function listGroups() {
  await initDb();
  const docs = await getDb()
    .collection('groups')
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map(mapGroup);
}

async function listGroupsForUser(userId, includeAll = false) {
  if (includeAll) {
    return listGroups();
  }
  await initDb();
  const docs = await getDb()
    .collection('groups')
    .find({
      $or: [{ members: userId }, { admins: userId }, { createdBy: userId }]
    }, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map(mapGroup);
}

async function getGroupById(id) {
  await initDb();
  const doc = await getDb()
    .collection('groups')
    .findOne({ id }, { projection: { _id: 0 } });
  return mapGroup(doc);
}

async function createGroup({ name, createdBy }) {
  await initDb();
  const id = genId('g_');
  const now = Date.now();
  const payload = {
    id,
    name,
    createdBy,
    admins: [createdBy],
    members: [createdBy],
    createdAt: now,
    avatarKey: null,
    avatarUrl: null
  };
  await getDb().collection('groups').insertOne(payload);
  return getGroupById(id);
}

async function updateGroup(id, updates = {}) {
  await initDb();
  const payload = { ...updates };
  if (typeof payload.name === 'string') {
    payload.name = payload.name.trim();
  }
  if (payload.avatarKey === undefined) {
    delete payload.avatarKey;
  } else if (typeof payload.avatarKey === 'string' && payload.avatarKey.trim()) {
    payload.avatarKey = payload.avatarKey.trim();
  } else {
    payload.avatarKey = null;
  }
  if (payload.avatarUrl !== undefined) {
    delete payload.avatarUrl;
  }

  await getDb()
    .collection('groups')
    .updateOne({ id }, { $set: payload });
  return getGroupById(id);
}

async function deleteGroup(groupId) {
  await initDb();
  const db = getDb();
  const group = await getGroupById(groupId);
  if (!group) return null;

  await Promise.all([
    db.collection('messages').deleteMany({ groupId }),
    db.collection('channels').deleteMany({ groupId }),
    db.collection('groups').deleteOne({ id: groupId })
  ]);

  return group;
}

async function addGroupMember(groupId, userId) {
  await initDb();
  await getDb()
    .collection('groups')
    .updateOne({ id: groupId }, { $addToSet: { members: userId } });
  return getGroupById(groupId);
}

async function removeGroupMember(groupId, userId) {
  await initDb();
  await getDb()
    .collection('groups')
    .updateOne(
      { id: groupId },
      {
        $pull: { members: userId, admins: userId }
      }
    );
  return getGroupById(groupId);
}

async function listChannelsByGroupId(groupId) {
  await initDb();
  const docs = await getDb()
    .collection('channels')
    .find({ groupId }, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map(mapChannel);
}

async function getChannelById(channelId) {
  await initDb();
  const doc = await getDb()
    .collection('channels')
    .findOne({ id: channelId }, { projection: { _id: 0 } });
  return mapChannel(doc);
}

async function createChannel({ groupId, name, createdBy }) {
  await initDb();
  const id = genId('c_');
  const now = Date.now();
  const payload = {
    id,
    groupId,
    name,
    createdBy,
    createdAt: now,
    bannedUserIds: []
  };
  await getDb().collection('channels').insertOne(payload);
  return getChannelById(id);
}

async function deleteChannel(channelId) {
  await initDb();
  const db = getDb();
  const channel = await getChannelById(channelId);
  if (!channel) return null;
  await Promise.all([
    db.collection('messages').deleteMany({ channelId }),
    db.collection('channels').deleteOne({ id: channelId })
  ]);
  return channel;
}

async function updateChannelBans(channelId, bannedUserIds) {
  await initDb();
  await getDb()
    .collection('channels')
    .updateOne({ id: channelId }, { $set: { bannedUserIds } });
  return getChannelById(channelId);
}

async function listAllChannels() {
  await initDb();
  const docs = await getDb()
    .collection('channels')
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map(mapChannel);
}

async function listMessages({ groupId, channelId, limit = 50 } = {}) {
  await initDb();
  const filter = {};
  if (groupId) filter.groupId = groupId;
  if (channelId) filter.channelId = channelId;

  const cursor = getDb()
    .collection('messages')
    .find(filter, { projection: { _id: 0 } })
    .sort({ timestamp: 1 });

  const messages = await cursor.toArray();
  if (limit && messages.length > limit) {
    return messages.slice(messages.length - limit).map(mapMessage);
  }
  return messages.map(mapMessage);
}

async function createMessage({
  groupId,
  channelId,
  userId,
  username,
  content = '',
  avatarKey,
  imageKey,
  imageContentType,
  imageFilename
}) {
  await initDb();
  const message = {
    id: genId('m_'),
    groupId,
    channelId,
    userId,
    username,
    content: typeof content === 'string' ? content : '',
    avatarKey: typeof avatarKey === 'string' && avatarKey.trim() ? avatarKey.trim() : null,
    imageKey: typeof imageKey === 'string' && imageKey.trim() ? imageKey.trim() : null,
    imageContentType: typeof imageContentType === 'string' ? imageContentType : null,
    imageFilename: typeof imageFilename === 'string' ? imageFilename : null,
    timestamp: Date.now()
  };
  await getDb().collection('messages').insertOne(message);
  return message;
}

async function exportData() {
  await initDb();
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
  const db = getDb();
  const users = Array.isArray(data.users) ? data.users : [];
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const messages = Array.isArray(data.messages) ? data.messages : [];

  await db.collection('users').deleteMany({});
  await db.collection('groups').deleteMany({});
  await db.collection('channels').deleteMany({});
  await db.collection('messages').deleteMany({});

  if (users.length) {
    await db.collection('users').insertMany(
      users.map(user => ({
        id: user.id || genId('u_'),
        username: user.username,
        usernameLower: user.username.toLowerCase(),
        email: user.email,
        emailLower: typeof user.email === 'string' ? user.email.toLowerCase() : undefined,
        password: isHashedPassword(user.password)
          ? user.password
          : hashPassword(typeof user.password === 'string' ? user.password : 'changeme'),
        roles: Array.isArray(user.roles) ? user.roles : [],
        groups: Array.isArray(user.groups) ? user.groups : [],
        avatarUrl: typeof user.avatarUrl === 'string' && user.avatarUrl.trim()
          ? user.avatarUrl.trim()
          : null
      }))
    );
  }

  if (groups.length) {
    await db.collection('groups').insertMany(
      groups.map(group => ({
        id: group.id || genId('g_'),
        name: group.name,
        createdBy: group.createdBy || 'u_super',
        admins: Array.isArray(group.admins) ? group.admins : [],
        members: Array.isArray(group.members) ? group.members : [],
        createdAt: Number(group.createdAt ?? Date.now()),
        avatarKey: typeof group.avatarKey === 'string' && group.avatarKey.trim()
          ? group.avatarKey.trim()
          : null,
        avatarUrl: typeof group.avatarUrl === 'string' && group.avatarUrl.trim()
          ? group.avatarUrl.trim()
          : null
      }))
    );
  }

  if (channels.length) {
    await db.collection('channels').insertMany(
      channels.map(channel => ({
        id: channel.id || genId('c_'),
        groupId: channel.groupId,
        name: channel.name,
        createdBy: channel.createdBy,
        createdAt: Number(channel.createdAt ?? Date.now()),
        bannedUserIds: Array.isArray(channel.bannedUserIds) ? channel.bannedUserIds : []
      }))
    );
  }

  if (messages.length) {
    await db.collection('messages').insertMany(
      messages.map(message => ({
        id: message.id || genId('m_'),
        groupId: message.groupId,
        channelId: message.channelId,
        userId: message.userId,
        username: message.username,
        content: typeof message.content === 'string' ? message.content : '',
        avatarKey:
          typeof message.avatarKey === 'string' && message.avatarKey.trim()
            ? message.avatarKey.trim()
            : null,
        imageKey:
          typeof message.imageKey === 'string' && message.imageKey.trim()
            ? message.imageKey.trim()
            : null,
        imageContentType:
          typeof message.imageContentType === 'string' && message.imageContentType.trim()
            ? message.imageContentType.trim()
            : null,
        imageFilename:
          typeof message.imageFilename === 'string' && message.imageFilename.trim()
            ? message.imageFilename.trim()
            : null,
        avatarUrl:
          typeof message.avatarUrl === 'string' && message.avatarUrl.trim()
            ? message.avatarUrl.trim()
            : null,
        imageUrl:
          typeof message.imageUrl === 'string' && message.imageUrl.trim()
            ? message.imageUrl.trim()
            : null,
        timestamp: Number(message.timestamp ?? Date.now())
      }))
    );
  }

  await ensureDefaultSuperUser();
}

async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    database = null;
    initPromise = null;
  }
}

module.exports = {
  initDb,
  genId,
  listUsers,
  getUserById,
  findUserByUsername,
  findUserByEmail,
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
  updateGroup,
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
