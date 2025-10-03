const express = require('express');
const { exportData, importData } = require('../lib/db');
const { requireUser, isSuper } = require('../middleware/auth');

const router = express.Router();

// Administrative endpoints require an authenticated user.
router.use(requireUser);

// GET /api/admin/export returns a snapshot of database entities; only super admins can access it.
router.get('/export', async (req, res, next) => {
  try {
    if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
    const data = await exportData();
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/import replaces persisted data with the provided snapshot (super admin only).
router.post('/import', async (req, res, next) => {
  try {
    if (!isSuper(req.me)) return res.status(403).json({ success: false, message: 'Super only' });
    const { data } = req.body || {};
    if (!data) return res.status(400).json({ success: false, message: 'data required' });
    await importData(data);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
