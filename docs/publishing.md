# Publishing (for maintainers)

The extension ships in two places:

- **Visual Studio Marketplace**, used by VS Code.
- **Open VSX**, used by Cursor, VSCodium, Windsurf, Gitpod and code-server. Publish here too, or Cursor users can't install it.

Releases run from GitHub Actions (`.github/workflows/release.yml`) when you push a tag like `v1.0.1`. You set up the accounts once.

## One-time setup

### Visual Studio Marketplace

1. Sign in at <https://marketplace.visualstudio.com/manage> with a Microsoft account and **create a publisher**. Its **ID** must equal `"publisher"` in `package.json` (currently `RahulSrivastava`; change one or the other).
2. Create a Personal Access Token at <https://dev.azure.com> → *User settings* → *Personal access tokens* → *New token*:
   - Organization: **All accessible organizations**
   - Scopes: **Custom defined → Marketplace → Manage**
3. In the GitHub repo: *Settings → Secrets and variables → Actions → New repository secret*: `VSCE_PAT` = that token.

### Open VSX

1. Sign in at <https://open-vsx.org> with GitHub and accept the Eclipse publisher agreement (profile page).
2. Create an access token (profile → *Access Tokens*).
3. Create the namespace once from your machine: `npx ovsx create-namespace RahulSrivastava -p <token>`
4. Add the GitHub secret `OVSX_PAT`.

## Releasing

1. Update `CHANGELOG.md` and bump `"version"` in `package.json`.
2. Commit, then tag and push:

```bash
git tag v1.0.1
```

```bash
git push origin main --tags
```

The workflow runs the checks (types, lint, tests, leak scan, secret scan), packages the `.vsix`, attaches it to a GitHub Release, and publishes to both marketplaces. Any secret that isn't set is skipped, so the release still produces a `.vsix`.

## Manual release

```bash
npm ci && npm run package
```

```bash
npx vsce publish --no-dependencies -p <VSCE_PAT>
```

```bash
npx ovsx publish coolify-vscode-dashboard-*.vsix -p <OVSX_PAT>
```

## Before every release

- `npm run check:leaks -- --vsix <file>.vsix` must pass. It blocks hostnames, ids and names from the private setup this project started from.
- Screenshots must only show example data (`example.com`, documentation IPs such as `203.0.113.x`, `acme-*` names).
