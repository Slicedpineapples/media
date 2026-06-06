import {
  displayName,
  escapeHtml,
  formatBytes,
  formatDate,
  formatMobileDate,
} from '../utils/format.js';
import { mediaThumbnail } from './media-preview.js';

export function createSectionHeader(label, itemCount, action = null) {
  const header = document.createElement('div');
  header.className = 'content-section-header';

  const title = document.createElement('div');
  title.className = 'content-section-title';
  title.textContent = label;

  const count = document.createElement('span');
  count.className = 'content-section-count';
  count.textContent = `(${itemCount})`;
  title.appendChild(count);
  header.appendChild(title);

  if (action) header.appendChild(action);
  return header;
}

export function createFileSort(value, onChange) {
  const sort = document.createElement('select');
  sort.className = 'file-sort';
  sort.setAttribute('aria-label', 'Sort files');
  sort.innerHTML = `
    <option value="newest">Newest first</option>
    <option value="oldest">Oldest first</option>
    <option value="name">Name A-Z</option>
  `;
  sort.value = value;
  sort.addEventListener('change', () => onChange(sort.value));
  return sort;
}

export function createFileHeader() {
  const header = document.createElement('div');
  header.className = 'file-header-row';
  header.innerHTML = '<span>No.</span><span>Name</span><span>Copy</span><span>Size</span><span>Date uploaded</span><span>Preview</span>';
  return header;
}

export function createBreadcrumbs(folder, onNavigate) {
  const breadcrumbs = document.createElement('div');
  breadcrumbs.id = 'breadcrumbs';
  breadcrumbs.className = 'breadcrumbs';
  const parts = folder ? folder.split('/') : [];
  const crumbs = [{ label: 'Home', path: '' }];

  parts.forEach((part, index) => {
    crumbs.push({
      label: part,
      path: parts.slice(0, index + 1).join('/'),
    });
  });

  crumbs.forEach((crumb, index) => {
    if (index) {
      const separator = document.createElement('span');
      separator.className = 'crumb-separator';
      separator.textContent = '/';
      breadcrumbs.appendChild(separator);
    }

    const button = document.createElement('button');
    button.className = 'crumb';
    button.type = 'button';
    button.textContent = crumb.label;
    button.addEventListener('click', () => onNavigate(crumb.path));
    breadcrumbs.appendChild(button);
  });

  return breadcrumbs;
}

export function createExplorerItem(entry, index, options) {
  const {
    isMobile,
    isSelected,
    selectMode,
    onCopy,
    onNavigate,
    onPreview,
    onToggleSelection,
  } = options;
  const item = document.createElement('div');
  item.className = `explorer-item ${entry.type === 'file' ? 'file-row' : 'folder-item'}`;
  item.style.animationDelay = `${index * 30}ms`;
  if (isSelected) item.classList.add('selected');

  if (entry.type === 'folder') {
    item.innerHTML = folderMarkup(entry, index, isMobile);
    item.addEventListener('click', () => {
      if (selectMode) onToggleSelection(entry, item);
      else onNavigate(entry.path);
    });
    return item;
  }

  item.innerHTML = fileMarkup(entry, index, isMobile);
  const copyButton = item.querySelector('.btn-copy');
  copyButton.addEventListener('click', async () => {
    await onCopy(entry.url);
    copyButton.textContent = 'Copied!';
    copyButton.classList.add('copied');
    setTimeout(() => {
      copyButton.textContent = 'Copy link';
      copyButton.classList.remove('copied');
    }, 1800);
  });

  item.addEventListener('click', async event => {
    if (event.target.closest('.file-actions')) return;
    if (selectMode) {
      onToggleSelection(entry, item);
      return;
    }
    if (isMobile) {
      if (event.target.closest('.file-preview')) return;
      await onCopy(entry.url);
      item.classList.add('copied');
      setTimeout(() => item.classList.remove('copied'), 450);
      return;
    }
    onPreview(entry);
  });

  return item;
}

function fileMarkup(entry, index, isMobile) {
  const safeName = escapeHtml(entry.name);
  const size = formatBytes(entry.size || 0);
  return `
    <div class="selection-mark">✓</div>
    <div class="file-index">${index + 1}</div>
    <div class="file-info">
      <div class="item-kind">File</div>
      <div class="file-name" title="${safeName}">${escapeHtml(displayName(entry.name, isMobile))}</div>
      <div class="file-url">${escapeHtml(entry.url)}</div>
    </div>
    <div class="file-actions">
      <button class="btn-copy" type="button">Copy link</button>
    </div>
    <div class="file-size">${size}</div>
    <div class="file-mobile-meta">${formatMobileDate(entry.uploadedAt)} - ${size}</div>
    <div class="file-date">${formatDate(entry.uploadedAt)}</div>
    ${mediaThumbnail(entry.name, entry.url)}
  `;
}

function folderMarkup(entry, index, isMobile) {
  const safeName = escapeHtml(entry.name);
  return `
    <div class="selection-mark">✓</div>
    <div class="file-index">${index + 1}</div>
    <div class="folder-icon"></div>
    <div class="file-info">
      <div class="item-kind">Folder</div>
      <div class="file-name" title="${safeName}">${escapeHtml(displayName(entry.name, isMobile))}</div>
    </div>
  `;
}
