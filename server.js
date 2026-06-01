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

app.listen(PORT, () => console.log(`Media service running on port ${PORT}`));
