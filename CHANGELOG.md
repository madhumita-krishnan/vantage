# Changelog

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
