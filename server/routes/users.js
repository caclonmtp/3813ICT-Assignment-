const express = require('express');
const { readDB, writeDB } = require('../lib/db');
const { requireUser, isSuper } = require('../middleware/auth');

const router = express.Router();

// All endpoints require authentication
router.use(requireUser);

// GET /api/users
router.get('/', (req, res) => {
  const db = readDB();
  const users = db.users.map(({ password, ...u }) => u);
  return res.json(users);
});

// GET /api/users/:id
router.get('/:id', (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const { password, ...safe } = user;
  return res.json(safe);
});

// PUT /api/users/:id
router.put('/:id', (req, res) => {
  const db = readDB();
  if (!(isSuper(req.me) || req.me.id === req.params.id))
    return res.status(403).json({ success: false, message: 'Forbidden' });
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const { username, email, roles } = req.body || {};
  if (username) user.username = username;
  if (email) user.email = email;
  if (roles && isSuper(req.me)) user.roles = roles;
  writeDB(db);
  const { password, ...safe } = user;
  return res.json(safe);
});

// PATCH /api/users/:id/roles (super only)
router.patch('/:id/roles', (req, res) => {
  const db = readDB();
  if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const { roles } = req.body || {};
  if (!Array.isArray(roles)) return res.status(400).json({ success: false, message: 'roles[] required' });
  user.roles = roles;
  writeDB(db);
  const { password, ...safe } = user;
  return res.json(safe);
});

// POST /api/users/:id/promote (to group-admin, super only)
router.post('/:id/promote', (req, res) => {
  const db = readDB();
  if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (!user.roles.includes('group-admin')) user.roles.push('group-admin');
  writeDB(db);
  const { password, ...safe } = user;
  return res.json(safe);
});

// DELETE /api/users/:id (super only)
router.delete('/:id', (req, res) => {
  const db = readDB();
  if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'User not found' });

  const removed = db.users[idx];
  db.groups.forEach(g => {
    g.members = (g.members || []).filter(id => id !== removed.id);
    g.admins = (g.admins || []).filter(id => id !== removed.id);
    if (g.createdBy === removed.id) g.createdBy = req.me.id;
  });
  db.users.splice(idx, 1);
  writeDB(db);
  return res.json({ success: true });
});

module.exports = router;

