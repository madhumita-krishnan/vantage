/* In-browser stand-in for the Vantage server, used by design/live-prototype/build.js.
 * The real console, tester shell and gate pages run unchanged against this: it answers the same routes with the same
 * JSON shapes, from seeded demo data that lives only in the page. Nothing here is served by the real server. */
/* global __RESULTS__ */
(function () {
  'use strict';
  const S = window.__SCREEN || { state: 'list' };
  const NOW = Date.now();
  const day = 86400e3;
  const iso = (t) => new Date(t).toISOString();
  const rid = () => Math.random().toString(36).slice(2, 10);
  const LATENCY = 120;

  // ---- the same small rules the server applies ----
  const TASK_KINDS = ['task', 'question'];
  const WHEN_TYPES = ['start', 'after', 'screen', 'minutes'];
  function normalizeTasks(tasks) {
    return (Array.isArray(tasks) ? tasks : [])
      .map((t) => {
        if (typeof t === 'string') t = { text: t };
        const text = String((t && t.text) || '')
          .trim()
          .slice(0, 300);
        if (!text) return null;
        const w = t.when && typeof t.when === 'object' ? t.when : { type: 'start' };
        const type = WHEN_TYPES.includes(w.type) ? w.type : 'start';
        const value =
          type === 'after'
            ? Math.max(0, Math.min(+w.value || 0, 49))
            : type === 'minutes'
              ? Math.max(0, Math.min(+w.value || 0, 600))
              : type === 'screen'
                ? String(w.value || '')
                    .trim()
                    .slice(0, 200)
                : null;
        return { text, kind: TASK_KINDS.includes(t.kind) ? t.kind : 'task', when: { type, value } };
      })
      .filter(Boolean)
      .slice(0, 50);
  }
  const shareStatus = (s) => (s.revoked ? 'revoked' : s.expiresAt <= Date.now() ? 'expired' : 'active');
  function applyMode(share) {
    if (share.voice || share.screen) share.requireConsent = true;
    if (share.mode === 'view')
      Object.assign(share, { recordSessions: false, recordText: false, voice: false, screen: false, showTasks: false, tasks: [] });
  }
  function parseViewerSpec(spec) {
    if (spec && typeof spec === 'object') return { name: String(spec.name || '').trim(), email: String(spec.email || '').trim().toLowerCase() };
    const m = String(spec || '')
      .trim()
      .match(/^(.*?)\s*<([^>]+)>$/);
    return m
      ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim().toLowerCase() }
      : { name: '', email: String(spec || '').trim().toLowerCase() };
  }
  const R = __RESULTS__({ normalizeTasks, shareStatus }); // the server's own results.js

  // ---- demo data ----
  const ME = 'mira@lumen.design';
  const BASE = 'https://prototypes.lumen.design';
  const viewer = (id, name, email, opens, seenAgo, extra) => ({
    id,
    name,
    email,
    createdAt: NOW - 6 * day,
    revoked: false,
    opens,
    maxOpens: 0,
    lastSeenAt: seenAgo == null ? null : NOW - seenAgo,
    source: 'invite',
    ...extra,
  });
  const CHECKOUT_TASKS = [
    { text: 'Choose the Team plan, billed annually', kind: 'task', when: { type: 'start', value: null } },
    { text: 'Add a team member', kind: 'task', when: { type: 'after', value: 0 } },
    { text: 'What would you change about the billing address step?', kind: 'question', when: { type: 'screen', value: '#billing' } },
    { text: 'Anything else you noticed?', kind: 'question', when: { type: 'minutes', value: 5 } },
  ];
  const shares = {};
  const feedback = {};
  const events = {};
  const audit = {};
  function mkShare(s) {
    const share = {
      createdAt: NOW - 6 * day,
      expiresAt: NOW + 8 * day,
      revoked: false,
      createdBy: ME,
      mode: 'unmoderated',
      passcode: null,
      watermark: true,
      recordSessions: true,
      requireConsent: true,
      tasks: [],
      showTasks: true,
      voice: false,
      screen: false,
      requireSignIn: false,
      recordText: false,
      recordings: {},
      notes: '',
      externalOrigins: [],
      ssoAllow: { emails: [], domains: [] },
      viewers: {},
      entry: 'index.html',
      files: { count: 14, bytes: 412_000, paths: ['index.html', 'plans.html', 'team.html', 'billing.html', 'css/app.css', 'js/app.js', 'js/plans.js', 'img/logo.svg', 'img/plan-starter.png', 'img/plan-team.png', 'img/plan-annual.png', 'fonts/inter.woff2', 'fonts/inter-medium.woff2', 'vendor/tailwind.js'] },
      intro: { kind: 'default', text: '', media: null, subtitles: [] },
      ...s,
    };
    applyMode(share);
    shares[share.id] = share;
    feedback[share.id] = feedback[share.id] || [];
    events[share.id] = events[share.id] || [];
    audit[share.id] = audit[share.id] || [];
    return share;
  }
  const checkout = mkShare({
    id: 'Qm4xT9vLp2Kd',
    name: 'Checkout redesign v3',
    tasks: CHECKOUT_TASKS,
    passcode: { hash: 'demo' },
    voice: true,
    screen: true,
    notes: 'Round 2 with the three people who struggled with the plan picker in round 1. Watch the annual toggle.',
    intro: {
      kind: 'text',
      text: 'Thanks for helping us test the new checkout. There are no right or wrong answers; we are testing the design, not you.\n\n- Say what you are thinking as you go\n- If something is confusing, that is **useful**, tell us\n- It takes about ten minutes',
      media: null,
      subtitles: [],
    },
    viewers: {
      v1: viewer('v1', 'Priya Shah', 'priya@customer.com', 3, 2 * 3600e3),
      v2: viewer('v2', 'Tom Reyes', 'tom@partner.org', 1, 26 * 3600e3),
      v3: viewer('v3', 'Lena Okafor', 'lena@lumen.design', 0, null),
      v4: viewer('v4', 'Sam Field', 'sam@oldagency.com', 2, 4 * day, { revoked: true }),
    },
    recordings: {
      s1: { viewerId: 'v1', mime: 'audio/webm', size: 1_843_200, segments: 12, startedAt: NOW - 2 * 3600e3 - 600e3, updatedAt: NOW - 2 * 3600e3 },
      s3: { viewerId: 'v2', mime: 'video/webm', size: 38_400_000, segments: 84, startedAt: NOW - 26 * 3600e3, updatedAt: NOW - 25 * 3600e3 },
    },
  });
  const onboarding = mkShare({
    id: 'Hb7nR2wQx5Ae',
    name: 'Onboarding flow, round 2',
    mode: 'moderated',
    showTasks: false,
    tasks: [
      { text: 'Create a workspace and invite one colleague', kind: 'task', when: { type: 'start', value: null } },
      { text: 'Where would you go to change the workspace name?', kind: 'question', when: { type: 'start', value: null } },
    ],
    createdAt: NOW - 2 * day,
    expiresAt: NOW + 12 * day,
    notes: 'Sessions on Thursday 10:00 and 14:00 with Dana.',
    files: { count: 9, bytes: 268_000, paths: ['index.html', 'workspace.html', 'invite.html', 'css/app.css', 'js/app.js', 'img/logo.svg', 'img/empty.svg', 'fonts/inter.woff2', 'vendor/tailwind.js'] },
    viewers: { v5: viewer('v5', 'Dana Whitfield', 'dana@customer.com', 0, null), v6: viewer('v6', 'Arun Mehta', 'arun@customer.com', 0, null) },
  });
  const pricing = mkShare({
    id: 'Zt3kW8mNc1Yf',
    name: 'Pricing page handoff',
    mode: 'view',
    createdAt: NOW - 1 * day,
    expiresAt: NOW + 29 * day,
    files: { count: 5, bytes: 96_000, paths: ['index.html', 'css/app.css', 'img/hero.png', 'img/logo.svg', 'fonts/inter.woff2'] },
    viewers: { v7: viewer('v7', 'Jules Barr', 'jules@lumen.design', 4, 30 * 60e3), v8: viewer('v8', 'Noor Haddad', 'noor@lumen.design', 1, 5 * 3600e3) },
  });
  mkShare({
    id: 'Pw9cD4sEj6Lo',
    name: 'Dashboard concept, round 1',
    createdAt: NOW - 40 * day,
    expiresAt: NOW - 12 * day,
    tasks: [{ text: 'Find last month’s revenue', kind: 'task', when: { type: 'start', value: null } }],
    viewers: { v9: viewer('v9', 'Priya Shah', 'priya@customer.com', 2, 30 * day) },
  });
  mkShare({
    id: 'Xn2vB6hKq8Rt',
    name: 'Investor demo (do not forward)',
    mode: 'view',
    revoked: true,
    createdAt: NOW - 20 * day,
    expiresAt: NOW + 10 * day,
    passcode: { hash: 'demo' },
    viewers: { v10: viewer('v10', 'Ines Moreau', 'ines@capital.example', 6, 9 * day) },
  });

  // Results for the checkout test: events, feedback, audit.
  const ev = (share, viewerId, session, t, type, path, data, ago) => {
    const v = share.viewers[viewerId];
    events[share.id].push({ ts: iso(NOW - ago + t), viewer: v.name, email: v.email, session, t, type, path, data: data || {} });
  };
  const priyaAgo = 2 * 3600e3 + 600e3;
  [
    [0, 'pageview', 'index.html', { title: 'Acme Billing', w: 1440, h: 900 }],
    [4200, 'click', 'index.html', { target: 'div.plan "Team"', x: 51.2, y: 44.0 }],
    [6900, 'click', 'index.html', { target: 'div.plan "Annual"', x: 78.4, y: 44.1 }],
    [9100, 'custom:plan_selected', 'index.html', { plan: 'Annual' }],
    [12800, 'click', 'index.html', { target: 'button#continue "Continue"', x: 34.5, y: 58.2 }],
    [12900, 'navigate', 'index.html#team', { title: 'Acme Billing', how: 'hash' }],
    [15200, 'click', 'index.html#team', { target: 'button#addMember "Add member"', x: 31.0, y: 47.7 }],
    [17800, 'focus', 'index.html#team', { target: 'input[text] "Full name"' }],
    [24100, 'focus', 'index.html#team', { target: 'input[text] "Work email"' }],
    [30400, 'click', 'index.html#team', { target: 'button#saveMember "Send invite"', x: 33.2, y: 62.5 }],
    [30500, 'custom:member_added', 'index.html#team', {}],
    [41000, 'click', 'index.html#team', { target: 'a "Billing address"', x: 22.1, y: 3.2 }],
    [41100, 'navigate', 'index.html#billing', { title: 'Acme Billing', how: 'hash' }],
    [52000, 'scroll', 'index.html#billing', { depth: 100 }],
    [58300, 'error', 'index.html#billing', { message: 'Cannot read properties of undefined (reading "postal")' }],
  ].forEach(([t, type, path, data]) => ev(checkout, 'v1', 's1', t, type, path, data, priyaAgo));
  const tomAgo = 26 * 3600e3;
  [
    [0, 'pageview', 'index.html', { title: 'Acme Billing', w: 1280, h: 720 }],
    [3100, 'click', 'index.html', { target: 'div.plan "Starter"', x: 18.7, y: 44.3 }],
    [5500, 'click', 'index.html', { target: 'div.plan "Team"', x: 51.0, y: 44.0 }],
    [8000, 'click', 'index.html', { target: 'button#continue "Continue"', x: 34.5, y: 58.2 }],
    [8100, 'navigate', 'index.html#team', { title: 'Acme Billing', how: 'hash' }],
    [19400, 'click', 'index.html#team', { target: 'a "Plans"', x: 12.0, y: 3.1 }],
    [19500, 'navigate', 'index.html#plans', { title: 'Acme Billing', how: 'hash' }],
    [26000, 'click', 'index.html#plans', { target: 'div.plan "Annual"', x: 78.0, y: 44.0 }],
  ].forEach(([t, type, path, data]) => ev(checkout, 'v2', 's3', t, type, path, data, tomAgo));
  feedback[checkout.id].push(
    { ts: iso(NOW - priyaAgo + 13000), kind: 'task', viewer: 'Priya Shah', email: 'priya@customer.com', session: 's1', text: 'The annual toggle looked disabled until I hovered it.', location: 'index.html#team', taskIndex: 0, result: 'done' },
    { ts: iso(NOW - priyaAgo + 31000), kind: 'task', viewer: 'Priya Shah', email: 'priya@customer.com', session: 's1', text: '', location: 'index.html#team', taskIndex: 1, result: 'done' },
    { ts: iso(NOW - priyaAgo + 60000), kind: 'task', viewer: 'Priya Shah', email: 'priya@customer.com', session: 's1', text: 'Put the postal code before the city, that is how I think of my address. Also the Save button jumped when the error appeared.', location: 'index.html#billing', taskIndex: 2, result: 'answer' },
    { ts: iso(NOW - priyaAgo + 64000), kind: 'feedback', viewer: 'Priya Shah', email: 'priya@customer.com', session: 's1', text: 'Something broke on the billing screen after I typed the postal code, the page showed an error in the corner.', location: 'index.html#billing' },
    { ts: iso(NOW - tomAgo + 9000), kind: 'task', viewer: 'Tom Reyes', email: 'tom@partner.org', session: 's3', text: 'Went for Team first, did not see the annual option until later.', location: 'index.html#team', taskIndex: 0, result: 'done' },
    { ts: iso(NOW - tomAgo + 27000), kind: 'task', viewer: 'Tom Reyes', email: 'tom@partner.org', session: 's3', text: 'Could not find where to add someone. Went back to plans.', location: 'index.html#plans', taskIndex: 1, result: 'stuck' },
    { ts: iso(NOW - 90 * 60e3), kind: 'note', by: ME, viewer: 'Tom Reyes', email: 'tom@partner.org', session: 's3', text: 'Tom expected "Add member" on the plans screen, next to the seat count.', location: '' }
  );
  const au = (share, ago, type, extra) => audit[share.id].push({ ts: iso(NOW - ago), type, shareId: share.id, ip: extra.ip || '203.0.113.42', ua: 'Mozilla/5.0 (Macintosh) Safari/17', ...extra });
  au(checkout, 6 * day, 'share.created', { by: ME, name: checkout.name, viewers: 3, ip: '198.51.100.7' });
  au(checkout, 4 * day + 3600e3, 'link.redeemed', { email: 'sam@oldagency.com', viewerId: 'v4', ip: '192.0.2.88' });
  au(checkout, 4 * day, 'view.open', { email: 'sam@oldagency.com', viewerId: 'v4', session: 's0', ip: '192.0.2.88' });
  au(checkout, 3 * day, 'viewer.revoked', { by: ME, email: 'sam@oldagency.com', ip: '198.51.100.7' });
  au(checkout, tomAgo + 30e3, 'link.redeemed', { email: 'tom@partner.org', viewerId: 'v2', ip: '203.0.113.9' });
  au(checkout, tomAgo + 25e3, 'passcode.ok', { email: 'tom@partner.org', ip: '203.0.113.9' });
  au(checkout, tomAgo + 20e3, 'consent', { email: 'tom@partner.org', accepted: true, ip: '203.0.113.9' });
  au(checkout, tomAgo, 'screen.started', { email: 'tom@partner.org', session: 's3', ip: '203.0.113.9' });
  au(checkout, tomAgo - 9e3, 'task.result', { email: 'tom@partner.org', session: 's3', taskIndex: 0, result: 'done', ip: '203.0.113.9' });
  au(checkout, 5 * 3600e3, 'link.rejected', { reason: 'bad_token', ip: '198.51.100.201' });
  au(checkout, 5 * 3600e3 - 40e3, 'link.rejected', { reason: 'bad_token', ip: '198.51.100.201' });
  au(checkout, priyaAgo + 40e3, 'link.redeemed', { email: 'priya@customer.com', viewerId: 'v1' });
  au(checkout, priyaAgo + 30e3, 'passcode.fail', { email: 'priya@customer.com' });
  au(checkout, priyaAgo + 22e3, 'passcode.ok', { email: 'priya@customer.com' });
  au(checkout, priyaAgo + 15e3, 'consent', { email: 'priya@customer.com', accepted: true });
  au(checkout, priyaAgo + 14e3, 'voice.started', { email: 'priya@customer.com', session: 's1' });
  au(checkout, priyaAgo - 64e3, 'feedback', { email: 'priya@customer.com', session: 's1' });
  au(pricing, 30 * 60e3, 'view.open', { email: 'jules@lumen.design', viewerId: 'v7', session: 's9' });
  au(onboarding, 2 * day, 'share.created', { by: ME, name: onboarding.name, viewers: 2, ip: '198.51.100.7' });

  const tokens = [
    { id: 'tk1', name: 'Claude Code on my laptop', owner: ME, prefix: 'pv_8f2K', createdAt: NOW - 9 * day, createdBy: ME, lastUsedAt: NOW - 3 * 3600e3, revokedAt: null },
    { id: 'tk2', name: 'CLI on the studio Mac mini', owner: ME, prefix: 'pv_Qw41', createdAt: NOW - 30 * day, createdBy: ME, lastUsedAt: NOW - 20 * day, revokedAt: NOW - 11 * day },
  ];
  const adminLog = [
    { ts: iso(NOW - 45 * 60e3), type: 'admin.signin', email: ME, ip: '198.51.100.7' },
    { ts: iso(NOW - 2 * day), type: 'share.created', by: ME, name: onboarding.name, ip: '198.51.100.7' },
    { ts: iso(NOW - 3 * day), type: 'share.revoked', by: ME, name: 'Investor demo (do not forward)', ip: '198.51.100.7' },
    { ts: iso(NOW - 6 * day), type: 'share.created', by: ME, name: checkout.name, ip: '198.51.100.7' },
    { ts: iso(NOW - 9 * day), type: 'token.created', by: ME, name: 'Claude Code on my laptop', ip: '198.51.100.7' },
    { ts: iso(NOW - 11 * day), type: 'token.revoked', by: ME, name: 'CLI on the studio Mac mini', ip: '198.51.100.7' },
    { ts: iso(NOW - 12 * day), type: 'admin.unauthorized', path: '/api/shares', ip: '203.0.113.250' },
  ];
  let signedIn = S.state !== 'signin';
  const link = (share, v) => `${BASE}/p/${share.id}#k=${rid()}${rid()}${rid()}${rid()}`;
  if (S.state === 'empty') for (const k of Object.keys(shares)) delete shares[k];

  // ---- views, as the server shapes them ----
  const viewerView = (share, v, l) => {
    const out = { id: v.id, name: v.name, email: v.email, createdAt: iso(v.createdAt), revoked: !!v.revoked, opens: v.opens || 0, maxOpens: v.maxOpens || 0, lastSeenAt: v.lastSeenAt ? iso(v.lastSeenAt) : null, source: v.source || 'invite' };
    if (l) out.link = l;
    return out;
  };
  function shareView(share, full, links = {}) {
    const viewers = Object.values(share.viewers);
    const out = {
      id: share.id,
      name: share.name,
      status: shareStatus(share),
      createdAt: iso(share.createdAt),
      expiresAt: iso(share.expiresAt),
      revoked: !!share.revoked,
      hasPasscode: !!share.passcode,
      watermark: share.watermark,
      recordSessions: share.recordSessions,
      requireConsent: share.requireConsent,
      tasks: normalizeTasks(share.tasks),
      entry: share.entry,
      notes: share.notes || '',
      showTasks: share.showTasks !== false,
      voice: !!share.voice,
      screen: !!share.screen,
      requireSignIn: !!share.requireSignIn,
      recordText: !!share.recordText,
      recordings: Object.entries(share.recordings || {}).map(([sid, r]) => ({ session: sid, viewerId: r.viewerId, viewer: (share.viewers[r.viewerId] || {}).name, email: (share.viewers[r.viewerId] || {}).email, mime: r.mime, size: r.size, segments: r.segments, startedAt: iso(r.startedAt), updatedAt: iso(r.updatedAt) })),
      externalOrigins: share.externalOrigins,
      ssoAllow: share.ssoAllow,
      files: share.files ? { count: share.files.count, bytes: share.files.bytes } : null,
      mode: share.mode,
      intro: { ...share.intro, subtitles: share.intro.subtitles || [] },
      viewerCount: viewers.filter((v) => !v.revoked).length,
      totalOpens: viewers.reduce((a, v) => a + (v.opens || 0), 0),
      url: `${BASE}/p/${share.id}`,
      createdBy: share.createdBy,
    };
    if (full) {
      out.viewers = viewers.map((v) => viewerView(share, v, links[v.id]));
      out.filePaths = share.files ? share.files.paths : [];
    }
    return out;
  }
  const me = () => ({
    ok: true,
    admin: ME,
    mine: { shares: Object.keys(shares).length, tokens: tokens.filter((t) => !t.revokedAt).length, limits: { shares: 25, storageMb: 500 } },
    identity: { kind: 'google', who: ME, tokenId: null, label: 'Google sign-in' },
    server: { encryptionAtRest: true, sso: false, publicUrl: BASE, contentOrigin: 'https://*.content.lumen.design', allowedExternalOrigins: [], defaultExpiryDays: 7, maxExpiryDays: 365, maxUploadMb: 25, maxMediaMb: 200, mediaTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/aac'], retentionDays: 30, sessionHours: 8, ssoLogoutUrl: null, serverToken: false, google: true, quickstart: false, mcpPath: null, version: '0.3.1' },
  });
  function addViewer(share, spec) {
    const { name, email } = parseViewerSpec(spec);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw { status: 400, error: `Invalid viewer email: ${email || '(empty)'}` };
    const existing = Object.values(share.viewers).find((v) => v.email === email && !v.revoked);
    if (existing) return existing;
    const v = { id: 'v' + rid().slice(0, 4), name: name || email.split('@')[0], email, createdAt: NOW, revoked: false, opens: 0, maxOpens: 0, lastSeenAt: null, source: 'invite' };
    share.viewers[v.id] = v;
    return v;
  }
  function createShare(b) {
    const name = String(b.name || '').trim();
    if (!name) throw { status: 400, error: 'name is required' };
    if (b.passcode && String(b.passcode).length < 6) throw { status: 400, error: 'passcode must be at least 6 characters' };
    const tasks = normalizeTasks(b.tasks);
    const files = Array.isArray(b.files) && b.files.length ? b.files : null;
    const share = mkShare({
      id: rid().slice(0, 6) + rid().slice(0, 6),
      name,
      createdAt: NOW,
      expiresAt: NOW + Math.min(+(b.expiresInDays || 7), 365) * day,
      mode: ['view', 'unmoderated', 'moderated'].includes(b.mode) ? b.mode : tasks.length ? 'unmoderated' : 'view',
      passcode: b.passcode ? { hash: 'x' } : null,
      watermark: b.watermark !== false,
      recordSessions: b.recordSessions !== false,
      requireConsent: b.requireConsent !== false,
      tasks,
      showTasks: b.showTasks != null ? !!b.showTasks : b.mode !== 'moderated',
      voice: !!b.voice,
      screen: !!b.screen,
      requireSignIn: !!b.requireSignIn,
      recordText: !!b.recordText,
      notes: String(b.notes || '').slice(0, 2000),
      entry: files ? b.entry || (files.find((f) => /(^|\/)index\.html$/.test(f.path)) || files[0]).path : null,
      files: files ? { count: files.length, bytes: files.reduce((a, f) => a + Math.round((f.contentBase64 || '').length * 0.75), 0), paths: files.map((f) => f.path) } : null,
      intro: { kind: b.intro && b.intro.kind !== 'default' && b.intro.text ? b.intro.kind : 'default', text: (b.intro && b.intro.text) || '', media: null, subtitles: [] },
    });
    const links = {};
    for (const spec of Array.isArray(b.viewers) ? b.viewers : String(b.viewers || '').split(',').filter(Boolean)) {
      const v = addViewer(share, spec);
      links[v.id] = link(share, v);
    }
    audit[share.id].push({ ts: iso(NOW), type: 'share.created', shareId: share.id, ip: '198.51.100.7', by: ME, name, viewers: Object.keys(share.viewers).length });
    adminLog.unshift({ ts: iso(NOW), type: 'share.created', by: ME, name, ip: '198.51.100.7' });
    return { share, links };
  }
  function updateShare(share, b) {
    if (b.name != null) share.name = String(b.name).trim();
    if (b.revoked != null) share.revoked = !!b.revoked;
    if (b.expiresAt != null) share.expiresAt = Date.parse(b.expiresAt);
    if (b.extendDays != null) share.expiresAt = Math.max(share.expiresAt, NOW) + +b.extendDays * day;
    if (b.tasks != null) share.tasks = normalizeTasks(b.tasks);
    for (const k of ['showTasks', 'screen', 'recordText', 'voice', 'watermark', 'recordSessions', 'requireConsent', 'requireSignIn']) if (b[k] != null) share[k] = !!b[k];
    if (b.notes != null) share.notes = String(b.notes);
    if (b.mode != null) share.mode = b.mode;
    if (b.intro != null) share.intro = { ...share.intro, kind: ['default', 'text', 'audio', 'video'].includes(b.intro.kind) ? b.intro.kind : share.intro.kind, text: b.intro.text != null ? String(b.intro.text) : share.intro.text };
    if ((share.intro.kind === 'audio' || share.intro.kind === 'video') && !share.intro.media) share.intro.kind = share.intro.text ? 'text' : 'default';
    if (b.passcode !== undefined) {
      if (b.passcode && String(b.passcode).length < 6) throw { status: 400, error: 'passcode must be at least 6 characters' };
      share.passcode = b.passcode ? { hash: 'x' } : null;
    }
    if (b.ssoAllow != null) share.ssoAllow = b.ssoAllow;
    applyMode(share);
    audit[share.id].push({ ts: iso(Date.now()), type: b.revoked ? 'share.revoked' : 'share.updated', shareId: share.id, ip: '198.51.100.7', by: ME });
  }

  // ---- a microphone and a screen that exist only in the page ----
  // The tester page asks for a real microphone and screen; here it gets a synthesised voice-like tone and a drawn
  // screen, so "Record my session" records, the level meter moves, and a recording plays back and downloads.
  function synthAudio() {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ac.createMediaStreamDestination();
    const osc = ac.createOscillator(),
      g = ac.createGain(),
      lfo = ac.createOscillator(),
      lg = ac.createGain();
    osc.type = 'sawtooth'; // harmonics up the spectrum, where the level meter looks
    osc.frequency.value = 180;
    g.gain.value = 0.1;
    lfo.frequency.value = 2.7;
    lg.gain.value = 0.09;
    lfo.connect(lg).connect(g.gain);
    const vib = ac.createOscillator(),
      vg = ac.createGain();
    vib.frequency.value = 0.8;
    vg.gain.value = 40;
    vib.connect(vg).connect(osc.frequency);
    osc.connect(g).connect(dest);
    osc.start();
    lfo.start();
    vib.start();
    if (ac.state === 'suspended') ac.resume();
    const track = dest.stream.getAudioTracks()[0];
    const stop = () => {
      try {
        osc.stop();
        lfo.stop();
        ac.close();
      } catch {
        /* already closed */
      }
    };
    track.addEventListener('ended', stop);
    return { track, stop };
  }
  function synthScreen() {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const x = c.getContext('2d');
    let f = 0;
    const draw = () => {
      x.fillStyle = '#111827';
      x.fillRect(0, 0, 640, 360);
      x.fillStyle = '#fff';
      x.font = '600 26px -apple-system, Segoe UI, sans-serif';
      x.fillText('Acme Billing (screen recording, demo)', 36, 110);
      x.fillStyle = '#60a5fa';
      x.fillRect(36, 150, (f * 9) % 560, 10);
      f++;
    };
    draw();
    const iv = setInterval(draw, 100);
    const track = c.captureStream(10).getVideoTracks()[0];
    track.addEventListener('ended', () => clearInterval(iv));
    return { track, stop: () => clearInterval(iv) };
  }
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = async () => new MediaStream([synthAudio().track]);
    navigator.mediaDevices.getDisplayMedia = async () => new MediaStream([synthScreen().track]);
  }
  // The recordings listed on the results tab: a real two-second WebM, made once per kind when first played.
  const recBlobs = {};
  async function recordingBlob(video) {
    const key = video ? 'v' : 'a';
    if (recBlobs[key]) return recBlobs[key];
    const a = synthAudio();
    const parts = [a];
    if (video) parts.unshift(synthScreen());
    const mr = new MediaRecorder(new MediaStream(parts.map((p) => p.track)));
    const chunks = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((k) => (mr.onstop = k));
    mr.start();
    await wait(2500);
    mr.stop();
    await stopped;
    parts.forEach((p) => p.stop());
    return (recBlobs[key] = new Blob(chunks, { type: (mr.mimeType || (video ? 'video/webm' : 'audio/webm')).split(';')[0] }));
  }

  // Dialogs the console uses before anything destructive. A host that blocks native dialogs would make those buttons
  // do nothing, so here they confirm with a toast and go ahead: nothing in the demo is real.
  const say = (m, ms) => (typeof toast === 'function' ? toast(m, ms) : console.log(m)); // eslint-disable-line no-undef
  window.confirm = (m) => {
    say('Demo: went ahead. ' + m, 2500);
    return true;
  };
  window.alert = (m) => say(String(m), 5000);

  // ---- routing ----
  const json = (status, obj) => ({ status, body: JSON.stringify(obj), type: 'application/json; charset=utf-8' });
  const text = (status, body, type) => ({ status, body, type });
  function adminRoute(method, p, q, body) {
    if (!signedIn) return json(401, { error: 'Unauthorized' });
    if (p === '/me') return json(200, me());
    if (p === '/me/leave') {
      const n = Object.keys(shares).length;
      for (const k of Object.keys(shares)) delete shares[k];
      const t = tokens.filter((x) => !x.revokedAt).length;
      tokens.forEach((x) => (x.revokedAt = x.revokedAt || Date.now()));
      signedIn = false;
      return json(200, { ok: true, shares: n, tokens: t, sso: false });
    }
    if (p === '/logout') {
      signedIn = false;
      return json(200, { ok: true });
    }
    let m = p.match(/^\/tokens(?:\/([\w-]+))?$/);
    if (m) {
      const tv = (t) => ({ ...t, createdAt: iso(t.createdAt), lastUsedAt: t.lastUsedAt ? iso(t.lastUsedAt) : null, revokedAt: t.revokedAt ? iso(t.revokedAt) : null, current: false });
      if (!m[1] && method === 'GET') return json(200, { tokens: tokens.map(tv) });
      if (!m[1] && method === 'POST') {
        const name = String(body.name || '').trim().slice(0, 60);
        if (!name) return json(400, { error: 'name is required (for example "Claude Code on my laptop")' });
        const raw = 'pv_' + rid() + rid() + rid() + rid();
        const t = { id: 'tk' + rid().slice(0, 4), name, owner: ME, prefix: raw.slice(0, 7), createdAt: Date.now(), createdBy: ME, lastUsedAt: null, revokedAt: null };
        tokens.unshift(t);
        adminLog.unshift({ ts: iso(Date.now()), type: 'token.created', by: ME, name, ip: '198.51.100.7' });
        return json(201, { token: raw, item: tv(t) });
      }
      if (m[1] && method === 'DELETE') {
        const t = tokens.find((x) => x.id === m[1]);
        if (!t) return json(404, { error: 'Token not found' });
        t.revokedAt = t.revokedAt || Date.now();
        adminLog.unshift({ ts: iso(Date.now()), type: 'token.revoked', by: ME, name: t.name, ip: '198.51.100.7' });
        return json(200, { item: tv(t) });
      }
    }
    if (p === '/activity') return json(200, { activity: adminLog });
    if (p === '/shares' && method === 'GET')
      return json(200, { shares: Object.values(shares).sort((a, b) => b.createdAt - a.createdAt).map((s) => shareView(s, false)) });
    if (p === '/shares' && method === 'POST') {
      const { share, links } = createShare(body);
      return json(201, { share: shareView(share, true, links) });
    }
    if (p === '/shares/sample' && method === 'POST') {
      const { share, links } = createShare({ name: 'Sample: Acme Billing', viewers: body.viewer ? [String(body.viewer)] : [], expiresInDays: 7, files: [{ path: 'index.html', contentBase64: 'x'.repeat(5400) }], entry: 'index.html', mode: 'unmoderated', tasks: CHECKOUT_TASKS.slice(0, 3), notes: 'The example prototype that ships with Vantage. Open your own link to see the tester side, then delete this whenever you like.' });
      return json(201, { share: shareView(share, true, links) });
    }
    m = p.match(/^\/shares\/([\w-]+)(?:\/(bundle|viewers|audit|events|feedback|summary|intro|notes|report|subtitles|recordings))?(?:\/([\w-]+))?(?:\/(rotate))?$/);
    if (!m) return json(404, { error: 'Unknown API route' });
    const share = shares[m[1]];
    if (!share) return json(404, { error: 'Share not found' });
    const [, , sub, subId, action] = m;
    const view = () => json(200, { share: shareView(share, true) });
    if (!sub) {
      if (method === 'GET') return view();
      if (method === 'PATCH') {
        updateShare(share, body);
        return view();
      }
      if (method === 'DELETE') {
        delete shares[share.id];
        adminLog.unshift({ ts: iso(Date.now()), type: 'share.deleted', by: ME, name: share.name, ip: '198.51.100.7' });
        return json(200, { ok: true });
      }
    }
    if (sub === 'bundle') {
      const files = body.files || [];
      if (!files.length) return json(400, { error: 'Bundle contains no files' });
      share.files = { count: files.length, bytes: files.reduce((a, f) => a + Math.round((f.contentBase64 || '').length * 0.75), 0), paths: files.map((f) => f.path.replace(/^[^/]+\//, '')) };
      share.entry = share.files.paths.find((x) => /(^|\/)index\.html$/.test(x)) || share.files.paths.find((x) => /\.html?$/.test(x)) || null;
      if (!share.entry) return json(400, { error: 'Bundle has no .html file to open' });
      audit[share.id].push({ ts: iso(Date.now()), type: 'bundle.replaced', shareId: share.id, ip: '198.51.100.7', by: ME, files: share.files.count, bytes: share.files.bytes });
      return view();
    }
    if (sub === 'viewers') {
      if (method === 'POST' && !subId) {
        try {
          const added = (Array.isArray(body.viewers) ? body.viewers : [body]).map((s) => addViewer(share, s));
          audit[share.id].push({ ts: iso(Date.now()), type: 'viewer.added', shareId: share.id, ip: '198.51.100.7', by: ME, emails: added.map((v) => v.email) });
          return json(201, { viewers: added.map((v) => viewerView(share, v, v.lastSeenAt || v.opens ? undefined : link(share, v))) });
        } catch (e) {
          return json(e.status || 500, { error: e.error || 'Internal error' });
        }
      }
      const v = share.viewers[subId];
      if (!v) return json(404, { error: 'Viewer not found' });
      if (action === 'rotate') {
        audit[share.id].push({ ts: iso(Date.now()), type: 'viewer.link_rotated', shareId: share.id, ip: '198.51.100.7', by: ME, email: v.email });
        return json(200, { viewer: viewerView(share, v, link(share, v)) });
      }
      if (method === 'DELETE') {
        v.revoked = true;
        audit[share.id].push({ ts: iso(Date.now()), type: 'viewer.revoked', shareId: share.id, ip: '198.51.100.7', by: ME, email: v.email });
        return json(200, { viewer: viewerView(share, v) });
      }
    }
    if (sub === 'intro') {
      if (method === 'DELETE') {
        share.intro = { ...share.intro, kind: share.intro.text ? 'text' : 'default', media: null, subtitles: [] };
        return view();
      }
      return view(); // uploads are answered by the XHR stand-in below
    }
    if (sub === 'subtitles' && subId) {
      share.intro.subtitles = (share.intro.subtitles || []).filter((x) => x.lang !== subId);
      if (method !== 'DELETE') share.intro.subtitles.push({ lang: subId, label: q.label || subId, size: 1200 });
      return view();
    }
    if (sub === 'recordings') {
      if (method === 'GET' && !subId) return json(200, { recordings: shareView(share, true).recordings });
      if (method === 'GET') {
        const rec = share.recordings[subId];
        if (!rec) return json(404, { error: 'Recording not found' });
        return { status: 200, blob: recordingBlob(rec.mime.startsWith('video/')) };
      }
      if (method === 'DELETE') {
        delete share.recordings[subId];
        return json(200, { ok: true });
      }
    }
    if (sub === 'notes' && method === 'POST') {
      const v = body.viewerId ? share.viewers[body.viewerId] : null;
      const rec = { ts: iso(Date.now()), kind: 'note', by: ME, viewer: v ? v.name : '', email: v ? v.email : '', session: '', text: String(body.text || ''), location: '' };
      if (!rec.text) return json(400, { error: 'text is required' });
      feedback[share.id].push(rec);
      return json(201, { note: rec });
    }
    const fb = feedback[share.id],
      rows = events[share.id],
      al = audit[share.id];
    if (sub === 'audit') return json(200, { audit: al });
    if (sub === 'feedback') return json(200, { feedback: fb });
    if (sub === 'summary') return json(200, R.summary(share, fb, rows));
    if (sub === 'events') return q.format === 'csv' ? text(200, R.eventsCsv(rows), 'text/csv') : json(200, { events: rows });
    if (sub === 'report') return q.format === 'json' ? json(200, { share: shareView(share, false), feedback: fb, events: rows, audit: al }) : text(200, R.report(share, fb, rows, al), 'text/markdown');
    return json(405, { error: 'Method not allowed' });
  }

  // Tester side: one session, for the share the screen names.
  const sess = { consent: S.consent === undefined ? null : S.consent, passcodeOk: false };
  function viewerRoute(method, p, q, body) {
    const m = p.match(/^\/p\/([\w-]+)\/_vantage\/(.+)$/);
    if (!m) return json(404, { error: 'Not found' });
    const share = shares[m[1]];
    if (!share) return json(404, { error: 'Not found' });
    const ep = m[2];
    const v = share.viewers[S.viewerId] || Object.values(share.viewers)[0];
    if (ep === 'meta') {
      const intro = share.intro;
      return json(200, {
        name: share.name,
        sharedBy: ME,
        abuseEmail: 'security@lumen.design',
        tasks: share.tasks,
        entry: share.entry,
        watermark: share.watermark,
        recordSessions: share.recordSessions,
        requireConsent: share.requireConsent,
        consent: sess.consent,
        viewer: { name: v.name, email: v.email },
        expiresAt: iso(share.expiresAt),
        hasBundle: !!share.files,
        mode: share.mode,
        showTasks: share.showTasks !== false,
        voice: !!share.voice,
        screen: !!share.screen,
        recordText: !!share.recordText,
        voiceActive: false,
        contentOrigin: window.origin,
        intro: { kind: intro.kind, text: intro.kind === 'default' ? '' : intro.text, media: null, subtitles: [] },
      });
    }
    if (ep === 'content') return json(200, { html: window.__PROTOTYPE__ });
    if (ep === 'consent') {
      sess.consent = !!body.accept;
      return json(200, { consent: sess.consent });
    }
    if (ep === 'events') return json(200, { ok: (body || []).length });
    if (ep.startsWith('recording')) return json(200, { ok: true, seq: +q.seq || 0 });
    if (ep === 'feedback') {
      if (share.mode === 'view') return json(403, { error: 'This share is view only' });
      const rec = { ts: iso(Date.now()), kind: body.kind === 'task' ? 'task' : 'feedback', viewer: v.name, email: v.email, session: 'live', text: String(body.text || ''), location: String(body.location || '') };
      if (rec.kind === 'task') {
        rec.taskIndex = +body.taskIndex;
        rec.result = ['done', 'answer'].includes(body.result) ? body.result : 'stuck';
      }
      feedback[share.id].push(rec);
      return json(201, { ok: true });
    }
    return json(404, { error: 'Unknown endpoint' });
  }

  function route(method, url, body) {
    const u = new URL(url, 'http://x');
    const q = Object.fromEntries(u.searchParams);
    if (u.pathname === '/api/auth') return json(200, { serverToken: true, google: true, sso: false, ssoEmail: null, ssoAdmin: false, ssoLogoutUrl: null });
    if (u.pathname.startsWith('/api/')) return adminRoute(method, u.pathname.slice(4), q, body);
    if (u.pathname.startsWith('/p/')) return viewerRoute(method, u.pathname, q, body);
    return json(404, { error: 'Not found' });
  }
  const parse = (b) => {
    if (b == null || b === '') return {};
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  };
  const wait = (ms) => new Promise((k) => setTimeout(k, ms));
  window.fetch = async (url, opts = {}) => {
    await wait(LATENCY);
    if (opts.headers && opts.headers.Authorization) signedIn = true; // any pasted token signs the demo in
    let r;
    try {
      r = route((opts.method || 'GET').toUpperCase(), String(url), parse(opts.body));
    } catch (e) {
      r = json(e.status || 500, { error: e.error || e.message || 'Internal error' });
    }
    if (r.blob) {
      const b = await r.blob;
      return new Response(b, { status: 200, headers: { 'content-type': b.type } });
    }
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.type } });
  };
  // uploadXhr() in the console uses XMLHttpRequest for progress; this answers it the way the server would.
  window.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.headers = {};
      this.status = 0;
      this.responseText = '';
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    }
    send(file) {
      const steps = [0.2, 0.45, 0.7, 0.9, 1];
      let i = 0;
      const tick = () => {
        if (this.upload.onprogress) this.upload.onprogress({ lengthComputable: true, loaded: steps[i], total: 1 });
        if (++i < steps.length) return setTimeout(tick, 160);
        const m = this.url.match(/^\/api\/shares\/([\w-]+)\/(intro|subtitles)(?:\/([\w-]+))?/);
        const share = m && shares[m[1]];
        if (share && m[2] === 'intro') {
          const mime = this.headers['content-type'] || file.type || 'audio/mpeg';
          share.intro = { ...share.intro, kind: mime.startsWith('video/') ? 'video' : 'audio', media: { mime, size: file.size || 0, name: decodeURIComponent(this.headers['x-file-name'] || file.name || 'intro'), uploadedAt: iso(Date.now()) } };
        }
        if (share && m[2] === 'subtitles') {
          share.intro.subtitles = (share.intro.subtitles || []).filter((x) => x.lang !== m[3]);
          share.intro.subtitles.push({ lang: m[3], label: decodeURIComponent(this.headers['x-label'] || m[3]), size: file.size || 0 });
        }
        this.status = share ? 200 : 404;
        this.responseText = JSON.stringify(share ? { share: shareView(share, true) } : { error: 'Share not found' });
        if (this.onload) this.onload();
      };
      setTimeout(tick, 160);
    }
  };

  // ---- the screen this frame was opened on ----
  try {
    if (signedIn) sessionStorage.setItem('vantage_token', 'demo');
    else sessionStorage.removeItem('vantage_token');
  } catch {
    /* storage blocked: the token form still works */
  }
  window.__DEMO__ = { shares, checkout, sess, signIn: () => (signedIn = true) };
  document.addEventListener('DOMContentLoaded', () => {
    // Links the console would open on the real server: docs, Google sign-in.
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const h = a.getAttribute('href');
      if (h === '/auth/google') {
        e.preventDefault();
        signedIn = true;
        window
          .fetch('/api/me')
          .then((r) => r.json())
          .then((m) => {
            me = m; // eslint-disable-line no-undef
            render(); // eslint-disable-line no-undef
          });
      } else if (h.startsWith('/docs/') || h.startsWith('/p/')) {
        e.preventDefault();
        if (typeof toast === 'function') toast('In the demo this opens nothing. On a real vantage it opens ' + h + '.'); // eslint-disable-line no-undef
      }
    });
  });
})();
