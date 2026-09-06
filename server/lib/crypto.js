'use strict';
// At-rest encryption for stored files and the metadata store.
// Format: "VLT1" magic (4) + IV (12) + GCM auth tag (16) + ciphertext.
const crypto = require('crypto');
const MAGIC = Buffer.from('VLT1');

function makeBlob(keyHex) {
  if (!keyHex) {
    return {
      enabled: false,
      encode: (b) => b,
      decode: (b) => {
        if (b.length >= 4 && b.subarray(0, 4).equals(MAGIC)) {
          throw new Error('Data is encrypted but VANTAGE_ENCRYPTION_KEY is not set');
        }
        return b;
      },
    };
  }
  const key = Buffer.from(keyHex.trim(), 'hex');
  if (key.length !== 32) throw new Error('VANTAGE_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  return {
    enabled: true,
    encode(buf) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(buf), c.final()]);
      return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
    },
    decode(buf) {
      if (buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC)) return buf; // plaintext written before key was set
      const iv = buf.subarray(4, 16),
        tag = buf.subarray(16, 32),
        ct = buf.subarray(32);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]);
    },
  };
}

function randomId(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function randomKeyHex() {
  return crypto.randomBytes(32).toString('hex');
}
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)),
    bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
// scrypt is deliberately slow; the async form keeps it off the event loop so one passcode guess cannot stall everyone.
const scrypt = (pass, salt) =>
  new Promise((ok, no) => crypto.scrypt(String(pass), salt, 32, (e, k) => (e ? no(e) : ok(k.toString('hex')))));
async function hashPasscode(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: await scrypt(pass, salt) };
}
async function verifyPasscode(pass, rec) {
  return !!rec && safeEqual(await scrypt(pass, rec.salt), rec.hash);
}

module.exports = { makeBlob, randomId, randomToken, randomKeyHex, sha256, safeEqual, hashPasscode, verifyPasscode };

// ---- Chunked storage for large media (audio/video intros). ----
// Plaintext is split into 1 MiB chunks; each chunk is encoded with the blob (encrypted when a key is set),
// so any byte range can be served by decoding only the chunks it touches. Needed for HTTP Range streaming.
const CHUNK = 1024 * 1024;
// Per-file: a file written before VANTAGE_ENCRYPTION_KEY was set has no header and is read as plaintext, like the store.
function chunkOverhead(blob, file) {
  if (!blob.enabled) return 0;
  const fs = require('fs');
  const head = Buffer.alloc(4);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  return head.equals(MAGIC) ? 32 : 0;
}
function chunkedWriter(blob, file) {
  const fs = require('fs');
  fs.mkdirSync(require('path').dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'w', 0o600);
  let pending = [],
    pendingLen = 0;
  function flush(all) {
    while (pendingLen >= CHUNK || (all && pendingLen > 0)) {
      const buf = Buffer.concat(pending, pendingLen);
      const take = Math.min(CHUNK, buf.length);
      fs.writeSync(fd, blob.encode(buf.subarray(0, take)));
      const rest = buf.subarray(take);
      pending = rest.length ? [rest] : [];
      pendingLen = rest.length;
      if (!all && pendingLen < CHUNK) break;
    }
  }
  return {
    write(c) {
      pending.push(c);
      pendingLen += c.length;
      if (pendingLen >= CHUNK) flush(false);
    },
    end() {
      flush(true);
      fs.closeSync(fd);
    },
    abort() {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    },
  };
}
function* chunkedRange(blob, file, size, start, end) {
  const fs = require('fs');
  const ov = chunkOverhead(blob, file);
  const fd = fs.openSync(file, 'r');
  try {
    for (let i = Math.floor(start / CHUNK); i * CHUNK <= end; i++) {
      const plainLen = Math.min(CHUNK, size - i * CHUNK);
      if (plainLen <= 0) break;
      const buf = Buffer.alloc(plainLen + ov);
      fs.readSync(fd, buf, 0, buf.length, i * (CHUNK + ov));
      const plain = blob.decode(buf);
      yield plain.subarray(Math.max(0, start - i * CHUNK), Math.min(plainLen, end - i * CHUNK + 1));
    }
  } finally {
    fs.closeSync(fd);
  }
}
module.exports.chunkOverhead = chunkOverhead;
module.exports.chunkedWriter = chunkedWriter;
module.exports.chunkedRange = chunkedRange;
