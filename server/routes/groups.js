const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const sharp = require('sharp');
const {
  listGroups,
  listGroupsForUser,
  getGroupById,
  createGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  getChannelById,
  updateChannelBans,
  updateGroup
} = require('../lib/db');
const { requireUser, isSuper, isGroupAdmin } = require('../middleware/auth');
const {
  GROUP_AVATAR_DIR,
  ensureUploadDirs,
  resolveFilePathFromUrl
} = require('../lib/uploads');
const media = require('../lib/media');

const router = express.Router();

const fsPromises = fs.promises;

const groupAvatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureUploadDirs();
      cb(null, GROUP_AVATAR_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext && /\.[a-z0-9]+$/.test(ext) ? ext : '';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const groupId = req.params?.groupId || 'group';
    cb(null, `group-${groupId}-${unique}${safeExt}`);
  }
});

const groupAvatarUpload = multer({
  storage: groupAvatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed'));
    } else {
      cb(null, true);
    }
  }
});

async function removeGroupAvatar(group) {
  if (!group) return;
  if (group.avatarKey) {
    await media.deleteKey(group.avatarKey);
    return;
  }
  if (group.avatarUrl) {
    const previousPath = resolveFilePathFromUrl(group.avatarUrl);
    if (!previousPath) return;
    try {
      await fsPromises.unlink(previousPath);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        console.warn('Failed to remove old group avatar', err);
      }
    }
  }
}

router.use(requireUser);

// GET /api/groups
router.get('/', async (req, res, next) => {
  try {
    const groupsRaw = isSuper(req.me) ? await listGroups() : await listGroupsForUser(req.me.id);
    const groups = groupsRaw.map(media.applyGroupMedia);
    return res.json(groups);
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/user/:userId
router.get('/user/:userId', async (req, res, next) => {
  try {
    const groups = await listGroupsForUser(req.params.userId, isSuper(req.me));
    return res.json(groups.map(media.applyGroupMedia));
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
    return res.json({ success: true, group: media.applyGroupMedia(group) });
  } catch (err) {
    next(err);
  }
});

router.post('/:groupId/avatar', (req, res, next) => {
  groupAvatarUpload.single('avatar')(req, res, async err => {
    if (err) {
      const message = err instanceof multer.MulterError ? err.message : err?.message;
      return res.status(400).json({ success: false, message: message || 'Failed to upload group avatar' });
    }

    try {
      const groupId = req.params.groupId;
      const group = await getGroupById(groupId);
      if (!group) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }

      const isManager =
        isSuper(req.me) ||
        group.createdBy === req.me.id ||
        (Array.isArray(group.admins) && group.admins.includes(req.me.id));

      if (!isManager) {
        return res.status(403).json({ success: false, message: 'Admins only' });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Avatar file required' });
      }

      let buffer;
      try {
        buffer = await sharp(req.file.path)
          .rotate()
          .resize(256, 256, { fit: 'cover' })
          .toFormat('jpeg', { quality: 80 })
          .toBuffer();
      } catch (imageErr) {
        await fsPromises.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ success: false, message: 'Unable to process group avatar image' });
      }

      await fsPromises.unlink(req.file.path).catch(() => {});

      const saved = await media.saveBuffer(buffer, {
        prefix: 'group-avatar',
        contentType: 'image/jpeg',
        filename: `${groupId}.jpg`
      });

      const updatedGroup = await updateGroup(groupId, { avatarKey: saved.key });
      await removeGroupAvatar(group);

      return res.json({ success: true, group: media.applyGroupMedia(updatedGroup) });
    } catch (uploadErr) {
      next(uploadErr);
    }
  });
});

// DELETE /api/groups/:groupId
router.delete('/:groupId', async (req, res, next) => {
  try {
    const group = await getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    if (!(isSuper(req.me) || group.createdBy === req.me.id)) {
      return res.status(403).json({ success: false, message: 'Only owner or super' });
    }
    const deleted = await deleteGroup(group.id);
    await removeGroupAvatar(deleted || group);
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
    return res.json(media.applyGroupMedia(updated));
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
    return res.json(media.applyGroupMedia(updated));
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
