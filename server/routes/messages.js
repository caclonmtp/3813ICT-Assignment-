const express = require('express');
const {
  listMessages,
  createMessage,
  getChannelById
} = require('../lib/db');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

router.use(requireUser);

router.get('/', async (req, res, next) => {
  try {
    const { groupId, channelId } = req.query;
    const messages = await listMessages({ groupId, channelId });
    return res.json({ success: true, messages });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { groupId, channelId, content } = req.body || {};
    if (!groupId || !channelId || !content) {
      return res.status(400).json({ success: false, message: 'groupId, channelId, content required' });
    }
    const channel = await getChannelById(channelId);
    if (!channel || channel.groupId !== groupId) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }
    if (Array.isArray(channel.bannedUserIds) && channel.bannedUserIds.includes(req.me.id)) {
      return res.status(403).json({ success: false, message: 'You are banned in this channel' });
    }
    const trimmed = String(content).trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Content must not be empty' });
    }
    const message = await createMessage({
      groupId,
      channelId,
      userId: req.me.id,
      username: req.me.username,
      content: trimmed
    });
    return res.json({ success: true, message });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
