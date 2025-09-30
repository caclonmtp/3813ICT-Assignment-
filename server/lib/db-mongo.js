const { MongoClient } = require('mongodb');

const DEFAULT_URI = process.env.MEAN_CHAT_MONGO_URI || 'mongodb://127.0.0.1:27017';
const DEFAULT_DB = process.env.MEAN_CHAT_MONGO_DB || 'mean_chat';

let client;
let database;
let initPromise;

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
      client = new MongoClient(DEFAULT_URI, {
        maxPoolSize: Number(process.env.MEAN_CHAT_MONGO_MAX_POOL || 10),
        serverSelectionTimeoutMS: Number(process.env.MEAN_CHAT_MONGO_TIMEOUT || 5000)
      });
      await client.connect();
      database = client.db(DEFAULT_DB);

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
    db.collection('groups').createIndex({ id: 1 }, { unique: true }),
    db.collection('channels').createIndex({ id: 1 }, { unique: true }),
    db.collection('channels').createIndex({ groupId: 1 }),
    db.collection('messages').createIndex({ channelId: 1, timestamp: 1 }),
    db.collection('messages').createIndex({ groupId: 1, timestamp: 1 })
  ]);
}

async function ensureDefaultSuperUser() {
  const db = getDb();
  const existing = await db.collection('users').findOne({ usernameLower: 'super' });
  if (!existing) {
    await db.collection('users').insertOne({
      id: 'u_super',
      username: 'super',
      usernameLower: 'super',
      email: 'super@admin.com',
      password: '123',
      roles: ['super-admin'],
      groups: []
    });
  }
}

function mapUser(doc) {
  if (!doc) return null;
  const { _id, usernameLower, ...rest } = doc;
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

async function findUserByCredentials(usernameLower, password) {
  await initDb();
  const doc = await getDb()
    .collection('users')
    .findOne({ usernameLower, password }, { projection: { _id: 0 } });
  return mapUser(doc);
}

async function createUser(user) {
  await initDb();
  const id = user.id || genId('u_');
  const payload = {
    id,
    username: user.username,
    usernameLower: String(user.username).toLowerCase(),
    email: user.email,
    password: user.password,
    roles: Array.isArray(user.roles) && user.roles.length ? user.roles : ['user'],
    groups: Array.isArray(user.groups) ? user.groups : []
  };
  await getDb().collection('users').insertOne(payload);
  return getUserById(id);
}

async function updateUser(id, updates) {
  await initDb();
  const payload = { ...updates };
  if (typeof payload.username === 'string') {
    payload.usernameLower = payload.username.toLowerCase();
  }
  const updateDoc = {
    $set: payload
  };
  if (payload.roles === undefined) delete payload.roles;
  if (payload.groups === undefined) delete payload.groups;

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
    createdAt: now
  };
  await getDb().collection('groups').insertOne(payload);
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

async function createMessage({ groupId, channelId, userId, username, content }) {
  await initDb();
  const message = {
    id: genId('m_'),
    groupId,
    channelId,
    userId,
    username,
    content,
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
        password: user.password,
        roles: Array.isArray(user.roles) ? user.roles : [],
        groups: Array.isArray(user.groups) ? user.groups : []
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
        createdAt: Number(group.createdAt ?? Date.now())
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
        content: message.content,
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

