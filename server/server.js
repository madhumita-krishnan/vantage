#!/usr/bin/env node
'use strict';
/*
 * Prototype Vault: self-hosted, access-controlled sharing for coded prototypes. Zero third-party dependencies. Node 20+.
 * Wiring and routing live here; everything else is in lib/ (config, http, shares, media, results, admin, viewer).
 * Two origins: the main one (console, tester shell, API) and a content one that serves only prototype files.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { Store, Log } = require('./lib/store');
const C = require('./lib/crypto');

function createApp(env = process.env) {
  const CONFIG = loadConfig(env);
  const blob = C.makeBlob(CONFIG.encryptionKey);
  const PUBLIC = path.join(__dirname, 'public');
  const ctx = {
    CONFIG,
    blob,
    store: new Store(path.join(CONFIG.dataDir, 'store.json'), blob),
    audit: new Log(path.join(CONFIG.dataDir, 'audit')),
    events: new Log(path.join(CONFIG.dataDir, 'events')),
    feedback: new Log(path.join(CONFIG.dataDir, 'feedback')),
    readPublic: (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8'),
  };
  ctx.H = require('./lib/http')(CONFIG);
  ctx.gate = (req, res, status, title, message, extra = '') =>
    ctx.H.html(
      req,
      res,
      status,
      ctx
        .readPublic('gate.html')
        .replace(/\{\{TITLE\}\}/g, ctx.H.esc(title))
        .replace(/\{\{MESSAGE\}\}/g, message)
        .replace(/\{\{EXTRA\}\}/g, extra)
    );
  ctx.G = require('./lib/google')(ctx);
  ctx.S = require('./lib/shares')(ctx);
  ctx.M = require('./lib/media')(ctx);
  const { handleAdmin, adminFromReq, authInfo, handleAuth } = require('./lib/admin')(ctx);
  const handleViewer = require('./lib/viewer')(ctx);
  const { send, json, html, redirect, esc, sameOrigin } = ctx.H;
  const DOCS = {
    security: '../docs/SECURITY.md',
    deployment: '../docs/DEPLOYMENT.md',
    readme: '../README.md',
    limits: '../docs/WHAT-IT-CANNOT-DO.md',
    testing: '../docs/TESTING.md',
    'design-system': '../design/DESIGN-SYSTEM.md',
  };
  const hostOf = (req) => (CONFIG.trustProxy && req.headers['x-forwarded-host']) || req.headers.host || '';

  async function handle(req, res, onContentPort) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const content = onContentPort || CONFIG.contentHostRe.test(hostOf(req));
    try {
      if (p === '/healthz') return send(req, res, 200, 'ok', { 'Content-Type': 'text/plain' });
      if (p === '/vault.css')
        return send(req, res, 200, ctx.readPublic('vault.css'), { 'Content-Type': 'text/css; charset=utf-8' });
      const m = p.match(/^\/p\/([A-Za-z0-9_-]{6,32})(\/.*)?$/);
      if (m) return await handleViewer(req, res, url, m[1], m[2] || '', content);
      if (content) return ctx.gate(req, res, 404, 'Not found', 'Nothing here.');
      if (p === '/') return redirect(req, res, '/admin');
      if (p === '/admin' || p === '/admin/') return html(req, res, 200, ctx.readPublic('admin.html'));
      const am = p.match(/^\/admin\/([a-z-]+\.js)$/);
      if (am)
        return send(req, res, 200, ctx.readPublic(path.join('admin', am[1])), {
          'Content-Type': 'text/javascript; charset=utf-8',
        });
      const dm = p.match(/^\/docs\/([a-z-]+)$/);
      if (dm && DOCS[dm[1]] && fs.existsSync(path.join(__dirname, DOCS[dm[1]])))
        return send(req, res, 200, fs.readFileSync(path.join(__dirname, DOCS[dm[1]])), {
          'Content-Type': 'text/plain; charset=utf-8',
        });
      if (p === '/auth/google/viewer') return await handleViewer.signInCallback(req, res, url);
      if (p.startsWith('/auth/')) return await handleAuth(req, res, url);
      if (p === '/api/auth' && req.method === 'GET') return json(req, res, 200, authInfo(req));
      if (p.startsWith('/api/')) {
        const admin = adminFromReq(req);
        if (admin && admin.cookie && req.method !== 'GET' && !sameOrigin(req))
          return json(req, res, 403, { error: 'Cross-origin request rejected' });
        if (admin) return await handleAdmin(req, res, url, admin);
        // Logged a few times per address per hour, not once per request, so a scanner cannot fill the disk.
        if (p !== '/api/me' && ctx.H.rateLimit(`unauth:${ctx.H.clientIp(req)}`, 5, 3600e3))
          ctx.S.logAudit(null, 'admin.unauthorized', req, { path: p });
        return json(req, res, 401, { error: 'Unauthorized' });
      }
      return ctx.gate(req, res, 404, 'Not found', 'Nothing here.');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (res.headersSent) return res.destroy(); // a stream failed mid-body; nothing sensible can be sent now
      if (p.startsWith('/api/') || p.includes('/_vault/'))
        return json(req, res, status, { error: status >= 500 ? 'Internal error' : e.message });
      return ctx.gate(
        req,
        res,
        status,
        status >= 500 ? 'Something went wrong' : 'Error',
        esc(status >= 500 ? 'The server hit an error. Try again.' : e.message)
      );
    }
  }
  const serve = (content) => (req, res) => handle(req, res, content).catch(() => res.destroy());
  const server = http.createServer(serve(false));
  const contentServer = CONFIG.contentPort ? http.createServer(serve(true)) : null;
  const sweeper = setInterval(ctx.S.sweep, 600e3);
  sweeper.unref();
  server.on('close', () => {
    clearInterval(sweeper);
    ctx.store.flush();
    if (contentServer) contentServer.close();
  });
  return { server, contentServer, ctx };
}

function banner(CONFIG, blob, port) {
  const base = CONFIG.publicUrl || `http://localhost:${port}`;
  console.log(`Prototype Vault listening on http://${CONFIG.host}:${port}`);
  console.log(
    `  prototypes served at: ${CONFIG.contentOrigin}${CONFIG.contentPort ? ` (port ${CONFIG.contentPort})` : ' (by hostname)'}`
  );
  console.log(`  data dir:            ${CONFIG.dataDir}`);
  console.log(`  encryption at rest:  ${blob.enabled ? 'on' : 'OFF (set VAULT_ENCRYPTION_KEY)'}`);
  console.log(
    `  admin sign-in:       ${[CONFIG.adminToken && 'token', CONFIG.adminEmails.length && `sso (${CONFIG.adminEmails.join(', ')})`, CONFIG.googleClientId && 'google'].filter(Boolean).join(' + ')}`
  );
  console.log(
    `  viewer SSO header:   ${CONFIG.trustProxy && CONFIG.trustedHeaderEmail ? CONFIG.trustedHeaderEmail : 'off (personal links only)'}`
  );
  console.log(
    `  external origins:    ${CONFIG.allowedExternalOrigins.length ? CONFIG.allowedExternalOrigins.join(', ') : 'none allowed (prototypes must be self-contained)'}`
  );
  if (!CONFIG.quickstart) return;
  console.log(
    [
      '',
      'Quick start (no ADMIN_TOKEN was set, so the server made its own and is listening on this machine only):',
      `  Open the console, already signed in:   ${base}/admin#token=${CONFIG.adminToken}`,
      `  Connect Claude Code on this machine:   claude mcp add prototype-vault -- node "${CONFIG.mcpPath}"`,
      `  Secrets are in ${CONFIG.secretsFile} (keep it private).`,
      '  To let other devices open links, or for a real deployment, set HOST, ADMIN_TOKEN and VAULT_ENCRYPTION_KEY yourself: docs/DEPLOYMENT.md',
    ].join('\n')
  );
}

if (require.main === module) {
  const { server, contentServer, ctx } = createApp();
  server.listen(ctx.CONFIG.port, ctx.CONFIG.host, () => banner(ctx.CONFIG, ctx.blob, server.address().port));
  if (contentServer) contentServer.listen(ctx.CONFIG.contentPort, ctx.CONFIG.host);
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.on(sig, () => {
      ctx.store.flush();
      process.exit(0);
    });
}
module.exports = { createApp };
