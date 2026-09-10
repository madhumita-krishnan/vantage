# Code audit, 5 September 2026 (version 0.1.0)

A line-by-line read of the server, the browser code, the CLI library, the MCP server and the viewer app, looking for holes, bugs and abuse paths. Each finding names the file and line, says how it would be exploited or what breaks, and gives the fix. Line numbers refer to commit `d483488`.

Severity: **High** = exploitable now with real impact; **Medium** = exploitable with preconditions, or a bug that breaks a feature; **Low** = hardening. Effort as in OBJECTIONS.md: **S** hours, **M** a day.

## Summary

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | All shares sit on one content origin, so a prototype can read another share's files if the tester holds both sessions | High | M |
| 2 | Client IP taken from the first `X-Forwarded-For` entry; spoofable behind Cloud Run, which defeats the passcode rate limit | High (hosted) | S |
| 3 | Console cannot download reports, play recordings or upload media when signed in with Google (empty Bearer header) | Medium (bug) | S |
| 4 | A tester can defeat the watermark by opening the content origin directly in a tab | Medium | S |
| 5 | Personal link secret travels in the query string and lands in proxy and Cloud Run request logs | Medium (hosted) | S |
| 6 | Event `data` over 2,000 characters crashes the events endpoint with a 500 | Medium (bug) | S |
| 7 | CSV export has no formula-injection guard; tester-controlled text opens as a formula in Excel | Medium | S |
| 8 | Per-person storage limit ignores intro media and voice recordings; testers can fill a share's 1 GB media cap | Medium (hosted) | S |
| 9 | Events endpoint is limited by request count, not bytes; one session can write hundreds of megabytes a minute | Medium (hosted) | S |
| 10 | Activity filter uses a bare prefix match on the owner email, leaking entries to a near-name | Low | S |
| 11 | Tickets can be minted without limit by a valid session | Low | S |
| 12 | Retention purges prototype files but keeps share metadata, events and feedback forever | Low (privacy) | S |
| 13 | A corrupt or truncated `store.json` stops the server with no backup to fall back on | Low (ops) | S |
| 14 | Sandbox grants `allow-popups` and `allow-downloads` to prototypes for no reason | Low | S |
| 15 | `decodeURIComponent` on client-supplied headers and paths can throw and return a 500 | Low | S |
| 16 | `frame-ancestors` and the tracker's shell origin come from `PUBLIC_URL`; without it, Docker and LAN setups cannot frame prototypes | Low (bug) | S |
| 17 | MCP publish accepts any readable path; a prompt-injected agent could publish a home directory to a stranger | Low (AI agent) | S |
| 18 | Hosted open sign-up makes the service usable for phishing pages that record typed values through custom events | Low (abuse) | M |
| 19 | No sign-in domain allowlist for Google | Low (feature) | S |

Findings 3 and 6 are plain bugs and should be fixed today. Findings 1, 2, 4 and 5 are the ones a security reviewer will lead with.

**Update, version 0.2.0 (same day):** seventeen findings fixed, two (1 and 18) done on the code side and waiting on infrastructure or a product decision. Each finding below carries its status.

---

## 1. One content origin for every share (High, M)

**Status, 0.2.0:** code side done. `CONTENT_ORIGIN` accepts a wildcard and each share then gets its own hostname; the content policy no longer allows one share to frame another. The wildcard DNS and certificate are the owner's to set up.

**Where.** `server/lib/config.js:77-79` (one `CONTENT_ORIGIN`), `server/lib/viewer.js:228-245` (`handleContent`), `server/lib/shares.js:304-311` (content cookie scoped by path).

**What is wrong.** Moving prototypes off the console's origin was the right fix, but every share now shares the *same* content origin, with per-share session cookies distinguished only by cookie `Path`. Cookie paths are not a security boundary. JavaScript running in share A's prototype at `https://content…/p/A/app/` can call `fetch('/p/B/app/index.html', { credentials: 'include' })`; the browser attaches the `vs_B` cookie because the request path matches, and the CSP allows it because it is `'self'`. It can also post fake events into share B.

**Precondition.** The same browser holds a live content-origin session for both shares. Sessions last eight hours, so a tester invited to two designers' prototypes in one afternoon qualifies, as does a designer who previews their own work and was invited to someone else's. On a hosted service with strangers as designers, this is the realistic attack.

**Fix.** One origin per share, which is what GitHub Pages did when it moved to `<user>.github.io`: `https://<shareId>.content.example.com`. The ticket redirect already carries the share id, so the server change is small (build the content URL from the share id, accept any host matching the wildcard). The cost is infrastructure: a wildcard DNS record and a wildcard certificate. Cloud Run's domain mappings do not accept wildcards, so it needs a load balancer with a wildcard certificate, or Cloudflare in front. Until then, document the precondition, remove `'self'` from the content `frame-ancestors` (`viewer.js:53`) so one share cannot frame another, and treat finding 14 as part of this.

## 2. Spoofable client IP behind a proxy (High on Cloud Run, S)

**Status, 0.2.0:** fixed. Address read from the right (`TRUSTED_PROXY_HOPS`), per-share passcode cap, six-character minimum. Tested.

**Where.** `server/lib/http.js:55-58`.

**What is wrong.** With `TRUST_PROXY=1` the client IP is the *first* value of `X-Forwarded-For`. Google's front end, like most load balancers, appends the real client address to whatever the client already sent. So a client that sends `X-Forwarded-For: 1.2.3.4` is recorded as `1.2.3.4`, and every rate limit keyed by IP (link redemption, passcode attempts) resets with each new fake value. A four-digit passcode has ten thousand combinations; the eight-per-fifteen-minutes limit becomes no limit. The audit log's IP column is also attacker-chosen.

**Fix.** Take the address from the right-hand end: with one trusted proxy, the last entry. Add `TRUSTED_PROXY_HOPS` (default 1) and use `parts[parts.length - hops]`. Behind Cloudflare, prefer `CF-Connecting-IP`. Separately, add a per-share failure cap on passcodes that does not depend on IP (for example, 50 failures per share per hour locks the passcode until the designer rotates it), and require six characters instead of four.

## 3. Google sign-in cannot download, play or upload (Medium bug, S)

**Status, 0.2.0:** fixed in the three console helpers.

**Where.** `server/public/admin.html`, functions `download`, `blobUrl` and `uploadXhr`. They send `Authorization: Bearer ` + token unconditionally. A Google-signed-in session has no token, so the header is `Bearer ` with nothing after it. `adminFromReq` (`server/lib/admin.js:28-33`) sees a Bearer header, finds no matching token, and returns null before it ever looks at the cookie.

**Effect.** Reports, CSV, JSON export, voice playback, intro media upload and subtitle upload all return 401 for anyone signed in with Google. The `api()` helper in the same file already guards with `if (token)`; the three other helpers do not.

**Fix.** Send the header only when a token exists, and add a test that exercises one download through a Google session.

## 4. Watermark bypass by direct navigation (Medium, S)

**Status, 0.2.0:** fixed. `Sec-Fetch-Dest` check on content pages; popups and downloads removed from the sandbox. Tested.

**Where.** `server/lib/viewer.js:212-225` (`serveFile`), `server/public/viewer.html` (sandbox attribute).

**What is wrong.** After the shell loads a prototype, the tester's browser holds a content-origin cookie. Nothing stops the tester from pasting `https://content…/p/<id>/app/index.html` into a new tab, or the prototype from calling `window.open` on itself (the sandbox grants `allow-popups`). Either way the prototype renders full-screen with no shell, no watermark, no Feedback button. The watermark is the one leak deterrent the README promises.

**Fix.** Serve HTML on the content origin only to framed requests: refuse when `Sec-Fetch-Dest` is present and is not `iframe` or `frame` (Chrome, Firefox and Safari 16.4+ send it). Return a small page saying "open this from your link". Subresources carry other destinations and are unaffected. Remove `allow-popups` from the sandbox. Old browsers without the header still get through; this is a deterrent, and the docs should say so.

## 5. Link secret in the query string (Medium on hosted, S)

**Status, 0.2.0:** fixed. Links use `#k=` and a same-origin POST; `?k=` still accepted. Tested.

**Where.** `server/lib/shares.js:194-198` (`issueLink`), `server/lib/viewer.js:262-290` (redemption reads `?k=`).

**What is wrong.** Cloud Run, most reverse proxies and every CDN log the full request URL, query string included. Every personal link's secret therefore lands in Cloud Logging, readable by anyone with log access on the project, for the log retention period. The admin token already avoids this by travelling in the URL fragment; links should too.

**Fix.** Issue links as `/p/<id>#k=<secret>`. The gate page reads the fragment and POSTs it to `/p/<id>/redeem` (same-origin, Origin-checked), which sets the cookie and redirects. Fragments never reach any server or log. The redemption rate limit moves to the POST. Old `?k=` links can be accepted for a transition period.

## 6. Oversized event data returns 500 (Medium bug, S)

**Status, 0.2.0:** fixed and tested.

**Where.** `server/lib/viewer.js:107`: `JSON.parse(JSON.stringify(e.data).slice(0, 2000))`.

**What is wrong.** Slicing a JSON string at 2,000 characters produces invalid JSON whenever the data is longer, and `JSON.parse` throws. The whole batch of up to 500 events is lost and the tester's tracker gets a 500. A prototype with a long `aria-label` or a `custom` event with a big payload triggers it by accident; a tester triggers it on purpose.

**Fix.** Keep the data as a string if it is over the limit, or drop it: `const raw = JSON.stringify(e.data); data = raw.length > 2000 ? { truncated: raw.slice(0, 2000) } : e.data`.

## 7. CSV formula injection (Medium, S)

**Status, 0.2.0:** fixed and tested.

**Where.** `server/lib/results.js:56-79` (`eventsCsv`).

**What is wrong.** Cells are quoted but not neutralised. A value beginning with `=`, `+`, `-` or `@` is executed as a formula when the designer opens the export in Excel or Google Sheets. The `target` column is built from element descriptions the prototype's DOM controls, and `detail` holds whatever a `window.vantage.event` call sent, so both a malicious prototype and a tester can plant one.

**Fix.** In `q()`, prefix a single quote (or a tab) when the value starts with one of those characters, and strip control characters.

## 8. Storage limit does not count media (Medium on hosted, S)

**Status, 0.2.0:** fixed. Media and recordings count toward the owner's limit, recording uploads are rate-limited, `MAX_MEDIA_MB` defaults to 200. Tested.

**Where.** `server/lib/shares.js:151-161` (`enforceLimits` sums only `files.bytes`), `server/lib/media.js:115-136` (`appendRecording` caps at `MAX_MEDIA_MB`, default 1,024 per share).

**What is wrong.** A person capped at 200 MB of prototypes can still upload a 1 GB intro video per share, and every invited tester can stream up to the same 1 GB of voice segments into a share whether the designer wants them or not (the endpoint has no rate limit). On a free hosted tier this is how the disk fills.

**Fix.** Count intro media and recordings toward the owner's storage in `enforceLimits`, check it in `storeIntro` and `appendRecording`, lower `MAX_MEDIA_MB` to 200 by default, and rate-limit the recording endpoint per session.

## 9. Events are limited by count, not size (Medium on hosted, S)

**Status, 0.2.0:** fixed. 20,000 events or 5 MB per session.

**Where.** `server/lib/viewer.js:93-110`.

**What is wrong.** 600 requests a minute, each up to 512 KB and 500 events, is over 300 MB a minute per session, appended to a file that `Log.read` later loads whole into memory (`admin.js:403`, up to 200,000 lines). A tester can exhaust disk, and then take the console down when the designer opens the results tab.

**Fix.** Cap total events per session (for example 20,000) and bytes per session, stop accepting when reached, and read the events file in a streaming fashion or keep a rolling window.

## 10. Activity filter prefix match (Low, S)

**Status, 0.2.0:** fixed.

**Where.** `server/lib/admin.js:442-443`: `String(r.by || '').startsWith(ownerOf(admin))`.

**What is wrong.** `ana@a.example` is a prefix of `ana@a.example.org`, so a person with the shorter address sees the longer address's account activity (share names, token names). `ownsShare` in `shares.js:102-105` gets this right by requiring `owner + ' via '`; the activity filter should reuse it.

## 11. Unbounded ticket minting (Low, S)

**Status, 0.2.0:** fixed. 20 tickets per session per minute.

**Where.** `server/lib/viewer.js:142-149`.

**What is wrong.** Any valid session can call `_vantage/content` in a loop. Tickets expire after 60 seconds but pruning only runs past 1,000 entries and only removes expired ones, so a minute's worth of minting is held in memory. Rate-limit the endpoint per session (a handful per minute is plenty) and cap the map.

## 12. Retention keeps metadata, events and feedback forever (Low, privacy, S)

**Status, 0.2.0:** fixed. The whole share is deleted after the retention window. Tested.

**Where.** `server/lib/shares.js:345-365` (`sweep` purges only files).

**What is wrong.** The docs say data is retained for `RETENTION_DAYS` after expiry. Prototype files are; viewer names and emails, sessions, recorded events and feedback text stay until someone deletes the share by hand. Delete the whole share (metadata and logs) once the retention window passes, and say so in SECURITY.md.

## 13. No recovery path for a damaged store (Low, ops, S)

**Status, 0.2.0:** fixed. `store.json.bak` is kept and the error names it. Tested.

**Where.** `server/lib/store.js:16-29` (`load` has no error handling), `37-42` (`flush` writes then renames).

**What is wrong.** On a Cloud Storage FUSE mount, rename is a copy and delete, so a crash mid-flush can leave a truncated file. On the next start `JSON.parse` throws and the server does not come up. Refusing to start is right; having nothing to start from is not. Write `store.json.bak` before each rename, and on a parse failure print which file to restore.

## 14. Sandbox flags the prototype does not need (Low, S)

**Status, 0.2.0:** fixed.

**Where.** `server/public/viewer.html`, the iframe's `sandbox` attribute grants `allow-popups` and `allow-downloads`.

**What is wrong.** Popups are the watermark bypass in finding 4. Downloads let a prototype push a file at the tester. Neither is something a usability prototype needs. Drop both; keep `allow-scripts allow-same-origin allow-forms allow-modals`.

## 15. Unhandled `decodeURIComponent` (Low, S)

**Status, 0.2.0:** fixed.

**Where.** `server/lib/admin.js:327` and `:362` (headers `x-file-name`, `x-label`), `server/lib/viewer.js:243` (`rest.slice(5)`).

**What is wrong.** A malformed percent sequence throws `URIError`, which the top-level handler turns into a 500 and a stack trace on stderr. Wrap each in a helper that returns the raw string on failure, or reject with 400.

## 16. Framing depends on `PUBLIC_URL` (Low, bug, S)

**Status, 0.2.0:** fixed. The shell's origin is recorded on the session when the frame is opened.

**Where.** `server/lib/config.js:80` (`mainOrigin` falls back to `http://localhost:<port>`), used by `viewer.js:53` (`frame-ancestors`) and `:87` (tracker's `shell` origin).

**What is wrong.** In Docker or on a LAN without `PUBLIC_URL`, the console is opened as `http://192.168.x.y:8787` but the content origin only allows `http://localhost:8787` to frame it, and the tracker posts location messages to the wrong origin. Prototypes render blank. The server already knows the shell's real origin when it mints the ticket (`baseUrl(req)`); store it on the session and use it for both headers.

## 17. MCP publish takes any path (Low, AI agent, S)

**Status, 0.2.0:** fixed. Paths outside the working directory need `allowAnyPath`; a top-level HTML file and under 2,000 files are required.

**Where.** `mcp/server.js:192-217` passes `a.path` straight to `cli/lib.js:243` (`publish`), which walks the folder and uploads every file.

**What is wrong.** A prompt-injected agent holding a Vantage token can publish any directory the user can read to any email address. The skill tells the agent to confirm first; the server does not enforce anything. Refuse paths outside the current working directory unless the user passes an explicit override, require an `.html` file at the top level, and cap the file count.

## 18. Phishing through the hosted service (Low, abuse, M)

**Status, 0.3.2:** closed. Open sign-up no longer exists: Google sign-in requires `ADMIN_EMAILS` or `ALLOWED_SIGNIN_DOMAINS`, and the server refuses to start without one. Every designer on a server was named by its operator.

**Status, 0.2.0:** partly. The shell shows who shared the prototype, the consent text names custom events, and `ABUSE_EMAIL` puts a report address in front of testers. Open sign-up itself is a product decision; `ALLOWED_SIGNIN_DOMAINS` exists for teams that want it closed.

**Where.** Open sign-up (`config.js:40`), custom events (`server/public/tracker.js`, `window.vantage.event`).

**What is wrong.** Anyone with a Google account can publish an arbitrary page on your content domain and send "personal links" to victims. The CSP stops the page sending anything to the internet, but `window.vantage.event('pw', value)` records typed values into the events log that the page's owner reads back. So the service can host credential-harvesting pages that look legitimate. Mitigations: show the sharing designer's email in the shell header so the tester sees who sent it, offer a report-abuse link on every tester page, and keep `recordText` and custom events off unless consent was given (they are, through `recording`, but the consent text should name custom events).

## 19. No sign-in domain allowlist (Low, feature, S)

**Status, 0.2.0:** fixed (`ALLOWED_SIGNIN_DOMAINS`).

**Where.** `server/lib/admin.js:123`.

**What is wrong.** `ADMIN_EMAILS` is all or nothing. A team that wants "anyone at our company" has no option. Add `ALLOWED_SIGNIN_DOMAINS`.

---

## What is sound

For balance, the things a reviewer will check that hold up:

- Link, session, token and admin-session secrets are 256-bit random and stored as SHA-256 hashes. Comparison is constant-time.
- Passcodes use salted scrypt, asynchronously.
- Path handling rejects `..`, absolute paths and control characters at upload and at serve time, and checks the resolved prefix.
- The console escapes every dynamic value it renders; the tester shell does the same.
- Cookie-authenticated writes and tester POSTs check `Origin`; cookies are `HttpOnly`, `SameSite=Lax` (or `None; Secure` where a cross-site frame needs it).
- The Google flow uses a state cookie, checks audience, issuer and verified email, and takes the ID token only from the token endpoint over TLS.
- Encryption at rest is AES-256-GCM with a fresh random nonce per object.
- No third-party code in the server; the outbound surface is one token exchange.

## Suggested order

1. Findings 3 and 6 (bugs), plus 10, 15 and 16 while in those files. Half a day.
2. Findings 2, 4, 5, 7, 14. One day. These change what a reviewer can say about the hosted version.
3. Findings 8, 9, 11, 12, 13. One day. These are what keep a free service alive.
4. Finding 1, once there is a domain and a decision on Cloudflare or a load balancer.
5. Findings 17, 18, 19 as the hosted version gets users.
