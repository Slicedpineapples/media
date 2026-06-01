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
const METADATA_FILE = path.join(UPLOADS_DIR, '.metadata.json');

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 8005;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS_HASH = bcrypt.hashSync(process.env.ADMIN_PASS, 10);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024);
const ROOT_FOLDER = '';

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

function sanitizeFolderPath(value) {
  const raw = String(value || ROOT_FOLDER).trim();
  if (!raw || raw === '/') return ROOT_FOLDER;

  const segments = raw
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, ' ').replace(/[^\w .-]/g, '').slice(0, 60))
    .filter((segment) => segment && segment !== '.' && segment !== '..');

  return segments.slice(0, 5).join('/');
}

function safeUploadsPath(relativePath = ROOT_FOLDER) {
  const target = path.resolve(UPLOADS_DIR, relativePath);
  const root = path.resolve(UPLOADS_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function ensureUploadFolder(folder) {
  const safeFolder = sanitizeFolderPath(folder);
  const folderPath = safeUploadsPath(safeFolder);
  if (!folderPath) return null;
  fs.mkdirSync(folderPath, { recursive: true });
  return { folder: safeFolder, folderPath };
}

function relativeFilePath(folder, filename) {
  return folder ? `${folder}/${filename}` : filename;
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

function loadMetadata() {
  try {
    return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveMetadata(metadata) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
}

function recordUpload(filename, size = 0) {
  const metadata = loadMetadata();
  metadata[filename] = {
    uploadedAt: new Date().toISOString(),
    size,
  };
  saveMetadata(metadata);
}

function listFolders(dir = UPLOADS_DIR, prefix = ROOT_FOLDER) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];

    const folder = prefix ? `${prefix}/${entry.name}` : entry.name;
    const childPath = path.join(dir, entry.name);
    return [folder, ...listFolders(childPath, folder)];
  });
}

function listStoredFiles(dir = UPLOADS_DIR, prefix = ROOT_FOLDER) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.metadata.json') return [];

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) return listStoredFiles(fullPath, relativePath);
    if (!prefix) return [];
    if (!entry.isFile() || !allowedStoredFile(entry.name)) return [];

    return [{ name: entry.name, folder: prefix, path: relativePath }];
  });
}

function directoryContents(req, folder = ROOT_FOLDER) {
  const safeFolder = sanitizeFolderPath(folder);
  const folderPath = safeUploadsPath(safeFolder);
  if (!folderPath || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return null;

  const metadata = loadMetadata();
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folderRelativePath = relativeFilePath(safeFolder, entry.name);
      return {
        name: entry.name,
        path: folderRelativePath,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const files = safeFolder ? entries
    .filter((entry) => entry.isFile() && entry.name !== '.metadata.json' && allowedStoredFile(entry.name))
    .map((entry) => {
      const filePath = relativeFilePath(safeFolder, entry.name);
      const stat = fs.statSync(path.join(folderPath, entry.name));
      return {
        name: entry.name,
        folder: safeFolder,
        path: filePath,
        size: stat.size || metadata[filePath]?.size || 0,
        uploadedAt: metadata[filePath]?.uploadedAt || null,
        url: publicUrl(req, filePath),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name)) : [];

  return {
    folder: safeFolder,
    parent: safeFolder.split('/').slice(0, -1).join('/'),
    folders,
    files,
  };
}

function removeMetadataForPath(itemPath) {
  const metadata = loadMetadata();
  Object.keys(metadata).forEach((key) => {
    if (key === itemPath || key.startsWith(itemPath + '/')) delete metadata[key];
  });
  saveMetadata(metadata);
}

function deleteUploadItem(item) {
  const type = item?.type === 'folder' ? 'folder' : 'file';
  const itemPath = sanitizeFolderPath(item?.path);
  if (!itemPath) return false;

  const fullPath = safeUploadsPath(itemPath);
  if (!fullPath || !fs.existsSync(fullPath)) return false;

  const stat = fs.statSync(fullPath);
  if (type === 'folder') {
    if (!stat.isDirectory()) return false;
    fs.rmSync(fullPath, { recursive: true, force: true });
  } else {
    if (!stat.isFile() || !allowedStoredFile(path.basename(itemPath))) return false;
    fs.unlinkSync(fullPath);
  }

  removeMetadataForPath(itemPath);
  return true;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const requestedFolder = req.body.folder || req.query.folder || req.headers['x-upload-folder'];
    if (!sanitizeFolderPath(requestedFolder)) return cb(new Error('Choose a folder first'));

    const uploadFolder = ensureUploadFolder(requestedFolder);
    if (!uploadFolder) return cb(new Error('Invalid folder'));
    req.uploadFolder = uploadFolder.folder;
    cb(null, uploadFolder.folderPath);
  },
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
      return cb(new Error('Unsupported file type'));
    }
    cb(null, true);
  },
});
const uploadSingleFile = upload.single('file');

function publicUrl(req, filename) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
  return `${proto}://${host}/media/${encodedPath}`;
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
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    const { filename } = req.file;
    const folder = req.uploadFolder || ROOT_FOLDER;
    const filePath = relativeFilePath(folder, filename);
    recordUpload(filePath, req.file.size);

    res.json({
      filename,
      path: filePath,
      folder,
      size: req.file.size,
      url: publicUrl(req, filePath),
    });
  });
});

app.get('/media/*', (req, res) => {
  let requestedPath;
  try {
    requestedPath = req.params[0].split('/').map(decodeURIComponent).join('/');
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }

  const safePath = sanitizeFolderPath(path.dirname(requestedPath));
  const filename = path.basename(requestedPath);
  if (!allowedStoredFile(filename)) return res.status(404).json({ error: 'Not found' });

  const filepath = safeUploadsPath(relativeFilePath(safePath, filename));
  if (!filepath) return res.status(404).json({ error: 'Not found' });
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

app.get('/folders', authenticate, (req, res) => {
  res.json(listFolders());
});

app.post('/folders', authenticate, (req, res) => {
  const parent = sanitizeFolderPath(req.body.parent);
  const requestedFolder = req.body.folder;
  const folder = parent && requestedFolder
    ? relativeFilePath(parent, requestedFolder)
    : requestedFolder;
  const uploadFolder = ensureUploadFolder(folder);
  if (!uploadFolder || !uploadFolder.folder) {
    return res.status(400).json({ error: 'Invalid folder' });
  }
  res.status(201).json({ folder: uploadFolder.folder });
});

app.get('/browse', authenticate, (req, res) => {
  const contents = directoryContents(req, req.query.folder);
  if (!contents) return res.status(404).json({ error: 'Folder not found' });
  res.json(contents);
});

app.delete('/items', authenticate, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'No items selected' });

  let deleted = 0;
  items.forEach((item) => {
    if (deleteUploadItem(item)) deleted++;
  });

  res.json({ deleted });
});

app.get('/files', authenticate, (req, res) => {
  const metadata = loadMetadata();
  const files = listStoredFiles()
    .map(({ name, folder, path: filePath }) => {
      const fullPath = safeUploadsPath(filePath);
      const stat = fullPath && fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
      return {
        name,
        folder,
        path: filePath,
        size: stat?.size || metadata[filePath]?.size || 0,
        uploadedAt: metadata[filePath]?.uploadedAt || null,
        url: publicUrl(req, filePath),
      };
    });
  res.json(files);
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => console.log(`Media service running on port ${PORT}`));
