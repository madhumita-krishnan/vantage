'use strict';
// Tester side (/p/:id/...). The shell (consent, tasks, feedback, watermark) lives on the main origin. The prototype
// files and the tracker are served only on the content origin, so a prototype's scripts run on an origin of their own
// and cannot reach the shell, the console, or another share.
const path = require('path');
const C = require('./crypto');
const { mimeFor } = require('./bundle');

module.exports = function viewer(ctx) {
  const { CONFIG, store, events, feedback, H, S, M, G, readPublic, gate } = ctx;
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
    baseUrl,
    dec,
  } = H;
  const now = Date.now;
  // One-time tickets carry a main-origin session over to the content origin. ponytail: in memory, so single process.
  const tickets = new Map();
  // Pending tester sign-ins, keyed by OAuth state: which session asked to be verified. Same ceiling as tickets.
  const pendingSignIns = new Map();
  const VIEWER_REDIRECT = () => `${CONFIG.mainOrigin}/auth/google/viewer`;
  // Per-session ceilings for recorded events, so one tester cannot fill the disk.
  const MAX_EVENTS = 20000;
  const MAX_EVENT_BYTES = 5 * 1048576;

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
  // The gate shown without a session. If the address carries a personal link secret in its fragment, this script
  // hands it to the server with a POST (fragments never travel in a request, so the secret stays out of logs).
  const REDEEM_SCRIPT =
    '<script>(function(){var m=location.hash.match(/(?:^#|&)k=([^&]+)/);if(!m)return;history.replaceState(null,"",location.pathname);' +
    'fetch(location.pathname+"/redeem",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({k:decodeURIComponent(m[1])}),credentials:"same-origin"})' +
    '.then(function(r){if(r.ok){location.replace(location.pathname);return}return r.text().then(function(t){document.open();document.write(t);document.close()})})})()</script>';
  // Prototypes may load only from their own origin plus origins allowed by both server and share. Egress control, not XSS defence.
  function appCsp(share, shell) {
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
      `frame-ancestors ${shell}`,
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
  function admit(req, res, share, viewer, type) {
    viewer.opens = (viewer.opens || 0) + 1;
    viewer.lastSeenAt = now();
    S.setSessionCookie(req, res, share, S.createSession(req, share, viewer));
    S.logAudit(share, type, req, { email: viewer.email, viewerId: viewer.id });
  }
  const recording = (share, sess) => share.recordSessions && (!share.requireConsent || sess.consent === true);
  // Where the shell that framed this prototype lives: recorded on the session when the ticket is minted, so Docker
  // and LAN setups work without PUBLIC_URL.
  const shellOf = (sess) => (sess && sess.shell) || CONFIG.mainOrigin;

  // Personal link redemption. Sends a gate page and returns true on failure; sets the session cookie and returns
  // false when the person is admitted (the caller then answers).
  function redeem(req, res, share, k) {
    const ip = clientIp(req);
    if (!rateLimit(`redeem:${ip}`, 30, 600e3)) {
      gate(req, res, 429, 'Slow down', 'Too many attempts. Try again in a few minutes.');
      return true;
    }
    const status = S.shareStatus(share);
    const hash = C.sha256(String(k));
    const v = Object.values(share.viewers).find((x) => x.token && C.safeEqual(x.token, hash));
    const reject = (reason, extra) => S.logAudit(share, 'link.rejected', req, { reason, ...extra });
    if (!v || v.revoked) {
      reject(v ? 'viewer_revoked' : 'bad_token');
      gate(
        req,
        res,
        403,
        'Link not valid',
        'This invitation link is not valid or has been revoked. Ask the person who shared it for a new link.'
      );
      return true;
    }
    if (status !== 'active') {
      reject(status, { email: v.email });
      gone(req, res, status);
      return true;
    }
    if (v.maxOpens && v.opens >= v.maxOpens) {
      reject('open_limit', { email: v.email });
      gate(req, res, 403, 'Open limit reached', 'This invitation has been used the maximum number of times.');
      return true;
    }
    admit(req, res, share, v, 'link.redeemed');
    return false;
  }

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
          shell: shellOf(sess),
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
        const bytes = JSON.stringify(arr).length;
        if ((sess.events || 0) + arr.length > MAX_EVENTS || (sess.eventBytes || 0) + bytes > MAX_EVENT_BYTES)
          return json(req, res, 200, { ok: 0, limit: true });
        sess.events = (sess.events || 0) + arr.length;
        sess.eventBytes = (sess.eventBytes || 0) + bytes;
        for (const e of arr) {
          const raw = typeof e.data === 'object' && e.data ? JSON.stringify(e.data) : '{}';
          events.append(share.id, {
            ts: S.iso(now()),
            viewer: viewer.name,
            email: viewer.email,
            session: sess.id,
            t: +e.t || 0,
            type: String(e.type || '').slice(0, 60),
            path: String(e.path || '').slice(0, 500),
            data: raw.length > 2000 ? { truncated: raw.slice(0, 2000) } : JSON.parse(raw),
          });
        }
        return json(req, res, 200, { ok: arr.length });
      }
      throw httpError(404, 'Unknown endpoint');
    }
    if (ep === 'meta' && req.method === 'GET') {
      const intro = share.intro || { kind: 'default', text: '', media: null };
      const owner = S.shareOwner(share);
      return json(req, res, 200, {
        name: share.name,
        sharedBy: owner === 'admin-token' ? '' : owner,
        abuseEmail: CONFIG.abuseEmail,
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
        screen: !!share.screen,
        recordText: !!share.recordText,
        voiceActive: !!(share.recordings || {})[sess.id],
        contentOrigin: CONFIG.contentOriginFor(share.id),
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
      if (!rateLimit(`ticket:${sess.id}`, 20, 60e3)) return json(req, res, 429, { error: 'rate' });
      if (tickets.size > 1000) for (const [k, v] of tickets) if (v.exp < now()) tickets.delete(k);
      sess.shell = baseUrl(req);
      store.save();
      const t = C.randomToken();
      tickets.set(t, { tok: parseCookies(req)[`vs_${share.id}`], exp: now() + 60e3 });
      return json(req, res, 200, {
        url: `${CONFIG.contentOriginFor(share.id)}/p/${share.id}/enter?t=${t}&to=${encodeURIComponent(share.entry || '')}`,
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
      if (!(share.voice || share.screen) || (share.requireConsent && sess.consent !== true))
        throw httpError(403, 'Recording is not enabled for this share, or consent was not given');
      if (!rateLimit(`rec:${sess.id}`, 60, 60e3)) return json(req, res, 429, { error: 'rate' });
      const mime = String(req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const video = /^video\/(webm|mp4)$/.test(mime);
      if (video ? !share.screen : !/^audio\/(webm|mp4|ogg|wav|mpeg|aac)$/.test(mime) || !share.voice)
        throw httpError(415, 'Unsupported recording type');
      const seq = Math.max(0, Math.min(+url.searchParams.get('seq') || 0, 100000));
      M.appendRecording(share, sess.id, viewer.id, mime, seq, await readBody(req, 8 * 1048576));
      if (seq === 0)
        S.logAudit(share, video ? 'screen.started' : 'voice.started', req, { email: viewer.email, session: sess.id });
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
  function serveFile(req, res, share, sess, rel) {
    if (!share.files) return gate(req, res, 404, 'No content', 'The prototype files for this share have been removed.');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    let data = S.readBundleFile(share.id, rel);
    for (const suffix of ['.html', '/index.html'])
      if (data == null && !path.extname(rel) && (data = S.readBundleFile(share.id, rel + suffix)) != null)
        rel += suffix;
    if (data == null) return send(req, res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const type = mimeFor(rel);
    // Pages are for the shell's frame only. A browser that says it is loading a top-level document (a pasted address,
    // a popup) is turned away, because outside the frame there is no watermark and no consent record.
    const dest = req.headers['sec-fetch-dest'];
    if (type.startsWith('text/html') && dest && dest !== 'iframe' && dest !== 'frame')
      return gate(
        req,
        res,
        403,
        'Open it from your link',
        'This prototype only opens inside the page your personal link leads to.'
      );
    return send(req, res, 200, type.startsWith('text/html') ? injectTracker(data, share) : data, {
      'Content-Type': type,
      'Content-Security-Policy': appCsp(share, shellOf(sess)),
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
    if (rest.startsWith('/app/')) return serveFile(req, res, share, sess, dec(rest.slice(5)));
    throw httpError(404, 'Not found');
  }

  // Google sends the tester back here. The state cookie proves it is the same browser; the pending entry says which
  // session asked; the email must equal the invited address.
  async function signInCallback(req, res, url) {
    const { email, state } = await G.finish(req, url, VIEWER_REDIRECT());
    const pending = pendingSignIns.get(state);
    pendingSignIns.delete(state);
    if (!pending || pending.exp < now()) throw httpError(400, 'Sign-in took too long. Open your link again.');
    const share = store.data.shares[pending.shareId];
    const sess = share && store.data.sessions[pending.sessionKey];
    if (!share || !sess || sess.shareId !== share.id) throw httpError(400, 'Session not found. Open your link again.');
    const viewer = share.viewers[sess.viewerId];
    if (!viewer || viewer.email.toLowerCase() !== email) {
      S.logAudit(share, 'identity.mismatch', req, { email, expected: viewer && viewer.email, session: sess.id });
      return gate(
        req,
        res,
        403,
        'Not the invited address',
        `You signed in as <b>${esc(email)}</b>, but this link was sent to <b>${esc((viewer && viewer.email) || '')}</b>. Sign in with that account, or ask the person who shared it to invite this one.`
      );
    }
    sess.identityOk = true;
    store.save();
    S.logAudit(share, 'identity.ok', req, { email, session: sess.id });
    return redirect(req, res, `/p/${share.id}`);
  }
  handleViewer.signInCallback = signInCallback;
  return handleViewer;
  async function handleViewer(req, res, url, id, rest, content) {
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

    // 1) Personal link redemption. Links carry the secret in the fragment; the gate page posts it here. Older links
    //    carried it in the query string, and those still work.
    if (rest === '/redeem' && req.method === 'POST') {
      if (!sameOrigin(req)) throw httpError(403, 'Cross-origin request rejected');
      if (redeem(req, res, share, (await readJson(req, 4096)).k || '')) return;
      return json(req, res, 200, { ok: true });
    }
    const k = url.searchParams.get('k');
    if (!rest && k) {
      if (redeem(req, res, share, k)) return;
      return redirect(req, res, `/p/${share.id}`);
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
        if (allowed) {
          admit(req, res, share, S.addViewer(share, { email, name: email.split('@')[0] }, 'sso'), 'sso.authorized');
          return redirect(req, res, url.pathname);
        }
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
        'This prototype is confidential. Open it using the personal link you were sent. If you do not have one, ask the person who shared it.',
        REDEEM_SCRIPT
      );
    }
    const viewer = share.viewers[sess.viewerId];
    if (status !== 'active') return gone(req, res, status);
    // 3a) Identity gate: the share asks testers to sign in with Google as the address the link was sent to, so a
    //     forwarded link opens nothing. The secret was already consumed; the session simply never becomes usable.
    if (share.requireSignIn && !sess.identityOk) {
      if (rest === '/signin') {
        if (!rateLimit(`signin:${sess.id}`, 10, 600e3)) return gate(req, res, 429, 'Slow down', 'Try again later.');
        const state = G.start(req, res, VIEWER_REDIRECT());
        pendingSignIns.set(state, { sessionKey: S.sessionKey(req, share), shareId: share.id, exp: now() + 600e3 });
        return;
      }
      if (rest) return json(req, res, 401, { error: 'Sign-in required' });
      return gate(
        req,
        res,
        200,
        'Sign in to open',
        `Hi ${esc(viewer.name)}. This prototype opens only for the Google account <b>${esc(viewer.email)}</b>, the address this link was sent to.`,
        `<a class="btn primary" href="/p/${esc(share.id)}/signin" style="display:block;text-align:center">Sign in with Google</a>`
      );
    }
    // 3) Passcode gate (optional second factor). Limited per address and, so a spoofed address does not help, per share.
    if (share.passcode && !sess.passcodeOk) {
      if (rest === '/passcode' && req.method === 'POST') {
        if (!rateLimit(`pass:${share.id}:${ip}`, 8, 900e3) || !rateLimit(`pass-share:${share.id}`, 100, 3600e3))
          return gate(req, res, 429, 'Too many attempts', 'Wait a while and try again.');
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
  }
};
