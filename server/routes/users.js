const express = require('express');
const {
  listUsers,
  getUserById,
  updateUser,
  setUserRoles,
  addRoleToUser,
  deleteUser
} = require('../lib/db');
const { requireUser, isSuper } = require('../middleware/auth');

const router = express.Router();

// All endpoints require authentication
router.use(requireUser);

// GET /api/users
router.get('/', async (req, res, next) => {
  try {
    const users = await listUsers();
    return res.json(users.map(({ password, ...u }) => u));
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:id
router.get('/:id', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const { password, ...safe } = user;
    return res.json(safe);
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id
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
    if (email) updates.email = email;
    if (roles && isSuper(req.me)) updates.roles = roles;
    const updated = await updateUser(req.params.id, updates);
    const { password, ...safe } = updated;
    return res.json(safe);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/:id/roles (super only)
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
    return res.json(safe);
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:id/promote (to group-admin, super only)
router.post('/:id/promote', async (req, res, next) => {
  try {
    if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
    const updated = await addRoleToUser(req.params.id, 'group-admin');
    if (!updated) return res.status(404).json({ success: false, message: 'User not found' });
    const { password, ...safe } = updated;
    return res.json(safe);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id (super only)
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
    const removed = await deleteUser(req.params.id, req.me.id);
    if (!removed) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
