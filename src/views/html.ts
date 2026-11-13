import * as vscode from 'vscode';

export function nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
}

/** Page shell with a strict Content-Security-Policy; all code and styles come from media/. */
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, opts: { title: string; script: string; styles: string[] }): string {
    const n = nonce();
    const asset = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', f)).toString();
    const csp = [`default-src 'none'`, `style-src ${webview.cspSource}`, `img-src ${webview.cspSource} data:`, `font-src ${webview.cspSource}`, `script-src 'nonce-${n}'`].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${opts.styles.map((s) => `<link rel="stylesheet" href="${asset(s)}">`).join('\n')}
<title>${opts.title}</title>
</head>
<body>
<div id="app" aria-live="polite"><div class="loading">Loading…</div></div>
<script nonce="${n}" src="${asset(opts.script)}"></script>
</body>
</html>`;
}
