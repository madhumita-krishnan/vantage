'use strict';
// Share domain: creation, viewers, sessions, bundles, audit, API views, limits, retention sweep.
const fs = require('fs');
const path = require('path');
const C = require('./crypto');
const { normalizeFiles, cleanPath } = require('./bundle');
const { list } = require('./config');

const MODES = ['view', 'unmoderated', 'moderated'];
const MEDIA_TYPES = {
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/webm': 'audio',
  'audio/ogg': 'audio',
  'audio/aac': 'audio',
};
const TASK_KINDS = ['task', 'question'];
const WHEN_TYPES = ['start', 'after', 'screen', 'minutes'];
const now = () => Date.now();
const iso = (t) => new Date(t).toISOString();

// Tasks are { text, kind: task|question, when: { type: start|after|screen|minutes, value } }. Plain strings still accepted.
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
function shareStatus(share) {
  return share.revoked ? 'revoked' : share.expiresAt <= now() ? 'expired' : 'active';
}
// 'view' = just for looking: no tasks, no interaction, voice or screen recording, no consent screen, no feedback button. Opens are still logged.
function applyMode(share) {
  if (share.voice || share.screen) share.requireConsent = true; // testers choose recording on the consent screen
  if (share.mode === 'view')
    Object.assign(share, {
      recordSessions: false,
      recordText: false,
      voice: false,
      screen: false,
      showTasks: false,
      tasks: [],
    });
}
function normalizeIntro(b, current) {
  const cur = current || { kind: 'default', text: '', media: null };
  if (!b) return cur;
  const kind = ['default', 'text', 'audio', 'video'].includes(b.kind) ? b.kind : cur.kind;
  const text = b.text != null ? String(b.text).slice(0, 8000) : cur.text;
  if ((kind === 'audio' || kind === 'video') && !cur.media) return { ...cur, kind: text ? 'text' : 'default', text };
  return { ...cur, kind, text };
}
function parseViewerSpec(spec) {
  // "Name <email>" | "email" | {name,email}
  if (spec && typeof spec === 'object')
    return {
      name: String(spec.name || '').trim(),
      email: String(spec.email || '')
        .trim()
        .toLowerCase(),
    };
  const m = String(spec || '')
    .trim()
    .match(/^(.*?)\s*<([^>]+)>$/);
  return m
    ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim().toLowerCase() }
    : {
        name: '',
        email: String(spec || '')
          .trim()
          .toLowerCase(),
      };
}
const ssoAllowOf = (b) => ({
  emails: list((b || {}).emails).map((e) => e.toLowerCase()),
  domains: list((b || {}).domains).map((d) => d.toLowerCase().replace(/^@/, '')),
});
const ownsShare = (share, owner) => {
  const by = String(share.createdBy || '');
  return by === owner || by.startsWith(owner + ' via ');
};
// The person behind a share: "ana@x.com" or "ana@x.com via Claude Code" both belong to ana@x.com.
const shareOwner = (share) => String(share.createdBy || '').split(' via ')[0];
// Bytes a share holds: prototype files, intro media and recordings.
const shareBytes = (s) =>
  ((s.files && s.files.bytes) || 0) +
  ((s.intro && s.intro.media && s.intro.media.size) || 0) +
  Object.values(s.recordings || {}).reduce((a, r) => a + (r.size || 0), 0);

module.exports = function shares(ctx) {
  const { CONFIG, store, blob, audit, events, feedback, H } = ctx;
  const { httpError, clientIp, baseUrl, isHttps, parseCookies, setCookie } = H;

  const bundleDir = (id) => path.join(CONFIG.dataDir, 'bundles', id);
  const mediaDir = (id) => path.join(CONFIG.dataDir, 'media', id);
  const removeMedia = (id) => fs.rmSync(mediaDir(id), { recursive: true, force: true });

  function writeBundle(id, files) {
    const dir = bundleDir(id);
    const tmp = dir + '.tmp'; // written beside the old bundle and swapped in, so a failed upload leaves the old one serving
    fs.rmSync(tmp, { recursive: true, force: true });
    let bytes = 0;
    for (const f of files) {
      const target = path.join(tmp, f.path);
      if (!target.startsWith(tmp + path.sep)) throw httpError(400, 'Unsafe path');
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, blob.encode(f.data), { mode: 0o600 });
      bytes += f.data.length;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    return { count: files.length, bytes, paths: files.map((f) => f.path).slice(0, 2000) };
  }
  function readBundleFile(id, rel) {
    const dir = bundleDir(id);
    let target;
    try {
      target = path.join(dir, cleanPath(rel));
    } catch {
      return null;
    }
    if (!target.startsWith(dir + path.sep)) return null;
    try {
      return fs.statSync(target).isFile() ? blob.decode(fs.readFileSync(target)) : null;
    } catch {
      return null;
    }
  }
  function bufferFilesFromJson(files) {
    if (!Array.isArray(files)) throw httpError(400, 'files must be an array of {path, contentBase64}');
    return files.map((f) => ({
      path: String(f.path || ''),
      data: Buffer.from(String(f.contentBase64 || ''), 'base64'),
    }));
  }
  // Per-person limits: shares, and bytes across prototype files, intro media and recordings. The owner is read from
  // the share, so the same check serves designers uploading and testers recording. The server admin token is exempt.
  function enforceLimits(share, addBytes) {
    const owner = shareOwner(share);
    if (owner === 'admin-token') return;
    const lim = CONFIG.limits(owner) || {};
    const mine = Object.values(store.data.shares).filter((s) => ownsShare(s, owner) && s.id !== share.id);
    if (lim.shares && !store.data.shares[share.id] && mine.length >= lim.shares)
      throw httpError(403, `Limit reached: ${lim.shares} shares per person. Delete one first.`);
    const used = mine.reduce((a, s) => a + shareBytes(s), 0) + shareBytes(share) + addBytes;
    if (lim.storageMb && used > lim.storageMb * 1048576)
      throw httpError(403, `Limit reached: ${lim.storageMb} MB of files, media and recordings per person.`);
  }
  function setBundle(share, files, entry) {
    let norm;
    try {
      norm = normalizeFiles(bufferFilesFromJson(files), entry);
    } catch (e) {
      throw e.status ? e : httpError(400, e.message);
    }
    const current = (share.files && share.files.bytes) || 0;
    enforceLimits(share, norm.files.reduce((a, f) => a + f.data.length, 0) - current);
    share.files = writeBundle(share.id, norm.files);
    share.entry = norm.entry;
  }

  function logAudit(share, type, req, extra = {}) {
    const rec = {
      ts: iso(now()),
      type,
      shareId: share ? share.id : null,
      ip: req ? clientIp(req) : null,
      ua: req ? String(req.headers['user-agent'] || '').slice(0, 200) : null,
      ...extra,
    };
    audit.append(share ? share.id : '_admin', rec);
    if (share && /^(share\.|admin\.)/.test(type)) audit.append('_admin', rec); // the account page's window
    // One line per refusal on stderr, so a hosting platform's log alert can page the operator without the vault
    // ever calling out.
    if (/rejected|denied|fail|mismatch|unauthorized/.test(type)) console.error('vault-refused', JSON.stringify(rec));
  }

  // A personal link's secret is stored only as a hash, like the API tokens, so a copy of the store cannot open
  // prototypes. The link is returned once, when it is issued; "rotate" issues a new one. The secret rides in the URL
  // fragment, which browsers never send to a server, so it stays out of proxy and platform request logs.
  function issueLink(req, share, v) {
    const t = C.randomToken();
    v.token = C.sha256(t);
    return `${baseUrl(req)}/p/${share.id}#k=${t}`;
  }
  function viewerView(share, v, link) {
    const out = {
      id: v.id,
      name: v.name,
      email: v.email,
      createdAt: iso(v.createdAt),
      revoked: !!v.revoked,
      opens: v.opens || 0,
      maxOpens: v.maxOpens || 0,
      lastSeenAt: v.lastSeenAt ? iso(v.lastSeenAt) : null,
      source: v.source || 'invite',
    };
    if (link) out.link = link;
    return out;
  }
  function shareView(req, share, full, links = {}) {
    const viewers = Object.values(share.viewers || {});
    const intro = share.intro || { kind: 'default', text: '', media: null };
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
      recordings: Object.entries(share.recordings || {}).map(([sid, r]) => ({
        session: sid,
        viewerId: r.viewerId,
        viewer: (share.viewers[r.viewerId] || {}).name,
        email: (share.viewers[r.viewerId] || {}).email,
        mime: r.mime,
        size: r.size,
        segments: r.segments,
        startedAt: iso(r.startedAt),
        updatedAt: iso(r.updatedAt),
      })),
      externalOrigins: share.externalOrigins || [],
      ssoAllow: share.ssoAllow || { emails: [], domains: [] },
      files: share.files ? { count: share.files.count, bytes: share.files.bytes } : null,
      mode: share.mode || 'unmoderated',
      intro: { ...intro, subtitles: intro.subtitles || [] },
      viewerCount: viewers.filter((v) => !v.revoked).length,
      totalOpens: viewers.reduce((a, v) => a + (v.opens || 0), 0),
      url: `${baseUrl(req)}/p/${share.id}`,
      createdBy: share.createdBy || '',
    };
    if (full) {
      out.viewers = viewers.map((v) => viewerView(share, v, links[v.id]));
      out.filePaths = share.files ? share.files.paths : [];
    }
    return out;
  }
  function addViewer(share, spec, source = 'invite', maxOpens = 0) {
    const { name, email } = parseViewerSpec(spec);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, `Invalid viewer email: ${email || '(empty)'}`);
    const existing = Object.values(share.viewers).find((v) => v.email === email && !v.revoked);
    if (existing) return existing;
    const v = {
      id: C.randomId(6),
      name: name || email.split('@')[0],
      email,
      token: null,
      createdAt: now(),
      revoked: false,
      opens: 0,
      maxOpens: +maxOpens || 0,
      lastSeenAt: null,
      source,
    };
    share.viewers[v.id] = v;
    return v;
  }
  function validateExternalOrigins(origins) {
    const out = new Set();
    for (const o of origins || []) {
      let u;
      try {
        u = new URL(o);
      } catch {
        throw httpError(400, `Invalid external origin: ${o}`);
      }
      if (!CONFIG.allowedExternalOrigins.includes(u.origin))
        throw httpError(
          400,
          `External origin not allowed by server policy: ${u.origin}. Ask the server admin to add it to ALLOWED_EXTERNAL_ORIGINS, or inline the asset with "vault inline".`
        );
      out.add(u.origin);
    }
    return [...out];
  }

  // ---- viewer sessions: HttpOnly cookie scoped to the share path, hashed server side ----
  const cookieName = (id) => `vs_${id}`;
  // `cross` is the copy set on the content origin, which sits in an iframe; over HTTPS it needs SameSite=None.
  function setSessionCookie(req, res, share, tok, cross) {
    setCookie(res, cookieName(share.id), tok, {
      path: `/p/${share.id}`,
      maxAge: CONFIG.sessionHours * 3600,
      secure: isHttps(req),
      sameSite: cross && isHttps(req) ? 'None' : 'Lax',
    });
  }
  // Testers must sign in with Google as the invited address: only possible where Google sign-in is configured.
  function requireSignInOf(v) {
    if (!v) return false;
    if (!CONFIG.googleClientId)
      throw httpError(400, 'Testers cannot be asked to sign in: Google sign-in is not configured on this server');
    return true;
  }
  function createSession(req, share, viewer) {
    const tok = C.randomToken();
    store.data.sessions[C.sha256(tok)] = {
      id: C.randomId(6),
      shareId: share.id,
      viewerId: viewer.id,
      createdAt: now(),
      expiresAt: Math.min(now() + CONFIG.sessionHours * 3600e3, share.expiresAt),
      passcodeOk: false,
      consent: null,
      ip: clientIp(req),
    };
    store.save();
    return tok;
  }
  const sessionKey = (req, share) => C.sha256(parseCookies(req)[cookieName(share.id)] || '');
  function getSession(req, share) {
    const tok = parseCookies(req)[cookieName(share.id)];
    const s = tok && store.data.sessions[C.sha256(tok)];
    if (!s || s.shareId !== share.id || s.expiresAt < now()) return null;
    const v = share.viewers[s.viewerId];
    return v && !v.revoked ? s : null;
  }
  function dropSessions(pred) {
    for (const [k, s] of Object.entries(store.data.sessions)) if (pred(s)) delete store.data.sessions[k];
  }

  function purgeFiles(share) {
    fs.rmSync(bundleDir(share.id), { recursive: true, force: true });
    removeMedia(share.id);
    if (share.intro && share.intro.media)
      share.intro = { kind: share.intro.text ? 'text' : 'default', text: share.intro.text, media: null };
    share.files = null;
  }
  function sweep() {
    const t = now();
    const before = Object.keys(store.data.sessions).length;
    dropSessions((s) => s.expiresAt < t);
    let changed = Object.keys(store.data.sessions).length !== before;
    for (const [k, s] of Object.entries(store.data.adminSessions))
      if (s.expiresAt < t) {
        delete store.data.adminSessions[k];
        changed = true;
      }
    // Past the retention window a share goes entirely: files, viewers, sessions, events, feedback and its audit log.
    for (const share of Object.values(store.data.shares))
      if (share.expiresAt + CONFIG.retentionDays * 86400e3 < t) deleteShare(share, null, { who: 'retention' });
    audit.trim('_admin', iso(t - CONFIG.retentionDays * 86400e3));
    if (changed) store.save();
  }
  function deleteShare(share, req, admin) {
    purgeFiles(share);
    delete store.data.shares[share.id];
    dropSessions((s) => s.shareId === share.id);
    store.save();
    events.remove(share.id);
    feedback.remove(share.id);
    logAudit(share, 'share.deleted', req, { by: admin.who, name: share.name });
    audit.remove(share.id);
  }
  function requireShare(id) {
    const share = Object.hasOwn(store.data.shares, id) && store.data.shares[id];
    if (!share) throw httpError(404, 'Share not found');
    return share;
  }
  function expiryFrom(b) {
    if (b.expiresAt) {
      const t = Date.parse(b.expiresAt);
      if (isNaN(t)) throw httpError(400, 'expiresAt must be an ISO date');
      return t;
    }
    const days = +(b.expiresInDays || CONFIG.defaultExpiryDays);
    if (!(days > 0)) throw httpError(400, 'expiresInDays must be a positive number');
    return now() + Math.min(days, CONFIG.maxExpiryDays) * 86400e3;
  }
  // Create a share from an API body. Purpose defaults to view-only unless the body asks for a test (a mode, or tasks).
  // Personal links for the viewers land in `links` (viewer id -> link); they are not stored anywhere.
  async function createShare(b, req, admin, links = {}) {
    const name = String(b.name || '')
      .trim()
      .slice(0, 120);
    if (!name) throw httpError(400, 'name is required');
    if (b.passcode && String(b.passcode).length < 6) throw httpError(400, 'passcode must be at least 6 characters');
    const expiresAt = expiryFrom(b);
    if (expiresAt > now() + CONFIG.maxExpiryDays * 86400e3)
      throw httpError(400, `Expiry exceeds server maximum of ${CONFIG.maxExpiryDays} days`);
    const tasks = normalizeTasks(b.tasks);
    const share = {
      id: C.randomId(9),
      name,
      createdAt: now(),
      expiresAt,
      revoked: false,
      createdBy: admin.who,
      mode: MODES.includes(b.mode) ? b.mode : tasks.length ? 'unmoderated' : 'view',
      passcode: b.passcode ? await C.hashPasscode(String(b.passcode)) : null,
      watermark: b.watermark !== false,
      recordSessions: b.recordSessions !== false,
      requireConsent: b.requireConsent !== false,
      tasks,
      showTasks: b.showTasks != null ? !!b.showTasks : b.mode !== 'moderated',
      voice: !!b.voice,
      screen: !!b.screen,
      requireSignIn: requireSignInOf(b.requireSignIn),
      recordText: !!b.recordText,
      recordings: {},
      notes: String(b.notes || '').slice(0, 2000),
      externalOrigins: validateExternalOrigins(b.externalOrigins),
      ssoAllow: ssoAllowOf(b.ssoAllow),
      viewers: {},
      entry: null,
      files: null,
      intro: normalizeIntro(b.intro, null),
    };
    applyMode(share);
    for (const v of Array.isArray(b.viewers) ? b.viewers : list(b.viewers)) {
      const viewer = addViewer(share, v, 'invite', b.maxOpensPerViewer);
      links[viewer.id] = issueLink(req, share, viewer);
    }
    if (Array.isArray(b.files) && b.files.length) setBundle(share, b.files, b.entry);
    else enforceLimits(share, 0);
    store.data.shares[share.id] = share;
    store.save();
    logAudit(share, 'share.created', req, { by: admin.who, name, viewers: Object.keys(share.viewers).length });
    return share;
  }
  async function updateShare(share, b, req, admin) {
    const changes = {};
    const set = (k, v) => {
      share[k] = v;
      changes[k] = v;
    };
    if (b.name != null) set('name', String(b.name).trim().slice(0, 120));
    if (b.revoked != null) set('revoked', !!b.revoked);
    if (b.expiresAt != null || b.extendDays != null) {
      const t =
        b.expiresAt != null ? Date.parse(b.expiresAt) : Math.max(share.expiresAt, now()) + +b.extendDays * 86400e3;
      if (isNaN(t) || t > now() + CONFIG.maxExpiryDays * 86400e3)
        throw httpError(400, 'Invalid expiry or beyond the server maximum');
      set('expiresAt', t);
      changes.expiresAt = iso(t);
    }
    if (b.tasks != null) {
      set('tasks', normalizeTasks(b.tasks));
      changes.tasks = share.tasks.length;
    }
    for (const k of ['showTasks', 'screen', 'recordText', 'voice', 'watermark', 'recordSessions', 'requireConsent'])
      if (b[k] != null) set(k, !!b[k]);
    if (b.requireSignIn != null) set('requireSignIn', requireSignInOf(b.requireSignIn));
    if (b.notes != null) share.notes = String(b.notes).slice(0, 2000);
    if (b.mode != null) {
      if (!MODES.includes(b.mode)) throw httpError(400, 'mode must be view, unmoderated or moderated');
      set('mode', b.mode);
    }
    if (b.intro != null) {
      share.intro = normalizeIntro(b.intro, share.intro);
      changes.intro = share.intro.kind;
    }
    if (b.passcode !== undefined) {
      if (b.passcode && String(b.passcode).length < 6) throw httpError(400, 'passcode must be at least 6 characters');
      share.passcode = b.passcode ? await C.hashPasscode(String(b.passcode)) : null;
      changes.passcode = !!b.passcode;
    }
    if (b.externalOrigins != null) set('externalOrigins', validateExternalOrigins(b.externalOrigins));
    if (b.ssoAllow != null) set('ssoAllow', ssoAllowOf(b.ssoAllow));
    applyMode(share);
    store.save();
    logAudit(share, changes.revoked ? 'share.revoked' : 'share.updated', req, { by: admin.who, changes });
  }
  // "Try it": publishes the example prototype from examples/ to one viewer, with tasks, so a first-time user can open
  // their own link and see exactly what a tester sees.
  function createSampleShare(b, req, admin, links) {
    const dir = path.join(CONFIG.root, '..', 'examples', 'sample-prototype');
    if (!fs.existsSync(dir)) throw httpError(404, 'The examples folder is not on this server');
    const files = fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => ({
        path: path.relative(dir, path.join(d.parentPath || d.path, d.name)),
        contentBase64: fs.readFileSync(path.join(d.parentPath || d.path, d.name)).toString('base64'),
      }));
    return createShare(
      {
        name: 'Sample: Acme Billing',
        viewers: b.viewer ? [String(b.viewer)] : [],
        expiresInDays: 7,
        files,
        entry: 'index.html',
        mode: 'unmoderated',
        tasks: [
          { text: 'Choose the Team plan, billed annually', kind: 'task' },
          { text: 'Add a team member', kind: 'task', when: { type: 'after', value: 0 } },
          {
            text: 'What would you change about the billing address step?',
            kind: 'question',
            when: { type: 'screen', value: '#billing' },
          },
        ],
        notes:
          'The example prototype that ships with Prototype Vault. Open your own link to see the tester side, then delete this whenever you like.',
      },
      req,
      admin,
      links
    );
  }

  return {
    MODES,
    MEDIA_TYPES,
    now,
    iso,
    normalizeTasks,
    shareStatus,
    applyMode,
    normalizeIntro,
    bundleDir,
    mediaDir,
    removeMedia,
    readBundleFile,
    setBundle,
    enforceLimits,
    shareOwner,
    logAudit,
    issueLink,
    viewerView,
    shareView,
    addViewer,
    setSessionCookie,
    createSession,
    sessionKey,
    getSession,
    dropSessions,
    sweep,
    deleteShare,
    ownsShare,
    requireShare,
    createShare,
    updateShare,
    createSampleShare,
  };
};
Object.assign(module.exports, {
  MODES,
  MEDIA_TYPES,
  normalizeTasks,
  shareStatus,
  parseViewerSpec,
  ownsShare,
  shareOwner,
});
