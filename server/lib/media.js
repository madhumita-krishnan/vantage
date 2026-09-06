'use strict';
// Intro audio/video, voice and screen recording segments and subtitle files: stored encrypted, streamed with HTTP Range support.
const fs = require('fs');
const path = require('path');
const C = require('./crypto');

module.exports = function media(ctx) {
  const { CONFIG, blob, H, S } = ctx;
  const introFile = (id) => path.join(S.mediaDir(id), 'intro.bin');
  const subtitleFile = (id, lang) => path.join(S.mediaDir(id), `sub-${lang}.vtt`);
  // One rule for language codes wherever they arrive: "zh-TW" and "zh_tw" both become "zh-tw".
  const subtitleLang = (s) =>
    String(s)
      .toLowerCase()
      .replace(/_/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 12);
  const recordingDir = (id, session) => path.join(S.mediaDir(id), 'rec', session);

  function storeIntro(req, id, limit) {
    return new Promise((resolve, reject) => {
      const w = C.chunkedWriter(blob, introFile(id));
      let size = 0,
        failed = false;
      const fail = (e) => {
        failed = true;
        w.abort();
        req.destroy();
        reject(e);
      };
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > limit) return fail(H.httpError(413, `Media larger than ${Math.round(limit / 1048576)} MB`));
        try {
          w.write(c);
        } catch (e) {
          fail(e); // the disk is full or gone
        }
      });
      req.on('end', () => {
        if (failed) return;
        try {
          w.end();
          resolve(size);
        } catch (e) {
          fail(e);
        }
      });
      req.on('error', (e) => {
        if (!failed) {
          failed = true;
          w.abort();
          reject(e);
        }
      });
    });
  }
  // Parses a Range header against a known size. Returns { start, end, status } or writes 416 and returns null.
  function range(req, res, size, maxChunk) {
    let start = 0,
      end = size - 1,
      status = 200;
    const m = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
    if (m && size > 0) {
      if (m[1]) {
        start = +m[1];
        if (m[2]) end = Math.min(+m[2], size - 1);
      } else start = Math.max(0, size - +m[2]); // suffix: the last N bytes ("bytes=-" lands on start >= size, 416)
      if (start >= size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return null;
      }
      if (maxChunk) end = Math.min(end, start + maxChunk - 1);
      status = 206;
    }
    return { start, end, status };
  }
  async function stream(req, res, r, size, mime, pieces, extra = {}) {
    const headers = {
      ...H.baseHeaders(req),
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Content-Length': Math.max(0, r.end - r.start + 1),
      ...extra,
    };
    if (r.status === 206) headers['Content-Range'] = `bytes ${r.start}-${r.end}/${size}`;
    res.writeHead(r.status, headers);
    if (req.method === 'HEAD') return res.end();
    for (const piece of pieces) {
      if (res.destroyed) break; // the client went away: stop reading and let the generator's finally close the file
      if (!res.write(piece)) await new Promise((k) => res.once('drain', k).once('close', k));
    }
    res.end();
  }
  async function streamIntro(req, res, share) {
    const m = share.intro && share.intro.media;
    if (!m) return H.send(req, res, 404, 'No media', { 'Content-Type': 'text/plain' });
    const r = range(req, res, m.size, 8 * 1048576); // 8 MB per response keeps memory flat and lets players seek
    if (r) await stream(req, res, r, m.size, m.mime, C.chunkedRange(blob, introFile(share.id), m.size, r.start, r.end));
  }
  async function streamRecording(req, res, share, session) {
    const rec = Object.hasOwn(share.recordings || {}, session) && share.recordings[session];
    if (!rec) throw H.httpError(404, 'Recording not found');
    const dir = recordingDir(share.id, session);
    const segs = [];
    let total = 0;
    for (let i = 0; i < rec.segments; i++) {
      const f = path.join(dir, `${i}.bin`);
      let st;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      const len = st.size - C.chunkOverhead(blob, f);
      segs.push({ f, start: total, len });
      total += len;
    }
    const r = range(req, res, total);
    if (!r) return;
    const pieces = (function* () {
      for (const s of segs) {
        if (s.start + s.len - 1 < r.start || s.start > r.end) continue;
        yield blob
          .decode(fs.readFileSync(s.f))
          .subarray(Math.max(0, r.start - s.start), Math.min(s.len, r.end - s.start + 1));
      }
    })();
    await stream(req, res, r, total, rec.mime, pieces, {
      'Content-Disposition': `inline; filename="${rec.mime.startsWith('video/') ? 'screen' : 'voice'}-${rec.viewerId}.${rec.mime.split('/')[1]}"`,
    });
  }
  function appendRecording(share, session, viewerId, mime, seq, buf) {
    share.recordings = share.recordings || {};
    const rec =
      share.recordings[session] ||
      (share.recordings[session] = {
        viewerId,
        mime,
        size: 0,
        segments: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
    if (Object.values(share.recordings).reduce((a, x) => a + x.size, 0) + buf.length > CONFIG.maxMediaBytes)
      throw H.httpError(413, 'Recording storage limit reached');
    if (seq > rec.segments) throw H.httpError(400, 'Recording segments must arrive in order');
    const dir = recordingDir(share.id, session);
    const file = path.join(dir, `${seq}.bin`);
    let replaced = 0;
    try {
      replaced = fs.statSync(file).size - C.chunkOverhead(blob, file); // a retry after a lost answer
    } catch {
      /* new segment */
    }
    S.enforceLimits(share, buf.length - replaced);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, blob.encode(buf), { mode: 0o600 });
    rec.segments = Math.max(rec.segments, seq + 1);
    rec.size += buf.length - replaced;
    rec.updatedAt = Date.now();
    return rec;
  }
  function writeSubtitle(share, lang, buf) {
    fs.mkdirSync(S.mediaDir(share.id), { recursive: true, mode: 0o700 });
    fs.writeFileSync(subtitleFile(share.id, lang), blob.encode(buf), { mode: 0o600 });
  }
  function readSubtitle(share, lang) {
    const f = subtitleFile(share.id, lang);
    return fs.existsSync(f) ? blob.decode(fs.readFileSync(f)) : null;
  }
  const removeSubtitle = (share, lang) => {
    try {
      fs.unlinkSync(subtitleFile(share.id, lang));
    } catch {
      /* ignore */
    }
  };
  // Only the intro and its captions; recordings live in the same folder and stay.
  const removeIntro = (share) => {
    const dir = S.mediaDir(share.id);
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      if (f === 'intro.bin' || f.startsWith('sub-')) fs.unlinkSync(path.join(dir, f));
  };
  const removeRecording = (share, session) =>
    fs.rmSync(recordingDir(share.id, session), { recursive: true, force: true });
  return {
    storeIntro,
    streamIntro,
    streamRecording,
    appendRecording,
    subtitleLang,
    removeIntro,
    removeRecording,
    writeSubtitle,
    readSubtitle,
    removeSubtitle,
  };
};
