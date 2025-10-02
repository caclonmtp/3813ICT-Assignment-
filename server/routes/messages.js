const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  listMessages,
  createMessage,
  getChannelById,
  getGroupById
} = require('../lib/db');
const { emitNewMessage } = require('../lib/socket');
const { requireUser } = require('../middleware/auth');
const { ensureUploadDirs, MESSAGE_DIR } = require('../lib/uploads');
const media = require('../lib/media');

const router = express.Router();
const fsPromises = fs.promises;

const messageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureUploadDirs();
      cb(null, MESSAGE_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext && /\.[a-z0-9]+$/.test(ext) ? ext : '';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `message-${unique}${safeExt}`);
  }
});

const messageUpload = multer({
  storage: messageStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed'));
    } else {
      cb(null, true);
    }
  }
});

router.use(requireUser);

router.get('/', async (req, res, next) => {
  try {
    const { groupId, channelId } = req.query;
    const messages = await listMessages({ groupId, channelId });
    const decorated = messages.map(message => media.applyMessageMedia({ ...message }));
    return res.json({ success: true, messages: decorated });
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
      content: trimmed,
      avatarKey: req.me.avatarKey || null,
      imageKey: null,
      imageContentType: null,
      imageFilename: null
    });
    const decorated = media.applyMessageMedia({ ...message });
    emitNewMessage(message);
    return res.json({ success: true, message: decorated });
  } catch (err) {
    next(err);
  }
});

router.post('/upload', (req, res, next) => {
  messageUpload.single('image')(req, res, async err => {
    if (err) {
      const message = err instanceof multer.MulterError ? err.message : err?.message;
      return res.status(400).json({ success: false, message: message || 'Failed to upload image' });
    }

    try {
      const { groupId, channelId } = req.body || {};
      const content = typeof req.body?.content === 'string' ? req.body.content : '';

      if (!groupId || !channelId) {
        return res.status(400).json({ success: false, message: 'groupId and channelId are required' });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Image file is required' });
      }

      const channel = await getChannelById(channelId);
      if (!channel || channel.groupId !== groupId) {
        return res.status(404).json({ success: false, message: 'Channel not found' });
      }

      const group = await getGroupById(groupId);
      if (!group) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }

      const userId = req.me.id;
      const isMember =
        group.createdBy === userId ||
        (Array.isArray(group.admins) && group.admins.includes(userId)) ||
        (Array.isArray(group.members) && group.members.includes(userId));
      if (!isMember) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      if (Array.isArray(channel.bannedUserIds) && channel.bannedUserIds.includes(userId)) {
        return res.status(403).json({ success: false, message: 'You are banned in this channel' });
      }

      const fileBuffer = await fsPromises.readFile(req.file.path);
      await fsPromises.unlink(req.file.path).catch(() => {});
      const savedMedia = await media.saveBuffer(fileBuffer, {
        prefix: 'message',
        contentType: req.file.mimetype,
        filename: req.file.originalname
      });
      const trimmedContent = content.trim();
      if (!trimmedContent && !savedMedia.key) {
        return res.status(400).json({ success: false, message: 'Message requires text or image content' });
      }

      const message = await createMessage({
        groupId,
        channelId,
        userId,
        username: req.me.username,
        content: trimmedContent,
        avatarKey: req.me.avatarKey || null,
        imageKey: savedMedia.key,
        imageContentType: req.file.mimetype,
        imageFilename: req.file.originalname
      });

      const decorated = media.applyMessageMedia({ ...message });
      emitNewMessage(message);
      return res.json({ success: true, message: decorated });
    } catch (uploadErr) {
      next(uploadErr);
    }
  });
});

module.exports = router;
