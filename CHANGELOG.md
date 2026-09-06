# Changelog

## 0.2.0 (2026-09-05)

Fixes for sixteen of the nineteen findings in the line-by-line audit ([docs/AUDIT.md](docs/AUDIT.md)).

**Security**
- Personal links carry their secret in the URL fragment (`#k=`) and the gate page redeems it with a same-origin POST, so the secret never appears in proxy or platform request logs. Links in the older `?k=` form still work.
- Behind a proxy the client address is read from the right-hand end of `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`, default 1), so a caller cannot choose its own address. Passcode attempts are also capped per share, independent of address, and passcodes must be six characters or more.
- Prototype pages on the content origin are served only to framed requests (`Sec-Fetch-Dest`), which closes the "paste the address in a new tab" route around the watermark. The frame no longer grants popups or downloads.
- `CONTENT_ORIGIN` accepts a wildcard (`https://*.content.example.com`); each share then gets its own origin. The content policy no longer lets one share frame another.
- Spreadsheet formulas in CSV exports are defused. The activity filter matches owners exactly.
- Per-person storage limits now count intro media and voice recordings, and recording uploads are rate-limited. Event recording is capped per session by count and bytes. `MAX_MEDIA_MB` defaults to 200.
- Past the retention window the whole share is deleted, not only its files.
- `ALLOWED_SIGNIN_DOMAINS` restricts Google sign-in to company domains. `ABUSE_EMAIL` puts a report address in front of testers. The tester shell shows who shared the prototype.
- The MCP publish tool refuses paths outside the current project unless told otherwise, and the CLI refuses folders with no top-level HTML file or with thousands of files.

**Fixes**
- The console sent an empty `Authorization` header for downloads, playback and uploads when signed in with Google, and was refused. Fixed.
- Event data over 2,000 characters no longer fails the whole batch; it is kept, truncated.
- Docker and LAN setups without `PUBLIC_URL` can frame prototypes: the shell's origin is recorded when the frame is opened.
- Malformed percent-encoding in headers or paths no longer returns a 500.
- The metadata store keeps a `.bak` copy and reports which file to restore if it cannot be read.

**Console**
- The console is now one file per page under `server/public/admin/` (shared helpers and router, sign-in, list and server, form pieces, new share, share detail, account) instead of a single 1,500-line file of template strings. Same behaviour; every page was walked in a browser afterwards.

**Docs**
- `docs/WHAT-IT-CANNOT-DO.md` for designers, `docs/TESTING.md` on how the code was checked, `NEEDS-YOU.md` for the owner's to-do list.
- README's third step now says plainly that Claude is optional and that sharing needs each person's email address.

## 0.1.0 (2026-09-05)

First numbered version. Everything before this was a proof of concept at "1.0.0", which it was not.

**Security**
- Prototype files and the tracker are served only from a second origin (`CONTENT_ORIGIN`, second port by default). A prototype's scripts can no longer reach the console, the tester shell, or another share. The shell learns the tester's screen through `postMessage`.
- Viewer link secrets are stored as SHA-256 hashes and shown once, when issued. Old stores are converted on load.
- Everyone except the server admin token sees, changes and deletes only the shares they created. Personal tokens are scoped to their owner.
- Passcode hashing is asynchronous; a guess no longer stalls other requests.
- The rate limiter drops its oldest entry under pressure instead of clearing everything.
- Cookie-authenticated console writes require a matching `Origin` header.
- `/api/me` no longer returns filesystem paths, the Node version, or the admin list.
- The admin audit log is trimmed to `RETENTION_DAYS`.
- Dictation is off by default per share.

**Hosted deployments**
- "Sign in with Google" (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). Sessions are hashed server side, 30 days, with sign-out and "leave" support.
- Per-person limits: `MAX_SHARES_PER_OWNER`, `MAX_STORAGE_MB_PER_OWNER`, or an `ENTITLEMENTS_MODULE`.
- Cloud Run recipe in the deployment doc.

**Fixes**
- Tracker injection no longer lands before the doctype on pages without a `<head>`.
- Deployment doc now matches the code: `MAX_EXPIRY_DAYS` defaults to 365, `MAX_UPLOAD_MB` to 25.

**Removed**
- `vault_delete_share` MCP tool. Deletion is a console or CLI action.

**Tooling**
- Prettier and ESLint at the repository root (dev only; the server still has no dependencies), CI on Node 20 and 22, `engines` set to Node 20+.
- Test suite grew from 10 to 14 tests.
