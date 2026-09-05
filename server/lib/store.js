'use strict';
// Single-file JSON metadata store with atomic, debounced writes.
// Large or append-only data (audit, events, feedback) lives in NDJSON files instead.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, blob) {
    this.file = file;
    this.blob = blob;
    this.data = { shares: {}, sessions: {}, tokens: {} };
    this._timer = null;
    this.load();
  }
  load() {
    if (!fs.existsSync(this.file)) return;
    const raw = this.blob.decode(fs.readFileSync(this.file));
    const parsed = JSON.parse(raw.toString('utf8'));
    this.data = { shares: parsed.shares || {}, sessions: parsed.sessions || {}, tokens: parsed.tokens || {} };
  }
  save() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 150);
  }
  flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.blob.encode(Buffer.from(JSON.stringify(this.data))), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

// Append-only NDJSON log per share.
class Log {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  file(name) { return path.join(this.dir, name.replace(/[^A-Za-z0-9_-]/g, '_') + '.ndjson'); }
  append(name, obj) { fs.appendFileSync(this.file(name), JSON.stringify(obj) + '\n', { mode: 0o600 }); }
  read(name, limit = 5000) {
    const f = this.file(name);
    if (!fs.existsSync(f)) return [];
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const out = [];
    for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l)); } catch { /* skip corrupt line */ } }
    return out;
  }
  remove(name) { try { fs.unlinkSync(this.file(name)); } catch { /* ignore */ } }
}

module.exports = { Store, Log };
