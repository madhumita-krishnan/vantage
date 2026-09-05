# Deployment

Prototype Vault is one process, one data directory, no database. Deploy it the way you deploy any small internal web app.

## Requirements
- Node.js 18+ (or the Docker image, which bundles Node 22)
- A persistent disk for `DATA_DIR`
- TLS in front of it (reverse proxy, load balancer, or ingress)
- A hostname people inside the company (and any invited outsiders) can reach

## First start: what happens with no configuration

If neither `ADMIN_TOKEN` nor `ADMIN_EMAILS` is set, the server does not refuse to start. It generates an admin token, and an encryption key unless `VAULT_ENCRYPTION_KEY` is set, writes both to `DATA_DIR/local-secrets.json` (mode 0600), listens on `127.0.0.1` only, and prints a console link that signs you in plus the `claude mcp add` command. Restarts reuse the file. This is what makes "try it" a one-command affair on a laptop, and why nobody else can reach that laptop's vault by accident. (The Docker image sets `HOST=0.0.0.0` explicitly, so a container is reachable on its network as usual.)

For anything beyond a laptop, set the values yourself: a key stored next to the data it encrypts protects against a lost backup of the data alone, not against someone who has the whole disk. Once `ADMIN_TOKEN` is set the file is ignored (and can be deleted). Set `VAULT_ENCRYPTION_KEY` to the key from the file if you want to keep the shares made during the trial, or start a fresh `DATA_DIR`.

## Option A: Docker (recommended)

```bash
cd server
cp .env.example .env
# fill in ADMIN_TOKEN (npm run -s gen-token), VAULT_ENCRYPTION_KEY (npm run -s gen-key), PUBLIC_URL
docker compose up -d --build
```

The `.env` is optional: without it the first start behaves as described above, and `docker compose logs vault` shows the signed-in link.

The image runs as the unprivileged `node` user, exposes port 8787, stores everything in the `vault-data` volume, and has a health check on `/healthz`.

## Option B: Bare Node

```bash
cd server
cp .env.example .env && edit .env
set -a; source .env; set +a
node server.js
```

Wrap it in systemd, pm2, or your platform's process manager. Example systemd unit:

```ini
[Unit]
Description=Prototype Vault
After=network.target
[Service]
User=vault
WorkingDirectory=/opt/prototype-vault/server
EnvironmentFile=/opt/prototype-vault/server/.env
ExecStart=/usr/bin/node server.js
Restart=always
ProtectSystem=strict
ReadWritePaths=/var/lib/prototype-vault
[Install]
WantedBy=multi-user.target
```

## Option C: Cloud platforms

Any place that runs a container with a persistent volume works: AWS ECS/Fargate with EFS, Azure Container Apps with Azure Files, GCP Cloud Run with a GCS FUSE volume, an internal Kubernetes cluster with a PVC. Set `PORT` if the platform dictates one. Keep it on a private network or behind your identity-aware proxy.

## Reverse proxy and SSO

Set `TRUST_PROXY=1` **only** when a proxy you control is the only way to reach the server. Then the server trusts `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`, and the identity header you name in `TRUSTED_HEADER_EMAIL`.

| Proxy | `TRUSTED_HEADER_EMAIL` |
|---|---|
| Cloudflare Access | `cf-access-authenticated-user-email` |
| Google Identity-Aware Proxy | `x-goog-authenticated-user-email` (value is `accounts.google.com:user@x`; strip the prefix at the proxy, or use oauth2-proxy) |
| Azure App Service / Container Apps EasyAuth | `x-ms-client-principal-name` |
| oauth2-proxy (Okta, Entra ID, any OIDC) | `x-forwarded-email` |
| Pomerium | `x-pomerium-claim-email` |

Make sure the proxy **strips** that header from incoming requests before setting its own; otherwise anyone could forge it. All the products above do this by default.

### How a designer gets in (the account model)

There are no accounts inside Prototype Vault and nothing to sign up for. Identity comes from one of two places:

1. **Company sign-in (recommended).** IT puts the vault behind the identity-aware proxy the company already uses (Okta, Entra ID, Google Workspace, Cloudflare Access, oauth2-proxy). The proxy signs people in with the company MFA and passes their email in a header. Designers listed in `ADMIN_EMAILS` open `/admin` and are in; nobody else sees the console. Removing someone from `ADMIN_EMAILS` (or from the IdP group the proxy allows) removes their access everywhere, including tools they connected.
2. **Server admin token.** For a server you run yourself, or as a fallback: one secret set at start (or generated on first start), pasted on the sign-in screen, or carried by the signed-in link the server prints (`/admin#token=…`; the fragment never reaches the server or its logs).

Once in, the **Account** page is where a designer connects tools. *Connect a tool* creates a personal access token (shown once) for Claude Code, the CLI or the MCP server, named per tool. *Disconnect* revokes it immediately; the tool gets 401 on its next call and nothing already shared changes. `vault disconnect` does the same from the terminal. To stop using the vault entirely, *Delete everything I made and leave* on the Account page removes every share that person created and disconnects all their tools; IT then removes them from `ADMIN_EMAILS`. Every connect, disconnect and leave is in the admin audit log.

### Mixed audiences (employees via SSO, external testers via links)
Configure the proxy to require SSO for `/admin` and `/api/*`, and to pass `/p/*`, `/vault.css` and `/healthz` through without authentication. External testers then use personal links (plus passcode if you want). Employees on SSO can be admitted automatically by adding their domain on a share's Settings tab.

### nginx example (no SSO, TLS only)

```nginx
server {
  listen 443 ssl http2;
  server_name prototypes.internal.company.com;
  ssl_certificate     /etc/ssl/certs/vault.pem;
  ssl_certificate_key /etc/ssl/private/vault.key;
  client_max_body_size 100m;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header Host $host;
  }
}
```

## Environment reference

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_TOKEN` | generated | Admin secret (min 24 chars). Generated on first start and kept in `DATA_DIR/local-secrets.json` when neither this nor `ADMIN_EMAILS` is set; set it yourself for a real deployment. |
| `ADMIN_EMAILS` | — | Comma-separated emails that are admins when identified by the SSO header. |
| `VAULT_ENCRYPTION_KEY` | generated in quick start | 64 hex chars. Encrypts files and metadata at rest. Generated alongside the token in quick start; otherwise set it (strongly recommended). Cannot be changed later without re-uploading. |
| `PUBLIC_URL` | derived from request | Base URL used in generated links. Set it. |
| `TRUST_PROXY` | `0` | Trust `X-Forwarded-*` and the SSO header. |
| `TRUSTED_HEADER_EMAIL` | — | Header name carrying the authenticated email (lower-case). |
| `SSO_LOGOUT_URL` | — | Your proxy's logout URL. Gives the console's Account page a "Sign out of company sign-in" button (Cloudflare Access: `/cdn-cgi/access/logout`; oauth2-proxy: `/oauth2/sign_out`). |
| `DEFAULT_EXPIRY_DAYS` | `7` | Expiry when a share does not specify one. |
| `MAX_EXPIRY_DAYS` | `90` | Hard cap on share lifetime. |
| `RETENTION_DAYS` | `30` | Days after expiry before prototype files are auto-deleted. |
| `SESSION_HOURS` | `8` | Viewer session lifetime. |
| `MAX_UPLOAD_MB` | `100` | Upload cap. |
| `ALLOWED_EXTERNAL_ORIGINS` | empty | Origins prototypes may load from, if a share opts in. Leave empty. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` (`127.0.0.1` in quick start) | Listen address. |
| `DATA_DIR` | `./data` | Storage location. Back it up. |

## Backups and key rotation
Back up `DATA_DIR` and the encryption key **separately**. To rotate the key: create a new server with the new key, re-publish the shares you still need, then retire the old one. There is deliberately no in-place re-encryption path; shares are short-lived.

## Upgrading
Replace the `server/` files, restart. The data format is plain JSON and NDJSON; no migrations.

## Monitoring
`GET /healthz` returns `ok`. Stdout has the startup summary; stderr has 5xx errors. The `_admin.ndjson` audit log has `admin.unauthorized` entries if someone probes the API.
