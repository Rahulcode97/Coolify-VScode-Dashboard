# Changelog

## 1.1.0

- **Pink bar**: apps that build the open repo show when they have changes not deployed yet (newer commits on their branch, unpushed or uncommitted work), limited to the app's Coolify Base Directory and Watch Paths.
- **Red "stop users" bar**: warns before deploying a new SQL migration that would lock tables or break the running app (drop/rename column, NOT NULL without default, type changes, non-concurrent indexes, large UPDATE/DELETE and more), or a change matching your own downtime rules. `-- coolify:safe` silences a migration.
- Settings page: toggles, migration locations and a rules editor.
- README: "What the lights mean" legend with a short video.

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
