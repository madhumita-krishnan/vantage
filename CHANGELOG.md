# Changelog

## 0.3.1 (2026-09-06)

Line-by-line review of 0.3.0 by the author and two independent passes. Thirty defects found, all fixed; the server-side ones have tests that fail on 0.3.0. Nothing in the API changed shape.

**Security**

- `requireSignIn` was enforced on the console address only. The content address accepted the same session token before the tester had signed in, so a forwarded link could still fetch the prototype files with a copied cookie. The content address now applies the identity gate too.
- Admins signed in through the company SSO header had no cross-site check on writes, unlike Google sessions. They have one now.
- A viewer, share or recording id spelling an `Object.prototype` member (`__proto__`, `constructor`) reached the record maps. Lookups are own-property only.
- Unauthenticated console calls were written to the admin log without limit; they are now logged a few times per address per hour. The admin log holds admin events only, so the account page's recent-activity window is no longer pushed out by tester events.
- The CLI no longer follows symbolic links when collecting a prototype folder, and a relative `url()` inside a page's `<style>` is no longer resolved against a placeholder host.

**Data loss and availability**

- Replacing or removing a share's intro recording deleted every voice and screen recording in the share, and its caption files, while the results tab kept listing them. Only the intro and its captions are removed now.
- A bundle upload deleted the old files before writing the new ones, so a bundle the server refused half-way (a name used as both a file and a folder, a disk error) left the share with no prototype. New files are written beside the old ones and swapped in; a bundle with such a clash, or two paths differing only in case, is refused up front.
- A tester closing a media download mid-stream left the request waiting forever with an open file. A disk error while an intro uploaded, or a stream failing after its headers were sent, ended the process. All three are handled.
- Media written before `VAULT_ENCRYPTION_KEY` was set was misread after the key was added. Each file is now read by its own header, like the store.
- The console's live refresh on the results tab replaced the page every five seconds, discarding a moderator note being typed and stopping a recording being played. It now waits.
- Only the first item of a multi-item drop reached the New share page, because the browser empties the drop list at the first pause. Every dropped file and folder is taken first.
- The subtitle list lost an entry on any request naming that language, including a GET or a rejected file. Language codes are normalised the same way on upload and playback, so `zh_TW` plays.

**Fixes**

- Choosing "Open this file first" in the console after dropping a folder failed with "Entry file not found", because the server strips the folder name from the paths but not from the entry. Fixed.
- Saving a share's settings shifted every "After task N" rule down by one each time, because the editor showed the server's 0-based index and subtracted one again on save. The editor now shows and reads the number the way it was typed.
- A suffix range request (`Range: bytes=-500`) on intro media returned the first bytes instead of the last.
- A non-numeric `expiresInDays` created a share with no expiry date and answered 500. It is refused with 400.
- A malformed cookie set by another app on the same host made every page answer 500.
- A retried recording segment counted twice against the media limit; a segment far out of sequence made playback stat a hundred thousand files. Segments must arrive in order and a retry replaces its earlier copy.
- Voice or screen recording could be switched on with the consent screen off, which left testers no way to start recording. Offering either now turns the consent screen on, and the screen appears even when interaction recording is off.
- The tester page ignored the chosen intro kind: text saved under "Your text" still showed after switching back to "Standard", and a removed kind left an empty "Before you start" box. The page follows the kind.
- The "recording started" mark posted by the tester page went to an address that did not exist, so it never reached the event log.
- After "Hide tasks", scheduled tasks kept announcing themselves. A task appearing no longer wipes a note being typed. A refused feedback or task answer (rate limit, view-only) now says so instead of "Thanks, feedback sent".
- The drop zones lost their file pickers after the first pick, so a second click did nothing. A revoked viewer's link no longer shows or copies. Switching a share's purpose in Settings now sets "Show tasks" the way New share does. Results loaded for one share can no longer paint over another share's page. Tag attributes containing `$` survive `vault inline`.
- Viewer app: launching it a second time without a link no longer replaces the prototype that is open.

## 0.3.0 (2026-09-06)

**Recording**

- Screen recording, per share and off by default (`--screen`, the `screen` option in the console and MCP). The tester chooses on the consent screen and picks the prototype tab in the browser's own dialog; the video, with the voice track when both are on, streams to the vault in the same five-second segments as voice and plays back on the results tab. It stops itself when the share's media limit is reached. Desktop browsers only.
- The Recording pill now shows a level meter driven by the microphone, so testers can see their voice is being picked up.
- Dictation removed. It used the browser's speech service, which sends audio to Google or Apple, and voice recording already covers think-aloud.

**Security**

- Per-share `requireSignIn`: testers must sign in with Google as the invited address before the link opens, so a forwarded link opens nothing. Needs Google sign-in on the server; a mismatch is logged. Console switch, `--require-sign-in`, MCP option.
- The rate limiter never evicts a live bucket. When its table is full it drops expired entries and, if still full, refuses new keys until a window ends, so a flood of junk keys cannot reset someone's limit.
- With Google sign-in open to anyone, the server refuses to start on a shared content origin unless `ALLOW_SHARED_CONTENT_ORIGIN=1`.
- Every refusal (rejected link, failed passcode, wrong sign-in, unauthorized admin call) is also written to stderr as a `vault-refused` line for log-based alerting. The deployment guide gained "Knowing when something is wrong"; the security document gained an adversary's-view appendix.

**Repository**

- `docs/PROCESS.md` is the author's private record and is no longer in the repository or its history.

## 0.2.0 (2026-09-05)

Fixes for seventeen of the nineteen findings in the line-by-line audit ([docs/AUDIT.md](docs/AUDIT.md)).

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
