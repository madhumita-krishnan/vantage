'use strict';
// Console: shared helpers, session state, the shell (nav + footer) and the page router.
// Pages live in the other files under /admin/ and are plain functions the router calls.
/* exported $, esc, fmt, ic, count, toast, api, copy, download, blobUrl, b64, filesFromDrop, uploadXhr, stopLive,
   shell, wireShell, ask, signOut, render, rel */
/* global renderLogin, renderLeft, renderList, renderNew, renderShare, renderServer, renderAccount */

const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const fmt = (t) => (t ? new Date(t).toLocaleString() : '—');
const rel = (t) => {
  const d = (new Date(t) - Date.now()) / 864e5;
  if (d < 0) return 'expired';
  if (d < 1) return 'in ' + Math.round(d * 24) + 'h';
  if (d < 60) return 'in ' + Math.round(d) + ' days';
  return 'in ' + Math.round(d / 30) + ' months';
};

const ICON = {
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
  people:
    '<circle cx="9" cy="8" r="3.5"></circle><path d="M2.5 20a6.5 6.5 0 0 1 13 0"></path>' +
    '<path d="M16 4.5a3.5 3.5 0 0 1 0 7"></path><path d="M17.5 13.5A6.5 6.5 0 0 1 21.5 20"></path>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path><circle cx="12" cy="12" r="3"></circle>',
  download: '<path d="M12 3v12M6 11l6 6 6-6M4 21h16"></path>',
  play: '<path d="M7 4l12 8-12 8z"></path>',
  x: '<path d="M6 6l12 12M18 6L6 18"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path>',
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const count = (n, icon, word) =>
  `<span class="count" title="${n} ${word}${n === 1 ? '' : 's'}">${ic(icon)}<b>${n}</b></span>`;

// ---- session state shared by every page ----
let token = sessionStorage.getItem('vantage_token') || '';
let me = null;
let view = { page: 'list' };
let liveTimer = null;
let left = null;

// A signed-in link (printed when the server starts) carries the token in the URL fragment, which never reaches the
// server or its logs. Use it once and drop it from the address bar. Also handled on hashchange, for a pasted link.
function tokenFromHash() {
  const m = location.hash.match(/(?:^#|&)token=([^&]+)/);
  if (!m) return false;
  token = decodeURIComponent(m[1]);
  sessionStorage.setItem('vantage_token', token);
  history.replaceState(null, '', location.pathname);
  return true;
}

function toast(m, ms) {
  const t = $('#toast');
  t.innerHTML = '<span></span><button type="button" class="x" aria-label="Dismiss">×</button>';
  t.firstChild.textContent = m;
  t.classList.add('show');
  clearTimeout(t._h);
  const hide = () => t.classList.remove('show');
  t._h = setTimeout(hide, ms || Math.min(8000, Math.max(3000, 1000 + m.length * 50)));
  t.lastChild.onclick = hide;
  t.onmouseenter = () => clearTimeout(t._h);
  t.onmouseleave = () => {
    t._h = setTimeout(hide, 1500);
  };
}

// Bearer header only when there is a token; a Google session rides on its cookie.
const authHeaders = () => (token ? { Authorization: 'Bearer ' + token } : {});

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
  });
  if (r.status === 401) {
    const had = !!me;
    me = null;
    if (had) render();
    throw new Error('Unauthorized');
  }
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
}
async function copy(t) {
  try {
    await navigator.clipboard.writeText(t);
    toast('Copied');
  } catch {
    prompt('Copy this link', t);
  }
}
async function download(path, name) {
  const r = await fetch('/api' + path, { headers: authHeaders() });
  if (!r.ok) {
    alert('Export failed');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = name;
  a.click();
}
async function blobUrl(path) {
  const r = await fetch('/api' + path, { headers: authHeaders() });
  return URL.createObjectURL(await r.blob());
}
function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
// Reads a dropped folder tree into [{path, file}].
function walk(entry, prefix, out) {
  return new Promise((res) => {
    if (entry.isFile) {
      entry.file((f) => {
        out.push({ path: prefix + f.name, file: f });
        res();
      });
      return;
    }
    const reader = entry.createReader();
    const all = [];
    const read = () =>
      reader.readEntries(async (es) => {
        if (!es.length) {
          for (const e of all) await walk(e, prefix + entry.name + '/', out);
          res();
        } else {
          all.push(...es);
          read();
        }
      });
    read();
  });
}
async function filesFromDrop(e) {
  // The item list empties as soon as this handler yields, so every entry is taken before the first await.
  const items = [...(e.dataTransfer.items || [])].map((it) => ({
    entry: it.webkitGetAsEntry && it.webkitGetAsEntry(),
    file: it.kind === 'file' ? it.getAsFile() : null,
  }));
  const files = [];
  for (const it of items) {
    if (it.entry) await walk(it.entry, '', files);
    else if (it.file) files.push({ path: it.file.name, file: it.file });
  }
  if (!files.length) for (const f of e.dataTransfer.files) files.push({ path: f.name, file: f });
  return files;
}
// Raw upload (media, subtitles) with progress; fetch has no upload progress.
function uploadXhr(method, path, file, headers, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open(method, '/api' + path);
    if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
    for (const k in headers) x.setRequestHeader(k, headers[k]);
    x.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    x.onload = () => {
      let b = {};
      try {
        b = JSON.parse(x.responseText);
      } catch {
        /* not json */
      }
      if (x.status >= 200 && x.status < 300) res(b);
      else rej(new Error(b.error || x.statusText));
    };
    x.onerror = () => rej(new Error('Upload failed'));
    x.send(file);
  });
}
function stopLive() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

// ---- shell: nav + footer around every signed-in page ----
const initials = (w) => {
  const s = String(w || '')
    .replace(/@.*/, '')
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return s.length ? (s[0][0] + (s[1] ? s[1][0] : '')).toUpperCase() : 'A';
};
function shell(content, active) {
  const link = (page, label) => `<a href="#" data-nav="${page}" class="${active === page ? 'on' : ''}">${label}</a>`;
  const status = me.server.encryptionAtRest
    ? 'Encrypted at rest'
    : '<span style="color:var(--warn)">Not encrypted at rest</span>';
  const tagline = me.server.google ? '' : ' · self-hosted, nothing leaves this server';
  return `
    <nav class="nav">
      <a class="brand" href="#" data-nav="list">${ic('lock', 'lg')}Vantage</a>
      <div class="links">${link('list', 'Prototypes')}${link('new', 'New Share')}${link('server', 'Server')}</div>
      <span class="spacer"></span>
      <span class="hint">${status} · ${me.server.sso ? 'SSO' : 'personal links'}</span>
      <a href="#" class="me ${active === 'account' ? 'on' : ''}" data-nav="account" title="Account">
        <span class="avatar">${esc(initials(me.identity.who))}</span><span>${esc(me.identity.who)}</span>
      </a>
    </nav>
    <div class="wrap">
      <div class="content">${content}</div>
      <footer class="footer">
        <span>Vantage ${esc(me.server.version)}${tagline}</span>
        <span class="spacer"></span>
        <a href="/docs/readme" target="_blank">Help</a>
        <a href="/docs/security" target="_blank">Security overview</a>
        <a href="/docs/deployment" target="_blank">Deployment</a>
        <a href="/docs/limits" target="_blank">What it cannot do</a>
        <a href="/docs/testing" target="_blank">How it was checked</a>
        <a href="/docs/design-system" target="_blank">Design system</a>
      </footer>
    </div>`;
}
function wireShell() {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      view = { page: a.dataset.nav };
      render();
    };
  });
}
// Confirm dialog for anything that cannot be undone. Resolves true when the action button is pressed.
function ask(title, body, okLabel, danger) {
  return new Promise((res) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `
      <div class="card" role="dialog" aria-modal="true">
        <h1>${title}</h1>
        <div class="mbody"><p>${body}</p></div>
        <div class="mfoot">
          <button class="btn" id="mNo">Cancel</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" id="mYes">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const done = (v) => {
      m.remove();
      res(v);
    };
    m.querySelector('#mNo').onclick = () => done(false);
    m.querySelector('#mYes').onclick = () => done(true);
    m.onclick = (e) => {
      if (e.target === m) done(false);
    };
    m.querySelector('#mYes').focus();
  });
}
async function signOut() {
  if (me && me.identity.kind === 'google') {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      /* already gone */
    }
  }
  sessionStorage.removeItem('vantage_token');
  token = '';
  me = null;
  render();
}

// ---- router ----
function render() {
  stopLive();
  const app = $('#app');
  window.scrollTo(0, 0);
  if (left) return renderLeft(app);
  if (!me) return renderLogin(app);
  const pages = { list: renderList, new: renderNew, share: renderShare, server: renderServer, account: renderAccount };
  return (pages[view.page] || renderList)(app);
}

tokenFromHash();
window.addEventListener('hashchange', async () => {
  if (!tokenFromHash()) return;
  try {
    me = await api('/me');
  } catch {
    token = '';
  }
  view = { page: 'list' };
  render();
});
document.addEventListener('DOMContentLoaded', async () => {
  try {
    me = await api('/me');
  } catch {
    token = '';
  }
  render();
});
