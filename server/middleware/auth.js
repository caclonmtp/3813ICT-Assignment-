const { getUserById } = require('../lib/db');
const { applyUserMedia } = require('../lib/media');

async function requireUser(req, res, next) {
  try {
    const userId = req.header('x-user-id');
    if (!userId) return res.status(401).json({ success: false, message: 'Missing x-user-id' });
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ success: false, message: 'Invalid user id' });
    const { password, ...safeUser } = user;
    req.me = applyUserMedia(safeUser);
    next();
  } catch (err) {
    next(err);
  }
}

const isSuper = (u) => Array.isArray(u.roles) && u.roles.includes('super-admin');
const isGroupAdmin = (u) => Array.isArray(u.roles) && (u.roles.includes('group-admin') || u.roles.includes('super-admin'));

module.exports = { requireUser, isSuper, isGroupAdmin };
