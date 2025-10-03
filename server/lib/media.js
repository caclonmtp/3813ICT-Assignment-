const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_ROOT } = require('./uploads');

const SECRET_FILE = path.join(UPLOAD_ROOT, '.media-secret');
const DEFAULT_SECRET = 'mean-chat-development-secret';

if (!process.env.MEAN_CHAT_MEDIA_SECRET) {
  let resolvedSecret = null;
  try {
    if (fs.existsSync(SECRET_FILE)) {
      resolvedSecret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    } else {
      resolvedSecret = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
      fs.writeFileSync(SECRET_FILE, resolvedSecret, { encoding: 'utf8', mode: 0o600 });
    }
  } catch (err) {
    console.warn('[media] Failed to read/write media secret file:', err?.message || err);
    resolvedSecret = DEFAULT_SECRET;
  }

  if (!resolvedSecret) {
    resolvedSecret = DEFAULT_SECRET;
  }

  process.env.MEAN_CHAT_MEDIA_SECRET = resolvedSecret;
  if (resolvedSecret === DEFAULT_SECRET) {
    console.warn('[media] MEAN_CHAT_MEDIA_SECRET not set. Using development secret; do not use in production.');
  } else {
    console.info('[media] MEAN_CHAT_MEDIA_SECRET generated automatically for local use.');
  }
}

const MEDIA_SECRET = process.env.MEAN_CHAT_MEDIA_SECRET || DEFAULT_SECRET;
const HMAC_SECRET = crypto.createHash('sha256').update(`${MEDIA_SECRET}-sign`).digest();
const ENCRYPTION_KEY = crypto.createHash('sha256').update(MEDIA_SECRET).digest();
const MEDIA_DIR = path.join(UPLOAD_ROOT, 'secure');
const TOKEN_VERSION = 'v1';

fs.mkdirSync(MEDIA_DIR, { recursive: true });

function generateKey(prefix) {
  const id = crypto.randomBytes(12).toString('hex');
  return `${prefix}-${Date.now()}-${id}`;
}

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptBuffer(raw) {
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

async function saveBuffer(buffer, { prefix, contentType, filename } = {}) {
  const key = generateKey(prefix || 'media');
  const filePath = path.join(MEDIA_DIR, `${key}.enc`);
  const encrypted = encryptBuffer(buffer);
  await fs.promises.writeFile(filePath, encrypted);
  return { key, contentType, filename };
}

async function deleteKey(key) {
  if (!key) return;
  const filePath = path.join(MEDIA_DIR, `${key}.enc`);
  await fs.promises.unlink(filePath).catch(err => {
    if (err && err.code !== 'ENOENT') {
      console.warn(`[media] Failed to delete key ${key}:`, err);
    }
  });
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const pad = 4 - (str.length % 4);
  const padded = str + (pad < 4 ? '='.repeat(pad) : '');
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function createToken(payload) {
  const json = JSON.stringify(payload);
  const body = base64UrlEncode(json);
  const signature = crypto.createHmac('sha256', HMAC_SECRET).update(body).digest();
  return `${body}.${base64UrlEncode(signature)}`;
}

function decodeToken(token) {
  const [body, signature] = token.split('.');
  if (!body || !signature) {
    throw new Error('Invalid token');
  }
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(body).digest();
  const actual = base64UrlDecode(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('Invalid signature');
  }
  const payload = JSON.parse(base64UrlDecode(body).toString('utf8'));
  if (payload.v !== TOKEN_VERSION) {
    throw new Error('Unsupported token');
  }
  if (typeof payload.e !== 'number' || Date.now() > payload.e) {
    throw new Error('Token expired');
  }
  return payload;
}

function isExternalUrl(value) {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

function buildDownloadUrl(key, { filename, contentType, expiresInMs } = {}) {
  if (!key) {
    return null;
  }
  if (isExternalUrl(key)) {
    return key;
  }
  if (typeof key === 'string' && key.startsWith('/uploads/')) {
    const payload = {
      v: TOKEN_VERSION,
      l: true,
      p: key,
      e: Date.now() + (expiresInMs || 5 * 60 * 1000),
      fn: filename || null,
      ct: contentType || null
    };
    return `/api/media/${createToken(payload)}`;
  }
  const payload = {
    v: TOKEN_VERSION,
    k: key,
    e: Date.now() + (expiresInMs || 5 * 60 * 1000),
    fn: filename || null,
    ct: contentType || null
  };
  return `/api/media/${createToken(payload)}`;
}

async function readDecryptedBuffer(key) {
  const filePath = path.join(MEDIA_DIR, `${key}.enc`);
  const raw = await fs.promises.readFile(filePath);
  return decryptBuffer(raw);
}

function applyUserMedia(user) {
  if (!user) return user;
  const url = buildDownloadUrl(user.avatarKey || user.avatarUrl, {
    filename: 'avatar.jpg',
    contentType: 'image/jpeg'
  });
  if (url) {
    user.avatarUrl = url;
  }
  return user;
}

function applyGroupMedia(group) {
  if (!group) return group;
  const url = buildDownloadUrl(group.avatarKey || group.avatarUrl, {
    filename: 'group-avatar.jpg',
    contentType: 'image/jpeg'
  });
  if (url) {
    group.avatarUrl = url;
  }
  return group;
}

function applyMessageMedia(message) {
  if (!message) return message;
  const imageUrl = buildDownloadUrl(message.imageKey || message.imageUrl, {
    filename: message.imageFilename || 'attachment',
    contentType: message.imageContentType || undefined,
    expiresInMs: 3 * 60 * 1000
  });
  if (imageUrl) {
    message.imageUrl = imageUrl;
  }
  const avatarUrl = buildDownloadUrl(message.avatarKey || message.avatarUrl, {
    filename: 'avatar.jpg',
    contentType: 'image/jpeg'
  });
  if (avatarUrl) {
    message.avatarUrl = avatarUrl;
  }
  return message;
}

module.exports = {
  saveBuffer,
  deleteKey,
  buildDownloadUrl,
  decodeToken,
  readDecryptedBuffer,
  applyUserMedia,
  applyGroupMedia,
  applyMessageMedia,
  isExternalUrl
};
