# Security

Please report security problems privately via GitHub's **Report a vulnerability** (Security tab) instead of a public issue.

How the extension handles credentials:

- The Coolify API token, Cloudflare Access secret and custom header values are stored with VS Code SecretStorage (the OS keychain) and are only sent to the configured Coolify server.
- `coolify.serverUrl` and `coolify.authMode` are machine-scoped, so a repository's `.vscode/settings.json` cannot redirect credentials elsewhere.
- Commands from folder settings (pre-deploy command, local services) are ignored in untrusted workspaces.
- Webviews use a strict Content-Security-Policy with no inline scripts or styles.
