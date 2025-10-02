const express = require('express');
const {
  findUserByCredentials,
  findUserByUsername,
  findUserByEmail,
  createUser
} = require('../lib/db');
const { applyUserMedia } = require('../lib/media');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const uname = String(username || '').trim().toLowerCase();
    const pwd = String(password || '').trim();
    if (!uname || !pwd) {
      return res.status(400).json({ success: false, message: 'Missing credentials' });
    }
    const user = await findUserByCredentials(uname, pwd);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const { password: _, ...safe } = user;
    return res.json({ success: true, user: applyUserMedia(safe) });
  } catch (err) {
    next(err);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body || {};
    const uname = String(username || '').trim();
    const emailNorm = String(email || '').trim();
    const pwd = String(password || '').trim();
    if (!uname || !emailNorm || !pwd) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    const existing = await findUserByUsername(uname.toLowerCase());
    if (existing) {
      return res.status(409).json({ success: false, message: 'Username taken' });
    }
    const existingEmail = await findUserByEmail(emailNorm.toLowerCase());
    if (existingEmail) {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }
    const user = await createUser({ username: uname, email: emailNorm, password: pwd, roles: ['user'], groups: [] });
    const { password: _, ...safe } = user;
    return res.json({ success: true, user: applyUserMedia(safe) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Username or email already exists' });
    }
    next(err);
  }
});

module.exports = router;
