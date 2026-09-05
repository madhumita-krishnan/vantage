'use strict';
// Validates and normalises an uploaded set of files into a safe, servable bundle.
const path = require('path');

const JUNK = /(^|\/)(__MACOSX|\.git|node_modules|\.DS_Store|Thumbs\.db)(\/|$)/;

function cleanPath(p) {
  let s = String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  while (s.startsWith('/')) s = s.slice(1);
  const parts = s.split('/').filter((x) => x.length && x !== '.');
  if (parts.some((x) => x === '..')) throw new Error(`Unsafe path in bundle: ${p}`);
  // eslint-disable-next-line no-control-regex
  if (parts.some((x) => /[\x00-\x1f]/.test(x))) throw new Error(`Invalid characters in path: ${p}`);
  return parts.join('/');
}

// files: [{path, data:Buffer}] -> {files, entry}
function normalizeFiles(files, requestedEntry) {
  let list = files.map((f) => ({ path: cleanPath(f.path), data: f.data })).filter((f) => f.path && !JUNK.test(f.path));
  if (!list.length) throw new Error('Bundle contains no files');

  // Strip a single common top-level folder (e.g. "my-prototype/index.html" -> "index.html").
  const roots = new Set(list.map((f) => f.path.split('/')[0]));
  if (roots.size === 1 && list.every((f) => f.path.includes('/'))) {
    const root = [...roots][0] + '/';
    list = list.map((f) => ({ path: f.path.slice(root.length), data: f.data }));
  }

  let entry = requestedEntry ? cleanPath(requestedEntry) : null;
  const htmls = list.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path);
  if (entry && !list.some((f) => f.path === entry)) throw new Error(`Entry file not found in bundle: ${entry}`);
  if (!entry) entry = htmls.find((h) => h === 'index.html') || htmls.find((h) => !h.includes('/')) || htmls[0];
  if (!entry) throw new Error('Bundle has no .html file to open');

  const seen = new Set();
  for (const f of list) {
    if (seen.has(f.path)) throw new Error(`Duplicate path in bundle: ${f.path}`);
    seen.add(f.path);
  }
  return { files: list, entry };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
};
function mimeFor(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

module.exports = { normalizeFiles, cleanPath, mimeFor };
