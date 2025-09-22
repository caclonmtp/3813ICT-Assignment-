const express = require('express');
const {
  findUserByCredentials,
  findUserByUsername,
  createUser
} = require('../lib/db');

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
    return res.json({ success: true, user: safe });
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
    const user = await createUser({ username: uname, email: emailNorm, password: pwd, roles: ['user'], groups: [] });
    const { password: _, ...safe } = user;
    return res.json({ success: true, user: safe });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ success: false, message: 'Username taken' });
    }
    next(err);
  }
});

module.exports = router;
