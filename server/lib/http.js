'use strict';
// HTTP plumbing: body parsing, responses with security headers, errors, rate limiting.

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(httpError(413, 'Payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit = 1048576) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw httpError(400, 'Invalid JSON body'); }
}
// CSP for the vault's own pages (console, gates, viewer shell). Prototypes get their own policy in viewer.js.
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

module.exports = function httpHelpers(CONFIG) {
  const isHttps = (req) => !!req.socket.encrypted || (CONFIG.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
  const clientIp = (req) => (CONFIG.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress || '');
  const baseUrl = (req) => CONFIG.publicUrl || `${isHttps(req) ? 'https' : 'http'}://${(CONFIG.trustProxy && req.headers['x-forwarded-host']) || req.headers.host || `localhost:${CONFIG.port}`}`;
  function ssoEmail(req) {
    if (!CONFIG.trustProxy || !CONFIG.trustedHeaderEmail) return null;
    const v = String(req.headers[CONFIG.trustedHeaderEmail] || '').trim().toLowerCase();
    return /^[^@\s]+@[^@\s]+$/.test(v) ? v : null;
  }
  function baseHeaders(req) {
    const h = {
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Cache-Control': 'no-store', 'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=()', 'Cross-Origin-Opener-Policy': 'same-origin',
    };
    if (isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    return h;
  }
  function send(req, res, status, body, headers = {}) {
    const h = { ...baseHeaders(req), ...headers };
    if (body != null && !h['Content-Length']) h['Content-Length'] = Buffer.byteLength(body);
    res.writeHead(status, h);
    res.end(body);
  }
  const json = (req, res, status, obj) => send(req, res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
  const html = (req, res, status, body, extra = {}) => send(req, res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, ...extra });
  const redirect = (req, res, to) => send(req, res, 302, '', { Location: to });

  const buckets = new Map(); // in-memory, per process
  function rateLimit(key, max, windowMs) {
    const t = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt < t) { b = { count: 0, resetAt: t + windowMs }; buckets.set(key, b); }
    b.count++;
    if (buckets.size > 50000) buckets.clear();
    return b.count <= max;
  }
  return { esc, httpError, parseCookies, readBody, readJson, isHttps, clientIp, baseUrl, ssoEmail, baseHeaders, send, json, html, redirect, rateLimit };
};
