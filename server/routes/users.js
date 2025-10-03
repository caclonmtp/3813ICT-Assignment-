const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const {
  listUsers,
  getUserById,
  updateUser,
  setUserRoles,
  addRoleToUser,
  deleteUser,
  createUser,
  findUserByUsername,
  findUserByEmail
} = require('../lib/db');
const { requireUser, isSuper } = require('../middleware/auth');
const {
  AVATAR_DIR,
  ensureUploadDirs,
  resolveFilePathFromUrl
} = require('../lib/uploads');
const sharp = require('sharp');
const media = require('../lib/media');

const fsPromises = fs.promises;

const router = express.Router();

// Multer storage for user avatars, ensuring predictable filenames and safe extensions.
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureUploadDirs();
      cb(null, AVATAR_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext && /\.[a-z0-9]+$/.test(ext) ? ext : '';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `avatar-${unique}${safeExt}`);
  }
});

// Enforces avatar upload constraints (mime-type, size, storage).
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed'));
    } else {
      cb(null, true);
    }
  }
});

// Removes any currently associated avatar assets for a user to prevent orphaned files.
async function removeExistingAvatar(user) {
  if (!user) return;
  if (user.avatarKey) {
    await media.deleteKey(user.avatarKey);
    return;
  }
  if (user.avatarUrl) {
    const previousPath = resolveFilePathFromUrl(user.avatarUrl);
    if (!previousPath) {
      return;
    }
    try {
      await fsPromises.unlink(previousPath);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn('Failed to remove old avatar', err);
      }
    }
  }
}

// All user endpoints require an authenticated caller.
router.use(requireUser);

// POST /api/users provisions a new user; only super admins may invoke it.
router.post('/', async (req, res, next) => {
  try {
    if (!isSuper(req.me)) {
      return res.status(403).json({ success: false, message: 'Super only' });
    }

    const { username, email, password, roles, groups } = req.body || {};
    const uname = String(username || '').trim();
    const emailNorm = String(email || '').trim();
    const pwd = String(password || '').trim();

    if (!uname || !emailNorm || !pwd) {
      return res.status(400).json({ success: false, message: 'username, email, password required' });
    }

    const existing = await findUserByUsername(uname.toLowerCase());
    if (existing) {
      return res.status(409).json({ success: false, message: 'Username taken' });
    }

    const existingEmail = await findUserByEmail(emailNorm.toLowerCase());
    if (existingEmail) {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }

    if (roles && !Array.isArray(roles)) {
      return res.status(400).json({ success: false, message: 'roles must be an array when provided' });
    }

    if (groups && !Array.isArray(groups)) {
      return res.status(400).json({ success: false, message: 'groups must be an array when provided' });
    }

    const user = await createUser({
      username: uname,
      email: emailNorm,
      password: pwd,
      roles: roles && roles.length ? roles : undefined,
      groups: groups && groups.length ? groups : undefined
    });

    const { password: _, ...safe } = user;
    return res.status(201).json({ success: true, user: media.applyUserMedia(safe) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Username or email already exists' });
    }
    next(err);
  }
});

// GET /api/users returns the full user list sans passwords.
router.get('/', async (req, res, next) => {
  try {
    const users = await listUsers();
    const sanitized = users.map(({ password, ...u }) => media.applyUserMedia(u));
    return res.json(sanitized);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id retrieves a single user by id with media decoration.
router.get('/:id', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const { password, ...safe } = user;
    return res.json(media.applyUserMedia(safe));
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id updates profile fields; users can edit themselves, super admins can edit anyone.
router.put('/:id', async (req, res, next) => {
  try {
    if (!(isSuper(req.me) || req.me.id === req.params.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const updates = {};
    const { username, email, roles } = req.body || {};
    if (username) updates.username = username;
    if (email) {
      const normalizedEmail = String(email).trim();
      if (normalizedEmail.toLowerCase() !== (user.email || '').toLowerCase()) {
        const emailOwner = await findUserByEmail(normalizedEmail.toLowerCase());
        if (emailOwner && emailOwner.id !== user.id) {
          return res.status(409).json({ success: false, message: 'Email already in use' });
        }
      }
      updates.email = normalizedEmail;
    }
    if (roles && isSuper(req.me)) updates.roles = roles;
    const updated = await updateUser(req.params.id, updates);
    const { password, ...safe } = updated;
    return res.json(media.applyUserMedia(safe));
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Username or email already exists' });
    }
    next(err);
  }
});

// POST /api/users/:id/avatar uploads and processes a square avatar image for the user.
router.post('/:id/avatar', (req, res, next) => {
  avatarUpload.single('avatar')(req, res, async err => {
    if (err) {
      const message = err instanceof multer.MulterError ? err.message : err?.message;
      return res.status(400).json({ success: false, message: message || 'Failed to upload avatar' });
    }

    try {
      if (!(isSuper(req.me) || req.me.id === req.params.id)) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }

      const user = await getUserById(req.params.id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
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
        return res.status(400).json({ success: false, message: 'Unable to process avatar image' });
      }

      await fsPromises.unlink(req.file.path).catch(() => {});

      const saved = await media.saveBuffer(buffer, {
        prefix: 'avatar',
        contentType: 'image/jpeg',
        filename: `${req.params.id}.jpg`
      });

      const updated = await updateUser(req.params.id, { avatarKey: saved.key });
      await removeExistingAvatar(user);

      const { password, ...safe } = updated;
      return res.json({ success: true, user: media.applyUserMedia(safe) });
    } catch (uploadErr) {
      next(uploadErr);
    }
  });
});

// PATCH /api/users/:id/roles replaces the user's role set; restricted to super admins.
router.patch('/:id/roles', async (req, res, next) => {
  try {
    if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
    const { roles } = req.body || {};
    if (!Array.isArray(roles)) {
      return res.status(400).json({ success: false, message: 'roles[] required' });
    }
    const updated = await setUserRoles(req.params.id, roles);
    if (!updated) return res.status(404).json({ success: false, message: 'User not found' });
    const { password, ...safe } = updated;
    return res.json(media.applyUserMedia(safe));
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/promote adds the group-admin role to the target user.
router.post('/:id/promote', async (req, res, next) => {
  try {
    if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
    const updated = await addRoleToUser(req.params.id, 'group-admin');
    if (!updated) return res.status(404).json({ success: false, message: 'User not found' });
    const { password, ...safe } = updated;
    return res.json(media.applyUserMedia(safe));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id removes a user (and related assets) when initiated by a super admin.
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
    if (req.me.id === req.params.id) {
      return res.status(400).json({ success: false, message: 'Super admin cannot delete their own account' });
    }
    const removed = await deleteUser(req.params.id, req.me.id);
    if (!removed) return res.status(404).json({ success: false, message: 'User not found' });
    await removeExistingAvatar(removed);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
