'use strict';
// Shared client logic for the CLI and the MCP server. Node 18+ (uses global fetch).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SKIP = /(^|\/)(node_modules|\.git|__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/;

// A vault started on this machine without ADMIN_TOKEN writes its own secrets to DATA_DIR/local-secrets.json.
// Reading that file is what lets "claude mcp add ... -- node mcp/server.js" and "node cli/vault.js" work with no settings.
function localSecrets() {
  const candidates = [
    process.env.DATA_DIR && path.resolve(process.env.DATA_DIR, 'local-secrets.json'),
    path.join(__dirname, '..', 'server', 'data', 'local-secrets.json'),
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (s && typeof s.adminToken === 'string') return { url: s.url || 'http://localhost:8787', token: s.adminToken };
    } catch {
      /* not there */
    }
  }
  return null;
}
function config(overrides = {}) {
  let url = (overrides.url || process.env.VAULT_URL || '').replace(/\/$/, '');
  let token = overrides.token || process.env.VAULT_ADMIN_TOKEN || '';
  if (!url && !token) {
    const s = localSecrets();
    if (s) ({ url, token } = s);
  }
  if (!url)
    throw new Error(
      'Not connected to a vault. Start one on this machine (node server/server.js) or set VAULT_URL and VAULT_ADMIN_TOKEN for a remote one.'
    );
  if (!token) throw new Error('VAULT_ADMIN_TOKEN is not set for ' + url);
  return { url: url.replace(/\/$/, ''), token };
}

async function api(cfg, method, p, body, headers = {}) {
  let r;
  try {
    r = await fetch(cfg.url + '/api' + p, {
      method,
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json', ...headers },
      body: body == null ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `Cannot reach the vault at ${cfg.url}. Is it running? (${(e.cause && e.cause.code) || e.message})`,
      { cause: e }
    );
  }
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!r.ok) throw new Error(`Vault ${r.status}: ${data.error || text.slice(0, 200)}`);
  return data;
}

// Collect files from a folder or a single .html file.
function collectFiles(target) {
  const abs = path.resolve(target);
  const st = fs.statSync(abs);
  if (st.isFile())
    return { root: path.dirname(abs), files: [{ path: path.basename(abs), data: fs.readFileSync(abs) }] };
  const files = [];
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name),
        r = rel ? rel + '/' + name : name;
      if (SKIP.test(r)) continue;
      const s = fs.lstatSync(full); // a symlink is not followed: it could point anywhere on the machine
      if (s.isDirectory()) walk(full, r);
      else files.push({ path: r, data: fs.readFileSync(full) });
    }
  })(abs, '');
  return { root: abs, files };
}

function toJsonFiles(files) {
  return files.map((f) => ({ path: f.path, contentBase64: f.data.toString('base64') }));
}

// ---------- inlining external assets so the prototype is self-contained ----------
const EXT_URL = /https?:\/\/[^\s"'()<>]+/g;
function vendorName(url) {
  const u = new URL(url);
  let base = path.basename(u.pathname) || 'asset';
  if (u.hostname.includes('fonts.googleapis.com')) base = 'fonts.css';
  if (u.hostname === 'cdn.tailwindcss.com') base = 'tailwind.js';
  base = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  if (!path.extname(base)) base += u.pathname.includes('css') ? '.css' : '.js';
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 8) + '-' + base;
}
async function fetchAsset(url, log) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) PrototypeVault/1.0' } });
  if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
  log(`  ↓ ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
// Rewrites a CSS buffer's url()/@import references, downloading them into vendor/. Returns new CSS.
async function inlineCss(css, cssUrl, vendorDir, added, log) {
  let out = css;
  const refs = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
    .map((m) => m[1])
    .concat([...css.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]));
  for (const ref of new Set(refs)) {
    if (ref.startsWith('data:')) continue;
    let abs;
    try {
      abs = cssUrl ? new URL(ref, cssUrl).href : ref; // inside a page's <style>, only absolute references are fetched
    } catch {
      continue;
    }
    if (!/^https?:/.test(abs)) continue;
    const name = vendorName(abs);
    if (!added.has(name)) {
      try {
        fs.writeFileSync(path.join(vendorDir, name), await fetchAsset(abs, log));
        added.add(name);
      } catch (e) {
        log(`  ! could not fetch ${abs}: ${e.message}`);
        continue;
      }
    }
    out = out.split(ref).join(name); // same folder as the css file
  }
  return out;
}
// Inline every external <script src>, <link rel=stylesheet>, <img src>, and CSS url() in the HTML files of a folder.
// Returns { rewritten: n, remaining: [urls still referenced] }.
async function inlineExternal(root, log = () => {}) {
  const vendorDir = path.join(root, 'vendor');
  const added = new Set(fs.existsSync(vendorDir) ? fs.readdirSync(vendorDir) : []);
  let rewritten = 0;
  const remaining = new Set();
  const htmlFiles = [];
  (function walk(dir, rel) {
    for (const n of fs.readdirSync(dir)) {
      const f = path.join(dir, n),
        r = rel ? rel + '/' + n : n;
      if (SKIP.test(r) || r.startsWith('vendor/')) continue;
      const s = fs.lstatSync(f);
      if (s.isDirectory()) walk(f, r);
      else if (s.isFile() && /\.html?$/i.test(n)) htmlFiles.push({ full: f, rel: r });
    }
  })(root, '');
  for (const h of htmlFiles) {
    let src = fs.readFileSync(h.full, 'utf8');
    const prefix = path.relative(path.dirname(h.full), vendorDir).replace(/\\/g, '/') || '.';
    const tagRe = /<(script|link|img)\b[^>]*?\b(src|href)\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    const found = [...src.matchAll(tagRe)];
    for (const m of found) {
      const [tag, kind, , url] = m;
      if (kind.toLowerCase() === 'link' && !/rel\s*=\s*["']?(stylesheet|preload|icon)/i.test(tag)) {
        if (/rel\s*=\s*["']?(preconnect|dns-prefetch)/i.test(tag)) {
          src = src.replace(tag, '');
          continue;
        }
      }
      if (/^https?:\/\/[^/]*\/\/?$/.test(url)) continue;
      const name = vendorName(url);
      if (!added.has(name)) {
        fs.mkdirSync(vendorDir, { recursive: true });
        try {
          let buf = await fetchAsset(url, log);
          if (name.endsWith('.css'))
            buf = Buffer.from(await inlineCss(buf.toString('utf8'), url, vendorDir, added, log));
          fs.writeFileSync(path.join(vendorDir, name), buf);
          added.add(name);
        } catch (e) {
          log(`  ! could not fetch ${url}: ${e.message}`);
          remaining.add(url);
          continue;
        }
      }
      let newTag = tag
        .replace(url, `${prefix}/${name}`)
        .replace(/\s(integrity|crossorigin)\s*=\s*["'][^"']*["']/gi, '');
      src = src.replace(tag, () => newTag); // a function, so "$&" or "$1" inside the tag stays literal
      rewritten++;
    }
    // Inline <style> blocks with url(https://...)
    src = await replaceAsync(src, /<style\b[^>]*>([\s\S]*?)<\/style>/gi, async (whole, css) =>
      whole.replace(
        css,
        (await inlineCss(css, null, vendorDir, added, log)).replace(
          /url\(\s*['"]?([0-9a-f]{8}-[^'")]+)['"]?\s*\)/g,
          `url(${prefix}/$1)`
        )
      )
    );
    // Report what still points outside
    for (const m of src.matchAll(EXT_URL)) {
      const u = m[0];
      if (!/^https?:\/\/(www\.w3\.org|schema\.org|example\.com)/.test(u) && !/\.(html?)$/.test(u))
        remaining.add(u.replace(/[,;'")]+$/, ''));
    }
    fs.writeFileSync(h.full, src);
  }
  // Also scan .js/.css files for leftover external references
  (function walk(dir, rel) {
    for (const n of fs.readdirSync(dir)) {
      const f = path.join(dir, n),
        r = rel ? rel + '/' + n : n;
      if (SKIP.test(r) || r.startsWith('vendor/')) continue;
      const s = fs.lstatSync(f);
      if (s.isDirectory()) walk(f, r);
      else if (s.isFile() && /\.(js|mjs|css)$/i.test(n))
        for (const m of fs.readFileSync(f, 'utf8').matchAll(EXT_URL)) remaining.add(m[0].replace(/[,;'")]+$/, ''));
    }
  })(root, '');
  return { rewritten, remaining: [...remaining] };
}
async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) {
    parts.push(str.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return parts.join('');
}

function copyToTemp(target) {
  const src = path.resolve(target);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  if (fs.statSync(src).isFile()) {
    fs.copyFileSync(src, path.join(tmp, path.basename(src)));
    return tmp;
  }
  fs.cpSync(src, tmp, { recursive: true, filter: (p) => !SKIP.test(p.replace(/\\/g, '/') + '/') });
  return tmp;
}

// High-level publish used by both CLI and MCP.
async function publish(cfg, opts, log = () => {}) {
  let root = opts.path;
  let inlineReport = null;
  if (opts.inline !== false) {
    root = copyToTemp(opts.path);
    inlineReport = await inlineExternal(root, log);
  }
  const { files } = collectFiles(root);
  // A prototype has an .html file at its top level and a sane number of files. Anything else is probably not the
  // folder the person meant, and for an AI agent it is the difference between a prototype and a home directory.
  if (!files.some((f) => !f.path.includes('/') && /\.html?$/i.test(f.path)))
    throw new Error(`${opts.path} has no .html file at its top level; is that the prototype folder?`);
  if (files.length > 2000)
    throw new Error(`${opts.path} holds ${files.length} files; a prototype should have far fewer`);
  const totalBytes = files.reduce((a, f) => a + f.data.length, 0);
  log(`Uploading ${files.length} files (${(totalBytes / 1024).toFixed(0)} KB)`);
  const body = {
    name: opts.name,
    expiresInDays: opts.expiresInDays,
    passcode: opts.passcode || undefined,
    viewers: opts.viewers || [],
    tasks: opts.tasks || [],
    watermark: opts.watermark !== false,
    recordSessions: opts.recordSessions !== false,
    requireConsent: opts.requireConsent !== false,
    notes: opts.notes || '',
    entry: opts.entry || undefined,
    externalOrigins: opts.externalOrigins || [],
    maxOpensPerViewer: opts.maxOpensPerViewer || 0,
    files: toJsonFiles(files),
    mode: opts.mode || undefined,
    voice: !!opts.voice,
    screen: !!opts.screen,
    requireSignIn: !!opts.requireSignIn,
    intro: { kind: opts.introText ? 'text' : 'default', text: opts.introText || '' },
    recordText: !!opts.recordText,
    showTasks: opts.showTasks !== false,
  };
  let { share } = await api(cfg, 'POST', '/shares', body);
  if (opts.introMedia) {
    log(`Uploading intro media ${opts.introMedia}`);
    ({ share } = await uploadIntroMedia(cfg, share.id, opts.introMedia));
  }
  return { share, inlineReport };
}

const MEDIA_MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};
async function uploadIntroMedia(cfg, shareId, file) {
  const mime = MEDIA_MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`Unsupported media file ${file}. Use mp4, webm, mp3, m4a or wav.`);
  const size = fs.statSync(file).size;
  const r = await fetch(`${cfg.url}/api/shares/${shareId}/intro`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      'Content-Type': mime,
      'Content-Length': String(size),
      'X-File-Name': encodeURIComponent(path.basename(file)),
    },
    body: fs.createReadStream(file),
    duplex: 'half',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Vault ${r.status}: ${data.error || 'upload failed'}`);
  return data;
}
async function uploadSubtitles(cfg, shareId, lang, file, label) {
  const buf = fs.readFileSync(file);
  const r = await fetch(`${cfg.url}/api/shares/${shareId}/subtitles/${encodeURIComponent(lang)}`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      'Content-Type': 'text/vtt',
      'X-Label': encodeURIComponent(label || lang),
    },
    body: buf,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Vault ${r.status}: ${data.error || 'upload failed'}`);
  return data;
}
async function fetchText(cfg, p) {
  const r = await fetch(cfg.url + '/api' + p, { headers: { Authorization: 'Bearer ' + cfg.token } });
  const t = await r.text();
  if (!r.ok) throw new Error(`Vault ${r.status}: ${t.slice(0, 200)}`);
  return t;
}

module.exports = {
  config,
  api,
  collectFiles,
  toJsonFiles,
  inlineExternal,
  copyToTemp,
  publish,
  uploadIntroMedia,
  uploadSubtitles,
  fetchText,
};
