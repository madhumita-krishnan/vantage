'use strict';
// End-to-end tests against a real server on a random port with a throwaway DATA_DIR. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

function boot(env = {}, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'))) {
  const { server, ctx } = createApp({ DATA_DIR: dataDir, PORT: '0', ...env });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, p, body, headers = {}, token = ctx.CONFIG.adminToken) => {
      const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json', ...headers }, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
      const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: r.status, data, headers: r.headers };
    };
    resolve({ ctx, base, dataDir, call, close: () => new Promise((k) => server.close(k)) });
  }));
}
const b64 = (s) => Buffer.from(s).toString('base64');
const FILES = [{ path: 'index.html', contentBase64: b64('<html><head><title>T</title></head><body><a href="#x">x</a></body></html>') }, { path: 'app.js', contentBase64: b64('console.log(1)') }];
// Redeems a personal link and returns the cookie for the resulting session.
async function redeem(v, link) {
  const r = await v.call('GET', link.replace(v.base, ''), null, {}, null);
  assert.equal(r.status, 302);
  const cookie = String(r.headers.get('set-cookie')).split(';')[0];
  assert.match(cookie, /^vs_/);
  return { Cookie: cookie };
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
  await again.close(); await v.close();
});

test('explicit ADMIN_TOKEN: no secrets file, binds all interfaces, rejects short tokens', async () => {
  const v = await boot({ ADMIN_TOKEN: 'x'.repeat(32) });
  assert.ok(!fs.existsSync(path.join(v.dataDir, 'local-secrets.json')));
  assert.equal(v.ctx.CONFIG.host, '0.0.0.0');
  assert.equal(v.ctx.blob.enabled, false);
  await v.close();
  assert.throws(() => createApp({ ADMIN_TOKEN: 'short', DATA_DIR: v.dataDir }), /24 characters/);
});

test('admin API needs a valid bearer token', async () => {
  const v = await boot();
  assert.equal((await v.call('GET', '/api/shares', null, {}, null)).status, 401);
  assert.equal((await v.call('GET', '/api/shares', null, {}, 'wrong-token-wrong-token-wrong')).status, 401);
  const ok = await v.call('GET', '/api/shares');
  assert.equal(ok.status, 200); assert.deepEqual(ok.data.shares, []);
  const auth = await v.call('GET', '/api/auth', null, {}, null);
  assert.equal(auth.data.serverToken, true);
  assert.equal(JSON.stringify(auth.data).includes(v.ctx.CONFIG.adminToken), false, 'auth info leaks no secret');
  await v.close();
});

test('share defaults: view only unless a test is asked for; voice off; unsafe paths rejected', async () => {
  const v = await boot();
  const plain = await v.call('POST', '/api/shares', { name: 'Plain', files: FILES });
  assert.equal(plain.status, 201); assert.equal(plain.data.share.mode, 'view'); assert.equal(plain.data.share.voice, false);
  const tested = await v.call('POST', '/api/shares', { name: 'Tested', tasks: ['Find the price'], files: FILES });
  assert.equal(tested.data.share.mode, 'unmoderated'); assert.equal(tested.data.share.tasks.length, 1);
  const forced = await v.call('POST', '/api/shares', { name: 'Forced', mode: 'view', tasks: ['Dropped'], voice: true });
  assert.equal(forced.data.share.mode, 'view'); assert.equal(forced.data.share.tasks.length, 0); assert.equal(forced.data.share.voice, false);
  const bad = await v.call('POST', '/api/shares', { name: 'Bad', files: [{ path: '../evil.html', contentBase64: b64('x') }] });
  assert.equal(bad.status, 400);
  assert.equal((await v.call('POST', '/api/shares', { name: '' })).status, 400);
  assert.equal((await v.call('POST', '/api/shares', { name: 'Nope', viewers: ['not-an-email'] })).status, 400);
  await v.close();
});

test('tester flow: redeem link, consent, events, feedback, results, prototype served with CSP', async () => {
  const v = await boot();
  const { data: { share } } = await v.call('POST', '/api/shares', { name: 'Checkout', tasks: ['Pick a plan'], viewers: ['Priya <priya@example.com>'], files: FILES });
  const link = share.viewers[0].link;
  assert.match(link, /\/p\/[A-Za-z0-9_-]+\?k=/);
  const id = share.id;
  // Nobody gets in without a link
  const anon = await v.call('GET', `/p/${id}`, null, {}, null);
  assert.equal(anon.status, 403); assert.match(anon.data, /Invitation required/);
  const cookie = await redeem(v, link);
  const shell = await v.call('GET', `/p/${id}`, null, cookie, null);
  assert.equal(shell.status, 200); assert.match(shell.data, /<title>Prototype<\/title>/);
  const meta = await v.call('GET', `/p/${id}/_vault/meta`, null, cookie, null);
  assert.equal(meta.data.viewer.email, 'priya@example.com'); assert.equal(meta.data.consent, null); assert.equal(meta.data.voice, false);
  // Before consent nothing is recorded
  assert.equal((await v.call('POST', `/p/${id}/_vault/events`, [{ t: 1, type: 'click', path: '/' }], cookie, null)).data.ok, 0);
  assert.equal((await v.call('POST', `/p/${id}/_vault/consent`, { accept: true }, cookie, null)).data.consent, true);
  assert.equal((await v.call('POST', `/p/${id}/_vault/events`, [{ t: 1, type: 'click', path: '/', data: { target: 'a' } }, { t: 2, type: 'pageview', path: '/' }], cookie, null)).data.ok, 2);
  assert.equal((await v.call('POST', `/p/${id}/_vault/feedback`, { kind: 'task', taskIndex: 0, result: 'done', text: 'easy' }, cookie, null)).status, 201);
  assert.equal((await v.call('POST', `/p/${id}/_vault/feedback`, { kind: 'feedback', text: 'Nice' }, cookie, null)).status, 201);
  // Cross-origin posts are refused
  assert.equal((await v.call('POST', `/p/${id}/_vault/feedback`, { text: 'x' }, { ...cookie, Origin: 'https://evil.example' }, null)).status, 403);
  // Voice is off for this share
  assert.equal((await v.call('POST', `/p/${id}/_vault/recording?seq=0`, 'abc', { ...cookie, 'Content-Type': 'audio/webm' }, null)).status, 403);
  // The prototype itself: tracker injected, egress locked down, traversal blocked
  const page = await v.call('GET', `/p/${id}/app/index.html`, null, cookie, null);
  assert.equal(page.status, 200); assert.match(page.data, /_vault\/tracker\.js/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self';/);
  assert.equal((await v.call('GET', `/p/${id}/app/..%2F..%2Fstore.json`, null, cookie, null)).status, 404);
  const tracker = await v.call('GET', `/p/${id}/_vault/tracker.js`, null, cookie, null);
  assert.match(tracker.data, /"record":true/);
  // Results
  const sum = await v.call('GET', `/api/shares/${id}/summary`);
  assert.equal(sum.data.eventCount, 2); assert.equal(sum.data.feedbackCount, 1); assert.equal(sum.data.tasks[0].done, 1);
  assert.equal(sum.data.viewers[0].email, 'priya@example.com'); assert.equal(sum.data.viewers[0].clicks, 1);
  const report = await v.call('GET', `/api/shares/${id}/report`);
  assert.match(report.data, /# Checkout/); assert.match(report.data, /Pick a plan \| 1 \| 0/); assert.match(report.data, /1 successful opens/);
  assert.match((await v.call('GET', `/api/shares/${id}/events?format=csv`)).data, /^ts,viewer,email/);
  // Revoking the viewer kills the link and the session
  const viewerId = share.viewers[0].id;
  assert.equal((await v.call('DELETE', `/api/shares/${id}/viewers/${viewerId}`)).status, 200);
  assert.equal((await v.call('GET', link.replace(v.base, ''), null, {}, null)).status, 403);
  assert.equal((await v.call('GET', `/p/${id}`, null, cookie, null)).status, 403);
  const audit = await v.call('GET', `/api/shares/${id}/audit`);
  assert.ok(audit.data.audit.some((a) => a.type === 'link.rejected'));
  assert.ok(audit.data.audit.some((a) => a.type === 'viewer.revoked'));
  await v.close();
});

test('view-only share records nothing and has no feedback', async () => {
  const v = await boot();
  const { data: { share } } = await v.call('POST', '/api/shares', { name: 'Review', viewers: ['tom@example.com'], files: FILES });
  const cookie = await redeem(v, share.viewers[0].link);
  const meta = await v.call('GET', `/p/${share.id}/_vault/meta`, null, cookie, null);
  assert.equal(meta.data.mode, 'view'); assert.equal(meta.data.recordSessions, false);
  assert.equal((await v.call('POST', `/p/${share.id}/_vault/feedback`, { text: 'x' }, cookie, null)).status, 403);
  assert.equal((await v.call('POST', `/p/${share.id}/_vault/events`, [{ type: 'click' }], cookie, null)).data.ok, 0);
  assert.equal((await v.call('GET', `/api/shares/${share.id}/summary`)).data.eventCount, 0);
  await v.close();
});

test('passcode, rotation, expiry and revocation', async () => {
  const v = await boot();
  const { data: { share } } = await v.call('POST', '/api/shares', { name: 'Locked', passcode: '4321', viewers: ['a@example.com'], files: FILES });
  const id = share.id;
  const cookie = await redeem(v, share.viewers[0].link);
  const gate = await v.call('GET', `/p/${id}`, null, cookie, null);
  assert.equal(gate.status, 200); assert.match(gate.data, /needs the passcode/);
  assert.equal((await v.call('GET', `/p/${id}/_vault/meta`, null, cookie, null)).status, 401);
  assert.equal((await v.call('POST', `/p/${id}/passcode`, 'passcode=0000', { ...cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, null)).status, 401);
  assert.equal((await v.call('POST', `/p/${id}/passcode`, 'passcode=4321', { ...cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, null)).status, 302);
  assert.match((await v.call('GET', `/p/${id}`, null, cookie, null)).data, /<title>Prototype<\/title>/);
  // Rotating a link invalidates the old one and the session
  const rot = await v.call('POST', `/api/shares/${id}/viewers/${share.viewers[0].id}/rotate`);
  assert.notEqual(rot.data.viewer.link, share.viewers[0].link);
  assert.equal((await v.call('GET', share.viewers[0].link.replace(v.base, ''), null, {}, null)).status, 403);
  assert.equal((await v.call('GET', `/p/${id}`, null, cookie, null)).status, 403);
  // Expiry in the past: links stop working with 410
  assert.equal((await v.call('PATCH', `/api/shares/${id}`, { expiresAt: new Date(Date.now() - 1000).toISOString() })).status, 200);
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
  assert.equal(made.status, 201); assert.match(made.data.token, /^pv_/);
  const me = await v.call('GET', '/api/me', null, {}, made.data.token);
  assert.equal(me.data.identity.kind, 'personal-token'); assert.equal(me.data.identity.who, 'admin-token');
  assert.equal(JSON.stringify(v.ctx.store.data.tokens).includes(made.data.token), false, 'token stored hashed');
  assert.equal((await v.call('DELETE', '/api/tokens/current', null, {}, made.data.token)).status, 200);
  assert.equal((await v.call('GET', '/api/me', null, {}, made.data.token)).status, 401);
  await v.close();
});

test('sample share publishes the bundled example with tasks', async () => {
  const v = await boot();
  const r = await v.call('POST', '/api/shares/sample', { viewer: 'me@example.com' });
  assert.equal(r.status, 201);
  assert.equal(r.data.share.mode, 'unmoderated'); assert.equal(r.data.share.tasks.length, 3); assert.equal(r.data.share.files.count, 1);
  assert.equal(r.data.share.viewers[0].email, 'me@example.com');
  const cookie = await redeem(v, r.data.share.viewers[0].link);
  assert.match((await v.call('GET', `/p/${r.data.share.id}/app/index.html`, null, cookie, null)).data, /Acme Billing/);
  await v.close();
});

test('SSO header admits allowed domains only when the proxy is trusted', async () => {
  const v = await boot({ ADMIN_TOKEN: 'y'.repeat(32), TRUST_PROXY: '1', TRUSTED_HEADER_EMAIL: 'x-forwarded-email', ADMIN_EMAILS: 'lead@corp.example' });
  const { data: { share } } = await v.call('POST', '/api/shares', { name: 'Internal', files: FILES, ssoAllow: { domains: ['corp.example'] } });
  assert.equal((await v.call('GET', `/p/${share.id}`, null, { 'x-forwarded-email': 'sam@corp.example' }, null)).status, 302);
  assert.equal((await v.call('GET', `/p/${share.id}`, null, { 'x-forwarded-email': 'sam@other.example' }, null)).status, 403);
  assert.equal((await v.call('GET', '/api/me', null, { 'x-forwarded-email': 'lead@corp.example' }, null)).data.identity.kind, 'sso');
  assert.equal((await v.call('GET', '/api/me', null, { 'x-forwarded-email': 'sam@corp.example' }, null)).status, 401);
  await v.close();
  const untrusted = await boot({ ADMIN_TOKEN: 'y'.repeat(32), TRUSTED_HEADER_EMAIL: 'x-forwarded-email', ADMIN_EMAILS: 'lead@corp.example' });
  assert.equal((await untrusted.call('GET', '/api/me', null, { 'x-forwarded-email': 'lead@corp.example' }, null)).status, 401, 'header ignored without TRUST_PROXY');
  await untrusted.close();
});
