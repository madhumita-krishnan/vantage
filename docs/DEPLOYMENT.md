# Deployment

Prototype Vault is one process, one data directory, no database. Deploy it the way you deploy any small internal web app. This document covers running it yourself (Docker, bare Node, behind your proxy with SSO) and running a hosted copy on Google Cloud Run with Google sign-in.

## Requirements
- Node.js 20+ (or the Docker image, which bundles Node 22)
- A persistent disk for `DATA_DIR`
- TLS in front of it (reverse proxy, load balancer, or ingress)
- Two hostnames people can reach: one for the console and tester pages, one for prototype content (see "Two origins")

## First start: what happens with no configuration

If none of `ADMIN_TOKEN`, `ADMIN_EMAILS` or `GOOGLE_CLIENT_ID` is set, the server generates an admin token, and an encryption key unless `VAULT_ENCRYPTION_KEY` is set, writes both to `DATA_DIR/local-secrets.json` (mode 0600), listens on `127.0.0.1` only, serves prototypes on a second port (`PORT + 1`), and prints a console link that signs you in. Restarts reuse the file. This is what makes "try it" a one-command affair on a laptop.

For anything beyond a laptop, set the values yourself: a key stored next to the data it encrypts protects against a lost backup of the data alone, not against someone who has the whole disk. Once an admin mechanism is configured the file is ignored.

## Two origins

Prototype files are never served from the console's origin. They come from `CONTENT_ORIGIN`, so that a prototype's scripts cannot reach the console or the tester shell. Two ways to provide it:

- **Second port** (default). `CONTENT_PORT` (default `PORT + 1`) listens alongside the main port; `CONTENT_ORIGIN` defaults to `http://localhost:<CONTENT_PORT>`. Fine on a laptop and in Docker on a private network. Set `CONTENT_ORIGIN` to whatever address browsers will use for that port.
- **Second hostname** (behind a proxy or on Cloud Run). Set `CONTENT_ORIGIN=https://prototypes-content.example.com` and route that hostname to the same process. The server tells the two apart by the `Host` header. Set `CONTENT_PORT=0` if you do not want the extra listener.

Any pair of hostnames works. A sibling subdomain (`content.vault.example.com` next to `vault.example.com`) keeps the session cookie same-site, which every browser handles well.

**One origin per share.** `CONTENT_ORIGIN=https://*.content.example.com` (one `*`) gives every share its own hostname, so two prototypes open in the same browser cannot see each other. It needs a wildcard DNS record and a wildcard certificate; Cloud Run's domain mappings cannot do that on their own, so put Cloudflare or a load balancer in front, or use a single content hostname until then (the limitation is stated in [WHAT-IT-CANNOT-DO.md](WHAT-IT-CANNOT-DO.md)).

## Option A: Docker

```bash
cd server
cp .env.example .env
# fill in ADMIN_TOKEN (npm run -s gen-token), VAULT_ENCRYPTION_KEY (npm run -s gen-key), PUBLIC_URL, CONTENT_ORIGIN
docker compose up -d --build
```

The `.env` is optional: without it the first start behaves as described above and `docker compose logs vault` shows the signed-in link. The image runs as the unprivileged `node` user, exposes ports 8787 and 8788, stores everything in the `vault-data` volume, and has a health check on `/healthz`.

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

## Option C: Google Cloud Run (a hosted copy)

One container, one instance, a Cloud Storage bucket mounted as the data directory, secrets from Secret Manager, Google sign-in for designers. Everything below fits in the free tiers for a small team; set a billing alert anyway.

```bash
gcloud auth login && gcloud config set project YOUR_PROJECT
gcloud services enable run.googleapis.com secretmanager.googleapis.com storage.googleapis.com

# Storage and secrets
gcloud storage buckets create gs://YOUR_BUCKET --location=us-central1 --uniform-bucket-level-access
printf %s "$(cd server && npm run -s gen-token)" | gcloud secrets create admin-token --data-file=-
printf %s "$(cd server && npm run -s gen-key)"   | gcloud secrets create vault-key --data-file=-
printf %s "YOUR_GOOGLE_CLIENT_ID"     | gcloud secrets create google-client-id --data-file=-
printf %s "YOUR_GOOGLE_CLIENT_SECRET" | gcloud secrets create google-client-secret --data-file=-

# Deploy
gcloud run deploy prototype-vault --source server --region us-central1 --allow-unauthenticated \
  --max-instances 1 --port 8787 \
  --add-volume name=data,type=cloud-storage,bucket=YOUR_BUCKET --add-volume-mount volume=data,mount-path=/data \
  --set-env-vars DATA_DIR=/data,TRUST_PROXY=1,CONTENT_PORT=0,PUBLIC_URL=https://vault.example.com,CONTENT_ORIGIN=https://content.vault.example.com,MAX_SHARES_PER_OWNER=10,MAX_STORAGE_MB_PER_OWNER=200 \
  --set-secrets ADMIN_TOKEN=admin-token:latest,VAULT_ENCRYPTION_KEY=vault-key:latest,GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest

# Two hostnames to the same service
gcloud beta run domain-mappings create --service prototype-vault --region us-central1 --domain vault.example.com
gcloud beta run domain-mappings create --service prototype-vault --region us-central1 --domain content.vault.example.com
```

Then, in the Google Cloud console under APIs & Services, create an OAuth client of type "Web application" with `https://vault.example.com/auth/google/callback` as the authorised redirect URI, and put its ID and secret in the two secrets above.

Notes:
- `--max-instances 1` matters. The metadata store is a single JSON file; two instances writing it would corrupt it. One instance serves a small team comfortably.
- `TRUST_PROXY=1` is correct on Cloud Run: it terminates TLS and sets `X-Forwarded-Proto` and `X-Forwarded-For`.
- The bucket mount uses Cloud Storage FUSE. Writes are slower than local disk, which is fine at this scale.
- With `GOOGLE_CLIENT_ID` set and `ADMIN_EMAILS` empty, anyone with a Google account can sign in and gets their own space, limited by the two `MAX_*_PER_OWNER` values. Set `ADMIN_EMAILS` to restrict sign-in to a list.
- Billing alert: Billing → Budgets & alerts in the console, or `gcloud billing budgets create`.

## Reverse proxy and SSO (self-hosted)

Set `TRUST_PROXY=1` **only** when a proxy you control is the only way to reach the server. Then the server trusts `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`, and the identity header you name in `TRUSTED_HEADER_EMAIL`.

| Proxy | `TRUSTED_HEADER_EMAIL` |
|---|---|
| Cloudflare Access | `cf-access-authenticated-user-email` |
| Google Identity-Aware Proxy | `x-goog-authenticated-user-email` (value is `accounts.google.com:user@x`; strip the prefix at the proxy, or use oauth2-proxy) |
| Azure App Service / Container Apps EasyAuth | `x-ms-client-principal-name` |
| oauth2-proxy (Okta, Entra ID, any OIDC) | `x-forwarded-email` |
| Pomerium | `x-pomerium-claim-email` |

Make sure the proxy **strips** that header from incoming requests before setting its own; otherwise anyone could forge it. All the products above do this by default.

### How a designer gets in

There are no passwords inside Prototype Vault. Identity comes from one of three places:

1. **Company sign-in.** IT puts the vault behind the identity-aware proxy the company already uses. The proxy signs people in with the company MFA and passes their email in a header. Designers listed in `ADMIN_EMAILS` open `/admin` and are in. Removing someone from `ADMIN_EMAILS` (or from the IdP group) removes their access everywhere, including tools they connected.
2. **Google sign-in.** For a hosted copy, or a self-hosted one without a proxy. See Option C.
3. **Server admin token.** For a server you run yourself, or as a fallback: one secret set at start, pasted on the sign-in screen, or carried by the signed-in link the server prints.

Once in, the **Account** page is where a designer connects tools. *Connect a tool* creates a personal access token (shown once) for Claude Code, the CLI or the MCP server. *Disconnect* revokes it. *Delete everything I made and leave* removes every share that person created and disconnects all their tools. Every connect, disconnect and leave is in the admin audit log.

### Mixed audiences (employees via SSO, external testers via links)
Configure the proxy to require SSO for `/admin`, `/api/*` and `/auth/*`, and to pass `/p/*`, `/vault.css` and `/healthz` through without authentication, on both hostnames. External testers then use personal links (plus passcode if you want). Employees on SSO can be admitted automatically by adding their domain on a share's Settings tab.

### nginx example (no SSO, TLS only)

```nginx
server {
  listen 443 ssl http2;
  server_name prototypes.internal.company.com prototypes-content.internal.company.com;
  ssl_certificate     /etc/ssl/certs/vault.pem;
  ssl_certificate_key /etc/ssl/private/vault.key;
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header Host $host;
  }
}
```

With `CONTENT_ORIGIN=https://prototypes-content.internal.company.com` and `CONTENT_PORT=0`, both names reach the one process and it routes by hostname.

## Environment reference

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_TOKEN` | generated | Admin secret (min 24 chars). Generated on first start when no admin mechanism is configured; set it yourself for a real deployment. |
| `ADMIN_EMAILS` | (empty) | Comma-separated emails allowed into the console via the SSO header or Google sign-in. Empty with Google sign-in means anyone may sign in. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | (empty) | Enable "Sign in with Google". Redirect URI is `PUBLIC_URL/auth/google/callback`. |
| `ALLOWED_SIGNIN_DOMAINS` | (empty) | Email domains allowed to sign in with Google, e.g. `company.com`. Combines with `ADMIN_EMAILS`; both empty means anyone. |
| `ABUSE_EMAIL` | (empty) | Address testers see on the consent screen for reporting a link they were not expecting. |
| `VAULT_ENCRYPTION_KEY` | generated in quick start | 64 hex chars. Encrypts files and metadata at rest. Cannot be changed later without re-uploading. |
| `PUBLIC_URL` | derived from request | Address of the console and tester pages, e.g. `https://vault.example.com`. Set it. |
| `CONTENT_ORIGIN` | `http://localhost:<CONTENT_PORT>` | Address prototypes are served from. A second hostname behind a proxy, the second port's address, or a wildcard (`https://*.content.example.com`) for one origin per share. |
| `CONTENT_PORT` | `PORT + 1` | Second listener for prototype content. `0` disables it (hostname routing only). |
| `TRUST_PROXY` | `0` | Trust `X-Forwarded-*` and the SSO header. |
| `TRUSTED_PROXY_HOPS` | `1` | How many proxies append to `X-Forwarded-For` before the request reaches the server. The client address is read that many entries from the right, so a caller cannot choose its own. |
| `TRUSTED_HEADER_EMAIL` | (empty) | Header name carrying the authenticated email (lower-case). |
| `SSO_LOGOUT_URL` | (empty) | Your proxy's logout URL, for the console's sign-out button. |
| `MAX_SHARES_PER_OWNER` | `0` | Shares one person may hold. `0` = unlimited. The server admin token is exempt. |
| `MAX_STORAGE_MB_PER_OWNER` | `0` | Prototype bytes one person may hold. `0` = unlimited. |
| `ENTITLEMENTS_MODULE` | (empty) | Path to a module exporting `limits(owner) -> { shares, storageMb }`, replacing the two values above. |
| `DEFAULT_EXPIRY_DAYS` | `7` | Expiry when a share does not specify one. |
| `MAX_EXPIRY_DAYS` | `365` | Hard cap on share lifetime. |
| `RETENTION_DAYS` | `30` | Days after expiry before the whole share (files, viewers, recordings, events, feedback, its audit log) is deleted, and the age at which admin-log lines are dropped. |
| `SESSION_HOURS` | `8` | Viewer session lifetime. |
| `MAX_UPLOAD_MB` | `25` | Prototype upload cap. The whole upload is held in memory while it is decoded, so keep this modest. |
| `MAX_MEDIA_MB` | `200` | Intro media plus voice and screen recordings, per share. Screen video runs about 5 MB a minute; a tester's recording stops itself at the limit. Also counted toward `MAX_STORAGE_MB_PER_OWNER`. |
| `ALLOWED_EXTERNAL_ORIGINS` | (empty) | Origins prototypes may load from, if a share opts in. Leave empty. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` (`127.0.0.1` in quick start) | Listen address. |
| `DATA_DIR` | `./data` | Storage location. Back it up. |

## Backups and key rotation
Back up `DATA_DIR` and the encryption key **separately**. To rotate the key: create a new server with the new key, re-publish the shares you still need, then retire the old one. There is deliberately no in-place re-encryption path; shares are short-lived.

## Upgrading
Replace the files, restart. The data format is plain JSON and NDJSON. Version 0.1.0 changed how viewer link secrets are stored (hashed); an older `store.json` is converted on first load and existing links keep working.

## Monitoring
`GET /healthz` returns `ok` on both origins. Stdout has the startup summary; stderr has 5xx errors. The `_admin.ndjson` audit log has `admin.unauthorized` entries if someone probes the API.
