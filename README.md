# Prototype Vault

Share coded prototypes with named people through private, expiring links, and learn from how they use them.

Built for product designers who prototype with Claude or any tool that produces HTML and JavaScript. Each viewer gets a personal link that can be revoked. A share is view only unless you set up a usability test, and then testers see a consent screen before anything is recorded. The post that started this is in [PROBLEM.md](PROBLEM.md).

```
Designer ──(console / CLI / Claude)──▶ Prototype Vault ◀──(personal link)── Tester
```

## Two ways to use it

**Run it yourself.** One Node process, no third-party packages, files encrypted on disk, nothing sent anywhere. For teams whose policy forbids third-party hosting, and for anyone who wants to read every line before trusting it. Start with the three steps below; deploy with [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**Use a hosted copy.** The same server deployed with Google sign-in and per-person limits, for teams without such a policy. There is no public hosted instance yet; the deployment doc has the Cloud Run recipe, and the free tiers cover a small team.

Either way the code is the same. Which one fits you depends on one question: may your prototypes sit on someone else's server?

## Try it in three steps

Needs Node 20 or newer. Nothing to install, nothing to configure, and no Claude account needed.

**1. Start it.**

```bash
node server/server.js
```

The first start makes its own admin token and encryption key, listens on your machine only, and prints a link to the console that signs you in, plus a Claude Code command.

**2. Open the printed link and click "Try it with the sample prototype".** Enter your email, then open your own personal link. You see what a tester sees: the consent note, the tasks, the feedback button, the watermark. Back in the console, the share's **Feedback & results** tab fills in as you click around.

**3. Share your own work.** Click **New share**, drop the prototype folder, and type the email address of each person who may open it. You get one link per person. Send each link to its owner however you normally would. That is the whole product; nothing below is required.

**Optional: let Claude do step 3 for you.** If you use Claude Code, paste the command the server printed at start (it looks like `claude mcp add prototype-vault -- node "…/mcp/server.js"`). From then on you can say, in Claude Code, "share the checkout prototype with priya@customer.com and tom@partner.org for a week". Claude needs the email addresses, because that is what a personal link is tied to; it will ask if you leave them out, and it confirms the people and the expiry before publishing. The command-line tool does the same thing without Claude: `node cli/vault.js publish ./my-prototype --name "Checkout" --viewers "priya@customer.com,tom@partner.org"`.

Secrets live in `server/data/local-secrets.json`, and the server answers on your own machine only until you configure it. To let other people open links, or to run it on a real server, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Status: a working proof of concept, not an audited product

Built in a few days with Claude Code. It has an end-to-end test suite (`cd server && npm test`, 16 tests covering both origins, sign-in, limits and the tester flow), a written threat model, a linter and a formatter in CI, and no third-party code in the server. What was checked and how is in [docs/TESTING.md](docs/TESTING.md). It has not been penetration tested or reviewed by an independent security team. Read [docs/SECURITY.md](docs/SECURITY.md), run the tests, and have your own security people look at it before trusting it with anything that matters. Known weaknesses and the order they will be fixed in are in [docs/OBJECTIONS.md](docs/OBJECTIONS.md). Found something? See "Reporting a vulnerability" in the security document.

## What you get

| Piece | What it does |
|---|---|
| **`server/`** | The vault: a Node server with no third-party packages, one Docker image. Stores prototypes encrypted, gates them behind personal links, a passcode, your SSO, or Google sign-in, serves them from a separate origin in a locked-down frame, records access and, for usability tests, interactions and feedback. |
| **Console** (`/admin`) | Upload a folder, invite people, copy their links, revoke, extend, read results. |
| **`cli/vault.js`** | Publish from the terminal. `vault inline` pulls CDN scripts, styles and fonts into the bundle so the prototype works with no internet access. |
| **`mcp/server.js`** | An MCP server so Claude Code, Claude Desktop or Cursor can publish, invite, revoke and read usability results. |
| **`skill/prototype-share/`** | Optional Claude Code skill with the checked workflow (make self-contained, confirm viewers, publish, report). |
| **`viewer-app/`** | Optional desktop viewer (Electron) whose window is excluded from screenshots and screen sharing on macOS and Windows. |
| **`docs/`** | [SECURITY.md](docs/SECURITY.md) for your security review, [DEPLOYMENT.md](docs/DEPLOYMENT.md) for IT, [PROCESS.md](docs/PROCESS.md) on how it was built, [OBJECTIONS.md](docs/OBJECTIONS.md) on what is still weak. |

## What a security review will find

- **Nothing leaves your network** when you run it yourself. The server makes no outbound calls. With Google sign-in enabled, the one exception is the token exchange with Google during sign-in. Prototypes are served with a Content Security Policy that stops them loading from or sending to anywhere else.
- **Prototypes run on their own origin.** The files are served from a second hostname or port, so a prototype's scripts cannot reach the console, the tester shell, or another share. This is the same separation GitHub Pages and CodePen use.
- **Named access only.** Every viewer gets a personal link tied to their email. The link's secret travels in the URL fragment so it never reaches a log, is stored only as a hash, shown once when issued, and can be revoked or re-issued at any time. Optional passcode as a second factor. Optional SSO through your identity-aware proxy (Cloudflare Access, Google IAP, Azure AD App Proxy, oauth2-proxy).
- **Encrypted at rest.** Prototype files and metadata are AES-256-GCM encrypted with a key you hold.
- **Each person sees only their own shares.** Sign in with Google or a personal token and the console shows what you created. The server admin token sees everything.
- **Auditable.** Who opened what, when, from where, plus every rejected attempt and every admin action, in append-only logs trimmed to your retention window.
- **Research is opt-in at every level.** A share is view only unless you set up a test. Interaction recording needs the tester's consent. Voice recording, dictation and typed-text capture are each off unless you turn them on for a share.
- **Reviewable in an afternoon.** Ten small modules and no npm packages, so there is no supply chain to vet.

What it is *not*: DRM. In a browser, a tester who can see a prototype can screenshot it. The watermark (viewer email over every screen) and the access log make that traceable, and prototype pages open only inside the watermarked frame. The plain-language list of limits is [docs/WHAT-IT-CANNOT-DO.md](docs/WHAT-IT-CANNOT-DO.md). The optional [viewer app](viewer-app/README.md) uses the operating system's content-protection flag so screenshots and screen sharing of its window come out black on macOS and Windows. Nothing stops a phone camera.

## Sharing from the terminal or from Claude

```bash
node cli/vault.js publish ./my-prototype --name "Checkout v3" --viewers "Priya <priya@customer.com>,tom@partner.org" --expires 7 --tasks "Find the annual price|Add a team member"
```

A share is **view only** by default: nothing about how it is used is recorded, only who opened it. Giving tasks (or `--mode unmoderated|moderated`) turns it into a usability test with consent, tasks and interaction recording. `--voice` offers think-aloud voice recording.

**Remote vault.** When the vault runs somewhere other than your laptop, open the console's **Account** page, click *Connect a tool*, and copy the setup it shows. It amounts to two environment variables:

```bash
export VAULT_URL=https://prototypes.internal.company.com VAULT_ADMIN_TOKEN=...
claude mcp add prototype-vault -e VAULT_URL=$VAULT_URL -e VAULT_ADMIN_TOKEN=$VAULT_ADMIN_TOKEN -- node "/path/to/mcp/server.js"
```

*Disconnect* on the same page revokes a tool's token. Other MCP clients are covered in [mcp/README.md](mcp/README.md).

There is no password store. Designers get in through the company sign-in (SSO), through Google sign-in on a hosted copy, or with the admin token on a server they run themselves.

## The tester's experience

1. They click their personal link. The secret is consumed and dropped from the address bar.
2. If a passcode is set, they enter it.
3. For a usability test, they see a short note about what gets recorded and choose.
4. The prototype opens full screen, watermarked with their email, with a **Tasks** panel (if you set tasks) and a **Feedback** button.
5. They mark each task completed or stuck, optionally with a note, and can send feedback at any point. The screen they were on is attached automatically.

You see all of it on the share's **Feedback & results** tab, with `vault results <id>`, or by asking Claude.

## Making prototypes self-contained

Claude-generated prototypes often load React, Tailwind or fonts from a CDN. The vault blocks that by default, because a prototype that loads from the internet can also send to it. Two options:

- `node cli/vault.js inline ./my-prototype` downloads those assets into `vendor/` and rewrites the references. `vault publish` and the MCP publish tool do this automatically.
- Your server admin can allow specific origins with `ALLOWED_EXTERNAL_ORIGINS`, and a share can opt in to them. Prefer inlining.

Prototypes that call a live API will not work in the vault. Mock the data in the prototype instead.

## Development

```bash
npm install        # formatter and linter only; the server has no dependencies
npm run lint
npm run format
npm test
```

CI runs the same three commands on Node 20 and 22.

## Layout

```
PROBLEM.md                 the post that started this, and what it asks for
README.md                  this file
CHANGELOG.md               what changed in each version
server/                    the vault (server.js, lib/, public/, Dockerfile, .env.example)
cli/vault.js               command-line client; cli/lib.js is shared with the MCP server
mcp/server.js              MCP server (stdio)
skill/prototype-share/     optional Claude Code skill
docs/SECURITY.md           threat model, controls, review checklist
docs/DEPLOYMENT.md         Docker, Cloud Run, reverse proxy, SSO and Google sign-in setup
docs/PROCESS.md            how it was built: decisions, trade-offs, working with AI
docs/OBJECTIONS.md         known weaknesses and the fix order
docs/AUDIT.md              line-by-line code audit with findings, fixes and status
docs/WHAT-IT-CANNOT-DO.md  the limits, in plain language, for designers
docs/TESTING.md            how the code was checked, in plain language
NEEDS-YOU.md               the owner's to-do list (delete when empty)
design/                    design system and canvas mockups
examples/sample-prototype  the prototype behind "Try it with the sample prototype"
viewer-app/                optional desktop viewer with screenshot protection
server/test/               end-to-end tests (npm test)
```

## License

MIT. Use it, fork it, rename it.
