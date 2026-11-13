# Changelog

## 1.0.0

First public release.

- Sidebar dashboard for Coolify applications, services and databases, grouped by environment.
- Each workspace folder shows its own Coolify project: auto-detected from the git remote, picked once, or set in `.vscode/settings.json` for the team.
- Connection types: API token only, Cloudflare Access service token, or custom headers. Secrets are kept in VS Code SecretStorage.
- Settings page with **Test connection** and plain-language error explanations.
- Deploy, force rebuild, cancel, start, stop and restart. Live build logs and container logs.
- Detects builds that Coolify marked "finished" although the build log shows an error.
- Optional: pre-deploy command, Merge & Deploy with your own branch names, local dev services.
- "Copy AI setup prompt" for guided setup with any AI assistant.
- Follows light, dark and high-contrast themes. Polls only while the sidebar is visible.
