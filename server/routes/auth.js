const express = require('express');
const { readDB, writeDB, genId } = require('../lib/db');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const db = readDB();
  const { username, password } = req.body || {};
  const uname = String(username || '').trim().toLowerCase();
  const pwd = String(password || '').trim();
  let user = db.users.find(u => String(u.username).toLowerCase() === uname && String(u.password) === pwd);
  if (!user) {
    // Resilience: if super user is missing and default creds are used, auto-seed it.
    const hasSuper = db.users.some(u => String(u.username).toLowerCase() === 'super');
    if (!hasSuper && uname === 'super' && pwd === '123') {
      user = { id: genId('u_'), username: 'super', email: 'super@admin.com', password: '123', roles: ['super-admin'], groups: [] };
      db.users.push(user);
      writeDB(db);
    } else {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  }
  const { password: _, ...safe } = user;
  return res.json({ success: true, user: safe });
});

// POST /api/auth/register
router.post('/register', (req, res) => {
  const db = readDB();
  const { username, email, password } = req.body || {};
  const uname = String(username || '').trim();
  const emailNorm = String(email || '').trim();
  const pwd = String(password || '').trim();
  if (!uname || !emailNorm || !pwd)
    return res.status(400).json({ success: false, message: 'Missing fields' });
  if (db.users.some(u => String(u.username).toLowerCase() === uname.toLowerCase()))
    return res.status(409).json({ success: false, message: 'Username taken' });
  const user = { id: genId('u_'), username: uname, email: emailNorm, password: pwd, roles: ['user'], groups: [] };
  db.users.push(user);
  writeDB(db);
  const { password: _, ...safe } = user;
  return res.json({ success: true, user: safe });
});

module.exports = router;
