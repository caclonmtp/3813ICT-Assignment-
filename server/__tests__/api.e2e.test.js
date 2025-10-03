const assert = require('assert');
const supertest = require('supertest');
const { app } = require('../server');
const db = require('../lib/db');
const uploads = require('../lib/uploads');

describe('API end-to-end flow', function () {
  this.timeout(20000);
  let request;
  let superUser;
  let regularUser;
  let group;
  let channel;

  before(async () => {
    await db.initDb();
    uploads.ensureUploadDirs();
    request = supertest(app);
  });

  after(async () => {
    await db.closeDb();
  });

  it('authenticates default super admin', async () => {
    const response = await request
      .post('/api/auth/login')
      .send({ username: 'super', password: '123' })
      .expect(200);

    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.user.username, 'super');
    superUser = response.body.user;
  });

  it('registers a new user without logging them in', async () => {
    const username = `tester_${Date.now()}`;
    const response = await request
      .post('/api/auth/register')
      .send({ username, email: `${username}@example.com`, password: 'password123' })
      .expect(200);

    assert.strictEqual(response.body.success, true);
    assert.ok(response.body.user.id);
    regularUser = response.body.user;
  });

  it('allows a super admin to manage groups and channels, and members can exchange messages', async () => {
    const groupResponse = await request
      .post('/api/groups')
      .set('x-user-id', superUser.id)
      .send({ name: 'Test Automation Guild' })
      .expect(200);

    assert.strictEqual(groupResponse.body.success, true);
    group = groupResponse.body.group;
    assert.ok(group.id);

    const memberResponse = await request
      .post(`/api/groups/${group.id}/members`)
      .set('x-user-id', superUser.id)
      .send({ userId: regularUser.id })
      .expect(200);

    assert.ok(memberResponse.body.members.includes(regularUser.id));

    const channelResponse = await request
      .post('/api/channels')
      .set('x-user-id', superUser.id)
      .send({ groupId: group.id, name: 'general' })
      .expect(200);

    channel = channelResponse.body;
    assert.ok(channel.id);

    const loginResponse = await request
      .post('/api/auth/login')
      .send({ username: regularUser.username, password: 'password123' })
      .expect(200);

    assert.strictEqual(loginResponse.body.success, true);

    const messageResponse = await request
      .post('/api/messages')
      .set('x-user-id', regularUser.id)
      .send({ groupId: group.id, channelId: channel.id, content: 'Hello from e2e!' })
      .expect(200);

    assert.strictEqual(messageResponse.body.success, true);
    assert.strictEqual(messageResponse.body.message.content, 'Hello from e2e!');

    const listResponse = await request
      .get('/api/messages')
      .set('x-user-id', regularUser.id)
      .query({ channelId: channel.id })
      .expect(200);

    assert.strictEqual(listResponse.body.success, true);
    const contents = listResponse.body.messages.map(m => m.content);
    assert.ok(contents.includes('Hello from e2e!'));
  });
});
