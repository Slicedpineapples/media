import {
  createBreadcrumbs,
  createExplorerItem,
  createFileHeader,
  createFileSort,
  createSectionHeader,
} from './components/explorer.js';
import { emptyPreview, mediaPreview } from './components/media-preview.js';
import { escapeHtml, formatBytes, formatDate } from './utils/format.js';

const token = localStorage.getItem('token');
if (!token) window.location.href = '/';

// Decode username from JWT payload (no lib needed)
try {
  const payload = JSON.parse(atob(token.split('.')[1]));
  document.getElementById('navUser').textContent = payload.username || '';
} catch {}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('currentFolder');
  window.location.href = '/';
});

// ── File list ─────────────────────────────────────────
const initialFolder = new URLSearchParams(window.location.search).get('folder') || localStorage.getItem('currentFolder') || '';
let currentFolder = initialFolder;
let currentContents = { folder: '', parent: '', folders: [], files: [] };
let historyBack = initialFolder ? [''] : [];
let historyForward = [];
let selectMode = false;
let fileSort = 'newest';
const selectedItems = new Map();

async function loadFiles(folder = currentFolder, options = {}) {
  const list = document.getElementById('fileList');
  try {
    const res = await fetch(`/browse?folder=${encodeURIComponent(folder)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { localStorage.removeItem('token'); window.location.href = '/'; return; }
    if (res.status === 404) {
      if (folder) {
        localStorage.removeItem('currentFolder');
        currentFolder = '';
        await loadFiles('', { skipHistory: true });
        return;
      }
      await loadLegacyFiles();
      setStatus('File explorer API not available. Restart the server to enable folder browsing.', 'error');
      return;
    }
    if (!res.ok) throw new Error('Browse failed');
    const contents = await res.json();
    currentFolder = contents.folder || '';
    persistCurrentFolder();
    currentContents = contents;
    selectedItems.clear();
    updateUploadTarget();
    updateToolbar();
    updatePreviewLayout(contents);
    renderExplorer(contents);
  } catch {
    list.innerHTML = '<div class="empty-state"><span style="color:var(--error);font-size:12px">Failed to load files. Restart the server and try again.</span></div>';
  }
}

async function loadLegacyFiles() {
  const res = await fetch('/files', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { localStorage.removeItem('token'); window.location.href = '/'; return; }
  if (!res.ok) throw new Error('Files failed');
  const files = await res.json();
  currentFolder = '';
  persistCurrentFolder();
  currentContents = { folder: '', parent: '', folders: [], files: [] };
  updateUploadTarget();
  updateToolbar();
  updatePreviewLayout(currentContents);
  renderExplorer(currentContents);
}

function renderExplorer({ folder, folders, files }) {
  const list = document.getElementById('fileList');
  const count = document.getElementById('fileCount');
  const query = searchInput.value.trim().toLowerCase();
  const matches = item => !query || item.name.toLowerCase().includes(query);
  const visibleFolders = folders.filter(matches);
  const visibleFiles = folder ? files.filter(matches).sort(compareFiles) : [];
  const total = visibleFolders.length + visibleFiles.length;
  count.textContent = total ? `${visibleFolders.length} folder${visibleFolders.length === 1 ? '' : 's'} · ${visibleFiles.length} file${visibleFiles.length === 1 ? '' : 's'}` : '';
  renderBreadcrumbs(folder);

  if (!visibleFolders.length && !visibleFiles.length) {
    list.innerHTML = `<div class="empty-state"><p>${folder ? 'Empty folder' : 'No folders yet'}</p><span>${folder ? 'Upload something above or create a folder' : 'Create a folder to begin'}</span></div>`;
    return;
  }

  list.innerHTML = '';
  list.classList.toggle('selecting', selectMode);

  const folderRows = visibleFolders.map(item => ({ type: 'folder', ...item }));
  if (folderRows.length) {
    list.appendChild(createSectionHeader('Folders', folderRows.length));

    const folderGrid = document.createElement('div');
    folderGrid.className = 'folder-grid';
    folderGrid.classList.toggle('selecting', selectMode);
    folderRows.forEach((entry, i) => folderGrid.appendChild(renderItem(entry, i)));
    list.appendChild(folderGrid);
  }

  if (visibleFiles.length) {
    const sort = createFileSort(fileSort, value => {
      fileSort = value;
      renderExplorer(currentContents);
    });
    list.appendChild(createSectionHeader('Files', visibleFiles.length, sort));
    list.appendChild(createFileHeader());
  }

  visibleFiles.forEach((entry, i) => {
    list.appendChild(renderItem({ type: 'file', ...entry }, i));
  });
}

function compareFiles(a, b) {
  if (fileSort === 'name') {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }

  const aTime = Date.parse(a.uploadedAt) || 0;
  const bTime = Date.parse(b.uploadedAt) || 0;
  return fileSort === 'oldest' ? aTime - bTime : bTime - aTime;
}

async function copyFileUrl(url, options = {}) {
  await navigator.clipboard.writeText(url);
  if (!options.silent) setStatus('Link copied.', 'success');
}

function renderItem(entry, index) {
  return createExplorerItem(entry, index, {
    isMobile: mobileQuery.matches,
    isSelected: selectedItems.has(itemKey(entry)),
    selectMode,
    onCopy: url => copyFileUrl(url, { silent: true }),
    onNavigate: navigateTo,
    onPreview: showPreview,
    onToggleSelection: toggleSelection,
  });
}

function renderBreadcrumbs(folder) {
  const breadcrumbs = document.getElementById('breadcrumbs');
  breadcrumbs.replaceWith(createBreadcrumbs(folder, navigateTo));
}

function navigateTo(folder) {
  const target = folder || '';
  if (target === currentFolder) return;
  historyBack.push(currentFolder);
  historyForward = [];
  loadFiles(target, { skipHistory: true });
}

function persistCurrentFolder() {
  if (currentFolder) localStorage.setItem('currentFolder', currentFolder);
  else localStorage.removeItem('currentFolder');

  const url = new URL(window.location.href);
  if (currentFolder) url.searchParams.set('folder', currentFolder);
  else url.searchParams.delete('folder');
  window.history.replaceState(null, '', url);
}

// ── Toolbar actions ───────────────────────────────────
const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const statusEl = document.getElementById('uploadStatus');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const createFolderBtn = document.getElementById('createFolderBtn');
const currentFolderNote = document.getElementById('currentFolderNote');
const backBtn = document.getElementById('backBtn');
const forwardBtn = document.getElementById('forwardBtn');
const dirTitle = document.getElementById('dirTitle');
const searchInput = document.getElementById('searchInput');
const uploadBtn = document.getElementById('uploadBtn');
const uploadFolderBtn = document.getElementById('uploadFolderBtn');
const selectBtn = document.getElementById('selectBtn');
const deleteBtn = document.getElementById('deleteBtn');
const mobileActions = document.getElementById('mobileActions');
const mobileActionsBtn = document.getElementById('mobileActionsBtn');
const mobileActionsMenu = document.getElementById('mobileActionsMenu');
const mobileSelectAction = document.getElementById('mobileSelectAction');
const mobileDeleteAction = document.getElementById('mobileDeleteAction');
const previewPanel = document.getElementById('previewPanel');
const dropZone = document.getElementById('dropZone');
const explorerBody = document.getElementById('explorerBody');
const previewFrame = document.getElementById('previewFrame');
const previewName = document.getElementById('previewName');
const previewMeta = document.getElementById('previewMeta');
const mobileQuery = window.matchMedia('(max-width: 640px)');
let currentPreviewPath = '';
let statusTimer = null;

createFolderBtn.addEventListener('click', createFolder);
uploadBtn.addEventListener('click', () => {
  if (!currentFolder) {
    setStatus('Open a folder before uploading.', 'error');
    return;
  }
  fileInput.click();
});
uploadFolderBtn.addEventListener('click', () => {
  if (!currentFolder) {
    setStatus('Open a folder before uploading.', 'error');
    return;
  }
  folderInput.click();
});
selectBtn.addEventListener('click', toggleSelectMode);
deleteBtn.addEventListener('click', deleteSelected);
mobileActionsBtn.addEventListener('click', event => {
  event.stopPropagation();
  toggleMobileActions();
});
mobileActionsMenu.addEventListener('click', event => {
  const actionButton = event.target.closest('[data-mobile-action]');
  if (!actionButton || actionButton.disabled) return;
  runMobileAction(actionButton.dataset.mobileAction);
});
document.addEventListener('click', event => {
  if (mobileActionsMenu.hidden || mobileActions.contains(event.target)) return;
  closeMobileActions();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMobileActions();
});
searchInput.addEventListener('input', () => renderExplorer(currentContents));
mobileQuery.addEventListener('change', () => {
  closeMobileActions();
  updatePreviewLayout(currentContents);
  renderExplorer(currentContents);
});
backBtn.addEventListener('click', () => {
  if (!historyBack.length) return;
  historyForward.push(currentFolder);
  loadFiles(historyBack.pop(), { skipHistory: true });
});
forwardBtn.addEventListener('click', () => {
  if (!historyForward.length) return;
  historyBack.push(currentFolder);
  loadFiles(historyForward.pop(), { skipHistory: true });
});
fileInput.addEventListener('change', () => { uploadFiles([...fileInput.files]); fileInput.value = ''; });
folderInput.addEventListener('change', () => { uploadFiles([...folderInput.files]); folderInput.value = ''; });
dropZone.addEventListener('dragenter', handleDragEnter);
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);

async function uploadFiles(files) {
  const uploads = normalizeUploads(files);
  if (!uploads.length) return;
  if (!currentFolder) {
    setStatus('Open a folder before uploading.', 'error');
    return;
  }
  setStatus('', '');
  progressWrap.style.display = 'block';
  progressBar.style.width = '0%';

  let done = 0;
  const errors = [];

  for (const upload of uploads) {
    const fd = new FormData();
    const uploadFolder = folderForUpload(upload);
    fd.append('folder', uploadFolder);
    fd.append('file', upload.file);
    try {
      const res = await fetch('/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        errors.push(`${upload.relativePath || upload.file.name}: ${await uploadErrorMessage(res)}`);
      }
    } catch {
      errors.push(`${upload.relativePath || upload.file.name}: Network error`);
    }
    done++;
    progressBar.style.width = `${(done / uploads.length) * 100}%`;
  }

  setTimeout(() => { progressWrap.style.display = 'none'; }, 600);

  if (errors.length) {
    setStatus(`${done - errors.length} uploaded, ${errors.length} failed. ${errors.join(' ')}`, 'error');
  } else {
    setStatus(`${done} file${done === 1 ? '' : 's'} uploaded.`, 'success');
  }

  loadFiles();
}

function normalizeUploads(files) {
  return files
    .filter(file => file && file.size >= 0)
    .map(file => ({ file, relativePath: file.webkitRelativePath || file.relativePath || file.name }));
}

function folderForUpload(upload) {
  const parts = String(upload.relativePath || upload.file.name).split('/').filter(Boolean);
  parts.pop();
  const nestedFolder = parts.join('/');
  return [selectedFolder(), nestedFolder].filter(Boolean).join('/');
}

async function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove('drag-over');

  if (!currentFolder) {
    setStatus('Open a folder before uploading.', 'error');
    return;
  }

  const files = await filesFromDrop(event.dataTransfer);
  if (!files.length) {
    setStatus('No supported files found in that drop.', 'error');
    return;
  }
  uploadFiles(files);
}

function handleDragEnter(event) {
  if (!hasDroppableItems(event.dataTransfer)) return;
  event.preventDefault();
  dropZone.classList.add('drag-over');
}

function handleDragOver(event) {
  if (!hasDroppableItems(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = currentFolder ? 'copy' : 'none';
  dropZone.classList.add('drag-over');
}

function handleDragLeave(event) {
  if (dropZone.contains(event.relatedTarget)) return;
  dropZone.classList.remove('drag-over');
}

function hasDroppableItems(dataTransfer) {
  return dataTransfer && Array.from(dataTransfer.types || []).includes('Files');
}

async function filesFromDrop(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  if (!items.length) return Array.from(dataTransfer.files || []);

  const uploads = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      uploads.push(...await filesFromEntry(entry));
    } else {
      const file = item.getAsFile();
      if (file) uploads.push(file);
    }
  }
  return uploads;
}

async function filesFromEntry(entry, parentPath = '') {
  if (entry.isFile) {
    return new Promise(resolve => {
      entry.file(file => {
        file.relativePath = parentPath ? `${parentPath}/${file.name}` : file.name;
        resolve([file]);
      }, () => resolve([]));
    });
  }

  if (!entry.isDirectory) return [];

  const dirPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const reader = entry.createReader();
  const entries = await readAllDirectoryEntries(reader);
  const nested = await Promise.all(entries.map(child => filesFromEntry(child, dirPath)));
  return nested.flat();
}

async function readAllDirectoryEntries(reader) {
  const entries = [];
  while (true) {
    const batch = await new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
}

async function createFolder() {
  const folder = prompt('New folder name');
  if (!folder) return;

  createFolderBtn.disabled = true;
  try {
    const res = await fetch('/folders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: currentFolder, folder }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(body.error || 'Could not create folder', 'error');
      return;
    }
    await loadFiles(currentFolder);
    setStatus(`Folder created: ${body.folder.split('/').pop()}`, 'success');
  } catch {
    setStatus('Could not create folder', 'error');
  } finally {
    createFolderBtn.disabled = false;
  }
}

function selectedFolder() {
  return currentFolder;
}

function toggleMobileActions() {
  if (mobileActionsMenu.hidden) openMobileActions();
  else closeMobileActions();
}

function openMobileActions() {
  mobileActionsMenu.hidden = false;
  mobileActionsBtn.setAttribute('aria-expanded', 'true');
}

function closeMobileActions() {
  mobileActionsMenu.hidden = true;
  mobileActionsBtn.setAttribute('aria-expanded', 'false');
}

function runMobileAction(action) {
  closeMobileActions();

  if (action === 'new-folder') {
    createFolder();
    return;
  }

  if (action === 'upload-file') {
    if (!currentFolder) {
      setStatus('Open a folder before uploading.', 'error');
      return;
    }
    fileInput.click();
    return;
  }

  if (action === 'upload-folder') {
    if (!currentFolder) {
      setStatus('Open a folder before uploading.', 'error');
      return;
    }
    folderInput.click();
    return;
  }

  if (action === 'logout') {
    localStorage.removeItem('token');
    localStorage.removeItem('currentFolder');
    window.location.href = '/';
    return;
  }

  if (action === 'select') {
    toggleSelectMode();
    return;
  }

  if (action === 'delete') {
    deleteSelected();
  }
}

function showPreview(file) {
  if (mobileQuery.matches) return;

  currentPreviewPath = file.path;
  explorerBody.classList.add('preview-open');
  previewPanel.classList.add('open');
  previewFrame.innerHTML = mediaPreview(file.name, file.url);
  previewName.textContent = file.name;
  previewMeta.innerHTML = `
    <div>Size: ${formatBytes(file.size || 0)}</div>
    <div>Uploaded: ${formatDate(file.uploadedAt)}</div>
    <div>Path: ${escapeHtml(file.path)}</div>
  `;
}

function clearPreview() {
  currentPreviewPath = '';
  explorerBody.classList.add('preview-open');
  previewPanel.classList.add('open');
  previewFrame.innerHTML = emptyPreview();
  previewName.textContent = 'No file selected';
  previewMeta.textContent = 'Select a file to see its details.';
}

function updatePreviewLayout(contents) {
  if (mobileQuery.matches || !contents.folder) {
    currentPreviewPath = '';
    explorerBody.classList.remove('preview-open');
    previewPanel.classList.remove('open');
    return;
  }

  explorerBody.classList.add('preview-open');
  previewPanel.classList.add('open');
  syncPreviewWithContents(contents);
}

function syncPreviewWithContents(contents) {
  if (!currentPreviewPath) return;
  const previewStillExists = contents.files.some(file => file.path === currentPreviewPath);
  if (!previewStillExists) clearPreview();
}

function itemKey(item) {
  return `${item.type}:${item.path}`;
}

function toggleSelection(item, element) {
  const key = itemKey(item);
  if (selectedItems.has(key)) {
    selectedItems.delete(key);
    element.classList.remove('selected');
  } else {
    selectedItems.set(key, { type: item.type, path: item.path });
    element.classList.add('selected');
  }
  updateToolbar();
}

function toggleSelectMode() {
  selectMode = !selectMode;
  selectedItems.clear();
  selectBtn.classList.toggle('active', selectMode);
  selectBtn.textContent = selectMode ? 'Done' : 'Select';
  updateToolbar();
  renderExplorer(currentContents);
}

async function deleteSelected() {
  const items = [...selectedItems.values()];
  if (!items.length) return;
  if (!confirm(`Delete ${items.length} selected item${items.length === 1 ? '' : 's'}?`)) return;

  try {
    const res = await fetch('/items', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(body.error || 'Delete failed', 'error');
      return;
    }
    if (items.some(item => item.path === currentPreviewPath || (item.type === 'folder' && currentPreviewPath.startsWith(item.path + '/')))) {
      clearPreview();
    }
    selectedItems.clear();
    setStatus(`${body.deleted || 0} deleted.`, 'success');
    await loadFiles(currentFolder, { skipHistory: true });
  } catch {
    setStatus('Delete failed', 'error');
  }
}

function updateToolbar() {
  dirTitle.textContent = currentFolder ? currentFolder.split('/').pop() : 'Home';
  backBtn.disabled = !historyBack.length;
  forwardBtn.disabled = !historyForward.length;
  uploadBtn.disabled = !currentFolder;
  uploadFolderBtn.disabled = !currentFolder;
  deleteBtn.disabled = !selectedItems.size;
  mobileSelectAction.textContent = selectMode ? 'Done' : 'Select';
  mobileDeleteAction.disabled = !selectedItems.size;
  currentFolderNote.textContent = currentFolder ? `Uploading into /${currentFolder}` : '';
}

function updateUploadTarget() {
  fileInput.disabled = !currentFolder;
  folderInput.disabled = !currentFolder;
}

async function uploadErrorMessage(res) {
  try {
    const body = await res.json();
    return body.error || `Upload failed (${res.status})`;
  } catch {
    return `Upload failed (${res.status})`;
  }
}

function setStatus(msg, type) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg;
  statusEl.className = 'upload-status' + (type ? ` ${type}` : '');
  if (!msg) return;

  statusTimer = setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'upload-status';
  }, 3000);
}

updateUploadTarget();
loadFiles(initialFolder, { skipHistory: true });
