require('dotenv').config();
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS_HASH = bcrypt.hashSync(process.env.ADMIN_PASS, 10);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024);

const ALLOWED_UPLOADS = new Map([
  ['.apng', new Set(['image/apng'])],
  ['.avif', new Set(['image/avif'])],
  ['.gif', new Set(['image/gif'])],
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.png', new Set(['image/png'])],
  ['.webp', new Set(['image/webp'])],
  ['.aac', new Set(['audio/aac'])],
  ['.flac', new Set(['audio/flac', 'audio/x-flac'])],
  ['.m4a', new Set(['audio/mp4', 'audio/x-m4a'])],
  ['.mp3', new Set(['audio/mpeg'])],
  ['.ogg', new Set(['audio/ogg', 'video/ogg'])],
  ['.wav', new Set(['audio/wav', 'audio/x-wav'])],
  ['.mov', new Set(['video/quicktime'])],
  ['.mp4', new Set(['video/mp4'])],
  ['.webm', new Set(['video/webm'])],
]);

function allowedUpload(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimeTypes = ALLOWED_UPLOADS.get(ext);
  return allowedMimeTypes && allowedMimeTypes.has(file.mimetype);
}

function allowedStoredFile(filename) {
  return ALLOWED_UPLOADS.has(path.extname(filename).toLowerCase());
}

function hasAscii(buffer, offset, text) {
  return buffer.length >= offset + text.length && buffer.toString('ascii', offset, offset + text.length) === text;
}

function hasBytes(buffer, offset, bytes) {
  return buffer.length >= offset + bytes.length && bytes.every((byte, i) => buffer[offset + i] === byte);
}

function hasFtypBrand(buffer, brands) {
  if (!hasAscii(buffer, 4, 'ftyp')) return false;
  const brandArea = buffer.toString('ascii', 8, Math.min(buffer.length, 64));
  return brands.some((brand) => brandArea.includes(brand));
}

function matchesFileSignature(ext, buffer) {
  switch (ext) {
    case '.apng':
    case '.png':
      return hasBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case '.avif':
      return hasFtypBrand(buffer, ['avif', 'avis']);
    case '.gif':
      return hasAscii(buffer, 0, 'GIF87a') || hasAscii(buffer, 0, 'GIF89a');
    case '.jpg':
    case '.jpeg':
      return hasBytes(buffer, 0, [0xff, 0xd8, 0xff]);
    case '.webp':
      return hasAscii(buffer, 0, 'RIFF') && hasAscii(buffer, 8, 'WEBP');
    case '.aac':
      return hasBytes(buffer, 0, [0xff, 0xf1]) || hasBytes(buffer, 0, [0xff, 0xf9]);
    case '.flac':
      return hasAscii(buffer, 0, 'fLaC');
    case '.m4a':
      return hasFtypBrand(buffer, ['M4A', 'mp42', 'isom']);
    case '.mp3':
      return hasAscii(buffer, 0, 'ID3') || hasBytes(buffer, 0, [0xff, 0xfb]) || hasBytes(buffer, 0, [0xff, 0xf3]) || hasBytes(buffer, 0, [0xff, 0xf2]);
    case '.ogg':
      return hasAscii(buffer, 0, 'OggS');
    case '.wav':
      return hasAscii(buffer, 0, 'RIFF') && hasAscii(buffer, 8, 'WAVE');
    case '.mov':
      return hasFtypBrand(buffer, ['qt ']);
    case '.mp4':
      return hasFtypBrand(buffer, ['isom', 'iso2', 'avc1', 'mp41', 'mp42', 'M4V']);
    case '.webm':
      return hasBytes(buffer, 0, [0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return false;
  }
}

function validateStoredUpload(file) {
  const ext = path.extname(file.filename).toLowerCase();
  if (!allowedStoredFile(file.filename)) return false;

  const buffer = Buffer.alloc(64);
  const fd = fs.openSync(file.path, 'r');
  const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  return bytesRead > 0 && matchesFileSignature(ext, buffer.subarray(0, bytesRead));
}

function removeUploadedFile(file) {
  if (!file || !file.path) return;
  fs.unlink(file.path, () => {});
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uuidv4() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!allowedUpload(file)) {
      return cb(new Error('Unsupported file type. Upload images, audio, or video only.'));
    }
    cb(null, true);
  },
});
const uploadSingleFile = upload.single('file');

function publicUrl(req, filename) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/media/${filename}`;
}

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER || !(await bcrypt.compare(password, ADMIN_PASS_HASH))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

app.post('/upload', authenticate, (req, res) => {
  uploadSingleFile(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File is too large' });
    }
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    if (!validateStoredUpload(req.file)) {
      removeUploadedFile(req.file);
      return res.status(400).json({ error: 'File content does not match an allowed media type' });
    }

    const { filename } = req.file;
    res.json({
      filename,
      url: publicUrl(req, filename),
    });
  });
});

app.get('/media/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!allowedStoredFile(filename)) return res.status(404).json({ error: 'Not found' });

  const filepath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filepath, {
    headers: {
      'Cache-Control': 'public, max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/files', authenticate, (req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR)
    .filter(allowedStoredFile)
    .map((name) => ({
      name,
      url: publicUrl(req, name),
    }));
  res.json(files);
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => console.log(`Media service running on port ${PORT}`));
