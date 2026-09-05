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
async function boot(env = {}, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'))) {
  const { server, contentServer, ctx } = createApp({ DATA_DIR: dataDir, PORT: '0', ...env });
  const base = await listen(server);
  const content = await listen(contentServer);
  ctx.CONFIG.contentOrigin = content;
  ctx.CONFIG.contentHost = new URL(content).host;
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
// Redeems a personal link and returns the cookie for the resulting session.
async function redeem(v, link) {
  const r = await v.call('GET', link.replace(v.base, ''), null, {}, null);
  assert.equal(r.status, 302);
  const cookie = cookieOf(r);
  assert.match(cookie.Cookie, /^vs_/);
  return cookie;
}
// Walks the shell -> ticket -> content-origin cookie path a browser takes when it loads the prototype iframe.
async function enterContent(v, id, cookie) {
  const c = await v.call('GET', `/p/${id}/_vault/content`, null, cookie, null);
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

test('share defaults: view only unless a test is asked for; voice and dictation off; unsafe paths rejected', async () => {
  const v = await boot();
  const plain = await v.call('POST', '/api/shares', { name: 'Plain', files: FILES });
  assert.equal(plain.status, 201);
  assert.equal(plain.data.share.mode, 'view');
  assert.equal(plain.data.share.voice, false);
  const tested = await v.call('POST', '/api/shares', { name: 'Tested', tasks: ['Find the price'], files: FILES });
  assert.equal(tested.data.share.mode, 'unmoderated');
  assert.equal(tested.data.share.tasks.length, 1);
  assert.equal(tested.data.share.dictation, false);
  assert.equal(
    (await v.call('POST', '/api/shares', { name: 'Dict', tasks: ['x'], dictation: true })).data.share.dictation,
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
  assert.match(link, /\/p\/[A-Za-z0-9_-]+\?k=/);
  const id = share.id;
  // The link's secret is stored only as a hash, and is not returned again
  assert.equal(JSON.stringify(v.ctx.store.data).includes(link.split('k=')[1]), false, 'link token stored hashed');
  assert.equal((await v.call('GET', `/api/shares/${id}`)).data.share.viewers[0].link, undefined);
  // Nobody gets in without a link
  const anon = await v.call('GET', `/p/${id}`, null, {}, null);
  assert.equal(anon.status, 403);
  assert.match(anon.data, /Invitation required/);
  const cookie = await redeem(v, link);
  const shell = await v.call('GET', `/p/${id}`, null, cookie, null);
  assert.equal(shell.status, 200);
  assert.match(shell.data, /<title>Prototype<\/title>/);
  const meta = await v.call('GET', `/p/${id}/_vault/meta`, null, cookie, null);
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
  assert.match(page.data, /_vault\/tracker\.js/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self';/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self' http:\/\/localhost/);
  assert.equal(page.headers.get('x-frame-options'), null);
  assert.equal((await v.callContent('GET', `/p/${id}/app/..%2F..%2Fstore.json`, null, ccookie)).status, 404);
  // The content origin knows nothing else: no shell, no console, no meta
  assert.equal((await v.callContent('GET', `/p/${id}/_vault/meta`, null, ccookie)).status, 404);
  assert.equal((await v.callContent('GET', '/admin', null, {})).status, 404);
  assert.equal((await v.callContent('GET', '/api/shares', null, {})).status, 404);
  const tracker = await v.callContent('GET', `/p/${id}/_vault/tracker.js`, null, ccookie);
  assert.match(tracker.data, /"record":false/);
  // Before consent nothing is recorded
  assert.equal(
    (await v.callContent('POST', `/p/${id}/_vault/events`, [{ t: 1, type: 'click', path: '/' }], ccookie)).data.ok,
    0
  );
  assert.equal((await v.call('POST', `/p/${id}/_vault/consent`, { accept: true }, cookie, null)).data.consent, true);
  assert.match((await v.callContent('GET', `/p/${id}/_vault/tracker.js`, null, ccookie)).data, /"record":true/);
  assert.equal(
    (
      await v.callContent(
        'POST',
        `/p/${id}/_vault/events`,
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
        `/p/${id}/_vault/feedback`,
        { kind: 'task', taskIndex: 0, result: 'done', text: 'easy' },
        cookie,
        null
      )
    ).status,
    201
  );
  assert.equal(
    (await v.call('POST', `/p/${id}/_vault/feedback`, { kind: 'feedback', text: 'Nice' }, cookie, null)).status,
    201
  );
  // Cross-origin posts are refused on both origins
  assert.equal(
    (
      await v.call(
        'POST',
        `/p/${id}/_vault/feedback`,
        { text: 'x' },
        { ...cookie, Origin: 'https://evil.example' },
        null
      )
    ).status,
    403
  );
  assert.equal(
    (await v.callContent('POST', `/p/${id}/_vault/events`, [], { ...ccookie, Origin: 'https://evil.example' })).status,
    403
  );
  // Voice is off for this share
  assert.equal(
    (await v.call('POST', `/p/${id}/_vault/recording?seq=0`, 'abc', { ...cookie, 'Content-Type': 'audio/webm' }, null))
      .status,
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
  assert.equal((await v.call('GET', link.replace(v.base, ''), null, {}, null)).status, 403);
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
  const meta = await v.call('GET', `/p/${share.id}/_vault/meta`, null, cookie, null);
  assert.equal(meta.data.mode, 'view');
  assert.equal(meta.data.recordSessions, false);
  assert.equal((await v.call('POST', `/p/${share.id}/_vault/feedback`, { text: 'x' }, cookie, null)).status, 403);
  const { cookie: ccookie } = await enterContent(v, share.id, cookie);
  assert.equal((await v.callContent('POST', `/p/${share.id}/_vault/events`, [{ type: 'click' }], ccookie)).data.ok, 0);
  assert.equal((await v.call('GET', `/api/shares/${share.id}/summary`)).data.eventCount, 0);
  await v.close();
});

test('passcode, rotation, expiry and revocation', async () => {
  const v = await boot();
  const {
    data: { share },
  } = await v.call('POST', '/api/shares', {
    name: 'Locked',
    passcode: '4321',
    viewers: ['a@example.com'],
    files: FILES,
  });
  const id = share.id;
  const cookie = await redeem(v, share.viewers[0].link);
  const gate = await v.call('GET', `/p/${id}`, null, cookie, null);
  assert.equal(gate.status, 200);
  assert.match(gate.data, /needs the passcode/);
  assert.equal((await v.call('GET', `/p/${id}/_vault/meta`, null, cookie, null)).status, 401);
  assert.equal(
    (
      await v.call(
        'POST',
        `/p/${id}/passcode`,
        'passcode=0000',
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
        'passcode=4321',
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
  assert.equal((await v.call('GET', share.viewers[0].link.replace(v.base, ''), null, {}, null)).status, 403);
  assert.equal((await v.call('GET', `/p/${id}`, null, cookie, null)).status, 403);
  // Expiry in the past: links stop working with 410
  assert.equal(
    (await v.call('PATCH', `/api/shares/${id}`, { expiresAt: new Date(Date.now() - 1000).toISOString() })).status,
    200
  );
  assert.equal((await v.call('GET', rot.data.viewer.link.replace(v.base, ''), null, {}, null)).status, 410);
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

test('storage limit per person applies to uploads', async () => {
  const g = await fakeGoogle('c');
  const v = await boot({
    GOOGLE_CLIENT_ID: 'c',
    GOOGLE_CLIENT_SECRET: 's',
    GOOGLE_TOKEN_URL: g.url,
    ADMIN_TOKEN: 'z'.repeat(32),
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
  await v.close();
  g.close();
});

test('housekeeping: admin log is trimmed to the retention window; rate limiter survives a key flood', async () => {
  const v = await boot({ RETENTION_DAYS: '1' });
  v.ctx.audit.append('_admin', { ts: '2000-01-01T00:00:00.000Z', type: 'old' });
  v.ctx.audit.append('_admin', { ts: new Date().toISOString(), type: 'fresh' });
  v.ctx.S.sweep();
  const types = v.ctx.audit.read('_admin').map((r) => r.type);
  assert.ok(!types.includes('old'));
  assert.ok(types.includes('fresh'));
  const rl = v.ctx.H.rateLimit;
  for (let i = 0; i < 60000; i++) rl('flood' + i, 1, 60e3);
  assert.equal(rl('after', 1, 60e3), true);
  assert.equal(rl('after', 1, 60e3), false, 'a key made after the flood is still limited');
  await v.close();
});
