# Troubleshooting

First step for any problem: **Coolify: Open Settings → Test connection**. It explains failures in plain words. The **Coolify** output panel (View → Output → Coolify) has more detail.

Still stuck? Click **Copy AI setup prompt** and paste it into Claude, ChatGPT or Cursor chat. It includes your last error but never your token.

## Connection

| Message | What it means | Fix |
|---|---|---|
| **The API token was rejected (401)** | Token wrong, deleted or expired (Coolify's default expiry is 30 days) | Create a new token: Keys & Tokens → API Tokens → New Token |
| **The Coolify API is turned off on this server (403)** | Coolify answered `API is disabled.` | Coolify → Settings → Advanced → API access → Enabled |
| **Permission denied (403)** | Token lacks a permission, or your IP is not in *Allowed IPs* | Tick Read + Deploy (+ Write); check Settings → Advanced → Allowed IPs |
| **Cloudflare Access redirected the request to its login page** | Coolify is behind Cloudflare Access and no valid service token was sent | [Cloudflare guide](cloudflare-access.md) |
| **The server answered with a web page instead of the Coolify API** | URL points at a login page, a different site, or one of your apps | Use the address of Coolify itself; pick the right connection type |
| **Can't find the server** | DNS lookup failed | Check spelling; connect your VPN |
| **Connection refused** | Nothing listening there | Check the port (fresh installs use `:8000`); is Coolify running? |
| **The HTTPS certificate … is not trusted** | Self-signed or expired certificate | Fix the certificate, or *Allow self-signed certificates* ([details](localhost-and-direct.md)) |
| **HTTPS handshake … failed** | You used `https://` but the server only speaks HTTP | Use `http://…:8000` |
| **did not answer in time** | Slow network or server | Raise *Request timeout* under Advanced connection options |
| **Not found (404)** | Wrong base URL | Use the Coolify address without extra paths; `/api/v1` is added for you |

## Dashboard

| Symptom | Fix |
|---|---|
| Shows the wrong project | Click the project name at the top → pick the right one. Or set `coolify.projectUuid` in the folder's `.vscode/settings.json`. |
| Asks for a project every time | The folder's git remote does not match any Coolify app. Pick once and it is remembered, or tick *Share with my team*. |
| Shows nothing ("No resources") | The token may be limited to other projects (Access → Selected), or the project is empty. |
| *Your Coolify version does not report which project a resource belongs to* | Very old Coolify. Update Coolify; until then everything is shown. |
| "build failed" on an app Coolify shows as finished | Coolify marked the deployment *finished*, but the log contains a build error (e.g. `npm ERR!`). The running container is probably the previous build. Open **Build log**. |
| Container log says it needs "Read sensitive data" | Create a token with that permission. |
| Start/Stop does nothing | The token needs **Write**. |
| No pink/red bar although I changed code | The bar only shows on apps that build this repo, after the deployed commit exists in your local history (`git fetch`), and only for files inside the app's Base Directory / Watch Paths. Is the app deploying right now? Then it is hidden until it finishes. |
| Red bar for a migration that is fine | Add `-- coolify:safe` to that migration, or narrow `coolify.deployRisk.migrationGlobs`. |
| Status bar item missing | It appears after the first successful refresh. Check `coolify.statusBar.enabled`. |

## Optional features

| Symptom | Fix |
|---|---|
| Pre-deploy command never runs | Is the folder trusted? (Workspace Trust). Is `coolify.preDeploy.command` set in *this folder's* settings? |
| Merge & Deploy button missing | Turn on `coolify.merge.enabled`. The app's Coolify branch must equal `coolify.merge.targetBranch`. |
| Merge & Deploy: "Uncommitted changes to tracked files" | Commit or stash first. Untracked files are fine. |
| Merge failed with a conflict | The merge is aborted and you are returned to your branch. Resolve the conflict by hand, push, then use the plain Deploy button. |
| Local service stays "starting" | The port in settings does not match the port the app really listens on. |

## Reset everything

1. **Coolify: Forget Saved Credentials**: removes the token and Cloudflare secrets from the keychain.
2. Remove `coolify.*` entries from your User and Workspace settings.
3. Reload the window.
