const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const uploadsModulePath = require.resolve('../lib/uploads.js');

describe('uploads helpers', () => {
  let tmpRoot;
  let uploads;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-test-'));
    process.env.MEAN_CHAT_UPLOAD_ROOT = tmpRoot;
    delete require.cache[uploadsModulePath];
    uploads = require('../lib/uploads');
  });

  afterEach(() => {
    delete require.cache[uploadsModulePath];
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.MEAN_CHAT_UPLOAD_ROOT;
  });

  it('ensureUploadDirs creates expected directories within override root', () => {
    uploads.ensureUploadDirs();
    const expected = ['avatars', 'group-avatars', 'messages'];
    expected.forEach(dir => {
      const fullPath = path.join(tmpRoot, dir);
      assert.ok(fs.existsSync(fullPath), `Expected directory to exist: ${fullPath}`);
    });
  });

  it('toPublicUrl converts file paths to public urls relative to override root', () => {
    uploads.ensureUploadDirs();
    const filePath = path.join(tmpRoot, 'avatars', 'avatar.png');
    fs.writeFileSync(filePath, 'data');
    const url = uploads.toPublicUrl(filePath);
    assert.strictEqual(url, '/uploads/avatars/avatar.png');
  });

  it('resolveFilePathFromUrl rejects traversal attempts and returns safe paths', () => {
    uploads.ensureUploadDirs();
    const validUrl = '/uploads/avatars/user.png';
    const validResolved = uploads.resolveFilePathFromUrl(validUrl);
    assert.strictEqual(validResolved, path.join(tmpRoot, 'avatars', 'user.png'));

    const invalid = uploads.resolveFilePathFromUrl('/uploads/../etc/passwd');
    assert.strictEqual(invalid, null);
  });
});
