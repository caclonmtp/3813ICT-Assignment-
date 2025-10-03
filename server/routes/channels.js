const express = require('express');
const {
  listChannelsByGroupId,
  createChannel,
  deleteChannel,
  getGroupById,
  getChannelById
} = require('../lib/db');
const { requireUser, isSuper } = require('../middleware/auth');

const router = express.Router();

// Channel operations require an authenticated user context.
router.use(requireUser);

// GET /api/channels/group/:groupId lists channels belonging to a group once the group exists.
router.get('/group/:groupId', async (req, res, next) => {
  try {
    const group = await getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const channels = await listChannelsByGroupId(group.id);
    return res.json(channels);
  } catch (err) {
    next(err);
  }
});

// POST /api/channels creates a new channel within a group for authorised admins.
router.post('/', async (req, res, next) => {
  try {
    const { name, groupId } = req.body || {};
    if (!name || !groupId) {
      return res.status(400).json({ success: false, message: 'name, groupId required' });
    }
    const group = await getGroupById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    if (!(isSuper(req.me) || group.admins.includes(req.me.id))) {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }
    const channel = await createChannel({ groupId: group.id, name, createdBy: req.me.id });
    return res.json(channel);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/channels/:channelId removes a channel and cascades cleanup when triggered by group admins or super admins.
router.delete('/:channelId', async (req, res, next) => {
  try {
    const channel = await getChannelById(req.params.channelId);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
    const group = await getGroupById(channel.groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    if (!(isSuper(req.me) || group.admins.includes(req.me.id))) {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }
    await deleteChannel(channel.id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
