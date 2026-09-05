# Anticipated objections, and how to design around them

A senior engineer, a security reviewer, a privacy officer and an engineering director will each pick this project apart differently. This document lists what each will say, whether it is fair, what I say back, and what design change answers it. Findings marked **verified** were confirmed in the source on 5 September 2026; the file and line are given so anyone can check.

Effort: **S** = an hour or two, **M** = a day, **L** = several days or a design change.

---

## Part 1. What a senior or staff engineer will say

### 1.1 "Your sandbox is not a sandbox." (verified, the most important finding)

**What they will say.** The prototype iframe in `server/public/viewer.html` uses `sandbox="allow-scripts allow-same-origin …"`. The HTML specification warns that this combination lets the framed page remove its own sandbox attribute, because it is same-origin with the parent. On top of that, prototypes are served from the vault's own origin (`/p/<id>/app/…`), the same origin as the designer console at `/admin`. So the browser's same-origin policy, the strongest boundary a browser has, does not separate a prototype from the console or from other prototypes.

**Concrete consequence.** A prototype's JavaScript can reach into the viewer shell and remove the watermark overlay, call the tester endpoints, and, if a designer opens a prototype in a tab that also holds a console session, read the admin token from `sessionStorage`. Prototypes are uploaded by trusted designers, so the attacker here is a malicious or compromised prototype, for example one whose inlined CDN bundle was tampered with. The CSP still blocks sending anything to the internet, but the console API is same-origin and in scope.

**Is it fair?** Yes. This is how GitHub Pages, Figma, CodePen and every "run user content" product got burned before they moved user content to a separate origin.

**Design response (M).** Serve prototypes from a second origin: a `PROTOTYPE_ORIGIN` setting (a sibling hostname such as `prototypes-content.internal.company.com`, or a second port for quick start). Drop `allow-same-origin` so the frame is an opaque origin. Pass the tester session to the tracker as a short-lived token in the frame URL instead of relying on a cookie. The console and tester shell stay where they are. This is the change I would make before any other.

**What to say in the meantime.** "Prototypes are uploaded by named admins and cannot reach the internet, but they share an origin with the console. Moving user content to its own origin is the first item on the list."

### 1.2 "You hash the API tokens but store viewer link tokens in plaintext." (verified)

`server/lib/shares.js`, `addViewer`: `token: C.randomToken()` is stored as is. Personal access tokens in `admin.js` are stored as SHA-256 hashes. The store is encrypted at rest, so the exposure is a decrypted store or a running process, but the inconsistency will be noticed.

**Why it is this way.** The console needs to show "copy link" again later.

**Design response (S).** Store a hash, show the link once when the viewer is added, and use the existing rotate action to issue a new one. Or keep it and say the trade-off out loud. I would hash it; "copy link later" is a convenience, not a requirement.

### 1.3 "scryptSync blocks the event loop." (verified)

`server/lib/crypto.js`, `verifyPasscode` uses `crypto.scryptSync`. Every passcode attempt stalls every other request for the duration of the hash. The per-IP rate limit does not help against many IPs.

**Design response (S).** Use the async `crypto.scrypt`. Ten-line change.

### 1.4 "The rate limiter can be reset by the attacker." (verified)

`server/lib/http.js`, `rateLimit`: when the bucket map exceeds 50,000 keys it calls `buckets.clear()`. Spraying junk keys wipes everyone's limits. It is also per process (useless across replicas) and keyed by IP, which behind a proxy without `TRUST_PROXY` means every tester shares one limit.

**Design response (S).** Evict the oldest bucket instead of clearing, and document that limits are single-instance. Behind a real proxy, the proxy's rate limiting should be the primary control anyway.

### 1.5 "Uploads are base64 JSON held entirely in memory." (verified)

`POST /api/shares` reads up to `MAX_UPLOAD_MB` (default 100) of JSON with `readJson`, parses it, then base64-decodes each file. Peak memory is roughly three times the upload. Two concurrent uploads by legitimate admins can take the process down. The media path (`lib/media.js`) streams properly in 1 MiB chunks, so the project already knows how to do this; the bundle path just was not given the same care.

**Design response (M).** Upload files one at a time with `PUT /api/shares/:id/bundle/<path>` streaming to disk, or accept multipart. Lower the default cap to 25 MB in the meantime.

### 1.6 "A single JSON file rewritten on every change is not a database."

`server/lib/store.js` keeps all shares, sessions and tokens in one object, rewrites the whole file 150 ms after any change, and has no locking. Two instances on one volume would corrupt it. A crash inside the debounce window loses the last write.

**Is it fair?** Partly. For a per-team deployment with tens of shares this is fine, and it is why there is no database to operate. It is not fine for a company-wide instance.

**Design response.** Document the limit honestly (S): single instance, up to a few hundred shares. If it ever needs more, Node 22's built-in `node:sqlite` keeps the zero-dependency rule (M).

### 1.7 "Every admin can see, modify and delete every share." (verified)

`server/lib/admin.js`, `shareRoute` fetches the share with `requireShare` and never checks ownership. The `ownsShare` helper exists but is only used for counts and for "leave". A designer with a personal token on team A can read team B's viewer links and download team B's voice recordings.

**Design response (S).** Enforce `ownsShare` in `shareRoute` for personal-token and SSO identities; let the server token see everything. Add an optional `ADMIN_EMAILS` "owner" role later if teams want a lead who sees all.

### 1.8 "Your AI agent holds a token that can delete shares and download recordings." (verified)

Personal access tokens have no scopes. The MCP server exposes `vault_delete_share` and `vault_get_events`. A prompt-injected Claude session holding that token can do anything the designer can.

**Design response (M).** Scoped tokens: `publish`, `results`, `admin`. The "Connect a tool" dialog defaults to `publish` + `results`. Remove delete from the MCP tool list; deletion is a console action with a confirm dialog.

### 1.9 "The tracker injection can break a page."

`server/lib/viewer.js`, `injectTracker`: when the HTML has no `<head>` tag the script is prepended before `<!DOCTYPE html>`, which drops the page into quirks mode. Rare, but a bug.

**Design response (S).** Insert after the doctype, or after `<html>`, before falling back to prepending.

### 1.10 "The admin audit log grows forever and is never purged." (verified)

Per-share audit files are deleted with the share; `_admin.ndjson` is appended to and never rotated or trimmed. It holds tester emails and IPs past any retention window. SECURITY.md admits it.

**Design response (S).** Trim `_admin.ndjson` in the sweep to `RETENTION_DAYS`, or rotate it monthly.

### 1.11 "Zero dependencies is a nice line, but the code is compressed, not small." (verified)

`public/admin.html` is 60 KB in 229 lines; its longest line is 1,241 characters and 129 lines exceed 160 characters. `lib/viewer.js` has a 711-character line. Engineers read line counts as a proxy for size, and they will feel misled when they open the file.

**Design response (S).** Run Prettier at 120 columns and let the line count triple. Change the README to say "about 60 KB of server code" or drop the number. Never optimise a metric that a reviewer can falsify in one `wc`.

### 1.12 "No CI, no lint, no browser tests, and it says version 1.0.0."

There are ten end-to-end tests, which is more than most proof-of-concepts have, but nothing runs them automatically, there is no linter, the console and tester UI are not tested in a browser, and `package.json` calls a two-day proof of concept 1.0.0.

**Design response (S).** GitHub Actions running `npm test` on Node 20 and 22, ESLint with the recommended rules, version `0.1.0`, a CHANGELOG. Add one Playwright test for the tester flow when time allows (M).

### 1.13 Smaller things they will list

- **Node 18 is end-of-life** (April 2025); `engines` should say 20 or newer. (S)
- **Docs drift.** DEPLOYMENT.md says `MAX_EXPIRY_DAYS` defaults to 90; `lib/config.js` says 365. README claimed zip upload after it was removed (fixed 5 Sept). A test that prints the config defaults into the docs would stop this. (S)
- **`/api/me` over-shares.** It returns the data directory path, the secrets file path, the MCP path, admin emails and the Node version to any token holder. Trim it to what the Account page needs. (S)
- **Encryption format has no key id and no associated data.** Rotation is "re-upload everything" and a ciphertext moved between paths still decrypts. Add a key version byte and bind the share id and path as AAD. (M)
- **SSO header trust is by network position only.** If the server is ever reachable around the proxy, the header is forgeable. DEPLOYMENT.md says so; a shared secret header from the proxy would make it enforceable. (S)
- **Electron is a dependency.** The "zero dependencies" claim does not cover the viewer app, which pulls in Chromium and needs signing, notarisation and updates. Say so, and keep it clearly optional. (S, wording)

---

## Part 2. What a security reviewer will add

Most of Part 1 applies. Beyond it:

**"Who is the threat?"** Make the threat model explicit in one table: outsider with a guessed link; ex-tester with an old link; insider with a stolen admin token; malicious prototype; compromised host; the vault operator themselves. Say which controls address each and which do not. SECURITY.md has the pieces; it does not have the table. (S)

**"Unaudited means unaudited."** Do not argue. The answer is: small, readable, tested, threat-modelled, with a disclosure route, and looking for reviewers. Ask them to be one.

**"Dictation sends audio to Google by default."** It is per share and documented, but default-on for usability tests will get quoted. Default it off. (S)

**"Logging tester IP and user agent is personal data."** True, and it is a security record, not research data. Keep it, shorten retention for the audit log to match `RETENTION_DAYS`, and say why it exists (attribution of leaks). (S, wording plus 1.10)

**"Incident response?"** Write the four-line runbook: rotate `ADMIN_TOKEN`, revoke all personal tokens, revoke affected shares, rotate viewer links. All four are single actions today; they just are not written down together. (S)

---

## Part 3. What a privacy officer or works council will say

**Data Protection Impact Assessment.** Voice recording of testers, click-level behaviour recording and email-stamped watermarks are exactly what triggers a DPIA in Europe. Provide the inputs: what is collected, why, legal basis (consent for research data, legitimate interest for the access log), retention, who can see it. Half of this is already in SECURITY.md sections 2 and 7. (S, document)

**Right to erasure.** Deleting a share removes its data, but there is no "delete everything about tester X across all shares", and the admin log keeps their email. Add a per-email erasure action and an export for subject access requests. (M)

**Consent versioning.** The consent screen text lives in `viewer.html`; the log records that consent was given but not to which wording. Version the consent text and log the version. (S)

**Employee testers.** In Germany and some other countries, recording employees' interactions needs works council agreement regardless of individual consent. Say in the docs that internal usability tests may need that approval, and that view-only mode records nothing and needs none. (S, wording)

---

## Part 4. What an engineering director or design leader will say

**"Why not Cloudflare Access in front of a static bucket?"** Fair, and the honest answer is that the hosting and sign-in half of Prototype Vault is commodity. Any identity-aware proxy gives SSO, MFA and an access log for internal viewers in an afternoon. What it does not give is per-person expiring links for external testers, a consent screen, tasks, interaction recording and feedback with no data leaving the network. Position the product as the research layer that happens to include hosting, not as hosting. The DEPLOYMENT.md path "behind your proxy" should be the headline path, and the laptop quick start should be labelled as a demo.

**"You built a usability-testing product, not a sharing tool."** Also fair. Seven passes added moderated mode, timed questions, intro video with subtitles and translation, dictation and think-aloud audio before the core was tested by anyone. A director will call it scope creep. Own it: the first pass was sharing; the design passes turned it into Lookback without the SaaS. The design response is to tier it: a **core** profile (share, view only, links, expiry, audit) and a **research** profile (everything else), so a security review of the core is a short read. (M, mostly configuration and docs)

**"Who owns this in a year?"** Bus factor of one, written largely by an AI, security-adjacent. The only honest answer is an adoption path: MIT licence, fork into the company's own org, their platform team owns the deployment, I own the upstream. A tool nobody owns should not hold confidential data, and I will say that in the pitch.

**"This is shadow IT."** The premise is designers blocked by IT; the answer cannot be designers routing around IT. The design response is already in place (Docker image, proxy setup, SSO header, an IT-facing deployment doc); the pitch needs to lead with "hand this to IT" rather than "run this on your laptop".

**"Multi-team?"** See 1.7. Today the answer is one deployment per team. Ownership enforcement is a small change; real tenancy is not on the roadmap.

**"What did two days of engineering cost the design work?"** Answer with the outcome: a design org that can run confidential usability tests on coded prototypes without a vendor, and a designer who now knows what the security team will ask. Then stop talking.

**"Are you a developer or a designer?"** Do not claim to have written the code line by line; the process document says the AI did most of that. Claim what is true and verifiable: requirements, the design system, the security and privacy decisions, the reversals, the testing, and the ability to read the code well enough to have found the items in Part 1. "Designer who ships" or "design engineer" survives questioning; "front-end developer" invites the question "walk me through `crypto.js`", so be ready to.

---

## Part 5. Questions to be able to answer cold

If you present this, someone will ask one of these. Short answers:

- **What does `allow-same-origin` do on an iframe?** It lets the framed page keep its real origin instead of an opaque one. Combined with `allow-scripts`, the framed page can reach the parent and remove the sandbox. That is finding 1.1.
- **Why AES-GCM and not CBC?** GCM authenticates as well as encrypts; a tampered file fails to decrypt instead of decrypting to garbage. 96-bit random IV per file, never reused because each file is encrypted once.
- **Why scrypt for passcodes?** Memory-hard, so brute force on a stolen store is expensive. The sync call is the mistake, not the algorithm.
- **Why hash tokens but encrypt files?** Tokens only ever need comparing; files need reading back. Hash what you compare, encrypt what you read. Viewer links break that rule (1.2).
- **What does the CSP actually stop?** A prototype loading or sending anything to an origin other than the vault. It does not stop inline scripts, because prototypes are inline scripts.
- **Why no accounts?** Every password store is a liability; the company already has one. The vault trusts a header the proxy sets and a list of admin emails.
- **Where is the tester's session?** An HttpOnly, SameSite=Lax cookie scoped to `/p/<share>`, stored server-side as a hash, expiring with the share or after `SESSION_HOURS`.
- **What happens if the encryption key is lost?** Everything encrypted with it is gone. Shares are short-lived by design, so the recovery is "re-publish".
- **How would you scale it?** You would not, past one team; you would run one per team. Past that, SQLite via `node:sqlite` and a separate content origin.

---

## Part 6. The order to fix things

| Priority | Item | Effort | Why first |
|---|---|---|---|
| 1 | Separate content origin, drop `allow-same-origin` (1.1) | M | The one finding that turns into a headline |
| 2 | Ownership check in `shareRoute` (1.7) | S | Privacy of other teams' testers |
| 3 | Async scrypt, rate-limiter eviction (1.3, 1.4) | S | Cheap, and both are "obvious" to reviewers |
| 4 | Hash viewer link tokens (1.2) | S | Consistency with the token story |
| 5 | Prettier, ESLint, CI, version 0.1.0, Node 20+ (1.11, 1.12, 1.13) | S | Removes every cosmetic dunk in one commit |
| 6 | Trim `/api/me`, purge `_admin.ndjson`, dictation off by default, doc drift (1.10, 1.13, Part 2) | S | Half a day of small things |
| 7 | Scoped tokens, drop delete from MCP (1.8) | M | AI-agent governance is the question of the year |
| 8 | Streaming bundle upload (1.5) | M | Only matters once real teams use it |
| 9 | Core vs research profile, threat-model table, DPIA inputs, erasure and export (Parts 2 to 4) | M | What makes the security and privacy conversations short |

Do items 1 to 6 before posting anything. Items 7 to 9 can be the public roadmap, which is itself an answer: a roadmap shows you know where the gaps are.
