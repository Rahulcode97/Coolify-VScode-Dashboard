// @ts-check
/* Coolify Deploy Dashboard — settings page. */
(function () {
    'use strict';
    const vscode = acquireVsCodeApi();

    /** @type {any} */
    let init = null;
    /** @type {{uuid:string,name:string}[] | null} */
    let projects = null;
    const form = {
        serverUrl: '',
        authMode: 'token',
        allowSelfSigned: false,
        timeoutSeconds: 15,
        token: '',
        cfClientId: '',
        cfClientSecret: '',
        /** @type {{name:string,value:string,saved?:boolean}[]} */
        headers: [],
        projectUuid: '',
        shared: false,
        environment: '',
        refreshIntervalSeconds: 30,
        statusBar: true,
        confirmDeploy: true,
        preDeployCommand: '',
        preDeployCwd: '',
        mergeEnabled: false,
        mergeSource: 'development',
        mergeTarget: 'main',
        mergeRemote: 'origin',
        /** @type {{name:string,command:string,cwd?:string,port?:number|string,url?:string}[]} */
        localServices: [],
    };
    let testResult = null;
    let saveMsg = { text: '', cls: '' };
    let testing = false;
    let saving = false;

    const esc = (s) =>
        String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    const svg = (d, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const I = {
        cloud: svg('<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>', 20),
        sparkle: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>', 14),
        check: svg('<polyline points="20 6 9 17 4 12"/>', 14),
        warn: svg('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 14),
        info: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>', 14),
        plug: svg('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>', 14),
        x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 13),
        plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', 13),
    };

    function connectionPayload() {
        return {
            serverUrl: form.serverUrl,
            authMode: form.authMode,
            allowSelfSigned: form.allowSelfSigned,
            timeoutSeconds: Number(form.timeoutSeconds) || 15,
            token: form.token,
            cfClientId: form.cfClientId,
            cfClientSecret: form.cfClientSecret,
            headers: form.headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value })),
        };
    }

    function savedPh(has, normal) {
        return has ? '•••••••• saved. Leave empty to keep it.' : normal;
    }

    function render() {
        const app = document.getElementById('app');
        if (!app) return;
        if (!init) {
            app.innerHTML = '<div class="loading">Loading…</div>';
            return;
        }
        const c = init.connection;
        const active = document.activeElement;
        const activeId = active && active.id;
        const selStart = active && 'selectionStart' in active ? active.selectionStart : null;

        const mode = (id, title, desc) =>
            `<label class="mode${form.authMode === id ? ' sel' : ''}"><input type="radio" name="authMode" value="${id}" ${form.authMode === id ? 'checked' : ''}><span class="t">${title}</span><span class="d">${desc}</span></label>`;

        let h = `<div class="page">
        <div class="page-head"><div class="logo">${I.cloud}</div><div><h1>Coolify Settings</h1><p>Connect once. Each folder then shows its own Coolify project.</p></div></div>

        <div class="notice info ai-callout">${I.sparkle}<div><b>Stuck? Let an AI walk you through it.</b><br><span class="muted">Copies a ready-made prompt for Claude, ChatGPT or Cursor chat. It never includes your token or secrets.</span></div><button class="btn primary" data-action="copyPrompt">${I.sparkle} Copy AI setup prompt</button></div>

        <section class="card">
            <h2><span class="num">1</span>Connect to Coolify</h2>
            <p class="lead">One server per install. Secrets are stored in your OS keychain (VS Code SecretStorage), never in settings.json.</p>

            <div class="field">
                <label for="serverUrl">Server URL</label>
                <input type="url" id="serverUrl" data-bind="serverUrl" placeholder="https://coolify.example.com  or  http://localhost:8000" value="${esc(form.serverUrl)}" spellcheck="false" autocomplete="off">
                <div class="help">The address you type in the browser to open Coolify. Paste it as is: <code>/api/v1</code> and page paths are removed for you.</div>
            </div>

            <div class="field">
                <span class="label">Connection type</span>
                <div class="modes" role="radiogroup">
                    ${mode('token', 'API token only', 'Direct, localhost, or a normal reverse proxy (Traefik, Caddy, Nginx).')}
                    ${mode('cloudflare', 'Cloudflare Access', 'Coolify is behind a Cloudflare Zero Trust login page.')}
                    ${mode('headers', 'Custom headers', 'Another auth proxy that needs extra headers (API key, basic auth…).')}
                </div>
            </div>

            <div class="field">
                <label for="token">Coolify API token</label>
                <input type="password" id="token" data-bind="token" placeholder="${esc(savedPh(c.hasToken, 'Paste the token, e.g. 3|AbCdEf…'))}" value="${esc(form.token)}" autocomplete="off">
                <div class="help">In Coolify:
                    <ol><li>Open <b>Keys &amp; Tokens → API Tokens</b> in the left menu. If it says <i>API access is turned off</i>, click <b>Enable API Access</b> and set <b>API access</b> to <b>Enabled</b>.</li>
                    <li>Click <b>New Token</b>, enter a description like <i>VS Code</i>, and pick an expiry (default 30 days). Under <b>Permissions</b> tick <b>Read</b> and <b>Deploy</b>. Add <b>Write</b> for Start/Stop/Restart, and <b>Read sensitive data</b> for container logs.</li>
                    <li>Click <b>Create Token</b> and copy it right away: Coolify shows it only once.</li></ol>
                    <a data-action="openDoc" data-doc="getting-the-api-token.md">Guide with screenshots →</a>
                </div>
            </div>`;

        if (form.authMode === 'cloudflare') {
            h += `<div class="subcard">
                <div class="row2">
                    <div class="field"><label for="cfClientId">CF-Access-Client-Id</label><input type="text" id="cfClientId" data-bind="cfClientId" placeholder="${esc(savedPh(c.hasCfClientId, 'xxxxxxxx.access'))}" value="${esc(form.cfClientId)}" spellcheck="false" autocomplete="off"></div>
                    <div class="field"><label for="cfClientSecret">CF-Access-Client-Secret</label><input type="password" id="cfClientSecret" data-bind="cfClientSecret" placeholder="${esc(savedPh(c.hasCfClientSecret, 'Client secret'))}" value="${esc(form.cfClientSecret)}" autocomplete="off"></div>
                </div>
                <div class="help">Cloudflare dashboard → <b>Zero Trust → Access → Service Auth → Service Tokens → Create Service Token</b>. Then, on the Access application that protects your Coolify hostname, add a policy with action <b>Service Auth</b> that includes this token. A normal <i>Allow</i> policy will not accept it.
                <a data-action="openDoc" data-doc="cloudflare-access.md">Cloudflare guide →</a></div>
            </div>`;
        }
        if (form.authMode === 'headers') {
            const rows = form.headers
                .map(
                    (hd, i) =>
                        `<div class="hdr"><input type="text" data-hname="${i}" placeholder="Header name, e.g. X-Api-Key" value="${esc(hd.name)}" spellcheck="false"><input type="password" data-hvalue="${i}" placeholder="${esc(hd.saved ? '•••••••• saved. Leave empty to keep.' : 'Value')}" value="${esc(hd.value)}"><button class="btn ghost icon" title="Remove" data-action="removeHeader" data-i="${i}">${I.x}</button></div>`,
                )
                .join('');
            h += `<div class="subcard"><div class="field"><span class="label">Extra headers sent with every request</span>${rows}<button class="btn ghost" data-action="addHeader">${I.plus} Add header</button>
            <div class="help">For basic auth use the name <code>Authorization</code> and the value <code>Basic &lt;base64 of user:password&gt;</code>. The Coolify token above is still sent as <code>Authorization: Bearer …</code> unless you override that header here.</div></div></div>`;
        }

        h += `<details class="feature"><summary>Advanced connection options<span class="state">${form.allowSelfSigned ? 'self-signed allowed' : ''}</span></summary>
                <label class="toggle"><input type="checkbox" data-bind="allowSelfSigned" ${form.allowSelfSigned ? 'checked' : ''}><span>Allow self-signed certificates<span class="d">Only for servers you control (homelab, LAN). Turns off certificate checks for this server.</span></span></label>
                <div class="field narrow"><label for="timeoutSeconds">Request timeout (seconds)</label><input type="number" id="timeoutSeconds" min="3" max="120" data-bind="timeoutSeconds" value="${esc(form.timeoutSeconds)}"></div>
            </details>
            <div class="btns"><button class="btn primary" data-action="test" ${testing ? 'aria-busy="true" disabled' : ''}>${I.plug} ${testing ? 'Testing…' : 'Test connection'}</button><span class="muted small">Tests what is typed above, without saving.</span></div>`;
        if (testResult) {
            h += `<div class="result notice ${testResult.ok ? 'ok' : 'error'}">${testResult.ok ? I.check : I.warn}<div><b>${esc(testResult.message)}</b>${testResult.hint ? `<div class="mt-xs">${esc(testResult.hint)}</div>` : ''}${!testResult.ok ? `<div class="mt-sm"><a data-action="copyPrompt">Ask an AI about this error →</a></div>` : ''}</div></div>`;
        }
        h += `</section>`;

        // ---- Folder / project ---------------------------------------------
        h += `<section class="card"><h2><span class="num">2</span>Project for this folder</h2>`;
        if (init.folder) {
            const f = init.folder;
            const opts = (projects || []).map((p) => `<option value="${esc(p.uuid)}" ${form.projectUuid === p.uuid ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
            const unknownSel = form.projectUuid && projects && !projects.some((p) => p.uuid === form.projectUuid) ? `<option value="${esc(form.projectUuid)}" selected>${esc(form.projectUuid)} (not found)</option>` : '';
            h += `<p class="lead">If you keep several projects on one Coolify server, each repo folder shows only its own project.</p>
            <div class="repo-line"><span>Folder: <b>${esc(f.name)}</b></span><span>Git remote: <b>${esc(f.repo || 'none')}</b></span></div>
            <div class="row2">
                <div class="field"><label for="projectUuid">Coolify project</label>
                    <select id="projectUuid" data-bind="projectUuid"><option value="">Auto-detect (recommended)</option>${opts}${unknownSel}</select>
                    <div class="help">${projects ? 'Auto-detect picks the project whose app builds this git repo. If there is only one project, that one is used.' : 'Test or save the connection to load your projects.'}</div></div>
                <div class="field"><label for="environment">Only show environment (optional)</label>
                    <input type="text" id="environment" data-bind="environment" placeholder="e.g. production. Empty = all" value="${esc(form.environment)}" spellcheck="false">
                    <div class="help">Environments are shown grouped by default.</div></div>
            </div>
            <label class="toggle"><input type="checkbox" data-bind="shared" ${form.shared ? 'checked' : ''} ${form.projectUuid ? '' : 'disabled'}><span>Share this choice with my team<span class="d">Saves <code>coolify.projectUuid</code> in this folder's <code>.vscode/settings.json</code>. Otherwise it's remembered only on this machine.</span></span></label>`;
        } else {
            h += `<p class="lead">Open a folder (your repo) to link it to a Coolify project. Without a folder the dashboard asks which project to show.</p>`;
        }
        h += `</section>`;

        // ---- Dashboard ------------------------------------------------------
        h += `<section class="card"><h2><span class="num">3</span>Dashboard</h2>
            <div class="field narrow"><label for="refreshIntervalSeconds">Refresh every (seconds)</label><input type="number" id="refreshIntervalSeconds" min="10" max="600" data-bind="refreshIntervalSeconds" value="${esc(form.refreshIntervalSeconds)}"><div class="help">Only while the sidebar is visible. During a deployment it refreshes every 5 s.</div></div>
            <label class="toggle"><input type="checkbox" data-bind="statusBar" ${form.statusBar ? 'checked' : ''}><span>Show running/total in the status bar</span></label>
            <label class="toggle"><input type="checkbox" data-bind="confirmDeploy" ${form.confirmDeploy ? 'checked' : ''}><span>Ask before deploy, stop and restart</span></label>
        </section>`;

        // ---- Optional ---------------------------------------------------------
        const svcRows = form.localServices
            .map(
                (s, i) =>
                    `<div class="svc"><input type="text" data-svc="${i}" data-f="name" placeholder="Web" value="${esc(s.name)}"><input type="text" data-svc="${i}" data-f="command" placeholder="npm run dev" value="${esc(s.command)}" spellcheck="false"><input type="text" data-svc="${i}" data-f="cwd" placeholder="Folder, e.g. web" value="${esc(s.cwd || '')}" spellcheck="false"><input type="number" data-svc="${i}" data-f="port" placeholder="3000" value="${esc(s.port || '')}"><button class="btn ghost icon" title="Remove" data-action="removeSvc" data-i="${i}">${I.x}</button></div>`,
            )
            .join('');
        h += `<section class="card"><h2><span class="num">4</span>Optional features</h2>
            <p class="lead">All off by default. They are saved for <b>this folder</b> (in <code>.vscode/settings.json</code>), because each repo is different.${init.trusted ? '' : ' <b>This folder is not trusted, so the command-running features below are ignored until you trust it.</b>'}</p>
            <details class="feature"${form.preDeployCommand ? ' open' : ''}><summary>Run a command before every deploy<span class="state${form.preDeployCommand ? ' on' : ''}">${form.preDeployCommand ? 'on' : 'off'}</span></summary>
                <div class="row2"><div class="field"><label for="preDeployCommand">Command</label><input type="text" id="preDeployCommand" data-bind="preDeployCommand" placeholder="npm run build" value="${esc(form.preDeployCommand)}" spellcheck="false"></div>
                <div class="field"><label for="preDeployCwd">Run in folder</label><input type="text" id="preDeployCwd" data-bind="preDeployCwd" placeholder="Empty = repo root, or e.g. web" value="${esc(form.preDeployCwd)}" spellcheck="false"></div></div>
                <div class="help tight">If it fails, the deploy stops and the first error is shown. You can still choose <i>Deploy anyway</i>. Output goes to the <b>Coolify</b> output panel.</div>
            </details>
            <details class="feature"${form.mergeEnabled ? ' open' : ''}><summary>Merge &amp; Deploy button<span class="state${form.mergeEnabled ? ' on' : ''}">${form.mergeEnabled ? 'on' : 'off'}</span></summary>
                <label class="toggle"><input type="checkbox" data-bind="mergeEnabled" ${form.mergeEnabled ? 'checked' : ''}><span>Show <b>Merge &amp; Deploy</b> on apps that build the target branch<span class="d">One click: fetch, merge the source branch into the target, push, then deploy. Your working tree must have no uncommitted changes to tracked files.</span></span></label>
                <div class="row2"><div class="field"><label for="mergeSource">Source branch</label><input type="text" id="mergeSource" data-bind="mergeSource" value="${esc(form.mergeSource)}" spellcheck="false"></div>
                <div class="field"><label for="mergeTarget">Target branch (deployed)</label><input type="text" id="mergeTarget" data-bind="mergeTarget" value="${esc(form.mergeTarget)}" spellcheck="false"></div></div>
                <div class="field narrow"><label for="mergeRemote">Git remote</label><input type="text" id="mergeRemote" data-bind="mergeRemote" value="${esc(form.mergeRemote)}" spellcheck="false"></div>
            </details>
            <details class="feature"${form.localServices.length ? ' open' : ''}><summary>Localhost: start local dev servers<span class="state${form.localServices.length ? ' on' : ''}">${form.localServices.length ? form.localServices.length + ' configured' : 'off'}</span></summary>
                <div class="help lead-help">Each service runs in its own terminal. With a port set, the dashboard shows whether it is up (one quick local port check every 5 s, only while the sidebar is open).</div>
                ${form.localServices.length ? '<div class="svc svc-head"><span>Name</span><span>Command</span><span>Folder</span><span>Port</span><span></span></div>' : ''}
                ${svcRows}
                <button class="btn ghost mb" data-action="addSvc">${I.plus} Add local service</button>
            </details>
        </section>`;

        h += `<section class="card"><h2><span class="num">?</span>Help</h2>
            <div class="links">
                <a data-action="openDoc" data-doc="getting-the-api-token.md">Get the Coolify API token</a>
                <a data-action="openDoc" data-doc="cloudflare-access.md">Cloudflare Access setup</a>
                <a data-action="openDoc" data-doc="localhost-and-direct.md">Localhost / direct / homelab</a>
                <a data-action="openDoc" data-doc="multiple-projects.md">Several projects &amp; repos</a>
                <a data-action="openDoc" data-doc="troubleshooting.md">Troubleshooting</a>
                <a data-action="copyPrompt">Copy AI setup prompt</a>
                <a data-action="forget" class="danger-link">Forget saved token &amp; secrets</a>
            </div>
        </section>
        </div>
        <div class="savebar"><div class="inner"><span class="msg ${saveMsg.cls}">${esc(saveMsg.text)}</span><button class="btn primary" data-action="save" ${saving ? 'aria-busy="true" disabled' : ''}>${I.check} ${saving ? 'Saving…' : 'Save'}</button></div></div>`;

        app.innerHTML = h;
        if (activeId) {
            const el = /** @type {HTMLInputElement|null} */ (document.getElementById(activeId));
            if (el) {
                el.focus();
                if (selStart != null && 'setSelectionRange' in el) {
                    try {
                        el.setSelectionRange(selStart, selStart);
                    } catch {
                        /* number inputs */
                    }
                }
            }
        }
    }

    // Track whether each <details> is open across re-renders.
    const openDetails = new Set();
    function rememberDetails() {
        document.querySelectorAll('details.feature').forEach((d, i) => {
            if (/** @type {HTMLDetailsElement} */ (d).open) openDetails.add(i);
            else openDetails.delete(i);
        });
    }
    function restoreDetails() {
        document.querySelectorAll('details.feature').forEach((d, i) => {
            if (openDetails.has(i)) /** @type {HTMLDetailsElement} */ (d).open = true;
        });
    }
    function rerender() {
        rememberDetails();
        render();
        restoreDetails();
    }

    document.addEventListener('input', (ev) => {
        const t = /** @type {HTMLInputElement} */ (ev.target);
        const bind = t.getAttribute('data-bind');
        if (bind) {
            form[bind] = t.type === 'checkbox' ? t.checked : t.value;
            saveMsg = { text: 'Unsaved changes', cls: '' };
            const bar = document.querySelector('.savebar .msg');
            if (bar) {
                bar.textContent = saveMsg.text;
                bar.className = 'msg';
            }
            if (bind === 'projectUuid' || t.type === 'checkbox') rerender();
            return;
        }
        if (t.hasAttribute('data-hname')) form.headers[Number(t.getAttribute('data-hname'))].name = t.value;
        if (t.hasAttribute('data-hvalue')) form.headers[Number(t.getAttribute('data-hvalue'))].value = t.value;
        if (t.hasAttribute('data-svc')) form.localServices[Number(t.getAttribute('data-svc'))][t.getAttribute('data-f') || 'name'] = t.value;
    });

    document.addEventListener('change', (ev) => {
        const t = /** @type {HTMLInputElement} */ (ev.target);
        if (t.name === 'authMode') {
            form.authMode = t.value;
            testResult = null;
            if (form.authMode === 'headers' && form.headers.length === 0) form.headers.push({ name: '', value: '' });
            rerender();
        }
    });

    document.addEventListener('click', (ev) => {
        const el = /** @type {HTMLElement} */ (ev.target).closest('[data-action]');
        if (!el) return;
        ev.preventDefault();
        const a = el.getAttribute('data-action');
        const i = Number(el.getAttribute('data-i'));
        switch (a) {
            case 'test':
                testing = true;
                testResult = null;
                rerender();
                vscode.postMessage({ type: 'test', connection: connectionPayload() });
                return;
            case 'save':
                if (!form.serverUrl.trim()) {
                    saveMsg = { text: 'Enter the Server URL first.', cls: 'bad' };
                    return rerender();
                }
                if (!init.connection.hasToken && !form.token.trim()) {
                    saveMsg = { text: 'Paste a Coolify API token first.', cls: 'bad' };
                    return rerender();
                }
                saving = true;
                saveMsg = { text: 'Saving and connecting…', cls: '' };
                rerender();
                vscode.postMessage({
                    type: 'save',
                    connection: connectionPayload(),
                    dashboard: { refreshIntervalSeconds: Number(form.refreshIntervalSeconds), statusBar: form.statusBar, confirmDeploy: form.confirmDeploy },
                    folder: { projectUuid: form.projectUuid, shared: form.shared, environment: form.environment },
                    features: {
                        preDeployCommand: form.preDeployCommand,
                        preDeployCwd: form.preDeployCwd,
                        mergeEnabled: form.mergeEnabled,
                        mergeSource: form.mergeSource,
                        mergeTarget: form.mergeTarget,
                        mergeRemote: form.mergeRemote,
                        localServices: form.localServices,
                    },
                });
                return;
            case 'addHeader':
                form.headers.push({ name: '', value: '' });
                return rerender();
            case 'removeHeader':
                form.headers.splice(i, 1);
                return rerender();
            case 'addSvc':
                form.localServices.push({ name: '', command: '', cwd: '', port: '' });
                return rerender();
            case 'removeSvc':
                form.localServices.splice(i, 1);
                return rerender();
            case 'openDoc':
                return vscode.postMessage({ type: 'openDoc', doc: el.getAttribute('data-doc') });
            default:
                return vscode.postMessage({ type: a });
        }
    });

    window.addEventListener('message', (event) => {
        const m = event.data;
        switch (m && m.type) {
            case 'init': {
                init = m;
                const c = m.connection;
                Object.assign(form, {
                    serverUrl: c.serverUrl,
                    authMode: c.authMode,
                    allowSelfSigned: c.allowSelfSigned,
                    timeoutSeconds: c.timeoutSeconds,
                    token: '',
                    cfClientId: '',
                    cfClientSecret: '',
                    headers: (c.customHeaderNames || []).map((n) => ({ name: n, value: '', saved: true })),
                    projectUuid: m.folder ? m.folder.projectUuid : '',
                    shared: m.folder ? m.folder.shared : false,
                    environment: m.folder ? m.folder.environment : '',
                    refreshIntervalSeconds: m.dashboard.refreshIntervalSeconds,
                    statusBar: m.dashboard.statusBar,
                    confirmDeploy: m.dashboard.confirmDeploy,
                    preDeployCommand: m.features.preDeployCommand,
                    preDeployCwd: m.features.preDeployCwd,
                    mergeEnabled: m.features.mergeEnabled,
                    mergeSource: m.features.mergeSource,
                    mergeTarget: m.features.mergeTarget,
                    mergeRemote: m.features.mergeRemote,
                    localServices: (m.features.localServices || []).map((s) => ({ ...s })),
                });
                if (form.authMode === 'headers' && form.headers.length === 0) form.headers.push({ name: '', value: '' });
                if (!saveMsg.cls) saveMsg = c.hasToken ? { text: '', cls: '' } : { text: 'Not connected yet', cls: '' };
                return rerender();
            }
            case 'projects':
                projects = m.projects;
                return rerender();
            case 'testResult':
                testing = false;
                testResult = m;
                if (m.ok && m.projects) projects = m.projects;
                return rerender();
            case 'saved':
                saving = false;
                if (m.phase === 'error') saveMsg = { text: `Saved, but: ${m.error ? m.error.message : 'connection failed'}`, cls: 'bad' };
                else if (m.phase === 'pick') saveMsg = { text: 'Saved. Pick a project for this folder in the sidebar.', cls: 'ok' };
                else saveMsg = { text: m.project ? `Saved. Showing "${m.project}".` : 'Saved.', cls: 'ok' };
                form.token = '';
                form.cfClientId = '';
                form.cfClientSecret = '';
                vscode.postMessage({ type: 'ready' });
                return rerender();
            case 'toast':
                saving = false;
                testing = false;
                saveMsg = { text: m.text, cls: m.kind === 'error' ? 'bad' : 'ok' };
                return rerender();
        }
    });

    render();
    vscode.postMessage({ type: 'ready' });
})();
