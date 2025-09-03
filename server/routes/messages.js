const express = require('express');
const { readDB, writeDB, genId } = require('../lib/db');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

router.use(requireUser);


router.get('/', (req, res) => {
  const db = readDB();
  const { groupId, channelId } = req.query;
  const msgs = db.messages
    .filter(m => (!groupId || m.groupId === groupId) && (!channelId || m.channelId === channelId))
    .sort((a, b) => a.timestamp - b.timestamp);
  return res.json({ success: true, messages: msgs.slice(-50) });
});


router.post('/', (req, res) => {
  const db = readDB();
  const { groupId, channelId, content } = req.body || {};
  if (!groupId || !channelId || !content)
    return res.status(400).json({ success: false, message: 'groupId, channelId, content required' });
  const channel = db.channels.find(c => c.id === channelId && c.groupId === groupId);
  if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
  if (channel.bannedUserIds && channel.bannedUserIds.includes(req.me.id))
    return res.status(403).json({ success: false, message: 'You are banned in this channel' });
  const msg = {
    id: genId('m_'),
    groupId,
    channelId,
    userId: req.me.id,
    username: req.me.username,
    content: String(content).trim(),
    timestamp: Date.now()
  };
  db.messages.push(msg);
  writeDB(db);
  return res.json({ success: true, message: msg });
});

module.exports = router;

