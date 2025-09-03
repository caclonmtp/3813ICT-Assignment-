const express = require('express');
const { readDB, writeDB, genId } = require('../lib/db');
const { requireUser, isSuper, isGroupAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireUser);

// GET /api/groups
router.get('/', (req, res) => {
  const db = readDB();
  const me = req.me;
  const groups = isSuper(me)
    ? db.groups
    : db.groups.filter(g => (g.members || []).includes(me.id) || (g.admins || []).includes(me.id));
  return res.json(groups);
});

// GET /api/groups/user/:userId
router.get('/user/:userId', (req, res) => {
  const db = readDB();
  const { userId } = req.params;
  const groups = isSuper(req.me)
    ? db.groups
    : db.groups.filter(g => (g.members || []).includes(userId) || (g.admins || []).includes(userId));
  return res.json(groups);
});

// POST /api/groups
router.post('/', (req, res) => {
  if (!isSuper(req.me) && !isGroupAdmin(req.me))
    return res.status(403).json({ success: false, message: 'Group admin or super required' });
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ success: false, message: 'name required' });
  const db = readDB();
  const group = { id: genId('g_'), name, createdBy: req.me.id, admins: [req.me.id], members: [req.me.id], createdAt: Date.now() };
  db.groups.push(group);
  writeDB(db);
  return res.json({ success: true, group });
});

// DELETE /api/groups/:groupId
router.delete('/:groupId', (req, res) => {
  const db = readDB();
  const g = db.groups.find(g => g.id === req.params.groupId);
  if (!g) return res.status(404).json({ success: false, message: 'Group not found' });
  if (!(isSuper(req.me) || g.createdBy === req.me.id))
    return res.status(403).json({ success: false, message: 'Only owner or super' });

  db.channels = db.channels.filter(c => c.groupId !== g.id);
  db.messages = db.messages.filter(m => m.groupId !== g.id);
  db.groups = db.groups.filter(x => x.id !== g.id);
  writeDB(db);
  return res.json({ success: true });
});

// POST /api/groups/:groupId/members
router.post('/:groupId/members', (req, res) => {
  const db = readDB();
  const g = db.groups.find(g => g.id === req.params.groupId);
  if (!g) return res.status(404).json({ success: false, message: 'Group not found' });
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
  if (!(isSuper(req.me) || g.admins.includes(req.me.id)))
    return res.status(403).json({ success: false, message: 'Admins only' });
  if (!g.members.includes(userId)) g.members.push(userId);
  writeDB(db);
  return res.json(g);
});

// DELETE /api/groups/:groupId/members/:userId
router.delete('/:groupId/members/:userId', (req, res) => {
  const db = readDB();
  const g = db.groups.find(g => g.id === req.params.groupId);
  if (!g) return res.status(404).json({ success: false, message: 'Group not found' });
  if (!(isSuper(req.me) || g.admins.includes(req.me.id)))
    return res.status(403).json({ success: false, message: 'Admins only' });
  const { userId } = req.params;
  g.members = g.members.filter(m => m !== userId);
  g.admins = g.admins.filter(a => a !== userId);
  writeDB(db);
  return res.json(g);
});

// POST /api/groups/:groupId/channels/:channelId/ban
router.post('/:groupId/channels/:channelId/ban', (req, res) => {
  const db = readDB();
  const g = db.groups.find(g => g.id === req.params.groupId);
  const c = db.channels.find(c => c.id === req.params.channelId);
  if (!g || !c) return res.status(404).json({ success: false, message: 'Not found' });
  if (!(isSuper(req.me) || g.admins.includes(req.me.id)))
    return res.status(403).json({ success: false, message: 'Admins only' });

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
  if (!Array.isArray(c.bannedUserIds)) c.bannedUserIds = [];
  if (!c.bannedUserIds.includes(userId)) c.bannedUserIds.push(userId);
  writeDB(db);
  return res.json({ success: true, channel: c });
});

module.exports = router;

