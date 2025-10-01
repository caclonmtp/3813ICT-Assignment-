const path = require('path');
const fs = require('fs');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const AVATAR_DIR = path.join(UPLOAD_ROOT, 'avatars');
const MESSAGE_DIR = path.join(UPLOAD_ROOT, 'messages');

function ensureUploadDirs() {
  [UPLOAD_ROOT, AVATAR_DIR, MESSAGE_DIR].forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });
}

function toPublicUrl(filePath) {
  const relative = path.relative(UPLOAD_ROOT, filePath).split(path.sep).join('/');
  return `/uploads/${relative}`;
}

function resolveFilePathFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) {
    return null;
  }
  const relative = url.replace(/^\/uploads\//, '');
  const fullPath = path.join(UPLOAD_ROOT, relative);
  if (!fullPath.startsWith(UPLOAD_ROOT)) {
    return null;
  }
  return fullPath;
}

module.exports = {
  UPLOAD_ROOT,
  AVATAR_DIR,
  MESSAGE_DIR,
  ensureUploadDirs,
  toPublicUrl,
  resolveFilePathFromUrl
};
