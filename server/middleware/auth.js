const { readDB } = require('../lib/db');

function requireUser(req, res, next) {
  const userId = req.header('x-user-id');
  if (!userId) return res.status(401).json({ success: false, message: 'Missing x-user-id' });
  const db = readDB();
  const me = db.users.find(u => u.id === userId);
  if (!me) return res.status(401).json({ success: false, message: 'Invalid user id' });
  req.me = me; req.db = db;
  next();
}

const isSuper = (u) => Array.isArray(u.roles) && u.roles.includes('super-admin');
const isGroupAdmin = (u) => Array.isArray(u.roles) && u.roles.includes('group-admin');

module.exports = { requireUser, isSuper, isGroupAdmin };

