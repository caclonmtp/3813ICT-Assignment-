const express = require('express');
const fs = require('fs');
const {
  decodeToken,
  readDecryptedBuffer
} = require('../lib/media');
const { resolveFilePathFromUrl } = require('../lib/uploads');

const router = express.Router();

router.get('/:token', async (req, res, next) => {
  try {
    const payload = decodeToken(req.params.token);
    let buffer;
    if (payload?.l) {
      const filePath = resolveFilePathFromUrl(payload.p);
      if (!filePath) {
        return res.status(404).json({ success: false, message: 'Media not found' });
      }
      buffer = await fs.promises.readFile(filePath);
    } else if (payload?.k) {
      buffer = await readDecryptedBuffer(payload.k);
    } else {
      return res.status(404).json({ success: false, message: 'Invalid token' });
    }

    res.setHeader('Content-Type', payload.ct || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=0, no-cache');
    if (payload.fn) {
      res.setHeader('Content-Disposition', `inline; filename="${payload.fn}"`);
    }
    res.send(buffer);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.message === 'Token expired' || err.message === 'Invalid signature')) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }
    next(err);
  }
});

module.exports = router;
