# Security overview

Written for the people who have to approve Prototype Vault: security, privacy and IT. It says what the system does, what it protects against, what it does not, and how to configure it for a strict environment.

**Status.** Prototype Vault is a proof of concept written largely with an AI coding assistant. It has an end-to-end test suite (`cd server && npm test`), a linter and formatter in CI, and no third-party code in the server. It has had no independent security review or penetration test. Treat this document as the author's claims, verify them against the code (it is small on purpose), and report what you find. Known weaknesses and their fix order are in [OBJECTIONS.md](OBJECTIONS.md).

## 0. Reporting a vulnerability

Email prototype.security.contact@gmail.com with the details, or open a GitHub issue titled "Security" if nothing in it is sensitive. Do not include real prototype content or tester data in the report. There is no bounty. There is a promise to answer, fix or document within a reasonable time.

## 1. What the system is

A single Node.js process with no third-party packages that:

1. Accepts prototype bundles (HTML, CSS, JS, images, fonts) from a signed-in designer.
2. Stores them, encrypted, on local disk.
3. Serves them, from a separate origin, only to viewers who present a valid, unexpired, unrevoked credential.
4. Logs every access decision and admin action.
5. Optionally records viewer interactions (with consent) and free-text feedback for usability research.

**Outbound connections.** None, with one exception: when Google sign-in is configured, the server exchanges the sign-in code with Google's token endpoint. It never sends email, calls webhooks, fetches updates, or reports telemetry.

## 2. Who the threat is

| Threat | What they have | What stops them | What does not |
|---|---|---|---|
| Outsider guessing links | Nothing | 256-bit random link secrets, rate limit on redemption, every miss logged | |
| Ex-tester with an old link | A link that was valid | Expiry, per-viewer revocation, link rotation, open limits | A link that is still valid and not yet revoked |
| Tester who leaks content | A valid session | Watermark with their email on every screen, pages served only inside the frame, access log, viewer app with OS content protection | A phone camera; a browser screenshot |
| Malicious or tampered prototype | Designer uploaded it | Runs on its own origin, cannot reach console or shell, CSP blocks all other origins, no popups or downloads | Whatever the prototype does inside its own frame; another share open in the same browser, unless each share has its own hostname |
| Stolen personal token | A token for one designer | Sees and changes only that designer's shares; revocable from the Account page; hashed at rest | Everything that designer could do until revoked |
| Stolen server admin token | The shared token | Nothing inside the vault | Rotate `ADMIN_TOKEN` and revoke personal tokens |
| Copy of the data directory | The disk without the key | AES-256-GCM on files and metadata; link secrets, tokens and passcodes stored as hashes | With the key, everything |
| Host compromise | Root on the server | Standard host hardening; short retention | Everything |
| The operator | Runs the server | Nothing technical; audit log; MIT licence means you can run your own | |

## 3. Data handled

| Data | Where | Protection |
|---|---|---|
| Prototype files | `DATA_DIR/bundles/<share>/` | AES-256-GCM per file when `VAULT_ENCRYPTION_KEY` is set; file mode 0600 |
| Share metadata, viewer names and emails, session records, admin sessions | `DATA_DIR/store.json` | Same encryption; atomic writes; mode 0600 |
| Viewer link secrets, personal access tokens, Google sign-in sessions | inside store.json | SHA-256 hashes only |
| Passcodes | inside store.json | scrypt hash + salt |
| Access log | `DATA_DIR/audit/<share>.ndjson` and `_admin.ndjson` | append-only; contains email, IP, user agent, event type; `_admin.ndjson` trimmed to `RETENTION_DAYS` |
| Interaction events | `DATA_DIR/events/<share>.ndjson` | element descriptions, relative click positions, navigation, focus by field *type*, scroll depth, JS error messages. Typed values only when the share's "record typed text" option is on (off by default; never password fields; the value on change, never keystrokes). Never screenshots. |
| Feedback | `DATA_DIR/feedback/<share>.ndjson` | free text written by the tester, with their identity and location in the prototype |

The audit, events and feedback logs are not encrypted at rest because they are append-only streams. Put `DATA_DIR` on an encrypted volume (standard on cloud block storage) if this matters, or set `RETENTION_DAYS` low.

## 4. Access control

### Designers
There are no passwords stored in the vault. Four ways in:

- **SSO** (recommended for self-hosted teams): when the server sits behind an identity-aware proxy that sets a trusted email header, `ADMIN_EMAILS` grants console access to those identities. Requires `TRUST_PROXY=1` and `TRUSTED_HEADER_EMAIL`. MFA, device posture and offboarding come from the identity provider.
- **Google sign-in** (hosted deployments): `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` enable "Sign in with Google" on the console. The authorization-code flow with a state cookie; the ID token is taken from Google's token endpoint over TLS, which OpenID Connect Core 3.1.3.7 accepts in place of a signature check, and its audience, issuer and verified-email claims are checked. The session is a 30-day HttpOnly cookie, stored server-side as a hash. Cookie-authenticated requests that change anything must carry an `Origin` header matching the vault. `ADMIN_EMAILS`, if set, restricts who may sign in.
- **Server admin token**: `ADMIN_TOKEN` (min 24 chars), compared in constant time, sent as a Bearer header. The fallback for a server without a proxy, and the only identity that sees every share.
- **Personal access tokens**: created on the console's Account page ("Connect a tool"), one per tool. Random 24-byte secret shown once, stored as a SHA-256 hash, tagged with the creating identity. Revoked individually from the Account page or with `vault disconnect`. Creation and revocation are audited.

**Visibility.** Everyone except the server admin token sees, changes and deletes only the shares they created. Personal tokens inherit their creator's view.

**Limits.** `MAX_SHARES_PER_OWNER` and `MAX_STORAGE_MB_PER_OWNER` cap what one person can hold, counting prototype files, intro media and voice recordings (0 = unlimited). `ENTITLEMENTS_MODULE` can point at a module exporting `limits(owner)` to decide per person; that is where a paid tier would plug in, outside this repository.

**Leaving.** A person can delete everything they made in one step (`POST /api/me/leave`, the Account page's "Delete everything I made and leave"): every share they created, with files, viewers, sessions, recordings, events and feedback, plus their tokens and sign-in sessions. Audit entries stay for the retention period.

With no admin mechanism configured (quick start), the server generates a token and an encryption key on first start, stores them in `DATA_DIR/local-secrets.json` (mode 0600), and **binds to 127.0.0.1 only**. The token is printed once as a signed-in console link (`/admin#token=…`; URL fragments never reach the server or its logs). The key sitting next to the data it encrypts is why this mode is for a laptop.

### View-only shares
A share is **view only** unless the creator sets up a usability test. A view-only share records nothing about how the prototype is used: no interaction events, no typed text, no voice, no tasks, no feedback button, no consent screen. Access control, watermark and the access log are unchanged; those are security records.

### Viewers
Three mechanisms, usable together:

1. **Personal links** (default). Each invited person gets a 256-bit random secret bound to their email. The server keeps only its hash; the link is shown once when issued. The secret rides in the URL fragment (`#k=`), which browsers never send to a server, so it stays out of proxy and platform request logs; the gate page posts it to the server over the same origin. Redeeming it creates a server-side session (HttpOnly, SameSite=Lax cookie scoped to that share's path). Links can be revoked individually, rotated, limited to N opens, and all die when the share expires or is revoked.
2. **Passcode** (optional second factor). Six characters or more, scrypt-hashed, checked asynchronously so a guess cannot stall the server. 8 attempts per address per 15 minutes and 100 per share per hour, so a spoofed address does not help.
3. **SSO header** (optional). With `TRUST_PROXY=1` and `TRUSTED_HEADER_EMAIL`, a viewer authenticated by your proxy is admitted if their email is on the share's viewer list or their domain is on the share's allowlist.

Sessions expire after `SESSION_HOURS` (default 8) or when the share expires, whichever is first.

### Two origins
The console, the tester shell (consent, tasks, feedback, watermark) and the API live on the main origin. Prototype files and the interaction tracker are served **only** on the content origin (`CONTENT_ORIGIN`: a second port in quick start, a second hostname behind a proxy). The shell embeds the prototype in an iframe pointing at the content origin, handing over the tester's session through a one-time ticket that becomes a cookie there.

Result: a prototype's scripts run on an origin that holds nothing but that prototype. They cannot read the shell's page, remove the watermark, or call the console API. The prototype tells the shell which screen the tester is on through `postMessage`, and the shell accepts those messages only from the content origin.

Pages on the content origin are served only to framed requests: a browser that reports a top-level navigation (`Sec-Fetch-Dest` other than `iframe`) is turned away, so pasting the content address into a new tab does not produce an unwatermarked copy. Browsers that do not send that header (Safari before 16.4) are not covered.

With a single content hostname, shares are separated only by cookie path, which is not a security boundary: a hostile prototype could read another share that the same browser has open. `CONTENT_ORIGIN` with a wildcard gives each share its own hostname and closes that; see DEPLOYMENT.md.

### Content isolation
Every prototype response carries a Content Security Policy that permits loading only from the content origin (`'self'`), plus any origins explicitly allowed by both the server (`ALLOWED_EXTERNAL_ORIGINS`) and the share. `frame-ancestors` names the main origin so the prototype cannot be embedded elsewhere. All responses are `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`. `'unsafe-inline'` and `'unsafe-eval'` are allowed for scripts because prototypes are single-file by nature; the CSP's job here is egress control.

### Path safety
Bundle paths are normalised; `..`, absolute paths and control characters are rejected at upload and at serve time. Serving resolves within the share's directory and checks the prefix.

### Rate limits
In-memory per-process limits on link redemption (30 per address per 10 min), passcode attempts (8 per address per 15 min, 100 per share per hour), tickets, voice segments, event and feedback posts per session, plus a per-session ceiling on recorded events (20,000 or 5 MB). Over 50,000 tracked keys the oldest is dropped. Behind a proxy the client address is read `TRUSTED_PROXY_HOPS` entries from the right of `X-Forwarded-For`, so a caller cannot choose it. Let the proxy be the primary limiter.

### CSRF
Viewer and content-origin POSTs check the `Origin` header against the vault's own origins. Cookie-authenticated console requests that change anything do the same. Bearer tokens are not attached by browsers automatically.

### Voice, dictation and captions
- **Think-aloud voice recording** is off unless the share creator turns it on. The tester still decides on the consent screen, a persistent red "Recording" indicator with a Stop button shows throughout, and 5-second audio segments stream to the vault over the authenticated session. Segments are stored encrypted, listed on the results tab, and deleted with the share.
- **Dictation** (per share, off by default) turns speech into text in answer boxes using the tester's *browser* speech service (Chrome sends audio to Google, Safari to Apple). It is the one feature where audio leaves the tester's device to a third party. Nothing is sent by the server.
- **Captions and translations** are WebVTT files uploaded by the designer and served from the vault. Translation is done at authoring time, never by a live service.

## 5. What it does not protect against

- **Screenshots and screen recording by an authorised viewer, in a browser.** No web page can block them. The optional [viewer app](../viewer-app/README.md) requests the operating system's content-protection flag so captures of its window come out black on macOS and Windows. Nothing stops a phone camera. Inside the vault the per-viewer watermark and the audit log make a leak attributable.
- **A viewer saving the page source.** The prototype is delivered to their browser; that is the point.
- **A compromised admin token.** Treat it like a production secret. Prefer SSO or Google sign-in for teams.
- **Host compromise.** If someone has the encryption key and the disk, they have the prototypes.
- **Denial of service.** No special mitigation beyond rate limits and upload caps. Put it behind your normal proxy.

## 6. If something goes wrong

Four actions cover most incidents, each a single step:

1. **Rotate `ADMIN_TOKEN`** (set a new value, restart).
2. **Revoke personal tokens** on the Account page, or delete the `tokens` object in `store.json` and restart.
3. **Revoke affected shares** (console, `vault revoke`, or `PATCH /api/shares/:id {revoked:true}`). Every link and session for that share stops working.
4. **Rotate viewer links** for people who should keep access (console "Rotate", or `vault rotate`).

The `_admin.ndjson` log shows what happened and when.

## 7. Recommended configuration for strict environments

```
TRUST_PROXY=1
TRUSTED_HEADER_EMAIL=<your proxy's email header>
ADMIN_EMAILS=designer1@company.com,designer2@company.com
VAULT_ENCRYPTION_KEY=<64 hex chars, from a secrets manager>
PUBLIC_URL=https://prototypes.internal.company.com
CONTENT_ORIGIN=https://*.prototypes-content.internal.company.com   (a wildcard, one origin per share; or a single hostname)
TRUSTED_PROXY_HOPS=1
DEFAULT_EXPIRY_DAYS=7
MAX_EXPIRY_DAYS=30
RETENTION_DAYS=7
SESSION_HOURS=4
ALLOWED_EXTERNAL_ORIGINS=          (empty)
```

- Terminate TLS at the proxy; the server sets HSTS and `Secure` cookies when it sees `X-Forwarded-Proto: https`.
- Route both hostnames to the same process. The server tells them apart by the `Host` header.
- Run as a non-root user (the Dockerfile does), read-only filesystem except `DATA_DIR`.
- Back up `DATA_DIR` and the key separately.
- For external testers who are not in your IdP, use personal links plus passcode, and let the proxy pass the `/p/` path unauthenticated while keeping `/admin` and `/api` behind SSO.

## 8. Review checklist

- [ ] Source is small enough to read in full: `server/server.js` (routing), `server/lib/*.js` (one concern each), `server/public/*.js`. No `node_modules` in the server.
- [ ] `cd server && npm test` passes: quick start, auth, share defaults, the tester flow across both origins, passcode, rotation, expiry, tokens, SSO header handling, Google sign-in, limits, log trimming.
- [ ] `grep -rn "fetch(\|http.request\|https.request\|net.connect" server/server.js server/lib/` finds only the Google token exchange in `lib/admin.js`.
- [ ] Encryption enabled: startup log says `encryption at rest: on`; `head -c4 data/store.json` prints `VLT1`.
- [ ] `/api/shares` returns 401 without credentials.
- [ ] A guessed viewer link returns 403 and appears in the audit log as `link.rejected`.
- [ ] `/p/<id>/app/index.html` on the main origin returns 404; on the content origin it carries `Content-Security-Policy` with no external origins.
- [ ] `RETENTION_DAYS` matches your data retention policy.
- [ ] Interaction recording consent text reviewed by privacy (it is in `server/public/viewer.html`).

## 9. Privacy notes for research use

- Testers are told, before anything is recorded, what is captured and that access is logged regardless. They can decline recording and still use the prototype.
- Recorded data is tied to the invited email; treat it as personal data. Voice recordings and click-level behaviour recording of individuals are the kind of processing that triggers a Data Protection Impact Assessment in Europe; sections 2, 3 and 4 give the inputs.
- Recording employees' interactions may need works-council or equivalent agreement in some countries regardless of individual consent. View-only mode records nothing and needs none.
- Deleting a share removes its files, metadata, audit, events and feedback. `RETENTION_DAYS` after a share expires the server deletes it the same way, on its own. The `_admin.ndjson` log keeps admin actions and access events until they age out of the same window.
