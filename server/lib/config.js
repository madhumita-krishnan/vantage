'use strict';
// Configuration from the environment, plus quick start. With no admin mechanism configured the server makes its own
// admin token (and an encryption key unless VAULT_ENCRYPTION_KEY is set), keeps both in DATA_DIR/local-secrets.json
// (mode 0600) so restarts and the CLI / MCP server on this machine reuse them, and listens on localhost only.
// For a real deployment set ADMIN_TOKEN (or ADMIN_EMAILS + SSO), VAULT_ENCRYPTION_KEY and HOST yourself.
const fs = require('fs');
const path = require('path');
const C = require('./crypto');

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function loadConfig(env = process.env, root = path.join(__dirname, '..')) {
  const cfg = {
    root,
    port: +(env.PORT || 8787),
    host: env.HOST || '',
    dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
    adminToken: env.ADMIN_TOKEN || '',
    adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
    trustProxy: env.TRUST_PROXY === '1',
    trustedHeaderEmail: (env.TRUSTED_HEADER_EMAIL || '').toLowerCase(),
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    encryptionKey: env.VAULT_ENCRYPTION_KEY || '',
    maxUploadBytes: +(env.MAX_UPLOAD_MB || 100) * 1048576,
    maxMediaBytes: +(env.MAX_MEDIA_MB || 1024) * 1048576, // intro audio/video and voice recordings, per share
    sessionHours: +(env.SESSION_HOURS || 8),
    allowedExternalOrigins: list(env.ALLOWED_EXTERNAL_ORIGINS),
    defaultExpiryDays: +(env.DEFAULT_EXPIRY_DAYS || 7),
    maxExpiryDays: +(env.MAX_EXPIRY_DAYS || 365),
    retentionDays: +(env.RETENTION_DAYS || 30), // purge prototype files this long after expiry
    ssoLogoutUrl: env.SSO_LOGOUT_URL || '',
    quickstart: false,
    secretsFile: null,
    mcpPath: path.join(root, '..', 'mcp', 'server.js'),
  };
  if (cfg.adminToken && cfg.adminToken.length < 24) throw new Error('ADMIN_TOKEN must be at least 24 characters');
  if (cfg.trustedHeaderEmail && !cfg.trustProxy) console.error('TRUSTED_HEADER_EMAIL is set but TRUST_PROXY is not 1; the header will be ignored.');
  fs.mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 });
  if (!cfg.adminToken && !cfg.adminEmails.length) {
    cfg.quickstart = true;
    cfg.secretsFile = path.join(cfg.dataDir, 'local-secrets.json');
    let s = {};
    try { s = JSON.parse(fs.readFileSync(cfg.secretsFile, 'utf8')) || {}; } catch { /* first start */ }
    if (typeof s.adminToken !== 'string' || s.adminToken.length < 24) s.adminToken = C.randomToken();
    if (!cfg.encryptionKey && !/^[0-9a-f]{64}$/.test(String(s.encryptionKey || ''))) s.encryptionKey = C.randomKeyHex();
    s.url = cfg.publicUrl || `http://localhost:${cfg.port}`;
    fs.writeFileSync(cfg.secretsFile, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    cfg.adminToken = s.adminToken;
    if (!cfg.encryptionKey) cfg.encryptionKey = s.encryptionKey;
  }
  if (!cfg.host) cfg.host = cfg.quickstart ? '127.0.0.1' : '0.0.0.0';
  return cfg;
}

module.exports = { loadConfig, list };
