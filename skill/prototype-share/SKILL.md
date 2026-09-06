---
name: prototype-share
description: Share a coded prototype (HTML/JS folder or single file) confidentially with named people through the company's self-hosted Vantage, and later read back usability results. Use when the user says things like "share this prototype with…", "send this to the testers", "make a private link for…", "who has opened the prototype", "what did testers say", "revoke access", or asks how to share a Claude-built prototype without Vercel or public hosting.
---

# Share a prototype through Vantage

Vantage is a self-hosted server that gives each viewer a personal, expiring link and serves the prototype in a locked-down sandbox inside the company network. This skill drives it from the CLI at `cli/vantage.js` (or the MCP tools if the `vantage` MCP server is connected; prefer MCP tools when present).

## Setup check (once per machine)

1. Locate the CLI: it lives at `cli/vantage.js` in the Vantage folder. If the path is unknown, ask.
2. Run `node <path>/cli/vantage.js list`. It connects in one of two ways: a Vantage started on this machine with no settings (the CLI reads `server/data/local-secrets.json` next to it), or `VANTAGE_URL` and `VANTAGE_ADMIN_TOKEN` in the environment for a remote Vantage.
3. If it says it is not connected: ask whether the user wants the local Vantage (they start it with `node server/server.js`; do not start it for them unless asked) or a company vantage, in which case ask for the URL and token (the token is a secret; do not echo it back, do not write it to files in the project). Never invent a URL.

If there is no vantage anywhere yet, point the user to `README.md` ("Try it in three steps") and `docs/DEPLOYMENT.md`. Do not try to stand one up on public hosting.

## Publishing

1. **Identify the prototype**: the folder or `.html` file. Confirm it has an entry HTML file. If the prototype is a framework project (Vite, Next, CRA), build it first and publish the build output folder.
2. **Make it self-contained.** Run `node cli/vantage.js inline <path>` (or rely on `publish`, which inlines automatically into a temp copy). Read the "Still referenced externally" list. For each item:
   - CDN script/style/font: the inliner handles it. If a fetch failed, retry or ask the user.
   - ES module imports from `esm.sh`/`unpkg` inside `<script type="module">`: the inliner cannot vendor dependency graphs. Ask the user whether to switch to UMD builds from cdnjs, or accept that it will not load.
   - Live API calls: the Vantage blocks them. Suggest mocking data inside the prototype.
     Do not ask the server admin to allow external origins as a first resort.
3. **Confirm with the user before publishing**, in one message: share name, viewer list (name + email each), expiry in days, whether to require a passcode, and whether this is a review (view only, the default: nothing recorded) or a usability test (tasks, consent, interaction recording; add `--voice` only if they want think-aloud audio). Personal data and access are involved; do not guess emails or add people who were not named.
4. **Publish**:
   ```bash
   node cli/vantage.js publish <path> --name "<name>" --viewers "<Name <email>>,<email>" --expires <days> [--passcode <code>] [--tasks "task 1|task 2"]
   ```
5. **Report** the personal links, one per viewer, and remind the user: each link is shown only now (the Vantage keeps a hash, not the link), so copy it; send each link only to its owner, through the usual channel; if a passcode was set, send it by a different channel; links stop working on the expiry date and can be revoked or re-issued (`vantage rotate`) at any time.

### Test design options (ask only when the user mentions them)

- **Tasks and questions with timing.** `--tasks "Pick a plan|?What did you expect @after:1|Add a member @screen:#team|?Anything confusing @min:5"`. `?` makes a question (free-text answer). `@after:N` shows it once task N is done, `@screen:<path or #hash>` when the tester reaches that screen, `@min:N` after N minutes. Default is at the start.
- **Moderated sessions.** `--mode moderated --no-show-tasks`: the designer asks questions on the call; results refresh live; `vantage note <id> "..."` records observations.
- **Think-aloud voice.** Off unless `--voice` is given; then the tester chooses at the consent screen and a "Recording" indicator shows throughout. Recordings are listed on the share's results tab and downloadable as audio.
- **Screen recording.** Off unless `--screen` is given; the tester chooses at the consent screen and picks the tab in the browser's own dialog. Desktop browsers only. With `--voice` too, the voice is the video's audio track. About 5 MB a minute against the share's media limit; recording stops by itself when the limit is reached.
- **Identity check.** `--require-sign-in`: testers must sign in with Google as the invited address before the link opens, so a forwarded link opens nothing. Only on servers with Google sign-in configured (the server says so if not). Off by default because it excludes people without a Google account; the passcode by a second channel is the alternative.
- **Typed text.** Off by default so real personal data is never captured. `--record-text` turns it on for prototypes with sample data where the input matters (never password fields).
- **Intro video with captions and translations.** After `--intro-media intro.mp4`, transcribe the video (ask the user for the script or transcribe it yourself if the audio is available), write a WebVTT file per language, and upload each: `vantage subtitles <id> es es.vtt --label "Español"`. Translation happens here, at authoring time, because the server never calls out to the internet. The tester's browser language is selected automatically when a matching track exists.
- **Expiry.** Any length up to the server maximum (365 days by default): `--expires 180`, later `vantage extend <id> --days 90`.

## After sharing

- "Who has opened it?" → `node cli/vantage.js activity <shareId>` and summarise: who, when, any rejected attempts.
- "What did the testers say / how did the tasks go?" → `node cli/vantage.js results <shareId>`. Summarise task completion, then per-tester notes, then patterns (where people got stuck, which screens got the most clicks). Offer the CSV of raw events for deeper analysis: `node cli/vantage.js events <shareId> --csv --out events.csv`.
- "Add X" → `node cli/vantage.js add-viewer <shareId> "Name <email>"`.
- "Revoke / stop sharing" → `node cli/vantage.js revoke <shareId>` (whole share) or `--viewer <viewerId>` (one person). Confirm first; it is immediate.
- "Extend" → `node cli/vantage.js extend <shareId> --days N`.
- "Delete everything" → `node cli/vantage.js delete <shareId>`. Confirm first; it removes results too. A personal token can only delete shares its owner created.

Find share IDs with `node cli/vantage.js list`.

## Rules

- Never publish to any service other than the configured vantage. No Vercel, Netlify, GitHub Pages, public artifacts, or file-sharing links.
- Never widen a viewer list or expiry beyond what the user stated.
- Treat viewer emails and feedback text as confidential. Do not paste them into unrelated tools or commits.
- If a command fails with `Vantage 401`, the token is wrong or expired; ask the user, do not retry with guesses. If it says the Vantage cannot be reached, the local server is probably not running; tell the user rather than starting it yourself.
- The prototype can log research events itself by calling `window.vantage.event('name', {...})`; mention this when the user wants to measure something specific (e.g. which plan was chosen).
