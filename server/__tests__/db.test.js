const assert = require('assert/strict');
const { MongoClient } = require('mongodb');

const DEFAULT_URI = process.env.MEAN_CHAT_MONGO_URI || 'mongodb://127.0.0.1:27017';

function loadDb(dbName) {
  const modulePath = require.resolve('../lib/db');
  delete require.cache[modulePath];
  process.env.MEAN_CHAT_DB_PROVIDER = 'mongo';
  process.env.MEAN_CHAT_MONGO_DB = dbName;
  return require('../lib/db');
}

async function setupDb() {
  const dbName = `mean-chat-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const db = loadDb(dbName);
  await db.initDb();

  const cleanup = async () => {
    await db.closeDb();
    const modulePath = require.resolve('../lib/db');
    delete require.cache[modulePath];

    const client = new MongoClient(process.env.MEAN_CHAT_MONGO_URI || DEFAULT_URI);
    try {
      await client.connect();
      await client.db(dbName).dropDatabase();
    } finally {
      await client.close().catch(() => {});
    }

    delete process.env.MEAN_CHAT_DB_PROVIDER;
    delete process.env.MEAN_CHAT_MONGO_DB;
  };

  return { db, cleanup };
}

describe('database library', () => {
  it('initDb seeds default super user', async () => {
    const { db, cleanup } = await setupDb();
    try {
      const superUser = await db.findUserByUsername('super');
      assert.ok(superUser);
      assert.strictEqual(superUser.username, 'super');
      assert.strictEqual(superUser.email, 'super@admin.com');
      assert.ok(superUser.roles.includes('super-admin'));
    } finally {
      await cleanup();
    }
  });

  it('genId generates unique prefixed ids', async () => {
    const { db, cleanup } = await setupDb();
    try {
      const first = db.genId('u_');
      const second = db.genId('u_');
      assert.ok(/^u_[a-z0-9]+$/.test(first));
      assert.ok(/^u_[a-z0-9]+$/.test(second));
      assert.notStrictEqual(first, second);
    } finally {
      await cleanup();
    }
  });

  it('closeDb resets state for subsequent initDb calls', async () => {
    const { db, cleanup } = await setupDb();
    try {
      await db.closeDb();
      await db.initDb();
      const superUser = await db.findUserByUsername('super');
      assert.ok(superUser);
    } finally {
      await cleanup();
    }
  });

  it('user creation and lookup helpers work together', async () => {
    const { db, cleanup } = await setupDb();
    try {
      const created = await db.createUser({
        username: 'Alice',
        email: 'alice@example.com',
        password: 'secret'
      });
      assert.strictEqual(created.username, 'Alice');
      assert.deepStrictEqual(created.roles, ['user']);

      const all = await db.listUsers();
      assert.ok(all.some(u => u.id === created.id));

      const byId = await db.getUserById(created.id);
      assert.strictEqual(byId.email, 'alice@example.com');

      const byUsername = await db.findUserByUsername('alice');
      assert.ok(byUsername);
      assert.strictEqual(byUsername.id, created.id);

      const byCredentials = await db.findUserByCredentials('alice', 'secret');
      assert.ok(byCredentials);
      assert.strictEqual(byCredentials.id, created.id);
    } finally {
      await cleanup();
    }
  });

  it('user update helpers adjust email, groups, and roles', async () => {
    const { db, cleanup } = await setupDb();
    try {
      const user = await db.createUser({
        username: 'Bob',
        email: 'bob@example.com',
        password: 'pwd'
      });

      const updated = await db.updateUser(user.id, { email: 'bob+updated@example.com', groups: ['g_test'] });
      assert.strictEqual(updated.email, 'bob+updated@example.com');
      assert.deepStrictEqual(updated.groups, ['g_test']);

      const roleUpdated = await db.setUserRoles(user.id, ['group-admin']);
      assert.deepStrictEqual(roleUpdated.roles, ['group-admin']);

      await db.addRoleToUser(user.id, 'super-admin');
      const finalUser = await db.getUserById(user.id);
      assert.ok(finalUser.roles.includes('group-admin'));
      assert.ok(finalUser.roles.includes('super-admin'));

      await db.addRoleToUser(user.id, 'super-admin');
      const dedupUser = await db.getUserById(user.id);
      const superRoleCount = dedupUser.roles.filter(r => r === 'super-admin').length;
      assert.strictEqual(superRoleCount, 1);
    } finally {
      await cleanup();
    }
  });

  it('deleteUser removes user from groups and reassigns ownership', async () => {
    const { db, cleanup } = await setupDb();
    try {
      const owner = await db.createUser({ username: 'Owner', email: 'owner@example.com', password: 'pwd' });
      const member = await db.createUser({ username: 'Member', email: 'member@example.com', password: 'pwd' });
      const group = await db.createGroup({ name: 'Test Group', createdBy: member.id });
      await db.addGroupMember(group.id, owner.id);

      const removed = await db.deleteUser(member.id, owner.id);
      assert.strictEqual(removed.id, member.id);
      const missing = await db.getUserById(member.id);
      assert.strictEqual(missing, null);

      const updatedGroup = await db.getGroupById(group.id);
      assert.ok(!updatedGroup.members.includes(member.id));
      assert.ok(!updatedGroup.admins.includes(member.id));
      assert.strictEqual(updatedGroup.createdBy, owner.id);
    } finally {
      await cleanup();
    }
  });

  it('group helpers manage membership filters and deletion', async () => {
    const { db, cleanup } = await setupDb();
    try {
      const owner = await db.createUser({ username: 'Owner', email: 'owner@example.com', password: 'pwd' });
      const other = await db.createUser({ username: 'Other', email: 'other@example.com', password: 'pwd' });
      const group = await db.createGroup({ name: 'Team', createdBy: owner.id });

      await db.addGroupMember(group.id, other.id);

      const allGroups = await db.listGroups();
      assert.ok(allGroups.some(g => g.id === group.id));

      const ownerGroups = await db.listGroupsForUser(owner.id);
      assert.ok(ownerGroups.some(g => g.id === group.id));

      const otherGroups = await db.listGroupsForUser(other.id);
      assert.ok(otherGroups.some(g => g.id === group.id));

      const outsiderGroups = await db.listGroupsForUser('nope');
      assert.strictEqual(outsiderGroups.length, 0);

      const includeAll = await db.listGroupsForUser('anyone', true);
      assert.ok(includeAll.some(g => g.id === group.id));

      const afterRemoval = await db.removeGroupMember(group.id, other.id);
      assert.ok(!afterRemoval.members.includes(other.id));

      await db.deleteGroup(group.id);
      const deleted = await db.getGroupById(group.id);
      assert.strictEqual(deleted, null);
    } finally {
      await cleanup();
    }
  });

  it('channel lifecycle includes banning and message cleanup on delete', async () => {
    const { db, cleanup } = await setupDb();
    try {
      const owner = await db.createUser({ username: 'Owner', email: 'owner@example.com', password: 'pwd' });
      const other = await db.createUser({ username: 'Other', email: 'other@example.com', password: 'pwd' });
      const group = await db.createGroup({ name: 'Team', createdBy: owner.id });
      await db.addGroupMember(group.id, other.id);

      const channel = await db.createChannel({ groupId: group.id, name: 'general', createdBy: owner.id });
      const channels = await db.listChannelsByGroupId(group.id);
      assert.ok(channels.some(c => c.id === channel.id));

      const banned = await db.updateChannelBans(channel.id, [other.id]);
      assert.ok(banned.bannedUserIds.includes(other.id));

      await db.createMessage({
        groupId: group.id,
        channelId: channel.id,
        userId: owner.id,
        username: owner.username,
        content: 'Hello world'
      });
      const beforeDeleteMessages = await db.listMessages({ channelId: channel.id, limit: 0 });
      assert.strictEqual(beforeDeleteMessages.length, 1);

      const deletedChannel = await db.deleteChannel(channel.id);
      assert.strictEqual(deletedChannel.id, channel.id);
      const missingChannel = await db.getChannelById(channel.id);
      assert.strictEqual(missingChannel, null);

      const afterDeleteMessages = await db.listMessages({ channelId: channel.id, limit: 0 });
      assert.strictEqual(afterDeleteMessages.length, 0);
    } finally {
      await cleanup();
    }
  });

  it('listMessages enforces limits and filtering', async () => {
    const { db, cleanup } = await setupDb();
    try {
      const owner = await db.createUser({ username: 'Owner', email: 'owner@example.com', password: 'pwd' });
      const group = await db.createGroup({ name: 'Team', createdBy: owner.id });
      const channel = await db.createChannel({ groupId: group.id, name: 'general', createdBy: owner.id });

      for (let i = 0; i < 55; i += 1) {
        await db.createMessage({
          groupId: group.id,
          channelId: channel.id,
          userId: owner.id,
          username: owner.username,
          content: `Message ${i}`
        });
      }

      const defaultLimit = await db.listMessages({ channelId: channel.id });
      assert.strictEqual(defaultLimit.length, 50);
      const defaultContents = defaultLimit.map(m => m.content);
      assert.ok(!defaultContents.includes('Message 0'));
      assert.ok(defaultContents.includes('Message 5'));
      assert.ok(defaultContents.includes('Message 54'));

      const groupFiltered = await db.listMessages({ groupId: group.id, limit: 0 });
      assert.strictEqual(groupFiltered.length, 55);

      const customLimit = await db.listMessages({ channelId: channel.id, limit: 10 });
      assert.strictEqual(customLimit.length, 10);
      const customContents = customLimit.map(m => m.content);
      assert.ok(customContents.includes('Message 45'));
      assert.ok(customContents.includes('Message 54'));
      assert.ok(!customContents.includes('Message 44'));

      const unlimited = await db.listMessages({ channelId: channel.id, limit: 0 });
      assert.strictEqual(unlimited.length, 55);
    } finally {
      await cleanup();
    }
  });

  it('exportData and importData round-trip data correctly', async () => {
    const { db, cleanup } = await setupDb();
    try {
      const owner = await db.createUser({ username: 'Owner', email: 'owner@example.com', password: 'pwd' });
      const group = await db.createGroup({ name: 'Team', createdBy: owner.id });
      const channel = await db.createChannel({ groupId: group.id, name: 'general', createdBy: owner.id });
      await db.createMessage({
        groupId: group.id,
        channelId: channel.id,
        userId: owner.id,
        username: owner.username,
        content: 'Hello'
      });

      const snapshot = await db.exportData();
      assert.ok(snapshot.users.length >= 2);
      assert.ok(snapshot.groups.map(g => g.id).includes(group.id));
      assert.ok(snapshot.channels.map(c => c.id).includes(channel.id));
      assert.strictEqual(snapshot.messages.length, 1);

      const now = Date.now();
      const replacement = {
        users: [
          {
            id: 'u_new',
            username: 'newUser',
            email: 'new@example.com',
            password: 'pw',
            roles: ['user'],
            groups: []
          }
        ],
        groups: [
          {
            id: 'g_new',
            name: 'New Group',
            createdBy: 'u_new',
            admins: ['u_new'],
            members: ['u_new'],
            createdAt: now
          }
        ],
        channels: [
          {
            id: 'c_new',
            groupId: 'g_new',
            name: 'general',
            createdBy: 'u_new',
            createdAt: now,
            bannedUserIds: []
          }
        ],
        messages: [
          {
            id: 'm_new',
            groupId: 'g_new',
            channelId: 'c_new',
            userId: 'u_new',
            username: 'newUser',
            content: 'hello',
            timestamp: now
          }
        ]
      };

      await db.importData(replacement);

      const usersAfter = await db.listUsers();
      const idsAfter = usersAfter.map(u => u.id);
      assert.ok(idsAfter.includes('u_new'));
      assert.ok(idsAfter.includes('u_super'));
      const removedOwner = usersAfter.find(u => u.id === owner.id);
      assert.strictEqual(removedOwner, undefined);

      const newGroup = await db.getGroupById('g_new');
      assert.ok(newGroup);
      assert.deepStrictEqual(newGroup.members, ['u_new']);

      const newChannels = await db.listChannelsByGroupId('g_new');
      assert.strictEqual(newChannels.length, 1);
      assert.strictEqual(newChannels[0].id, 'c_new');

      const newMessages = await db.listMessages({ channelId: 'c_new', limit: 0 });
      assert.strictEqual(newMessages.length, 1);
      assert.strictEqual(newMessages[0].id, 'm_new');
    } finally {
      await cleanup();
    }
  });
});
