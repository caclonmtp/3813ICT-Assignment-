const express = require('express');
const { readDB, writeDB } = require('../lib/db');
const { requireUser, isSuper } = require('../middleware/auth');

const router = express.Router();

router.use(requireUser);

// GET /api/admin/export
router.get('/export', (req, res) => {
  if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
  return res.json({ success: true, data: readDB() });
});

// POST /api/admin/import
router.post('/import', (req, res) => {
  if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
  const { data } = req.body || {};
  if (!data) return res.status(400).json({ success: false, message: 'data required' });
  writeDB(data);
  return res.json({ success: true });
});

module.exports = router;

