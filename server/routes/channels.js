const express = require('express');
const { readDB, writeDB, genId } = require('../lib/db');
const { requireUser, isSuper } = require('../middleware/auth');

const router = express.Router();

router.use(requireUser);

// GET /api/channels/group/:groupId
router.get('/group/:groupId', (req, res) => {
  const db = readDB();
  const g = db.groups.find(g => g.id === req.params.groupId);
  if (!g) return res.status(404).json({ success: false, message: 'Group not found' });
  const channels = db.channels.filter(c => c.groupId === g.id);
  return res.json(channels);
});

// POST /api/channels
router.post('/', (req, res) => {
  const db = readDB();
  const { name, groupId } = req.body || {};
  if (!name || !groupId) return res.status(400).json({ success: false, message: 'name, groupId required' });
  const g = db.groups.find(g => g.id === groupId);
  if (!g) return res.status(404).json({ success: false, message: 'Group not found' });
  if (!(isSuper(req.me) || g.admins.includes(req.me.id)))
    return res.status(403).json({ success: false, message: 'Admins only' });
  const channel = { id: genId('c_'), groupId: g.id, name, createdBy: req.me.id, createdAt: Date.now(), bannedUserIds: [] };
  db.channels.push(channel);
  writeDB(db);
  return res.json(channel);
});

// DELETE /api/channels/:channelId
router.delete('/:channelId', (req, res) => {
  const db = readDB();
  const c = db.channels.find(c => c.id === req.params.channelId);
  if (!c) return res.status(404).json({ success: false, message: 'Channel not found' });
  const g = db.groups.find(g => g.id === c.groupId);
  if (!g) return res.status(404).json({ success: false, message: 'Group not found' });
  if (!(isSuper(req.me) || g.admins.includes(req.me.id)))
    return res.status(403).json({ success: false, message: 'Admins only' });
  db.channels = db.channels.filter(x => x.id !== c.id);
  db.messages = db.messages.filter(m => !(m.groupId === g.id && m.channelId === c.id));
  writeDB(db);
  return res.json({ success: true });
});

module.exports = router;

