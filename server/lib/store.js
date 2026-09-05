'use strict';
// Single-file JSON metadata store with atomic, debounced writes.
// Large or append-only data (audit, events, feedback) lives in NDJSON files instead.
const fs = require('fs');
const path = require('path');
const { sha256 } = require('./crypto');

class Store {
  constructor(file, blob) {
    this.file = file;
    this.blob = blob;
    this.data = { shares: {}, sessions: {}, tokens: {}, adminSessions: {} };
    this._timer = null;
    this.load();
  }
  load() {
    if (!fs.existsSync(this.file)) return;
    let parsed;
    try {
      parsed = JSON.parse(this.blob.decode(fs.readFileSync(this.file)).toString('utf8'));
    } catch (e) {
      throw new Error(
        `${this.file} cannot be read (${e.message}). The previous copy is ${this.file}.bak; restore it and start again.`,
        { cause: e }
      );
    }
    this.data = {
      shares: parsed.shares || {},
      sessions: parsed.sessions || {},
      tokens: parsed.tokens || {},
      adminSessions: parsed.adminSessions || {},
    };
    // Stores written before 0.1.0 kept viewer link tokens in clear; hash them once so old links keep working.
    for (const s of Object.values(this.data.shares))
      for (const v of Object.values(s.viewers || {})) if (v.token && v.token.length !== 64) v.token = sha256(v.token);
  }
  save() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 150);
  }
  flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.blob.encode(Buffer.from(JSON.stringify(this.data))), { mode: 0o600 });
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak'); // one step back, for a crash mid-rename
    fs.renameSync(tmp, this.file);
  }
}

// Append-only NDJSON log per share.
class Log {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(name) {
    return path.join(this.dir, name.replace(/[^A-Za-z0-9_-]/g, '_') + '.ndjson');
  }
  append(name, obj) {
    fs.appendFileSync(this.file(name), JSON.stringify(obj) + '\n', { mode: 0o600 });
  }
  read(name, limit = 5000) {
    const f = this.file(name);
    if (!fs.existsSync(f)) return [];
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const out = [];
    for (const l of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(l));
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }
  remove(name) {
    try {
      fs.unlinkSync(this.file(name));
    } catch {
      /* ignore */
    }
  }
  // Drop lines older than `since` (ISO string). ponytail: rewrites the whole file; fine for the admin log's size.
  trim(name, since) {
    const keep = this.read(name, Infinity).filter((r) => r.ts >= since);
    if (keep.length)
      fs.writeFileSync(this.file(name), keep.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    else this.remove(name);
  }
}

module.exports = { Store, Log };
