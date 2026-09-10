'use strict';
// End-to-end tests against a real server (main and content origins) on random ports with a throwaway DATA_DIR. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createApp } = require('../server');

const listen = (server) =>
  new Promise((k) => server.listen(0, '127.0.0.1', () => k(`http://127.0.0.1:${server.address().port}`)));
async function boot(env = {}, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vantage-test-'))) {
  const { server, contentServer, ctx } = createApp({ DATA_DIR: dataDir, PORT: '0', ...env });
  const base = await listen(server);
  const content = contentServer ? await listen(contentServer) : null;
  if (content) {
    ctx.CONFIG.contentOrigin = content;
    ctx.CONFIG.contentHostRe = new RegExp('^' + new URL(content).host.replace('.', '\\.') + '$');
    ctx.CONFIG.contentOriginRe = new RegExp('^' + content.replace(/[.]/g, '\\.') + '$');
  }
  const call = async (method, p, body, headers = {}, token = ctx.CONFIG.adminToken, origin = base) => {
    const r = await fetch(origin + p, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: r.status, data, headers: r.headers };
  };
  return {
    ctx,
    base,
    content,
    dataDir,
    call,
    callContent: (m, p, b, h) => call(m, p, b, h, null, content),
    close: () => new Promise((k) => server.close(k)),
  };
}
const b64 = (s) => Buffer.from(s).toString('base64');
const FILES = [
  {
    path: 'index.html',
    contentBase64: b64('<html><head><title>T</title></head><body><a href="#x">x</a></body></html>'),
  },
  { path: 'app.js', contentBase64: b64('console.log(1)') },
];
const cookieOf = (r) => ({ Cookie: String(r.headers.get('set-cookie')).split(';')[0] });
// Redeems a personal link the way the gate page does: the secret sits in the fragment and is POSTed, never sent as a URL.
async function redeem(v, link) {
  const [pathPart, k] = link.replace(v.base, '').split('#k=');
  assert.ok(k, 'link carries the secret in the fragment');
  const r = await v.call('POST', pathPart + '/redeem', { k }, {}, null);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie = cookieOf(r);
  assert.match(cookie.Cookie, /^vs_/);
  return cookie;
}
const legacyLink = (link) => link.replace('#k=', '?k=');
// Walks the shell -> ticket -> content-origin cookie path a browser takes when it loads the prototype iframe.
async function enterContent(v, id, cookie) {
  const c = await v.call('GET', `/p/${id}/_vantage/content`, null, cookie, null);
  assert.equal(c.status, 200);
  assert.ok(c.data.url.startsWith(v.content), 'content url is on the content origin');
  const r = await fetch(c.data.url, { redirect: 'manual' });
  assert.equal(r.status, 302);
  return { ticketUrl: c.data.url, cookie: cookieOf(r) };
}

test('quick start: makes secrets once, reuses them, listens on localhost only', async () => {
  const v = await boot();
  const file = path.join(v.dataDir, 'local-secrets.json');
  assert.ok(fs.existsSync(file));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(v.ctx.CONFIG.host, '127.0.0.1');
  assert.ok(v.ctx.blob.enabled, 'encryption on');
  const again = await boot({}, v.dataDir);
  assert.equal(again.ctx.CONFIG.adminToken, v.ctx.CONFIG.adminToken);
  await again.close();
  await v.close();
});

test('explicit ADMIN_TOKEN: no secrets file, binds all interfaces, rejects short tokens', async () => {
  const v = await boot({ ADMIN_TOKEN: 'x'.repeat(32) });
  assert.ok(!fs.existsSync(path.join(v.dataDir, 'local-secrets.json')));
  assert.equal(v.ctx.CONFIG.host, '0.0.0.0');
  assert.equal(v.ctx.blob.enabled, false);
  await v.close();
  assert.throws(() => createApp({ ADMIN_TOKEN: 'short', DATA_DIR: v.dataDir }), /24 characters/);
});

test('admin API needs a valid bearer token; identity info leaks no secrets or paths', async () => {
  const v = await boot();
  assert.equal((await v.call('GET', '/api/shares', null, {}, null)).status, 401);
  assert.equal((await v.call('GET', '/api/shares', null, {}, 'wrong-token-wrong-token-wrong')).status, 401);
  const ok = await v.call('GET', '/api/shares');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.shares, []);
  const auth = await v.call('GET', '/api/auth', null, {}, null);
  assert.equal(auth.data.serverToken, true);
  assert.equal(auth.data.google, false);
  assert.equal(JSON.stringify(auth.data).includes(v.ctx.CONFIG.adminToken), false, 'auth info leaks no secret');
  const me = await v.call('GET', '/api/me');
  assert.equal(me.data.server.dataDir, undefined);
  assert.equal(me.data.server.secretsFile, undefined);
  await v.close();
});

test('share defaults: view only unless a test is asked for; voice and screen off; unsafe paths rejected', async () => {
  const v = await boot();
  const plain = await v.call('POST', '/api/shares', { name: 'Plain', files: FILES });
  assert.equal(plain.status, 201);
  assert.equal(plain.data.share.mode, 'view');
  assert.equal(plain.data.share.voice, false);
  const tested = await v.call('POST', '/api/shares', { name: 'Tested', tasks: ['Find the price'], files: FILES });
  assert.equal(tested.data.share.mode, 'unmoderated');
  assert.equal(tested.data.share.tasks.length, 1);
  assert.equal(tested.data.share.screen, false);
  assert.equal(
    (await v.call('POST', '/api/shares', { name: 'Scr', tasks: ['x'], screen: true })).data.share.screen,
    true
  );
  const forced = await v.call('POST', '/api/shares', { name: 'Forced', mode: 'view', tasks: ['Dropped'], voice: true });
  assert.equal(forced.data.share.mode, 'view');
  assert.equal(forced.data.share.tasks.length, 0);
  assert.equal(forced.data.share.voice, false);
  const bad = await v.call('POST', '/api/shares', {
    name: 'Bad',
    files: [{ path: '../evil.html', contentBase64: b64('x') }],
  });
  assert.equal(bad.status, 400);
  assert.equal((await v.call('POST', '/api/shares', { name: '' })).status, 400);
  assert.equal((await v.call('POST', '/api/shares', { name: 'X', expiresInDays: 'soon' })).status, 400);
  // The console names the entry file with the dropped folder's name, which the server strips
  const nested = await v.call('POST', '/api/shares', {
    name: 'Nested',
    entry: 'proto/start.html',
    files: [
      { path: 'proto/index.html', contentBase64: b64('<p>a</p>') },
      { path: 'proto/start.html', contentBase64: b64('<p>b</p>') },
    ],
  });
  assert.equal(nested.status, 201, JSON.stringify(nested.data));
  assert.equal(nested.data.share.entry, 'start.html');
  assert.equal((await v.call('POST', '/api/shares', { name: 'Nope', viewers: ['not-an-email'] })).status, 400);
  await v.close();
});

test('tester flow: redeem link, consent, events, feedback, results; prototype only on the content origin', async () => {
  const v = await boot();
  const {
    data: { share },
  } = await v.call('POST', '/api/shares', {
    name: 'Checkout',
    tasks: ['Pick a plan'],
    viewers: ['Priya <priya@example.com>'],
    files: FILES,
  });
  const link = share.viewers[0].link;
  assert.match(link, /\/p\/[A-Za-z0-9_-]+#k=/);
  const id = share.id;
  // The link's secret is stored only as a hash, and is not returned again
  assert.equal(JSON.stringify(v.ctx.store.data).includes(link.split('k=')[1]), false, 'link token stored hashed');
  // The gate page carries the script that posts the fragment
  assert.match((await v.call('GET', `/p/${id}`, null, {}, null)).data, /\/redeem/);
  assert.equal((await v.call('GET', `/api/shares/${id}`)).data.share.viewers[0].link, undefined);
  // Nobody gets in without a link
  const anon = await v.call('GET', `/p/${id}`, null, {}, null);
  assert.equal(anon.status, 403);
  assert.match(anon.data, /Invitation required/);
  const cookie = await redeem(v, link);
  const shell = await v.call('GET', `/p/${id}`, null, cookie, null);
  assert.equal(shell.status, 200);
  assert.match(shell.data, /<title>Prototype<\/title>/);
  const meta = await v.call('GET', `/p/${id}/_vantage/meta`, null, cookie, null);
  assert.equal(meta.data.viewer.email, 'priya@example.com');
  assert.equal(meta.data.consent, null);
  assert.equal(meta.data.voice, false);
  assert.equal(meta.data.contentOrigin, v.content);
  // Prototype files never come from the main origin
  assert.equal((await v.call('GET', `/p/${id}/app/index.html`, null, cookie, null)).status, 404);
  const { ticketUrl, cookie: ccookie } = await enterContent(v, id, cookie);
  assert.equal((await fetch(ticketUrl, { redirect: 'manual' })).status, 403, 'ticket is one-time');
  const page = await v.callContent('GET', `/p/${id}/app/index.html`, null, ccookie);
  assert.equal(page.status, 200);
  assert.match(page.data, /_vantage\/tracker\.js/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self';/);
  assert.ok(
    page.headers.get('content-security-policy').includes(`frame-ancestors ${v.base};`),
    'only the shell that framed it may frame it'
  );
  assert.equal(page.headers.get('x-frame-options'), null);
  assert.equal((await v.callContent('GET', `/p/${id}/app/..%2F..%2Fstore.json`, null, ccookie)).status, 404);
  // The content origin knows nothing else: no shell, no console, no meta
  assert.equal((await v.callContent('GET', `/p/${id}/_vantage/meta`, null, ccookie)).status, 404);
  assert.equal((await v.callContent('GET', '/admin', null, {})).status, 404);
  assert.equal((await v.callContent('GET', '/api/shares', null, {})).status, 404);
  const tracker = await v.callContent('GET', `/p/${id}/_vantage/tracker.js`, null, ccookie);
  assert.match(tracker.data, /"record":false/);
  // Before consent nothing is recorded
  assert.equal(
    (await v.callContent('POST', `/p/${id}/_vantage/events`, [{ t: 1, type: 'click', path: '/' }], ccookie)).data.ok,
    0
  );
  assert.equal((await v.call('POST', `/p/${id}/_vantage/consent`, { accept: true }, cookie, null)).data.consent, true);
  assert.match((await v.callContent('GET', `/p/${id}/_vantage/tracker.js`, null, ccookie)).data, /"record":true/);
  assert.equal(
    (
      await v.callContent(
        'POST',
        `/p/${id}/_vantage/events`,
        [
          { t: 1, type: 'click', path: '/', data: { target: 'a' } },
          { t: 2, type: 'pageview', path: '/' },
        ],
        ccookie
      )
    ).data.ok,
    2
  );
  assert.equal(
    (
      await v.call(
        'POST',
        `/p/${id}/_vantage/feedback`,
        { kind: 'task', taskIndex: 0, result: 'done', text: 'easy' },
        cookie,
        null
      )
    ).status,
    201
  );
  assert.equal(
    (await v.call('POST', `/p/${id}/_vantage/feedback`, { kind: 'feedback', text: 'Nice' }, cookie, null)).status,
    201
  );
  // Cross-origin posts are refused on both origins
  assert.equal(
    (
      await v.call(
        'POST',
        `/p/${id}/_vantage/feedback`,
        { text: 'x' },
        { ...cookie, Origin: 'https://evil.example' },
        null
      )
    ).status,
    403
  );
  assert.equal(
    (await v.callContent('POST', `/p/${id}/_vantage/events`, [], { ...ccookie, Origin: 'https://evil.example' }))
      .status,
    403
  );
  // Voice is off for this share
  assert.equal(
    (
      await v.call(
        'POST',
        `/p/${id}/_vantage/recording?seq=0`,
        'abc',
        { ...cookie, 'Content-Type': 'audio/webm' },
        null
      )
    ).status,
    403
  );
  // Results
  const sum = await v.call('GET', `/api/shares/${id}/summary`);
  assert.equal(sum.data.eventCount, 2);
  assert.equal(sum.data.feedbackCount, 1);
  assert.equal(sum.data.tasks[0].done, 1);
  assert.equal(sum.data.viewers[0].email, 'priya@example.com');
  assert.equal(sum.data.viewers[0].clicks, 1);
  const report = await v.call('GET', `/api/shares/${id}/report`);
  assert.match(report.data, /# Checkout/);
  assert.match(report.data, /Pick a plan \| 1 \| 0/);
  assert.match(report.data, /1 successful opens/);
  assert.match((await v.call('GET', `/api/shares/${id}/events?format=csv`)).data, /^ts,viewer,email/);
  // Revoking the viewer kills the link and both sessions
  const viewerId = share.viewers[0].id;
  assert.equal((await v.call('DELETE', `/api/shares/${id}/viewers/${viewerId}`)).status, 200);
  assert.equal((await v.call('POST', `/p/${id}/redeem`, { k: link.split('#k=')[1] }, {}, null)).status, 403);
  assert.equal((await v.call('GET', `/p/${id}`, null, cookie, null)).status, 403);
  assert.equal((await v.callContent('GET', `/p/${id}/app/index.html`, null, ccookie)).status, 401);
  const audit = await v.call('GET', `/api/shares/${id}/audit`);
  assert.ok(audit.data.audit.some((a) => a.type === 'link.rejected'));
  assert.ok(audit.data.audit.some((a) => a.type === 'viewer.revoked'));
  await v.close();
});

test('tracker is injected after the doctype when a page has no head', async () => {
  const v = await boot();
  const files = [{ path: 'index.html', contentBase64: b64('<!doctype html>\n<body>hi</body>') }];
  const {
    data: { share },
  } = await v.call('POST', '/api/shares', { name: 'NoHead', viewers: ['a@example.com'], files });
  const { cookie } = await enterContent(v, share.id, await redeem(v, share.viewers[0].link));
  const page = await v.callContent('GET', `/p/${share.id}/app/index.html`, null, cookie);
  assert.match(page.data, /^<!doctype html><meta name="referrer"/);
  await v.close();
});

test('view-only share records nothing and has no feedback', async () => {
  const v = await boot();
  const {
    data: { share },
  } = await v.call('POST', '/api/shares', { name: 'Review', viewers: ['tom@example.com'], files: FILES });
  const cookie = await redeem(v, share.viewers[0].link);
  const meta = await v.call('GET', `/p/${share.id}/_vantage/meta`, null, cookie, null);
  assert.equal(meta.data.mode, 'view');
  assert.equal(meta.data.recordSessions, false);
  assert.equal((await v.call('POST', `/p/${share.id}/_vantage/feedback`, { text: 'x' }, cookie, null)).status, 403);
  const { cookie: ccookie } = await enterContent(v, share.id, cookie);
  assert.equal(
    (await v.callContent('POST', `/p/${share.id}/_vantage/events`, [{ type: 'click' }], ccookie)).data.ok,
    0
  );
  assert.equal((await v.call('GET', `/api/shares/${share.id}/summary`)).data.eventCount, 0);
  await v.close();
});

test('passcode, rotation, expiry and revocation', async () => {
  const v = await boot();
  const {
    data: { share },
  } = await v.call('POST', '/api/shares', {
    name: 'Locked',
    passcode: '654321',
    viewers: ['a@example.com'],
    files: FILES,
  });
  const id = share.id;
  assert.equal(
    (await v.call('POST', '/api/shares', { name: 'Short', passcode: '4321' })).status,
    400,
    'six characters'
  );
  // A link in the older ?k= form is still accepted
  const old = await v.call('GET', legacyLink(share.viewers[0].link).replace(v.base, ''), null, {}, null);
  assert.equal(old.status, 302);
  const cookie = cookieOf(old);
  const gate = await v.call('GET', `/p/${id}`, null, cookie, null);
  assert.equal(gate.status, 200);
  assert.match(gate.data, /needs the passcode/);
  assert.equal((await v.call('GET', `/p/${id}/_vantage/meta`, null, cookie, null)).status, 401);
  assert.equal(
    (
      await v.call(
        'POST',
        `/p/${id}/passcode`,
        'passcode=000000',
        { ...cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        null
      )
    ).status,
    401
  );
  assert.equal(
    (
      await v.call(
        'POST',
        `/p/${id}/passcode`,
        'passcode=654321',
        { ...cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        null
      )
    ).status,
    302
  );
  assert.match((await v.call('GET', `/p/${id}`, null, cookie, null)).data, /<title>Prototype<\/title>/);
  // Rotating a link invalidates the old one and the session
  const rot = await v.call('POST', `/api/shares/${id}/viewers/${share.viewers[0].id}/rotate`);
  assert.ok(rot.data.viewer.link);
  assert.notEqual(rot.data.viewer.link, share.viewers[0].link);
  assert.equal(
    (await v.call('GET', legacyLink(share.viewers[0].link).replace(v.base, ''), null, {}, null)).status,
    403
  );
  assert.equal((await v.call('GET', `/p/${id}`, null, cookie, null)).status, 403);
  // Expiry in the past: links stop working with 410
  assert.equal(
    (await v.call('PATCH', `/api/shares/${id}`, { expiresAt: new Date(Date.now() - 1000).toISOString() })).status,
    200
  );
  assert.equal((await v.call('GET', legacyLink(rot.data.viewer.link).replace(v.base, ''), null, {}, null)).status, 410);
  assert.equal((await v.call('GET', `/api/shares/${id}`)).data.share.status, 'expired');
  // Revoke whole share, then delete it
  assert.equal((await v.call('PATCH', `/api/shares/${id}`, { revoked: true })).data.share.status, 'revoked');
  assert.equal((await v.call('DELETE', `/api/shares/${id}`)).status, 200);
  assert.equal((await v.call('GET', `/api/shares/${id}`)).status, 404);
  assert.equal(fs.existsSync(path.join(v.dataDir, 'bundles', id)), false);
  await v.close();
});

test('personal access tokens: create, use, disconnect', async () => {
  const v = await boot();
  const made = await v.call('POST', '/api/tokens', { name: 'Claude Code' });
  assert.equal(made.status, 201);
  assert.match(made.data.token, /^pv_/);
  const me = await v.call('GET', '/api/me', null, {}, made.data.token);
  assert.equal(me.data.identity.kind, 'personal-token');
  assert.equal(me.data.identity.who, 'admin-token');
  assert.equal(JSON.stringify(v.ctx.store.data.tokens).includes(made.data.token), false, 'token stored hashed');
  assert.equal((await v.call('DELETE', '/api/tokens/current', null, {}, made.data.token)).status, 200);
  assert.equal((await v.call('GET', '/api/me', null, {}, made.data.token)).status, 401);
  await v.close();
});

test('sample share publishes the bundled example with tasks', async () => {
  const v = await boot();
  const r = await v.call('POST', '/api/shares/sample', { viewer: 'me@example.com' });
  assert.equal(r.status, 201);
  assert.equal(r.data.share.mode, 'unmoderated');
  assert.equal(r.data.share.tasks.length, 3);
  assert.equal(r.data.share.files.count, 1);
  assert.equal(r.data.share.viewers[0].email, 'me@example.com');
  assert.ok(r.data.share.viewers[0].link);
  const { cookie } = await enterContent(v, r.data.share.id, await redeem(v, r.data.share.viewers[0].link));
  assert.match((await v.callContent('GET', `/p/${r.data.share.id}/app/index.html`, null, cookie)).data, /Acme Billing/);
  await v.close();
});

test('SSO header admits allowed domains only when the proxy is trusted', async () => {
  const v = await boot({
    ADMIN_TOKEN: 'y'.repeat(32),
    TRUST_PROXY: '1',
    TRUSTED_HEADER_EMAIL: 'x-forwarded-email',
    ADMIN_EMAILS: 'lead@corp.example',
  });
  const {
    data: { share },
  } = await v.call('POST', '/api/shares', { name: 'Internal', files: FILES, ssoAllow: { domains: ['corp.example'] } });
  assert.equal(
    (await v.call('GET', `/p/${share.id}`, null, { 'x-forwarded-email': 'sam@corp.example' }, null)).status,
    302
  );
  assert.equal(
    (await v.call('GET', `/p/${share.id}`, null, { 'x-forwarded-email': 'sam@other.example' }, null)).status,
    403
  );
  assert.equal(
    (await v.call('GET', '/api/me', null, { 'x-forwarded-email': 'lead@corp.example' }, null)).data.identity.kind,
    'sso'
  );
  assert.equal((await v.call('GET', '/api/me', null, { 'x-forwarded-email': 'sam@corp.example' }, null)).status, 401);
  // An SSO admin is a browser session: a write from another site is refused
  const csrf = { 'x-forwarded-email': 'lead@corp.example', Origin: 'https://evil.example' };
  assert.equal((await v.call('POST', '/api/me/leave', null, csrf, null)).status, 403);
  await v.close();
  const untrusted = await boot({
    ADMIN_TOKEN: 'y'.repeat(32),
    TRUSTED_HEADER_EMAIL: 'x-forwarded-email',
    ADMIN_EMAILS: 'lead@corp.example',
  });
  assert.equal(
    (await untrusted.call('GET', '/api/me', null, { 'x-forwarded-email': 'lead@corp.example' }, null)).status,
    401,
    'header ignored without TRUST_PROXY'
  );
  await untrusted.close();
});

// A stand-in for Google's token endpoint: the `code` is the email it signs in.
async function fakeGoogle(clientId) {
  const idToken = (email) =>
    [
      'e30',
      Buffer.from(
        JSON.stringify({
          aud: clientId,
          iss: 'https://accounts.google.com',
          email,
          email_verified: true,
          name: 'Test Person',
        })
      ).toString('base64url'),
      'sig',
    ].join('.');
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
    });
    req.on('end', () => {
      const p = new URLSearchParams(b);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id_token: idToken(p.get('code')) }));
    });
  });
  return { url: await listen(srv), close: () => srv.close() };
}
async function signIn(v, email) {
  const start = await v.call('GET', '/auth/google', null, {}, null);
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const done = await v.call(
    'GET',
    `/auth/google/callback?code=${encodeURIComponent(email)}&state=${state}`,
    null,
    cookieOf(start),
    null
  );
  assert.equal(done.status, 302);
  assert.equal(done.headers.get('location'), '/admin');
  return cookieOf(done);
}

test('Google sign-in: cookie session, CSRF check, per-person visibility and limits, sign out', async () => {
  const g = await fakeGoogle('client-1');
  const v = await boot({
    GOOGLE_CLIENT_ID: 'client-1',
    GOOGLE_CLIENT_SECRET: 's',
    GOOGLE_TOKEN_URL: g.url,
    GOOGLE_AUTH_URL: 'http://auth.test/o',
    ADMIN_TOKEN: 'z'.repeat(32),
    ADMIN_EMAILS: 'ana@example.com,ben@example.com',
    MAX_SHARES_PER_OWNER: '1',
  });
  assert.equal(v.ctx.CONFIG.quickstart, false);
  assert.equal((await v.call('GET', '/api/auth', null, {}, null)).data.google, true);
  // A bad state is refused
  assert.equal(
    (await v.call('GET', '/auth/google/callback?code=x&state=nope', null, { Cookie: 'oauth_state=other' }, null))
      .status,
    400
  );
  const ana = await signIn(v, 'ana@example.com');
  assert.match(ana.Cookie, /^va=/);
  assert.equal(
    JSON.stringify(v.ctx.store.data.adminSessions).includes(ana.Cookie.slice(3)),
    false,
    'admin session stored hashed'
  );
  const me = await v.call('GET', '/api/me', null, ana, null);
  assert.equal(me.data.identity.kind, 'google');
  assert.equal(me.data.identity.who, 'ana@example.com');
  assert.equal(me.data.mine.limits.shares, 1);
  // Cookie-authenticated writes must come from our own origin
  assert.equal(
    (await v.call('POST', '/api/shares', { name: 'X' }, { ...ana, Origin: 'https://evil.example' }, null)).status,
    403
  );
  const made = await v.call(
    'POST',
    '/api/shares',
    { name: 'Ana one', files: FILES, viewers: ['t@example.com'] },
    ana,
    null
  );
  assert.equal(made.status, 201);
  assert.equal(made.data.share.createdBy, 'ana@example.com');
  assert.equal((await v.call('POST', '/api/shares', { name: 'Ana two' }, ana, null)).status, 403, 'share limit');
  // Another person sees nothing of Ana's; the server token sees everything
  const ben = await signIn(v, 'ben@example.com');
  assert.deepEqual((await v.call('GET', '/api/shares', null, ben, null)).data.shares, []);
  assert.equal((await v.call('GET', `/api/shares/${made.data.share.id}`, null, ben, null)).status, 404);
  assert.equal((await v.call('DELETE', `/api/shares/${made.data.share.id}`, null, ben, null)).status, 404);
  assert.equal((await v.call('GET', '/api/shares')).data.shares.length, 1);
  assert.equal((await v.call('GET', `/api/shares/${made.data.share.id}`, null, ana, null)).status, 200);
  // Sign out ends the session
  assert.equal((await v.call('POST', '/api/logout', null, ana, null)).status, 200);
  assert.equal((await v.call('GET', '/api/me', null, ana, null)).status, 401);
  await v.close();
  // ADMIN_EMAILS restricts who may sign in
  const strict = await boot({
    GOOGLE_CLIENT_ID: 'client-1',
    GOOGLE_CLIENT_SECRET: 's',
    GOOGLE_TOKEN_URL: g.url,
    ADMIN_EMAILS: 'ana@example.com',
  });
  const start = await strict.call('GET', '/auth/google', null, {}, null);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  assert.equal(
    (
      await strict.call(
        'GET',
        `/auth/google/callback?code=ben%40example.com&state=${state}`,
        null,
        cookieOf(start),
        null
      )
    ).status,
    403
  );
  await strict.close();
  g.close();
});

test('Google sign-in without an allow-list refuses to start, and says what to set', async () => {
  await assert.rejects(
    boot({ GOOGLE_CLIENT_ID: 'client-1', GOOGLE_CLIENT_SECRET: 's' }),
    /ADMIN_EMAILS=you@example.com/
  );
});

test('free monthly allowance: links pause with a plain message once it is used, the console keeps working', async () => {
  const v = await boot({ ADMIN_TOKEN: 'z'.repeat(32), MAX_MONTHLY_REQUESTS: '2' });
  try {
    const first = await v.call('GET', '/p/abcdefgh', null, {}, null);
    const second = await v.call('GET', '/p/abcdefgh', null, {}, null);
    assert.notEqual(first.status, 503);
    assert.notEqual(second.status, 503); // the normal gate, whatever it says: two requests used the allowance
    const paused = await v.call('GET', '/p/abcdefgh', null, {}, null);
    assert.equal(paused.status, 503);
    assert.match(String(paused.data), /Paused until next month/);
    assert.match(String(paused.data), /free allowance for the month/);
    assert.equal((await v.call('GET', '/api/shares')).status, 200); // the designer's console is not paused
    assert.equal(v.ctx.usage.status().refused, 1);
  } finally {
    await v.close();
  }
});

test('require sign-in: a forwarded link opens nothing until the invited address signs in with Google', async () => {
  const g = await fakeGoogle('client-1');
  const v = await boot({
    GOOGLE_CLIENT_ID: 'client-1',
    GOOGLE_CLIENT_SECRET: 's',
    GOOGLE_TOKEN_URL: g.url,
    GOOGLE_AUTH_URL: 'http://auth.test/o',
    ADMIN_EMAILS: 'ana@example.com',
    ADMIN_TOKEN: 'z'.repeat(32),
  });
  const made = await v.call('POST', '/api/shares', {
    name: 'Strict',
    files: FILES,
    viewers: ['Tia <tia@example.com>'],
    requireSignIn: true,
  });
  assert.equal(made.status, 201);
  assert.equal(made.data.share.requireSignIn, true);
  const id = made.data.share.id;
  const cookie = await redeem(v, made.data.share.viewers[0].link);
  // Holding the link is not enough
  const shell = await v.call('GET', `/p/${id}`, null, cookie, null);
  assert.equal(shell.status, 200);
  assert.match(shell.data, /Sign in with Google/);
  assert.equal((await v.call('GET', `/p/${id}/_vantage/meta`, null, cookie, null)).status, 401);
  assert.equal((await v.call('GET', `/p/${id}/_vantage/content`, null, cookie, null)).status, 401);
  // The same session token, replayed on the content origin, opens nothing either
  assert.equal((await v.callContent('GET', `/p/${id}/app/index.html`, null, cookie)).status, 401);
  const verify = async (email) => {
    const start = await v.call('GET', `/p/${id}/signin`, null, cookie, null);
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    return v.call(
      'GET',
      `/auth/google/viewer?code=${encodeURIComponent(email)}&state=${state}`,
      null,
      { Cookie: `${cookie.Cookie}; ${cookieOf(start).Cookie}` },
      null
    );
  };
  // The wrong Google account is refused and logged
  const wrong = await verify('someone@else.example');
  assert.equal(wrong.status, 403);
  assert.match(wrong.data, /Not the invited address/);
  assert.equal((await v.call('GET', `/p/${id}/_vantage/meta`, null, cookie, null)).status, 401);
  const log = (await v.call('GET', `/api/shares/${id}/audit`)).data;
  assert.ok(JSON.stringify(log).includes('identity.mismatch'));
  // The invited address gets in; the check is case-insensitive
  const right = await verify('Tia@Example.com');
  assert.equal(right.status, 302);
  assert.equal(right.headers.get('location'), `/p/${id}`);
  assert.equal((await v.call('GET', `/p/${id}/_vantage/meta`, null, cookie, null)).status, 200);
  // A state that was never issued is refused
  assert.equal(
    (await v.call('GET', '/auth/google/viewer?code=x&state=nope', null, { Cookie: 'oauth_state=nope' }, null)).status,
    400
  );
  await v.close();
  g.close();
  // Without Google sign-in the option cannot be set
  const plain = await boot();
  assert.equal((await plain.call('POST', '/api/shares', { name: 'X', requireSignIn: true })).status, 400);
  await plain.close();
});

test('storage limit per person applies to uploads', async () => {
  const g = await fakeGoogle('c');
  const v = await boot({
    GOOGLE_CLIENT_ID: 'c',
    GOOGLE_CLIENT_SECRET: 's',
    GOOGLE_TOKEN_URL: g.url,
    ADMIN_TOKEN: 'z'.repeat(32),
    ADMIN_EMAILS: 'ana@example.com',
    MAX_STORAGE_MB_PER_OWNER: '0.00001',
  });
  const ana = await signIn(v, 'ana@example.com');
  assert.equal(
    (
      await v.call(
        'POST',
        '/api/shares',
        { name: 'Small', files: [{ path: 'index.html', contentBase64: b64('<p>x</p>') }] },
        ana,
        null
      )
    ).status,
    201
  );
  const big = await v.call('POST', '/api/shares', { name: 'Big', files: FILES }, ana, null);
  assert.equal(big.status, 403);
  assert.match(big.data.error, /MB/);
  // Media counts toward the same limit: a tester's recording is refused once the owner is over it
  const small = await v.call(
    'POST',
    '/api/shares',
    { name: 'Voice', voice: true, tasks: ['x'], viewers: ['t@example.com'] },
    ana,
    null
  );
  assert.equal(small.status, 201);
  const cookie = await redeem(v, small.data.share.viewers[0].link);
  await v.call('POST', `/p/${small.data.share.id}/_vantage/consent`, { accept: true }, cookie, null);
  const rec = await v.call(
    'POST',
    `/p/${small.data.share.id}/_vantage/recording?seq=0`,
    'x'.repeat(64),
    { ...cookie, 'Content-Type': 'audio/webm' },
    null
  );
  assert.equal(rec.status, 403);
  await v.close();
  g.close();
});

test('screen recording: video accepted only when the share allows it, listed with its mime, streamed back', async () => {
  const v = await boot();
  const mk = async (opts) => {
    const r = await v.call('POST', '/api/shares', { name: 'R', tasks: ['x'], viewers: ['t@example.com'], ...opts });
    const cookie = await redeem(v, r.data.share.viewers[0].link);
    await v.call('POST', `/p/${r.data.share.id}/_vantage/consent`, { accept: true }, cookie, null);
    return { id: r.data.share.id, cookie };
  };
  const post = (s, mime) =>
    v.call('POST', `/p/${s.id}/_vantage/recording?seq=0`, 'x'.repeat(64), { ...s.cookie, 'Content-Type': mime }, null);
  const voiceOnly = await mk({ voice: true });
  assert.equal((await post(voiceOnly, 'video/webm')).status, 415, 'video refused on a voice-only share');
  const screenOnly = await mk({ screen: true });
  assert.equal((await post(screenOnly, 'audio/webm')).status, 415, 'audio refused on a screen-only share');
  assert.equal((await post(screenOnly, 'video/webm')).status, 200);
  const list = (await v.call('GET', `/api/shares/${screenOnly.id}/recordings`)).data.recordings;
  assert.equal(list.length, 1);
  assert.equal(list[0].mime, 'video/webm');
  const back = await v.call('GET', `/api/shares/${screenOnly.id}/recordings/${list[0].session}`);
  assert.equal(back.status, 200);
  assert.equal(back.headers.get('content-type'), 'video/webm');
  assert.match(back.headers.get('content-disposition'), /screen-.*\.webm/);
  // Replacing or removing the intro leaves the recordings alone
  const put = (body) =>
    v.call('PUT', `/api/shares/${screenOnly.id}/intro`, body, { 'Content-Type': 'audio/wav', 'X-File-Name': 'i.wav' });
  assert.equal((await put('abcdefghij')).status, 200);
  const suffix = await fetch(`${v.base}/p/${screenOnly.id}/_vantage/intro`, {
    headers: { ...screenOnly.cookie, Range: 'bytes=-3' },
  });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
  assert.equal(await suffix.text(), 'hij');
  assert.equal((await put('0123456789')).status, 200);
  assert.equal((await v.call('DELETE', `/api/shares/${screenOnly.id}/intro`)).status, 200);
  const still = await v.call('GET', `/api/shares/${screenOnly.id}/recordings/${list[0].session}`);
  assert.equal(still.status, 200);
  assert.equal(still.data, 'x'.repeat(64), 'recording survives intro changes');
  await v.close();
});

test('housekeeping: retention deletes whole shares, admin log trimmed, store keeps a backup, limiter survives a flood', async () => {
  const v = await boot({ RETENTION_DAYS: '1' });
  const {
    data: { share },
  } = await v.call('POST', '/api/shares', {
    name: 'Old',
    viewers: ['a@example.com'],
    files: FILES,
    expiresAt: new Date(Date.now() - 2 * 86400e3).toISOString(),
  });
  v.ctx.S.sweep();
  assert.equal((await v.call('GET', `/api/shares/${share.id}`)).status, 404, 'expired share gone after retention');
  assert.equal(fs.existsSync(path.join(v.dataDir, 'bundles', share.id)), false);
  v.ctx.store.flush();
  v.ctx.store.flush();
  assert.ok(fs.existsSync(path.join(v.dataDir, 'store.json.bak')), 'previous store kept as backup');
  v.ctx.audit.append('_admin', { ts: '2000-01-01T00:00:00.000Z', type: 'old' });
  v.ctx.audit.append('_admin', { ts: new Date().toISOString(), type: 'fresh' });
  v.ctx.S.sweep();
  const types = v.ctx.audit.read('_admin').map((r) => r.type);
  assert.ok(!types.includes('old'));
  assert.ok(types.includes('fresh'));
  const rl = v.ctx.H.rateLimit;
  rl('victim', 8, 60e3);
  for (let i = 0; i < 60000; i++) rl('flood' + i, 1, 60e3);
  assert.equal(rl('after', 1, 60e3), false, 'newcomers are refused while the table is full');
  for (let i = 0; i < 7; i++) rl('victim', 8, 60e3);
  assert.equal(rl('victim', 8, 60e3), false, 'the flood did not reset a live limit');
  await v.close();
});

test('hardening: proxy IP from the right, framed-only pages, CSV formulas defused, oversized event data kept', async () => {
  const v = await boot({ ADMIN_TOKEN: 'w'.repeat(32), TRUST_PROXY: '1' });
  const {
    data: { share },
  } = await v.call('POST', '/api/shares', { name: 'Hard', tasks: ['t'], viewers: ['a@example.com'], files: FILES });
  const id = share.id;
  // A client-supplied X-Forwarded-For prefix is ignored; the proxy-appended last entry is the address
  const [p, k] = share.viewers[0].link.replace(v.base, '').split('#k=');
  const r = await v.call('POST', p + '/redeem', { k }, { 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' }, null);
  assert.equal(r.status, 200);
  const cookie = cookieOf(r);
  const audit = (await v.call('GET', `/api/shares/${id}/audit`)).data.audit;
  assert.equal(audit.find((a) => a.type === 'link.redeemed').ip, '1.1.1.1');
  // Content pages open only inside a frame
  const { cookie: ccookie } = await enterContent(v, id, cookie);
  assert.equal(
    (await v.callContent('GET', `/p/${id}/app/index.html`, null, { ...ccookie, 'Sec-Fetch-Dest': 'document' })).status,
    403
  );
  assert.equal(
    (await v.callContent('GET', `/p/${id}/app/index.html`, null, { ...ccookie, 'Sec-Fetch-Dest': 'iframe' })).status,
    200
  );
  assert.equal(
    (await v.callContent('GET', `/p/${id}/app/app.js`, null, { ...ccookie, 'Sec-Fetch-Dest': 'script' })).status,
    200
  );
  assert.doesNotMatch(
    (await v.callContent('GET', `/p/${id}/app/index.html`, null, ccookie)).headers.get('content-security-policy'),
    /frame-ancestors 'self'/
  );
  // Oversized event data is kept, truncated, instead of failing the batch; CSV defuses formulas
  await v.call('POST', `/p/${id}/_vantage/consent`, { accept: true }, cookie, null);
  const posted = await v.callContent(
    'POST',
    `/p/${id}/_vantage/events`,
    [
      { type: 'click', path: '/', data: { target: '=1+1' } },
      { type: 'custom:big', path: '/', data: { big: 'x'.repeat(5000) } },
    ],
    ccookie
  );
  assert.equal(posted.data.ok, 2);
  const csv = (await v.call('GET', `/api/shares/${id}/events?format=csv`)).data;
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /truncated/);
  await v.close();
});

test('hardening 2: failed bundle keeps the old one, prototype ids, bad cookies, subtitles, segment order', async () => {
  const v = await boot();
  const {
    data: { share },
  } = await v.call('POST', '/api/shares', {
    name: 'H2',
    screen: true,
    tasks: ['t'],
    viewers: ['a@example.com'],
    files: FILES,
  });
  const id = share.id;
  // A name cannot be both a file and a folder; the old bundle is still there afterwards
  const clash = [
    { path: 'a', contentBase64: b64('x') },
    { path: 'a/b.html', contentBase64: b64('y') },
  ];
  assert.equal((await v.call('PUT', `/api/shares/${id}/bundle`, { files: clash })).status, 400);
  assert.equal((await v.call('GET', `/api/shares/${id}`)).data.share.files.count, 2);
  assert.ok(fs.existsSync(path.join(v.dataDir, 'bundles', id, 'index.html')));
  // Names of Object.prototype members are not records
  assert.equal((await v.call('DELETE', `/api/shares/${id}/viewers/__proto__`)).status, 404);
  assert.equal((await v.call('GET', `/api/shares/__proto__`)).status, 404);
  assert.equal((await v.call('GET', `/p/constructor`, null, {}, null)).status, 404);
  assert.equal(Object.prototype.revoked, undefined);
  // A malformed cookie from another app on the host is ignored, not a 500
  assert.equal((await v.call('GET', `/p/${id}`, null, { Cookie: 'x=%' }, null)).status, 403);
  // Subtitles: a GET changes nothing; a bad file changes nothing
  const vtt = { 'Content-Type': 'text/vtt', 'X-Label': 'Español' };
  assert.equal((await v.call('PUT', `/api/shares/${id}/subtitles/es`, 'WEBVTT\n', vtt)).status, 200);
  assert.equal((await v.call('GET', `/api/shares/${id}/subtitles/es`)).status, 405);
  assert.equal((await v.call('PUT', `/api/shares/${id}/subtitles/es`, 'not vtt', vtt)).status, 400);
  assert.equal((await v.call('GET', `/api/shares/${id}`)).data.share.intro.subtitles.length, 1);
  assert.equal(
    (await v.call('PUT', `/api/shares/${id}/subtitles/zh_TW`, 'WEBVTT\n', vtt)).data.share.intro.subtitles[1].lang,
    'zh-tw'
  );
  // Recording segments arrive in order; a retried segment replaces the earlier copy
  const cookie = await redeem(v, share.viewers[0].link);
  await v.call('POST', `/p/${id}/_vantage/consent`, { accept: true }, cookie, null);
  const seg = (n, body) =>
    v.call('POST', `/p/${id}/_vantage/recording?seq=${n}`, body, { ...cookie, 'Content-Type': 'video/webm' }, null);
  assert.equal((await seg(5, 'x')).status, 400);
  assert.equal((await seg(0, 'x'.repeat(10))).status, 200);
  assert.equal((await seg(0, 'y'.repeat(10))).status, 200);
  assert.equal((await v.call('GET', `/api/shares/${id}/recordings`)).data.recordings[0].size, 10);
  await v.close();
});

test('wildcard content origin gives every share its own host', async () => {
  const v = await boot({ ADMIN_TOKEN: 'w'.repeat(32), CONTENT_ORIGIN: 'https://*.content.example', CONTENT_PORT: '0' });
  assert.equal(v.ctx.CONFIG.contentOriginFor('AbC'), 'https://abc.content.example');
  assert.ok(v.ctx.CONFIG.contentHostRe.test('abc.content.example'));
  assert.ok(!v.ctx.CONFIG.contentHostRe.test('content.example'));
  assert.ok(!v.ctx.CONFIG.contentHostRe.test('abc.content.example.evil'));
  assert.ok(v.ctx.CONFIG.contentOriginRe.test('https://abc.content.example'));
  await v.close();
});
