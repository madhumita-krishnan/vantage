# Vantage MCP server

Lets an AI client publish prototypes to a Vantage and read back who opened them and what testers said. Stdio transport, no dependencies, Node 20+.

Configuration: none, when the Vantage runs on the same machine in quick start (the MCP server reads `server/data/local-secrets.json`, which the server writes on first start). For a Vantage elsewhere, `VANTAGE_URL` (e.g. `https://vantage.example.com`) and `VANTAGE_ADMIN_TOKEN` from the console's **Account → Connect a tool**.

A personal token sees only the shares its owner created. Deleting a share is not offered as a tool; do that in the console or with `vantage delete`.

## Tools

| Tool                      | Purpose                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `vantage_publish_prototype` | Upload a folder or HTML file; vendors CDN assets first; returns a personal link per viewer. View only unless tasks or a mode are given |
| `vantage_list_shares`       | Shares with status, viewers, expiry                                                                                                    |
| `vantage_get_share`         | One share with its viewers. Links are shown once, when issued, and are not stored                                                      |
| `vantage_add_viewers`       | Invite more people; returns their links                                                                                                |
| `vantage_revoke`            | Revoke a share or one viewer                                                                                                           |
| `vantage_extend`            | Extend expiry                                                                                                                          |
| `vantage_set_intro`         | Set the "Before you start" text or media                                                                                               |
| `vantage_add_subtitles`     | Add captions or a translation to the intro video                                                                                       |
| `vantage_add_note`          | Add a moderator note                                                                                                                   |
| `vantage_get_results`       | Task outcomes, per-tester interaction summary, feedback                                                                                |
| `vantage_get_activity`      | Access log                                                                                                                             |
| `vantage_get_events`        | Raw interaction events                                                                                                                 |

## Claude Code

Local vantage (the server prints this exact line with the right path when it starts):

```bash
claude mcp add vantage -- node "/absolute/path/to/mcp/server.js"
```

Remote vantage:

```bash
claude mcp add vantage -e VANTAGE_URL=https://vantage.example.com -e VANTAGE_ADMIN_TOKEN=YOUR_TOKEN -- node "/absolute/path/to/mcp/server.js"
```

Or add to `.mcp.json` in a project (do not commit the token; use `${VANTAGE_ADMIN_TOKEN}` env expansion):

```json
{
  "mcpServers": {
    "vantage": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/server.js"],
      "env": { "VANTAGE_URL": "https://vantage.example.com", "VANTAGE_ADMIN_TOKEN": "${VANTAGE_ADMIN_TOKEN}" }
    }
  }
}
```

## Claude Desktop

Settings → Developer → Edit Config, then add the same `mcpServers` block to `claude_desktop_config.json` and restart Claude Desktop.

## Cursor and other MCP clients

Any client that supports stdio MCP servers takes the same `command`, `args`, `env` shape.

## Example conversation

> Share ./checkout-v3 with Priya Shah (priya@customer.example) and tom@partner.example for 7 days, passcode 8841, tasks: find the annual price; add a team member.

Claude calls `vantage_publish_prototype`, then gives you two links to send. A week later:

> How did the checkout test go?

Claude calls `vantage_get_results` and summarises task completion, where people got stuck, and their comments.
