# Security overview

This document is written for the people who have to approve Prototype Vault: security, privacy and IT. It says what the system does, what it protects against, what it does not, and how to configure it for a strict environment.

**Status.** Prototype Vault is a proof of concept written largely with an AI coding assistant. It has an end-to-end test suite (`cd server && npm test`) and no third-party code, but it has had no independent security review or penetration test. Please treat this document as the author's claims, verify them against the code (it is small on purpose), and report what you find.

## 0. Reporting a vulnerability

Open a GitHub issue titled "Security" with the details, or email the maintainer listed in the repository if the issue is sensitive. Do not include real prototype content or tester data in the report. There is no bounty; there is a promise to answer, fix or document within a reasonable time.

## 1. What the system is

A single-process HTTP server (Node.js, no third-party packages) that:

1. Accepts prototype bundles (HTML, CSS, JS, images, fonts) from an authenticated administrator.
2. Stores them, encrypted, on local disk.
3. Serves them only to viewers who present a valid, unexpired, unrevoked credential.
4. Logs every access decision and admin action.
5. Optionally records viewer interactions (with consent) and free-text feedback for usability research.

It has **no outbound network connections**. It does not send email, call webhooks, fetch updates, or report telemetry. Its only network activity is answering the HTTP requests it receives.

## 2. Data handled

| Data | Where | Protection |
|---|---|---|
| Prototype files | `DATA_DIR/bundles/<share>/` | AES-256-GCM per file when `VAULT_ENCRYPTION_KEY` is set; file mode 0600 |
| Share metadata, viewer names and emails, viewer link tokens, session records | `DATA_DIR/store.json` | Same encryption; atomic writes; mode 0600 |
| Passcodes | inside store.json | scrypt hash + salt, never stored in clear |
| Access log | `DATA_DIR/audit/<share>.ndjson` and `_admin.ndjson` | append-only; contains email, IP, user agent, event type |
| Interaction events | `DATA_DIR/events/<share>.ndjson` | element descriptions, relative click positions, navigation, focus by field *type*, scroll depth, JS error messages. Typed values only when the share's "record typed text" option is on (off by default; never password fields; the value on change, never keystrokes). Never screenshots. |
| Feedback | `DATA_DIR/feedback/<share>.ndjson` | free text written by the tester, with their identity and location in the prototype |

The audit/events/feedback logs are not encrypted at rest by default because they are append-only streams. Put `DATA_DIR` on an encrypted volume (standard on cloud block storage) if this matters. Or set `RETENTION_DAYS` low.

## 3. Access control

### Administrators (designers)
There are no user accounts and no passwords stored in the vault. Three credentials exist:

- **SSO** (recommended): when the server sits behind an identity-aware proxy that sets a trusted email header, `ADMIN_EMAILS` grants admin rights to those identities without any token. Requires `TRUST_PROXY=1` and `TRUSTED_HEADER_EMAIL`. MFA, device posture and central offboarding come from the IdP. `SSO_LOGOUT_URL` gives the console a sign-out button that ends the proxy session.
- **Server admin token**: `ADMIN_TOKEN` (min 24 chars), compared in constant time, sent as a Bearer header. The sign-in screen fallback for servers without a proxy.
- **Personal access tokens**: created on the console's Account page ("Connect a tool"), one per tool (Claude Code, CLI, MCP). Random 24-byte secret shown once, stored only as a SHA-256 hash, tagged with the creating identity, name, creation and last-use time. Revoked ("Disconnect") individually from the Account page or with `vault disconnect`; a revoked token fails on its next request. At most 50 active. Creation and revocation are audited (`token.created`, `token.revoked`), as are all unauthorized API attempts.

**Leaving.** An SSO or personal-token identity can delete everything it made in one step (`POST /api/me/leave`, the Account page's "Delete everything I made and leave"): every share it created, with files, viewers, sessions, recordings, events and feedback, plus all its tokens revoked. Audit entries stay for the retention period. The shared server admin token cannot "leave" because it is not a person; rotate it instead.

With neither `ADMIN_TOKEN` nor SSO admin configured (quick start), the server generates a token and an encryption key on first start, stores them in `DATA_DIR/local-secrets.json` (mode 0600), and **binds to 127.0.0.1 only**, so nothing on the network can reach it until `HOST` is set deliberately. The token is printed once to the process's stdout as a signed-in console link (`/admin#token=…`; URL fragments are never sent to the server, so it does not appear in access logs). The key sitting next to the data it encrypts is why this mode is for a laptop: a deployment should set both values explicitly, at which point the file is ignored. The sign-in screen (`/api/auth`) reveals only which mechanisms exist, never a secret.

### View-only shares
A share is **View only** unless the creator sets up a usability test (a mode, or tasks). A view-only share records nothing about how the prototype is used: no interaction events, no typed text, no voice, no tasks, no feedback button, and no consent screen (an intro can still be shown). Access control, watermark and the access log (who opened it, when, from where) are unchanged; those are security records, not research data.

### Viewers
Three mechanisms, usable together:

1. **Personal links** (default). Each invited person gets a 256-bit random token bound to their email. Redeeming it creates a server-side session (HttpOnly, SameSite=Lax cookie scoped to that share's path only) and the token is removed from the URL by redirect. Links can be revoked individually, rotated (old link dies, new one issued), limited to N opens, and all die when the share expires or is revoked.
2. **Passcode** (optional second factor). scrypt-hashed. 8 attempts per IP per 15 minutes. Intended to be shared through a different channel than the link.
3. **SSO header** (optional). With `TRUST_PROXY=1` and `TRUSTED_HEADER_EMAIL`, a viewer authenticated by your proxy is admitted if their email is on the share's viewer list, or their domain is on the share's SSO allowlist. This gives you MFA, device posture and central revocation from your IdP for free.

Sessions expire after `SESSION_HOURS` (default 8) or when the share expires, whichever is first.

### Content isolation
Prototypes run inside a sandboxed iframe and every prototype response carries a Content Security Policy that permits loading only from the vault itself (`'self'`), plus any origins explicitly allowed by both the server (`ALLOWED_EXTERNAL_ORIGINS`) and the share. `connect-src`, `img-src`, `font-src`, `script-src`, `style-src`, `frame-src` and `form-action` are all constrained. `frame-ancestors 'self'` prevents embedding the prototype in another site. All responses are `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`.

Result: a prototype cannot exfiltrate data to the internet, cannot load trackers, and cannot be cached by intermediaries. `'unsafe-inline'` and `'unsafe-eval'` are allowed for scripts because prototypes are single-file by nature; the prototype author is a trusted insider and the CSP's job here is egress control, not XSS defence.

### Path safety
Bundle paths are normalised; `..`, absolute paths and control characters are rejected at upload and at serve time. Serving resolves within the share's directory and checks the prefix.

### Rate limits
In-memory per-process limits on link redemption (30 per IP per 10 min), passcode attempts (8 per IP per 15 min), event and feedback posts per session.

### CSRF
Viewer POST endpoints check the `Origin` header against the vault's own origin. Cookies are `SameSite=Lax`. Admin API needs a Bearer token, which browsers do not attach automatically.

### Voice, dictation and captions
- **Think-aloud voice recording** is off unless the share creator turns it on ("Offer think-aloud voice recording"). When on, the tester still decides on the consent screen (the switch there defaults to on and can be turned off), a persistent red "Recording" indicator with a Stop button shows throughout, and 5-second audio segments stream to the vault over the same authenticated session. The server refuses audio for shares where the option is off. Segments are stored encrypted like other media, listed on the results tab, and deleted with the share. Total media per share is capped by `MAX_MEDIA_MB`.
- **Dictation** (per share, on by default) turns speech into text in answer boxes using the tester's *browser* speech service (Chrome sends audio to Google, Safari to Apple, Firefox has none). That is the one feature where audio leaves the tester's device to a third party, so turn "Allow dictation" off for shares where that matters. Nothing is sent by the server.
- **Captions and translations** are WebVTT files uploaded by the designer and served from the vault. Translation is done at authoring time (for example by Claude), never by a live translation service.

## 4. What it does not protect against

- **Screenshots and screen recording by an authorised viewer, in a browser.** No web page can block them: browsers expose no API for it. The "black screenshot" some apps show comes from the operating system (macOS window sharing type, Windows capture exclusion, Android's secure-window flag), which only a native app can request. That is what the optional [viewer app](../viewer-app/README.md) does: one Electron window with content protection on, locked to the vault's origin, so screenshots, screen recordings and screen shares of it come out black on macOS and Windows. It does not exist for Linux, iOS offers no equivalent to web content, and no software stops a phone camera. Alongside it, the device policy your company already has: mobile device management can disable screenshots on managed phones. Inside the vault the per-viewer watermark and the audit log make a leak attributable. Keep viewer lists short and expiry tight.
- **A viewer saving the page source.** Same as above. The prototype is delivered to their browser; that is the point.
- **A compromised admin token.** Treat it like a production secret. Prefer SSO admin for teams.
- **Host compromise.** If someone has the encryption key and the disk, they have the prototypes. Standard host hardening applies.
- **Denial of service.** No special mitigation beyond rate limits and upload caps. Put it behind your normal proxy.

## 5. Recommended configuration for strict environments

```
TRUST_PROXY=1
TRUSTED_HEADER_EMAIL=<your proxy's email header>
ADMIN_EMAILS=designer1@company.com,designer2@company.com
VAULT_ENCRYPTION_KEY=<64 hex chars, from a secrets manager>
PUBLIC_URL=https://prototypes.internal.company.com
DEFAULT_EXPIRY_DAYS=7
MAX_EXPIRY_DAYS=30
RETENTION_DAYS=7
SESSION_HOURS=4
ALLOWED_EXTERNAL_ORIGINS=          (empty)
```

- Terminate TLS at the proxy; the server sets HSTS and `Secure` cookies when it sees `X-Forwarded-Proto: https`.
- Run as a non-root user (the Dockerfile does), read-only filesystem except `DATA_DIR`.
- Back up `DATA_DIR` and the key separately.
- For external testers (customers, agencies) who are not in your IdP, use personal links plus passcode, and restrict the proxy to allow the `/p/` path unauthenticated while keeping `/admin` and `/api` behind SSO.

## 6. Review checklist

- [ ] Source is small enough to read in full: `server/server.js` (routing), `server/lib/*.js` (one concern each), `server/public/*.js`. No `node_modules`.
- [ ] `cd server && npm test` passes: quick start, auth, share defaults, the whole tester flow, passcode, rotation, expiry, tokens, SSO header handling.
- [ ] `grep -rn "fetch(\|http.request\|https.request\|net.connect" server/server.js server/lib/` finds nothing: the server makes no outbound calls. (The browser files in `server/public/` fetch only relative, same-origin paths.)
- [ ] Encryption enabled: startup log says `encryption at rest: on`; `head -c4 data/store.json` prints `VLT1`.
- [ ] Admin token or SSO configured; `/api/shares` returns 401 without credentials.
- [ ] A guessed viewer link returns 403 and appears in the audit log as `link.rejected`.
- [ ] A prototype response carries `Content-Security-Policy` with no external origins.
- [ ] `RETENTION_DAYS` matches your data retention policy.
- [ ] Interaction recording consent text reviewed by privacy (it is in `server/public/viewer.html`).

## 7. Privacy notes for research use

- Testers are told, before anything is recorded, what is captured and that access is logged regardless. They can decline recording and still use the prototype.
- Recorded data is pseudonymous only in the sense that it is tied to the invited email; treat it as personal data.
- Deleting a share (admin page or `vault delete`) removes its files, metadata, audit, events and feedback. The consolidated `_admin.ndjson` log retains admin actions and access events for that share until you rotate it.
