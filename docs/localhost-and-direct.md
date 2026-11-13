# Direct, homelab and localhost setups

## Coolify on a public domain (most common)

Coolify is reachable at something like `https://coolify.example.com`, behind Coolify's own Traefik/Caddy proxy or your own Nginx.

- **Server URL:** `https://coolify.example.com`
- **Connection type:** API token only

## Coolify on a server IP (no domain yet)

A fresh Coolify install listens on port **8000**.

- **Server URL:** `http://203.0.113.10:8000` (your server's IP)
- **Connection type:** API token only

> Plain HTTP sends your token unencrypted. Fine on a private network or VPN; on the public internet, give Coolify a domain with HTTPS first.

## Homelab with a self-signed certificate

If Coolify uses HTTPS with a certificate your computer does not trust, the test says *The HTTPS certificate of … is not trusted*.

- Best: install your homelab CA on your computer, or use a real certificate (e.g. Let's Encrypt with a DNS challenge).
- Quick: open **Advanced connection options** on the settings page and tick **Allow self-signed certificates**. This turns certificate checking off **for the Coolify server only**. Only do this for servers you control.

## Coolify running on your own computer

For trying Coolify locally (Docker Desktop, OrbStack, a VM…):

- **Server URL:** `http://localhost:8000`
- **Connection type:** API token only

If you type `localhost:8000` without `http://`, the extension adds `http://` for `localhost`, `*.local`, and private IP ranges, and `https://` for everything else.

## Behind a VPN (Tailscale, WireGuard, ZeroTier…)

Use the VPN address, e.g. `http://100.64.0.12:8000` or `https://coolify.your-tailnet.ts.net`. The extension uses VS Code's network stack, so VS Code's proxy settings (`http.proxy`) apply too.

## "Localhost" section: run your own app locally

This is separate from where Coolify runs. The optional **Localhost** section in the sidebar starts your project's dev servers in VS Code terminals, so local testing sits next to your deployed apps.

Open **Coolify: Open Settings → Optional features → Localhost** and add a row per service:

| Name | Command | Folder | Port |
|---|---|---|---|
| Web | `npm run dev` | `web` | `3000` |
| API | `uvicorn app.main:app --reload --port 8080` | `api` | `8080` |

Or in `.vscode/settings.json`:

```json
{
  "coolify.localServices": [
    { "name": "Web", "command": "npm run dev", "cwd": "web", "port": 3000 },
    { "name": "API", "command": "uvicorn app.main:app --reload --port 8080", "cwd": "api", "port": 8080, "env": { "DEBUG": "1" } }
  ]
}
```

- **Start** opens a terminal named `Local · <name>` and runs the command.
- **Stop** closes that terminal, which stops the process.
- The dot turns green when something listens on the port. The check is one quick TCP connect every 5 seconds, only while the sidebar is open.
- The open-link icon opens `http://localhost:<port>`, or `url` if you set one.

For security, local services and the pre-deploy command are ignored in folders you have not marked as trusted (VS Code **Workspace Trust**).
