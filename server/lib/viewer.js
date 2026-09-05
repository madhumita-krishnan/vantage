'use strict';
// Tester side (/p/:id/...). The shell (consent, tasks, feedback, watermark) lives on the main origin. The prototype
// files and the tracker are served only on the content origin, so a prototype's scripts run on an origin of their own
// and cannot reach the shell, the console, or another share.
const path = require('path');
const C = require('./crypto');
const { mimeFor } = require('./bundle');

module.exports = function viewer(ctx) {
  const { CONFIG, store, events, feedback, H, S, M, readPublic, gate } = ctx;
  const {
    esc,
    httpError,
    readBody,
    readJson,
    json,
    html,
    send,
    redirect,
    rateLimit,
    clientIp,
    ssoEmail,
    sameOrigin,
    parseCookies,
  } = H;
  const now = Date.now;
  // One-time tickets carry a main-origin session over to the content origin. ponytail: in memory, so single process.
  const tickets = new Map();

  const gone = (req, res, status) =>
    gate(
      req,
      res,
      410,
      'No longer available',
      status === 'expired' ? 'This prototype link has expired.' : 'Access to this prototype has been withdrawn.'
    );
  const passcodeForm = (share) =>
    `<form method="post" action="/p/${esc(share.id)}/passcode" class="form"><input type="password" name="passcode" placeholder="Passcode" autocomplete="off" autofocus required><button type="submit">Continue</button></form>`;
  // Prototypes may load only from the content origin plus origins allowed by both server and share. Egress control, not XSS defence.
  function appCsp(share) {
    const ext = (share.externalOrigins || []).join(' ');
    return [
      `default-src 'self' ${ext}`,
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${ext}`,
      `style-src 'self' 'unsafe-inline' ${ext}`,
      `img-src 'self' data: blob: ${ext}`,
      `font-src 'self' data: ${ext}`,
      `connect-src 'self' ${ext}`,
      `media-src 'self' data: blob: ${ext}`,
      "worker-src 'self' blob:",
      `frame-src 'self' ${ext}`,
      `frame-ancestors 'self' ${CONFIG.mainOrigin}`,
      "form-action 'self'",
      "base-uri 'self'",
    ]
      .map((s) => s.trim())
      .join('; ');
  }
  function injectTracker(buf, share) {
    const src = buf.toString('utf8');
    const tag = `<meta name="referrer" content="no-referrer"><script src="/p/${share.id}/_vault/tracker.js"></script>`;
    const head = src.search(/<head[^>]*>/i);
    const at = head >= 0 ? src.indexOf('>', head) + 1 : (src.match(/^\s*<!doctype[^>]*>/i) || [''])[0].length;
    return Buffer.from(src.slice(0, at) + tag + src.slice(at));
  }
  function admit(req, res, share, viewer, type, to) {
    viewer.opens = (viewer.opens || 0) + 1;
    viewer.lastSeenAt = now();
    S.setSessionCookie(req, res, share, S.createSession(req, share, viewer));
    S.logAudit(share, type, req, { email: viewer.email, viewerId: viewer.id });
    return redirect(req, res, to);
  }
  const recording = (share, sess) => share.recordSessions && (!share.requireConsent || sess.consent === true);

  async function vaultEndpoint(req, res, url, ep, share, sess, viewer, content) {
    if (req.method === 'POST' && !sameOrigin(req)) throw httpError(403, 'Cross-origin request rejected');
    if (content) {
      if (ep === 'tracker.js' && req.method === 'GET') {
        const record = recording(share, sess);
        const cfg = {
          record,
          recordText: record && !!share.recordText,
          share: share.id,
          endpoint: `/p/${share.id}/_vault/events`,
          appBase: `/p/${share.id}/app/`,
          shell: CONFIG.mainOrigin,
        };
        return send(req, res, 200, `window.__VAULT_CFG=${JSON.stringify(cfg)};\n${readPublic('tracker.js')}`, {
          'Content-Type': 'text/javascript; charset=utf-8',
        });
      }
      if (ep === 'events' && req.method === 'POST') {
        if (!recording(share, sess)) return json(req, res, 200, { ok: 0 });
        if (!rateLimit(`ev:${sess.id}`, 600, 60e3)) return json(req, res, 429, { error: 'rate' });
        const b = await readJson(req, 512 * 1024);
        const arr = (Array.isArray(b) ? b : []).slice(0, 500);
        for (const e of arr)
          events.append(share.id, {
            ts: S.iso(now()),
            viewer: viewer.name,
            email: viewer.email,
            session: sess.id,
            t: +e.t || 0,
            type: String(e.type || '').slice(0, 60),
            path: String(e.path || '').slice(0, 500),
            data: typeof e.data === 'object' && e.data ? JSON.parse(JSON.stringify(e.data).slice(0, 2000)) : {},
          });
        return json(req, res, 200, { ok: arr.length });
      }
      throw httpError(404, 'Unknown endpoint');
    }
    if (ep === 'meta' && req.method === 'GET') {
      const intro = share.intro || { kind: 'default', text: '', media: null };
      return json(req, res, 200, {
        name: share.name,
        tasks: share.tasks,
        entry: share.entry,
        watermark: share.watermark,
        recordSessions: share.recordSessions,
        requireConsent: share.requireConsent,
        consent: sess.consent,
        viewer: { name: viewer.name, email: viewer.email },
        expiresAt: S.iso(share.expiresAt),
        hasBundle: !!share.files,
        mode: share.mode || 'unmoderated',
        showTasks: share.showTasks !== false,
        voice: !!share.voice,
        dictation: !!share.dictation,
        recordText: !!share.recordText,
        voiceActive: !!(share.recordings || {})[sess.id],
        contentOrigin: CONFIG.contentOrigin,
        intro: {
          kind: intro.kind,
          text: intro.text,
          media: intro.media ? { mime: intro.media.mime, size: intro.media.size } : null,
          subtitles: intro.subtitles || [],
        },
      });
    }
    // The shell asks for a content URL; the ticket in it becomes the session cookie on the content origin.
    if (ep === 'content' && req.method === 'GET') {
      if (tickets.size > 1000) for (const [k, v] of tickets) if (v.exp < now()) tickets.delete(k);
      const t = C.randomToken();
      tickets.set(t, { tok: parseCookies(req)[`vs_${share.id}`], exp: now() + 60e3 });
      return json(req, res, 200, {
        url: `${CONFIG.contentOrigin}/p/${share.id}/enter?t=${t}&to=${encodeURIComponent(share.entry || '')}`,
      });
    }
    if (ep === 'intro' && (req.method === 'GET' || req.method === 'HEAD')) return M.streamIntro(req, res, share);
    if (ep.startsWith('subtitles/') && req.method === 'GET') {
      const vtt = M.readSubtitle(
        share,
        ep
          .slice(10)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .slice(0, 12)
      );
      return vtt
        ? send(req, res, 200, vtt, { 'Content-Type': 'text/vtt; charset=utf-8' })
        : send(req, res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    }
    if (ep === 'consent' && req.method === 'POST') {
      sess.consent = !!(await readJson(req, 1024)).accept;
      store.save();
      S.logAudit(share, 'consent', req, { email: viewer.email, accepted: sess.consent });
      return json(req, res, 200, { consent: sess.consent });
    }
    if (ep === 'recording' && req.method === 'POST') {
      if (!share.voice || (share.requireConsent && sess.consent !== true))
        throw httpError(403, 'Voice recording is not enabled for this share, or consent was not given');
      const mime = String(req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!/^audio\/(webm|mp4|ogg|wav|mpeg|aac)$/.test(mime)) throw httpError(415, 'Unsupported audio type');
      const seq = Math.max(0, Math.min(+url.searchParams.get('seq') || 0, 100000));
      M.appendRecording(share, sess.id, viewer.id, mime, seq, await readBody(req, 8 * 1048576));
      if (seq === 0) S.logAudit(share, 'voice.started', req, { email: viewer.email, session: sess.id });
      store.save();
      return json(req, res, 200, { ok: true, seq });
    }
    if (ep === 'feedback' && req.method === 'POST') {
      if (share.mode === 'view') throw httpError(403, 'This share is view only');
      if (!rateLimit(`fb:${sess.id}`, 60, 60e3)) return json(req, res, 429, { error: 'rate' });
      const b = await readJson(req, 65536);
      const rec = {
        ts: S.iso(now()),
        kind: b.kind === 'task' ? 'task' : 'feedback',
        viewer: viewer.name,
        email: viewer.email,
        session: sess.id,
        text: String(b.text || '').slice(0, 5000),
        location: String(b.location || '').slice(0, 500),
      };
      if (rec.kind === 'task') {
        rec.taskIndex = +b.taskIndex;
        rec.result = ['done', 'answer'].includes(b.result) ? b.result : 'stuck';
      }
      feedback.append(share.id, rec);
      S.logAudit(share, rec.kind === 'task' ? 'task.result' : 'feedback', req, {
        email: viewer.email,
        session: sess.id,
        taskIndex: rec.taskIndex,
        result: rec.result,
      });
      return json(req, res, 201, { ok: true });
    }
    throw httpError(404, 'Unknown endpoint');
  }
  function serveFile(req, res, share, rel) {
    if (!share.files) return gate(req, res, 404, 'No content', 'The prototype files for this share have been removed.');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    let data = S.readBundleFile(share.id, rel);
    for (const suffix of ['.html', '/index.html'])
      if (data == null && !path.extname(rel) && (data = S.readBundleFile(share.id, rel + suffix)) != null)
        rel += suffix;
    if (data == null) return send(req, res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const type = mimeFor(rel);
    return send(req, res, 200, type.startsWith('text/html') ? injectTracker(data, share) : data, {
      'Content-Type': type,
      'Content-Security-Policy': appCsp(share),
    });
  }

  // Content origin: /enter turns a ticket into a session cookie here; then only the tracker, events and files exist.
  async function handleContent(req, res, url, share, rest) {
    const t = rest === '/enter' && url.searchParams.get('t');
    if (t) {
      const tk = tickets.get(t);
      tickets.delete(t);
      if (!tk || tk.exp < now() || !tk.tok)
        return gate(req, res, 403, 'Link expired', 'Go back to the prototype page and reload it.');
      S.setSessionCookie(req, res, share, tk.tok, true);
      return redirect(req, res, `/p/${share.id}/app/${encodeURI(url.searchParams.get('to') || '')}`);
    }
    const sess = S.getSession(req, share);
    if (!sess || S.shareStatus(share) !== 'active' || (share.passcode && !sess.passcodeOk))
      return send(req, res, 401, 'No session', { 'Content-Type': 'text/plain' });
    const viewer = share.viewers[sess.viewerId];
    if (rest.startsWith('/_vault/')) return vaultEndpoint(req, res, url, rest.slice(8), share, sess, viewer, true);
    if (rest.startsWith('/app/')) return serveFile(req, res, share, decodeURIComponent(rest.slice(5)));
    throw httpError(404, 'Not found');
  }

  return async function handleViewer(req, res, url, id, rest, content) {
    const share = store.data.shares[id];
    if (!share)
      return gate(
        req,
        res,
        404,
        'Not found',
        'This link does not point to a prototype. Check that you copied the full address.'
      );
    if (content) return handleContent(req, res, url, share, rest);
    const ip = clientIp(req);
    const status = S.shareStatus(share);

    // 1) Personal link redemption: /p/:id?k=TOKEN. The token is consumed into a session and dropped from the URL.
    const k = url.searchParams.get('k');
    if (!rest && k) {
      if (!rateLimit(`redeem:${ip}`, 30, 600e3))
        return gate(req, res, 429, 'Slow down', 'Too many attempts. Try again in a few minutes.');
      const hash = C.sha256(k);
      const v = Object.values(share.viewers).find((x) => x.token && C.safeEqual(x.token, hash));
      const reject = (reason, extra) => {
        S.logAudit(share, 'link.rejected', req, { reason, ...extra });
      };
      if (!v || v.revoked) {
        reject(v ? 'viewer_revoked' : 'bad_token');
        return gate(
          req,
          res,
          403,
          'Link not valid',
          'This invitation link is not valid or has been revoked. Ask the person who shared it for a new link.'
        );
      }
      if (status !== 'active') {
        reject(status, { email: v.email });
        return gone(req, res, status);
      }
      if (v.maxOpens && v.opens >= v.maxOpens) {
        reject('open_limit', { email: v.email });
        return gate(req, res, 403, 'Open limit reached', 'This invitation has been used the maximum number of times.');
      }
      return admit(req, res, share, v, 'link.redeemed', `/p/${share.id}`);
    }
    // 2) Existing session, or an identity from the SSO proxy that the share allows
    let sess = S.getSession(req, share);
    if (!sess) {
      const email = ssoEmail(req);
      if (email && status === 'active') {
        const allowed =
          Object.values(share.viewers).some((v) => v.email === email && !v.revoked) ||
          (share.ssoAllow.emails || []).includes(email) ||
          (share.ssoAllow.domains || []).includes(email.split('@')[1]);
        if (allowed)
          return admit(
            req,
            res,
            share,
            S.addViewer(share, { email, name: email.split('@')[0] }, 'sso'),
            'sso.authorized',
            url.pathname
          );
        S.logAudit(share, 'sso.denied', req, { email });
        return gate(
          req,
          res,
          403,
          'Not invited',
          `You are signed in as <b>${esc(email)}</b>, but this prototype has not been shared with you.`
        );
      }
      if (rest) return json(req, res, 401, { error: 'No session' });
      return gate(
        req,
        res,
        403,
        'Invitation required',
        'This prototype is confidential. Open it using the personal link you were sent. If you do not have one, ask the person who shared it.'
      );
    }
    const viewer = share.viewers[sess.viewerId];
    if (status !== 'active') return gone(req, res, status);
    // 3) Passcode gate (optional second factor)
    if (share.passcode && !sess.passcodeOk) {
      if (rest === '/passcode' && req.method === 'POST') {
        if (!rateLimit(`pass:${share.id}:${ip}`, 8, 900e3))
          return gate(req, res, 429, 'Too many attempts', 'Wait 15 minutes and try again.');
        const ok = await C.verifyPasscode(
          new URLSearchParams((await readBody(req, 4096)).toString('utf8')).get('passcode') || '',
          share.passcode
        );
        S.logAudit(share, ok ? 'passcode.ok' : 'passcode.fail', req, { email: viewer.email });
        if (!ok) return gate(req, res, 401, 'Passcode', 'That passcode is not correct.', passcodeForm(share));
        sess.passcodeOk = true;
        store.save();
        return redirect(req, res, `/p/${share.id}`);
      }
      if (rest) return json(req, res, 401, { error: 'Passcode required' });
      return gate(
        req,
        res,
        200,
        'Passcode',
        `Hi ${esc(viewer.name)}. This prototype also needs the passcode you were given separately.`,
        passcodeForm(share)
      );
    }
    // 4) The viewer shell and 5) its endpoints. Prototype files are never served on this origin.
    if (!rest || rest === '/') {
      S.logAudit(share, 'view.open', req, { email: viewer.email, viewerId: viewer.id, session: sess.id });
      return html(req, res, 200, readPublic('viewer.html'));
    }
    if (rest.startsWith('/_vault/')) return vaultEndpoint(req, res, url, rest.slice(8), share, sess, viewer, false);
    throw httpError(404, 'Not found');
  };
};
