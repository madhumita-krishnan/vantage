# Prototype Vault

**Share coded prototypes with specific people, inside your company's own walls, and learn from how they use them.**

Built for product designers who prototype with Claude (or any tool that produces HTML/JS) inside large enterprises where public hosting, third-party SaaS and "just send them the file" are all off the table. The full problem statement is in [PROBLEM.md](PROBLEM.md).

```
Designer ──(Claude / CLI / console)──▶ Prototype Vault ◀──(personal link)── Tester
                                       runs on your infra
                                       encrypted, audited, expiring
```

## Try it in three steps

Needs Node 18 or newer. Nothing to install, nothing to configure.

**1. Start it.**

```bash
node server/server.js
```

The first start makes its own admin token and encryption key, listens on your machine only, and prints two lines: a link to the console that signs you in, and a Claude Code command.

**2. Open the printed link and click "Try it with the sample prototype".** Enter your email, then open your own personal link. You will see exactly what a tester sees: the consent note, the tasks, the feedback button, the watermark. Back in the console, the share's **Feedback & results** tab fills in as you click around. To share your own work, click **New share** and drop a folder.

**3. Connect Claude** by pasting the printed command:

```bash
claude mcp add prototype-vault -- node "/path/to/mcp/server.js"
```

Then tell Claude "share this prototype with Priya and Tom for a week" and it publishes, confirms the people and expiry with you, and hands you the links. The CLI works the same way with no settings: `node cli/vault.js list`.

That is the whole local setup. Secrets live in `server/data/local-secrets.json`, and the server only answers on localhost until you configure it. To let other people open links, or for a real server, set the values yourself: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Status: a working proof of concept, not an audited product

This was built in a few days with Claude. It has an end-to-end test suite (`cd server && npm test`), a written threat model, and no third-party code, but it has not been penetration tested or reviewed by an independent security team. Read [docs/SECURITY.md](docs/SECURITY.md), run the tests, and have your own security people look at it before trusting it with anything that matters. Found something? See "Reporting a vulnerability" in that document.

## What you get

| Piece | What it does |
|---|---|
| **`server/`** | A self-hosted web server (Node, **zero third-party dependencies**, one Docker image, about 1,100 lines across small modules). Stores prototypes encrypted, gates them behind personal links, a passcode, or your SSO, serves them in a locked-down sandbox, records access and, for usability tests, interactions and feedback. |
| **Console** (`/admin`) | Upload a folder, invite people, copy their links, revoke, extend, read results. |
| **`cli/vault.js`** | Publish from the terminal. Also `vault inline`, which pulls CDN scripts, styles and fonts into the bundle so the prototype works with no internet access. |
| **`mcp/server.js`** | An MCP server so Claude Code, Claude Desktop or Cursor can publish, invite, revoke and read usability results directly. |
| **`skill/prototype-share/`** | Optional Claude Code skill with the full checked workflow (make self-contained, confirm viewers, publish, report). |
| **`viewer-app/`** | Optional desktop viewer (Electron) whose window is excluded from screenshots and screen sharing on macOS and Windows. |
| **`docs/`** | [SECURITY.md](docs/SECURITY.md) for your security review; [DEPLOYMENT.md](docs/DEPLOYMENT.md) for IT. |

## What a security review will find

- **Nothing leaves your network.** The server makes no outbound calls. Ever. Prototypes are served with a Content Security Policy that blocks them from loading or sending anything outside the vault.
- **Named access only.** Every viewer gets their own link tied to their email. Links expire, can be revoked one at a time, and can be re-issued if leaked. Optional passcode as a second factor. Optional SSO via your identity-aware proxy (Cloudflare Access, Google IAP, Azure AD App Proxy, oauth2-proxy).
- **Encrypted at rest.** Prototype files and metadata are AES-256-GCM encrypted with a key you hold.
- **Auditable.** Who opened what, when, from where, plus every rejected attempt and every admin action, in append-only logs.
- **Retention built in.** Shares expire; files are purged automatically after a retention window.
- **Reviewable in an afternoon.** About 1,100 lines of plain Node in small modules, no npm packages, so there is no supply chain to vet. `npm test` exercises the whole tester flow.
- **Research is opt-in at every level.** A share is view only unless you set up a test. Interaction recording needs the tester's consent, voice recording is off unless you turn it on for a share, and typed text is never captured unless you turn that on too.

What it is *not*: DRM. In a browser, a tester who can see a prototype can screenshot it; the watermark (viewer email over every screen) and the audit trail make that traceable rather than impossible. The optional [viewer app](viewer-app/README.md) goes further: its window is excluded from screenshots, screen recording and screen sharing on macOS and Windows, the way banking apps do it. Nothing stops a phone camera. See [docs/SECURITY.md](docs/SECURITY.md).

## Sharing from the terminal or from Claude

```bash
node cli/vault.js publish ./my-prototype --name "Checkout v3" --viewers "Priya <priya@customer.com>,tom@partner.org" --expires 7 --tasks "Find the annual price|Add a team member"
```

A share is **view only** by default: nothing about how it is used is recorded, only who opened it. Giving tasks (or `--mode unmoderated|moderated`) turns it into a usability test with consent, tasks and interaction recording. `--voice` additionally offers think-aloud voice recording.

**Remote vault.** When the vault runs on a company server instead of your laptop, the CLI and MCP server need to know where and who: open the console's **Account** page, click *Connect a tool*, and copy the setup it shows. It amounts to two environment variables:

```bash
export VAULT_URL=https://prototypes.internal.company.com VAULT_ADMIN_TOKEN=...
claude mcp add prototype-vault -e VAULT_URL=$VAULT_URL -e VAULT_ADMIN_TOKEN=$VAULT_ADMIN_TOKEN -- node "/path/to/mcp/server.js"
```

*Disconnect* on the same page revokes a tool's token. Other MCP clients are covered in [mcp/README.md](mcp/README.md).

**Skill (optional).** Copy `skill/prototype-share` into `~/.claude/skills/` if you want Claude to follow the full checked workflow even without the MCP server connected.

There is no sign-up. On a real deployment designers get in through the company sign-in (SSO) and IT lists them in `ADMIN_EMAILS`; the admin token is the fallback for a server you run yourself.

## The tester's experience

1. They click their personal link. The token is consumed and dropped from the address bar.
2. If a passcode is set, they enter it.
3. They see a short consent note about interaction recording and choose.
4. The prototype opens full-screen, watermarked with their email, with a **Tasks** panel (if you set tasks) and a **Feedback** button.
5. They mark each task completed or stuck, optionally with a note, and can send free-form feedback at any point. Their current screen is attached automatically.

You see all of it on the share's **Feedback & results** tab, or with `vault results <id>`, or by asking Claude through the MCP.

## Making prototypes self-contained

Claude-generated prototypes often load React, Tailwind or fonts from a CDN. The vault blocks that by default (a prototype that phones out is a data leak waiting to happen). Two options:

- `node cli/vault.js inline ./my-prototype` downloads those assets into `vendor/` and rewrites the references. `vault publish` does this automatically. The MCP publish tool does too.
- Your server admin can allow specific origins with `ALLOWED_EXTERNAL_ORIGINS`, then a share can opt in to them. Prefer inlining.

Prototypes that call a live API will not work in the vault. Mock the data in the prototype instead.

## Layout

```
PROBLEM.md                 the post that started this, and what it really asks for
README.md                  this file
server/                    the vault (server.js, lib/, public/, Dockerfile, .env.example)
cli/vault.js               command-line client; cli/lib.js is shared with the MCP server
mcp/server.js              MCP server (stdio)
skill/prototype-share/     optional Claude Code skill
docs/SECURITY.md           threat model, controls, review checklist
docs/DEPLOYMENT.md         Docker, reverse proxy, SSO header setup
docs/PROCESS.md            how it was built: decisions, trade-offs, working with AI, tests
docs/OBJECTIONS.md         known weaknesses, anticipated review findings, and the fix order
examples/sample-prototype  the prototype behind "Try it with the sample prototype"
viewer-app/                optional desktop viewer with screenshot protection
server/test/               end-to-end tests (npm test)
```

## License

MIT. Use it, fork it, rename it.
