import { escapeHtml } from '../utils/format.js';

const IMAGE_EXTENSIONS = ['apng', 'avif', 'gif', 'jpg', 'jpeg', 'png', 'webp'];
const VIDEO_EXTENSIONS = ['mp4', 'ogg', 'ogv', 'mov', 'webm'];
const AUDIO_EXTENSIONS = ['aac', 'flac', 'm4a', 'mp3', 'wav'];

function extension(name) {
  return name.split('.').pop().toLowerCase();
}

export function mediaThumbnail(name, url) {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(url);
  const type = extension(name);

  if (IMAGE_EXTENSIONS.includes(type)) {
    return `<div class="file-preview" aria-label="Preview ${safeName}"><img src="${safeUrl}" alt="${safeName}" loading="lazy" /></div>`;
  }
  if (VIDEO_EXTENSIONS.includes(type)) {
    return `<div class="file-preview" aria-label="Preview ${safeName}"><video src="${safeUrl}" muted preload="metadata"></video></div>`;
  }
  if (AUDIO_EXTENSIONS.includes(type)) {
    return `<div class="file-preview" aria-label="Preview ${safeName}">Audio</div>`;
  }
  return `<div class="file-preview" aria-label="Preview ${safeName}">File</div>`;
}

export function mediaPreview(name, url) {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(url);
  const type = extension(name);

  if (IMAGE_EXTENSIONS.includes(type)) {
    return `<img src="${safeUrl}" alt="${safeName}" />`;
  }
  if (VIDEO_EXTENSIONS.includes(type)) {
    return `<video src="${safeUrl}" controls preload="metadata"></video>`;
  }
  if (AUDIO_EXTENSIONS.includes(type)) {
    return `<audio src="${safeUrl}" controls></audio>`;
  }
  return 'Preview';
}

export function emptyPreview() {
  return `
    <div class="preview-placeholder">
      <div class="preview-placeholder-icon" aria-hidden="true"></div>
      <span class="preview-placeholder-label">Preview</span>
    </div>
  `;
}
