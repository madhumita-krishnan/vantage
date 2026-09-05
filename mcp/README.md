# Prototype Vault MCP server

Lets an AI client publish prototypes to a vault and read back who opened them and what testers said. Stdio transport, no dependencies, Node 20+.

Configuration: none, when the vault runs on the same machine in quick start (the MCP server reads `server/data/local-secrets.json`, which the server writes on first start). For a vault elsewhere, `VAULT_URL` (e.g. `https://vault.example.com`) and `VAULT_ADMIN_TOKEN` from the console's **Account → Connect a tool**.

A personal token sees only the shares its owner created. Deleting a share is not offered as a tool; do that in the console or with `vault delete`.

## Tools

| Tool | Purpose |
|---|---|
| `vault_publish_prototype` | Upload a folder or HTML file; vendors CDN assets first; returns a personal link per viewer. View only unless tasks or a mode are given |
| `vault_list_shares` | Shares with status, viewers, expiry |
| `vault_get_share` | One share with its viewers. Links are shown once, when issued, and are not stored |
| `vault_add_viewers` | Invite more people; returns their links |
| `vault_revoke` | Revoke a share or one viewer |
| `vault_extend` | Extend expiry |
| `vault_set_intro` | Set the "Before you start" text or media |
| `vault_add_subtitles` | Add captions or a translation to the intro video |
| `vault_add_note` | Add a moderator note |
| `vault_get_results` | Task outcomes, per-tester interaction summary, feedback |
| `vault_get_activity` | Access log |
| `vault_get_events` | Raw interaction events |

## Claude Code

Local vault (the server prints this exact line with the right path when it starts):

```bash
claude mcp add prototype-vault -- node "/absolute/path/to/mcp/server.js"
```

Remote vault:

```bash
claude mcp add prototype-vault -e VAULT_URL=https://vault.example.com -e VAULT_ADMIN_TOKEN=YOUR_TOKEN -- node "/absolute/path/to/mcp/server.js"
```

Or add to `.mcp.json` in a project (do not commit the token; use `${VAULT_ADMIN_TOKEN}` env expansion):

```json
{
  "mcpServers": {
    "prototype-vault": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/server.js"],
      "env": { "VAULT_URL": "https://vault.example.com", "VAULT_ADMIN_TOKEN": "${VAULT_ADMIN_TOKEN}" }
    }
  }
}
```

## Claude Desktop

Settings → Developer → Edit Config, then add the same `mcpServers` block to `claude_desktop_config.json` and restart Claude Desktop.

## Cursor and other MCP clients

Any client that supports stdio MCP servers takes the same `command`, `args`, `env` shape.

## Example conversation

> Share ./checkout-v3 with Priya Shah (priya@customer.com) and tom@partner.org for 7 days, passcode 8841, tasks: find the annual price; add a team member.

Claude calls `vault_publish_prototype`, then gives you two links to send. A week later:

> How did the checkout test go?

Claude calls `vault_get_results` and summarises task completion, where people got stuck, and their comments.
