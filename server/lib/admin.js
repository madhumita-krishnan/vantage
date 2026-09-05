'use strict';
// Admin API (/api/*): identity (server token, personal tokens, SSO header, Google sign-in), account, shares and
// their sub-resources. Everyone except the server admin token sees only what they created.
const C = require('./crypto');
const R = require('./results');

module.exports = function admin(ctx) {
  const { CONFIG, store, blob, audit, events, feedback, H, S, M, gate } = ctx;
  const {
    httpError,
    readBody,
    readJson,
    json,
    send,
    redirect,
    ssoEmail,
    baseUrl,
    parseCookies,
    setCookie,
    isHttps,
    clientIp,
  } = H;
  const now = Date.now;
  const ownerOf = (admin) => admin.owner || admin.who;
  const canSee = (share, admin) => admin.kind === 'server-token' || S.ownsShare(share, ownerOf(admin));

  function adminFromReq(req) {
    const auth = String(req.headers.authorization || '');
    if (auth.startsWith('Bearer ')) {
      const raw = auth.slice(7);
      if (CONFIG.adminToken && C.safeEqual(raw, CONFIG.adminToken)) return { kind: 'server-token', who: 'admin-token' };
      const t = store.data.tokens[C.sha256(raw)]; // personal access tokens ("Connect a tool"), stored hashed
      if (!t || t.revokedAt) return null;
      if (!t.lastUsedAt || now() - t.lastUsedAt > 60e3) {
        t.lastUsedAt = now();
        store.save();
      }
      return { kind: 'personal-token', who: `${t.owner} via ${t.name}`, owner: t.owner, tokenId: t.id };
    }
    const email = ssoEmail(req);
    if (email && CONFIG.adminEmails.includes(email)) return { kind: 'sso', who: email };
    const va = parseCookies(req).va;
    const s = va && store.data.adminSessions[C.sha256(va)];
    return s && s.expiresAt > now() ? { kind: 'google', who: s.email, owner: s.email, cookie: true } : null;
  }
  // Unauthenticated: tells the sign-in screen which ways in exist. No secrets.
  function authInfo(req) {
    const email = ssoEmail(req);
    return {
      serverToken: !!CONFIG.adminToken,
      google: !!CONFIG.googleClientId,
      sso: !!(CONFIG.trustProxy && CONFIG.trustedHeaderEmail && CONFIG.adminEmails.length),
      ssoEmail: email || null,
      ssoAdmin: !!(email && CONFIG.adminEmails.includes(email)),
      ssoLogoutUrl: CONFIG.ssoLogoutUrl || null,
    };
  }
  const tokenView = (t, a) => ({
    id: t.id,
    name: t.name,
    owner: t.owner,
    prefix: t.prefix,
    createdAt: S.iso(t.createdAt),
    createdBy: t.createdBy,
    lastUsedAt: t.lastUsedAt ? S.iso(t.lastUsedAt) : null,
    revokedAt: t.revokedAt ? S.iso(t.revokedAt) : null,
    current: !!a && a.tokenId === t.id,
  });
  const view = (req, res, share, status = 200, links) =>
    json(req, res, status, { share: S.shareView(req, share, true, links) });

  // ---- Google sign-in (hosted deployments). The only outbound request the server ever makes is the token exchange. ----
  async function handleAuth(req, res, url) {
    if (!CONFIG.googleClientId) throw httpError(404, 'Google sign-in is not configured');
    const redirectUri = `${CONFIG.mainOrigin}/auth/google/callback`;
    if (url.pathname === '/auth/google') {
      const state = C.randomToken(16);
      setCookie(res, 'oauth_state', state, { path: '/auth', maxAge: 600, secure: isHttps(req) });
      const q = new URLSearchParams({
        client_id: CONFIG.googleClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
      });
      return redirect(req, res, `${CONFIG.googleAuthUrl}?${q}`);
    }
    if (url.pathname !== '/auth/google/callback') throw httpError(404, 'Not found');
    const code = url.searchParams.get('code'),
      state = url.searchParams.get('state');
    if (!code || !state || state !== parseCookies(req).oauth_state)
      throw httpError(400, 'Sign-in did not complete (state mismatch). Try again.');
    const r = await fetch(CONFIG.googleTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CONFIG.googleClientId,
        client_secret: CONFIG.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) throw httpError(502, 'Google did not accept the sign-in');
    // The ID token arrived straight from Google's token endpoint over TLS, which OpenID Connect Core 3.1.3.7 accepts
    // in place of checking its signature. The claims are still checked.
    let claims;
    try {
      claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url'));
    } catch {
      throw httpError(502, 'Google returned an unreadable ID token');
    }
    const email = String(claims.email || '').toLowerCase();
    if (
      claims.aud !== CONFIG.googleClientId ||
      !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss) ||
      !claims.email_verified ||
      !email
    )
      throw httpError(403, 'Sign-in could not be verified');
    if (CONFIG.adminEmails.length && !CONFIG.adminEmails.includes(email)) {
      S.logAudit(null, 'admin.denied', req, { email });
      return gate(
        req,
        res,
        403,
        'Not on the list',
        `${H.esc(email)} is signed in with Google, but is not on this server's admin list.`
      );
    }
    const raw = C.randomToken();
    store.data.adminSessions[C.sha256(raw)] = {
      email,
      name: String(claims.name || '').slice(0, 80),
      createdAt: now(),
      expiresAt: now() + 30 * 86400e3,
      ip: clientIp(req),
    };
    store.save();
    setCookie(res, 'va', raw, { maxAge: 30 * 86400, secure: isHttps(req) });
    setCookie(res, 'oauth_state', '', { path: '/auth', maxAge: 0 });
    S.logAudit(null, 'admin.signin', req, { email });
    return redirect(req, res, '/admin');
  }
  function signOut(req, res, admin) {
    delete store.data.adminSessions[C.sha256(parseCookies(req).va || '')];
    store.save();
    setCookie(res, 'va', '', { maxAge: 0 });
    S.logAudit(null, 'admin.signout', req, { by: admin.who });
    return json(req, res, 200, { ok: true });
  }

  function me(req, admin) {
    const owner = ownerOf(admin);
    const label =
      { sso: 'Company sign-in', 'server-token': 'Server admin token', google: 'Google sign-in' }[admin.kind] ||
      'Personal access token';
    const lim = admin.kind === 'server-token' ? {} : CONFIG.limits(owner) || {};
    return {
      ok: true,
      admin: admin.who,
      mine: {
        shares: Object.values(store.data.shares).filter((x) => S.ownsShare(x, owner)).length,
        tokens: Object.values(store.data.tokens).filter((t) => t.owner === owner && !t.revokedAt).length,
        limits: { shares: lim.shares || 0, storageMb: lim.storageMb || 0 },
      },
      identity: { kind: admin.kind, who: owner, tokenId: admin.tokenId || null, label },
      server: {
        encryptionAtRest: blob.enabled,
        sso: !!(CONFIG.trustProxy && CONFIG.trustedHeaderEmail),
        publicUrl: baseUrl(req),
        contentOrigin: CONFIG.contentOrigin,
        allowedExternalOrigins: CONFIG.allowedExternalOrigins,
        defaultExpiryDays: CONFIG.defaultExpiryDays,
        maxExpiryDays: CONFIG.maxExpiryDays,
        maxUploadMb: CONFIG.maxUploadBytes / 1048576,
        maxMediaMb: CONFIG.maxMediaBytes / 1048576,
        mediaTypes: Object.keys(S.MEDIA_TYPES),
        retentionDays: CONFIG.retentionDays,
        sessionHours: CONFIG.sessionHours,
        ssoLogoutUrl: CONFIG.ssoLogoutUrl || null,
        serverToken: !!CONFIG.adminToken,
        google: !!CONFIG.googleClientId,
        quickstart: CONFIG.quickstart,
        mcpPath: CONFIG.quickstart ? CONFIG.mcpPath : null,
        version: require('../package.json').version,
      },
    };
  }
  async function tokens(req, res, admin, tid) {
    const mine = () =>
      Object.values(store.data.tokens).filter((t) => admin.kind === 'server-token' || t.owner === ownerOf(admin));
    if (!tid && req.method === 'GET')
      return json(req, res, 200, {
        tokens: mine()
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((t) => tokenView(t, admin)),
      });
    if (!tid && req.method === 'POST') {
      const name = String((await readJson(req, 65536)).name || '')
        .trim()
        .slice(0, 60);
      if (!name) throw httpError(400, 'name is required (for example "Claude Code on my laptop")');
      if (mine().filter((t) => !t.revokedAt).length >= 50)
        throw httpError(400, 'Too many active tokens; disconnect one first');
      const raw = 'pv_' + C.randomToken(24);
      const t = {
        id: C.randomId(6),
        name,
        owner: ownerOf(admin),
        prefix: raw.slice(0, 7),
        createdAt: now(),
        createdBy: admin.who,
        lastUsedAt: null,
        revokedAt: null,
      };
      store.data.tokens[C.sha256(raw)] = t;
      store.save();
      S.logAudit(null, 'token.created', req, { by: admin.who, tokenId: t.id, name });
      return json(req, res, 201, { token: raw, item: tokenView(t, admin) });
    }
    if (tid && req.method === 'DELETE') {
      const t = mine().find((x) => x.id === (tid === 'current' ? admin.tokenId : tid));
      if (!t) throw httpError(404, 'Token not found');
      if (!t.revokedAt) {
        t.revokedAt = now();
        store.save();
        S.logAudit(null, 'token.revoked', req, {
          by: admin.who,
          tokenId: t.id,
          name: t.name,
          self: t.id === admin.tokenId,
        });
      }
      return json(req, res, 200, { item: tokenView(t, admin) });
    }
    throw httpError(405, 'Method not allowed');
  }
  // Leave = delete everything this identity made, disconnect its tools, end its sign-in.
  function leave(req, res, admin) {
    const owner = ownerOf(admin);
    if (admin.kind === 'server-token')
      throw httpError(
        400,
        'The server admin token is shared by everyone who has it, not a personal account. Delete shares one by one and ask whoever runs the server to rotate ADMIN_TOKEN.'
      );
    const mine = Object.values(store.data.shares).filter((x) => S.ownsShare(x, owner));
    for (const x of mine) S.deleteShare(x, req, admin);
    let n = 0;
    for (const t of Object.values(store.data.tokens))
      if (t.owner === owner && !t.revokedAt) {
        t.revokedAt = now();
        n++;
      }
    for (const [k, s] of Object.entries(store.data.adminSessions))
      if (s.email === owner) delete store.data.adminSessions[k];
    store.save();
    if (admin.cookie) setCookie(res, 'va', '', { maxAge: 0 });
    S.logAudit(null, 'account.left', req, { by: admin.who, shares: mine.length, tokens: n });
    return json(req, res, 200, { ok: true, shares: mine.length, tokens: n, sso: admin.kind === 'sso' });
  }

  async function shareRoute(req, res, url, admin, share, sub, subId, action) {
    const method = req.method;
    if (!sub) {
      if (method === 'GET') return view(req, res, share);
      if (method === 'PATCH') {
        await S.updateShare(share, await readJson(req), req, admin);
        return view(req, res, share);
      }
      if (method === 'DELETE') {
        S.deleteShare(share, req, admin);
        return json(req, res, 200, { ok: true });
      }
    }
    if (sub === 'bundle' && (method === 'PUT' || method === 'POST')) {
      const b = await readJson(req, CONFIG.maxUploadBytes);
      S.setBundle(share, b.files, b.entry, admin);
      store.save();
      S.logAudit(share, 'bundle.replaced', req, { by: admin.who, files: share.files.count, bytes: share.files.bytes });
      return view(req, res, share);
    }
    if (sub === 'viewers') {
      if (method === 'POST' && !subId) {
        const b = await readJson(req);
        const added = (Array.isArray(b.viewers) ? b.viewers : [b]).map((s) =>
          S.addViewer(share, s, 'invite', b.maxOpens)
        );
        const out = added.map((v) => S.viewerView(share, v, v.token ? undefined : S.issueLink(req, share, v)));
        store.save();
        S.logAudit(share, 'viewer.added', req, { by: admin.who, emails: added.map((v) => v.email) });
        return json(req, res, 201, { viewers: out });
      }
      const v = share.viewers[subId];
      if (!v) throw httpError(404, 'Viewer not found');
      if (method === 'DELETE' || (action === 'rotate' && method === 'POST')) {
        const rotate = action === 'rotate';
        const link = rotate ? S.issueLink(req, share, v) : undefined;
        if (!rotate) {
          v.revoked = true;
          v.token = null;
        }
        S.dropSessions((s) => s.viewerId === v.id);
        store.save();
        S.logAudit(share, rotate ? 'viewer.link_rotated' : 'viewer.revoked', req, { by: admin.who, email: v.email });
        return json(req, res, 200, { viewer: S.viewerView(share, v, link) });
      }
    }
    if (sub === 'intro') {
      if (method === 'PUT' || method === 'POST') {
        const mime = String(req.headers['content-type'] || '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        const kind = S.MEDIA_TYPES[mime];
        if (!kind)
          throw httpError(
            415,
            `Unsupported media type ${mime || '(none)'}. Use ${Object.keys(S.MEDIA_TYPES).join(', ')}`
          );
        if (+(req.headers['content-length'] || 0) > CONFIG.maxMediaBytes)
          throw httpError(413, `Media larger than ${Math.round(CONFIG.maxMediaBytes / 1048576)} MB`);
        S.removeMedia(share.id);
        const size = await M.storeIntro(req, share.id, CONFIG.maxMediaBytes);
        const name = decodeURIComponent(String(req.headers['x-file-name'] || 'intro'))
          .replace(/[^\w.\- ()]/g, '_')
          .slice(0, 120);
        share.intro = {
          kind,
          text: (share.intro && share.intro.text) || '',
          media: { mime, size, name, uploadedAt: S.iso(now()) },
        };
        store.save();
        S.logAudit(share, 'intro.media_uploaded', req, { by: admin.who, mime, size });
        return view(req, res, share);
      }
      if (method === 'DELETE') {
        S.removeMedia(share.id);
        share.intro = {
          kind: share.intro && share.intro.text ? 'text' : 'default',
          text: (share.intro && share.intro.text) || '',
          media: null,
        };
        store.save();
        S.logAudit(share, 'intro.media_removed', req, { by: admin.who });
        return view(req, res, share);
      }
    }
    if (sub === 'subtitles' && subId) {
      const lang = subId.toLowerCase().slice(0, 12);
      share.intro = share.intro || { kind: 'default', text: '', media: null };
      share.intro.subtitles = (share.intro.subtitles || []).filter((x) => x.lang !== lang);
      if (method === 'PUT' || method === 'POST') {
        const buf = await readBody(req, 5 * 1048576);
        if (!/^\uFEFF?WEBVTT/.test(buf.toString('utf8')))
          throw httpError(400, 'Subtitles must be a WebVTT file (starts with WEBVTT)');
        M.writeSubtitle(share, lang, buf);
        share.intro.subtitles.push({
          lang,
          label: decodeURIComponent(String(req.headers['x-label'] || lang)).slice(0, 40),
          size: buf.length,
        });
        S.logAudit(share, 'intro.subtitles_uploaded', req, { by: admin.who, lang });
      } else if (method === 'DELETE') M.removeSubtitle(share, lang);
      else throw httpError(405, 'Method not allowed');
      store.save();
      return view(req, res, share);
    }
    if (sub === 'recordings') {
      if (method === 'GET' && !subId)
        return json(req, res, 200, { recordings: S.shareView(req, share, true).recordings });
      if (method === 'GET') return M.streamRecording(req, res, share, subId);
      if (method === 'DELETE' && subId) {
        M.removeRecording(share, subId);
        delete share.recordings[subId];
        store.save();
        S.logAudit(share, 'voice.deleted', req, { by: admin.who, session: subId });
        return json(req, res, 200, { ok: true });
      }
    }
    if (sub === 'notes' && method === 'POST') {
      const b = await readJson(req, 65536);
      const v = b.viewerId ? share.viewers[b.viewerId] : null;
      const rec = {
        ts: S.iso(now()),
        kind: 'note',
        by: admin.who,
        viewer: v ? v.name : b.viewer || '',
        email: v ? v.email : '',
        session: String(b.session || ''),
        text: String(b.text || '').slice(0, 5000),
        location: String(b.location || '').slice(0, 500),
      };
      if (!rec.text) throw httpError(400, 'text is required');
      feedback.append(share.id, rec);
      S.logAudit(share, 'note.added', req, { by: admin.who, viewerId: v ? v.id : null });
      return json(req, res, 201, { note: rec });
    }
    if (method === 'GET') {
      const fb = () => feedback.read(share.id),
        rows = () => events.read(share.id, 200000),
        au = () => audit.read(share.id);
      if (sub === 'audit') return json(req, res, 200, { audit: au() });
      if (sub === 'feedback') return json(req, res, 200, { feedback: fb() });
      if (sub === 'summary') return json(req, res, 200, R.summary(share, fb(), rows()));
      if (sub === 'events') {
        if (url.searchParams.get('format') === 'csv')
          return send(req, res, 200, R.eventsCsv(rows()), {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="events-${share.id}.csv"`,
          });
        return json(req, res, 200, { events: rows() });
      }
      if (sub === 'report') {
        if (url.searchParams.get('format') === 'json')
          return json(req, res, 200, {
            share: S.shareView(req, share, false),
            feedback: fb(),
            events: rows(),
            audit: au(),
          });
        return send(req, res, 200, R.report(share, fb(), rows(), au()), {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="report-${share.id}.md"`,
        });
      }
    }
    throw httpError(405, 'Method not allowed');
  }

  async function handleAdmin(req, res, url, admin) {
    const p = url.pathname,
      method = req.method;
    if (p === '/api/me') return json(req, res, 200, me(req, admin));
    if (p === '/api/me/leave' && method === 'POST') return leave(req, res, admin);
    if (p === '/api/logout' && method === 'POST') return signOut(req, res, admin);
    const tm = p.match(/^\/api\/tokens(?:\/([A-Za-z0-9_-]+))?$/);
    if (tm) return tokens(req, res, admin, tm[1]);
    if (p === '/api/activity' && method === 'GET') {
      const own = (r) =>
        admin.kind === 'server-token' || String(r.by || '').startsWith(ownerOf(admin)) || r.email === ownerOf(admin);
      return json(req, res, 200, {
        activity: audit
          .read('_admin', 5000)
          .filter((r) => own(r) && /^(token\.|admin\.|account\.|share\.(created|revoked|deleted))/.test(r.type))
          .slice(-100)
          .reverse(),
      });
    }
    if (p === '/api/shares' && method === 'GET')
      return json(req, res, 200, {
        shares: Object.values(store.data.shares)
          .filter((s) => canSee(s, admin))
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((s) => S.shareView(req, s, false)),
      });
    if (p === '/api/shares' && method === 'POST') {
      const links = {};
      return view(
        req,
        res,
        await S.createShare(await readJson(req, CONFIG.maxUploadBytes), req, admin, links),
        201,
        links
      );
    }
    if (p === '/api/shares/sample' && method === 'POST') {
      const links = {};
      return view(req, res, await S.createSampleShare(await readJson(req), req, admin, links), 201, links);
    }
    const m = p.match(
      /^\/api\/shares\/([A-Za-z0-9_-]+)(?:\/(bundle|viewers|audit|events|feedback|summary|intro|notes|report|subtitles|recordings))?(?:\/([A-Za-z0-9_-]+))?(?:\/(rotate))?$/
    );
    if (!m) throw httpError(404, 'Unknown API route');
    const share = S.requireShare(m[1]);
    if (!canSee(share, admin)) throw httpError(404, 'Share not found');
    return shareRoute(req, res, url, admin, share, m[2], m[3], m[4]);
  }
  return { handleAdmin, adminFromReq, authInfo, handleAuth };
};
