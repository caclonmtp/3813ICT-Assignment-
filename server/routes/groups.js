const express = require('express');
const {
  listGroups,
  listGroupsForUser,
  getGroupById,
  createGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  getChannelById,
  updateChannelBans
} = require('../lib/db');
const { requireUser, isSuper, isGroupAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireUser);

// GET /api/groups
router.get('/', async (req, res, next) => {
  try {
    const groups = isSuper(req.me) ? await listGroups() : await listGroupsForUser(req.me.id);
    return res.json(groups);
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/user/:userId
router.get('/user/:userId', async (req, res, next) => {
  try {
    const groups = await listGroupsForUser(req.params.userId, isSuper(req.me));
    return res.json(groups);
  } catch (err) {
    next(err);
  }
});

// POST /api/groups
router.post('/', async (req, res, next) => {
  try {
    if (!isSuper(req.me) && !isGroupAdmin(req.me)) {
      return res.status(403).json({ success: false, message: 'Group admin or super required' });
    }
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: 'name required' });
    const group = await createGroup({ name, createdBy: req.me.id });
    return res.json({ success: true, group });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:groupId
router.delete('/:groupId', async (req, res, next) => {
  try {
    const group = await getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    if (!(isSuper(req.me) || group.createdBy === req.me.id)) {
      return res.status(403).json({ success: false, message: 'Only owner or super' });
    }
    await deleteGroup(group.id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups/:groupId/members
router.post('/:groupId/members', async (req, res, next) => {
  try {
    const group = await getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    if (!(isSuper(req.me) || group.admins.includes(req.me.id))) {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
    const updated = await addGroupMember(group.id, userId);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:groupId/members/:userId
router.delete('/:groupId/members/:userId', async (req, res, next) => {
  try {
    const group = await getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    if (!(isSuper(req.me) || group.admins.includes(req.me.id))) {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }
    const updated = await removeGroupMember(group.id, req.params.userId);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/groups/:groupId/channels/:channelId/ban
router.post('/:groupId/channels/:channelId/ban', async (req, res, next) => {
  try {
    const group = await getGroupById(req.params.groupId);
    const channel = await getChannelById(req.params.channelId);
    if (!group || !channel || channel.groupId !== group.id) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    if (!(isSuper(req.me) || group.admins.includes(req.me.id))) {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
    const bannedSet = new Set(Array.isArray(channel.bannedUserIds) ? channel.bannedUserIds : []);
    bannedSet.add(userId);
    const updatedChannel = await updateChannelBans(channel.id, Array.from(bannedSet));
    return res.json({ success: true, channel: updatedChannel });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
