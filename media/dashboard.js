// @ts-check
/* Coolify Deploy Dashboard — sidebar webview. Renders state sent by the extension. */
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const saved = vscode.getState() || {};

    /** @type {any} */
    let state = null;
    let local = { services: [], trusted: true };
    const ui = {
        expanded: new Set(saved.expanded || []),
        collapsed: new Set(saved.collapsed || []),
        filter: saved.filter || '',
        share: !!saved.share,
        /** appUuid -> deployment uuid picked in history */
        selected: {},
        /** appUuid -> { title, text, live, error, deploymentUuid } */
        logs: {},
        busy: new Set(),
        flash: new Set(),
        prevActive: {},
    };

    function persist() {
        vscode.setState({ expanded: [...ui.expanded], collapsed: [...ui.collapsed], filter: ui.filter, share: ui.share });
    }

    // ---- Icons (inline SVG, inherit currentColor) ---------------------------
    const svg = (d, size = 14, extra = '') =>
        `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
    const I = {
        rocket: svg('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>', 13),
        merge: svg('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>', 13),
        restart: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>', 13),
        stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>', 13),
        play: svg('<polygon points="6 4 20 12 6 20 6 4"/>', 13),
        external: svg('<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>', 12),
        chevron: svg('<polyline points="6 9 12 15 18 9"/>', 12, 'class="chev"'),
        logs: svg('<path d="M4 6h16M4 12h16M4 18h10"/>', 13),
        terminal: svg('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>', 13),
        search: svg('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', 12),
        gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 13),
        sparkle: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>', 13),
        book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>', 13),
        warn: svg('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 14, 'class="notice-icon"'),
        info: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>', 14, 'class="notice-icon"'),
        folder: svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', 11),
        branch: svg('<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>', 11),
        clock: svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>', 11),
        pin: svg('<path d="M12 22s7-7.75 7-13a7 7 0 0 0-14 0c0 5.25 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/>', 11),
        x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 12),
        cloud: svg('<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>', 12),
        star: svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', 12),
    };

    // ---- Helpers ---------------------------------------------------------
    const esc = (s) =>
        String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    /** data-* attributes for an action button. */
    const act = (action, data) =>
        `data-action="${action}"` +
        Object.entries(data || {})
            .map(([k, v]) => ` data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${esc(v)}"`)
            .join('');

    const ACTIVE = ['queued', 'in_progress', 'running', 'deploying', 'building'];
    const FAILED = ['failed', 'error', 'cancelled', 'cancelled-by-user', 'canceled'];
    const isActive = (s) => ACTIVE.includes(String(s || '').toLowerCase());
    const isFailed = (d) => !!d && (FAILED.includes(String(d.status || '').toLowerCase()) || !!d.buildError);
    const isFinished = (s) => ['finished', 'success'].includes(String(s || '').toLowerCase());

    function rel(iso) {
        if (!iso) return '';
        const t = new Date(iso).getTime();
        if (!Number.isFinite(t)) return '';
        const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
        if (s < 45) return 'just now';
        const m = Math.floor(s / 60);
        if (m < 60) return `${Math.max(1, m)}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        const d = Math.floor(h / 24);
        if (d < 30) return `${d}d ago`;
        return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    function duration(a, b) {
        if (!a || !b) return '';
        const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
        return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
    }
    const short = (sha) => (sha ? String(sha).slice(0, 7) : '');
    const commitLink = (repo, sha) => (repo && sha ? (/gitlab/i.test(repo) ? `${repo}/-/commit/${sha}` : `${repo}/commit/${sha}`) : '');
    const statusWord = (d) => {
        if (!d) return 'Unknown';
        const s = String(d.status || '').toLowerCase();
        if (isActive(s)) return s === 'queued' ? 'Queued' : 'Building';
        if (d.buildError && !FAILED.includes(s)) return `Failed · ${d.buildError}`;
        if (FAILED.includes(s)) return s.startsWith('cancel') ? 'Cancelled' : 'Failed';
        if (isFinished(s)) return 'Success';
        return s || 'Unknown';
    };
    const pillClass = (d) => (isActive(d && d.status) ? 'busy' : isFailed(d) ? 'bad' : d && isFinished(d.status) ? 'ok' : '');

    function containerDot(r, deploying, lastFailed) {
        if (deploying) return 'busy';
        if (lastFailed) return 'bad';
        const c = r.container;
        if (c === 'running' || c === 'starting' || c === 'restarting') return c === 'running' ? 'ok' : 'busy';
        if (c === 'degraded') return 'warn';
        if (c === 'exited' || c === 'stopped' || c === 'dead') return 'bad';
        return '';
    }
    function healthDot(r) {
        if (!r.health || !r.running) return '';
        if (r.health === 'healthy') return 'ok';
        if (r.health === 'unhealthy') return 'bad';
        return 'warn';
    }

    // ---- Rendering -------------------------------------------------------
    function render() {
        const root = document.getElementById('app');
        if (!root) return;
        const html = state ? view() : '<div class="loading">Loading…</div>';
        const next = document.createElement('div');
        next.id = 'app';
        next.innerHTML = html;
        morph(root, next);
    }

    function view() {
        switch (state.phase) {
            case 'setup':
                return setupView();
            case 'error':
                return header() + errorView();
            case 'pick':
                return header() + pickView();
            default:
                return header() + readyView();
        }
    }

    function header() {
        const p = state.project;
        const f = state.folder;
        const name = p ? p.name : state.phase === 'pick' ? 'Choose a project' : 'Coolify';
        let h = `<div class="head" data-key="head"><button class="project-btn" ${act('pickProject')} title="Switch the Coolify project for this folder"><span class="brand-mark">${I.cloud}</span><span class="name">${esc(name)}</span>${I.chevron}</button></div>`;
        const bits = [];
        if (state.phase === 'ready') {
            const { running, total } = state.counts;
            const cls = total && running === total ? 'ok' : running < total ? 'warn' : '';
            bits.push(`<span class="pill-count ${cls}" title="Running / total resources">${running}/${total} running</span>`);
        }
        if (f && f.name) bits.push(`<span title="Open folder">${I.folder}${esc(f.name)}</span>`);
        if (f && f.branch) bits.push(`<span title="Current git branch">${I.branch}${esc(f.branch)}</span>`);
        if (state.phase === 'ready' && state.updatedAt) bits.push(`<span title="Last refresh">${I.clock}${esc(rel(state.updatedAt))}</span>`);
        h += `<div class="summary" data-key="summary">${bits.join('')}</div>`;
        return h;
    }

    function setupView() {
        return `<div class="hero" data-key="setup">
            <span class="brand-mark lg">${I.cloud}</span>
            <h2>Connect to your Coolify</h2>
            <p>See every app, database and service of the project you are working on, with deploy buttons and live build logs.</p>
            <ol class="steps">
                <li>In Coolify, open <b>Keys &amp; Tokens → API Tokens → New Token</b>. Tick <b>Read</b> + <b>Deploy</b> (add <b>Write</b> for start/stop).</li>
                <li>Click <b>Connect</b> below, paste your Coolify address and the token, then <b>Test connection</b>.</li>
                <li>Using Cloudflare Access? Pick <b>Cloudflare Access</b> as the connection type and add a service token.</li>
            </ol>
            <div class="stack">
                <button class="btn primary" ${act('openSettings')}>${I.gear} Connect</button>
                <button class="btn ghost" ${act('copyPrompt')} title="Copies a prompt for Claude, ChatGPT or Cursor that walks you through setup. Contains no secrets.">${I.sparkle} Copy AI setup prompt</button>
                <button class="btn ghost" ${act('openUrl', { url: 'https://github.com/Rahulcode97/Coolify-VScode-Dashboard#setup' })}>${I.book} Step-by-step guide</button>
            </div>
        </div>`;
    }

    function errorView() {
        const e = state.error || { message: 'Something went wrong.', hint: '' };
        return `<div class="banner" data-key="error"><div class="notice error">${I.warn}<div><b>${esc(e.message)}</b>${e.hint ? `<div class="mt-xs">${esc(e.hint)}</div>` : ''}
            <div class="detail-actions mt-sm">
                <button class="btn primary" ${act('refresh')}>${I.restart} Retry</button>
                <button class="btn ghost" ${act('openSettings')}>${I.gear} Settings</button>
                <button class="btn ghost" ${act('copyPrompt')} title="Includes this error, no secrets">${I.sparkle} Ask AI</button>
            </div></div></div></div>`;
    }

    function pickView() {
        const projects = [...(state.projects || [])].sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name));
        const items = projects
            .map((p) => `<button class="project-pick" data-key="pick-${esc(p.uuid)}" ${act('selectProject', { uuid: p.uuid })}>${p.suggested ? `<span class="accent" title="An app in this project builds this repo">${I.star}</span>` : `<span class="muted">${I.cloud}</span>`}<span class="name">${esc(p.name)}</span>${p.suggested ? '<span class="tag">This repo</span>' : ''}</button>`)
            .join('');
        return `<div class="banner" data-key="pick-why"><div class="notice info">${I.info}<div>${esc(state.pickReason || 'Which Coolify project should this folder show?')}</div></div></div>
            <div class="list" data-key="pick-list">${items || '<div class="empty">No projects found.</div>'}</div>
            <label class="check" data-key="pick-share"><input type="checkbox" data-action="toggleShare" ${ui.share ? 'checked' : ''}> Share with my team (saves to .vscode/settings.json)</label>`;
    }

    function readyView() {
        let h = '';
        if (state.warning) h += `<div class="banner" data-key="warning"><div class="notice warn">${I.warn}<div>${esc(state.warning)}</div></div></div>`;
        if (state.merge && state.merge.behind) {
            h += `<div class="banner" data-key="merge-banner"><div class="notice info">${I.merge}<div><b>${esc(state.merge.target)}</b> is ${state.merge.behind} commit${state.merge.behind === 1 ? '' : 's'} behind <b>${esc(state.merge.source)}</b>.</div></div></div>`;
        }
        const all = state.environments.flatMap((g) => g.resources);
        if (all.length > 5 || ui.filter) {
            h += `<div class="search" data-key="search">${I.search}<input type="text" id="filter" placeholder="Filter by name, branch or URL…" value="${esc(ui.filter)}" aria-label="Filter resources"></div>`;
        }
        h += localView();
        const q = ui.filter.trim().toLowerCase();
        const match = (r) => !q || [r.name, r.branch, r.typeLabel, ...(r.urls || [])].join(' ').toLowerCase().includes(q);
        let shown = 0;
        for (const g of state.environments) {
            const list = g.resources.filter(match);
            if (!list.length) continue;
            shown += list.length;
            const key = 'env-' + g.name;
            const collapsed = ui.collapsed.has(g.name);
            const label = state.environments.length === 1 && g.name === 'production' ? 'Resources' : g.name;
            h += `<div class="section${collapsed ? ' collapsed' : ''}" data-key="${esc(key)}">
                <button class="section-head" ${act('toggleSection', { env: g.name })} aria-expanded="${!collapsed}">${I.chevron}<span>${esc(label)}</span><span class="count">${list.length}</span></button>
                <div class="list">${list.map(row).join('')}</div></div>`;
        }
        if (!shown) {
            h += `<div class="empty" data-key="empty">${q ? 'Nothing matches the filter.' : `No resources in ${esc(state.project ? state.project.name : 'this project')} yet. Add an app in Coolify, then refresh.`}</div>`;
        }
        h += `<div class="foot" data-key="foot"><a ${act('openUrl', { url: state.project ? state.project.coolifyUrl : state.serverUrl })}>Open in Coolify</a> · <a ${act('openSettings')}>Settings</a></div>`;
        return h;
    }

    function localView() {
        const services = local.services || [];
        if (!services.length) return '';
        const rows = services
            .map((s) => {
                const dot = s.status === 'running' ? 'ok' : s.status === 'starting' ? 'busy' : '';
                const up = s.status !== 'stopped';
                return `<div class="row" data-key="local-${esc(s.name)}">
                <div class="row-main static"><div class="dots"><span class="dot ${dot}"></span></div><div class="info">
                    <div class="title"><span class="name">${esc(s.name)}</span><span class="tag local">Local</span>${s.url && s.status === 'running' ? `<a class="link" title="Open ${esc(s.url)}" ${act('localOpen', { name: s.name })}>${I.external}</a>` : ''}</div>
                    <div class="sub"><span class="sha">${esc(s.command)}</span>${s.port ? `<span>·</span><span>:${esc(s.port)}</span>` : ''}<span>·</span><span class="${s.status === 'running' ? 'state-ok' : s.status === 'starting' ? 'state-busy' : ''}">${esc(s.status)}</span></div>
                </div></div>
                <div class="actions">${up ? `<button class="btn danger" ${act('localStop', { name: s.name })}>${I.stop} Stop</button>` : `<button class="btn primary" ${act('localStart', { name: s.name })}>${I.play} Start</button>`}<button class="btn ghost" ${act('localShow', { name: s.name })}>${I.terminal} Terminal</button></div>
            </div>`;
            })
            .join('');
        const collapsed = ui.collapsed.has('__local');
        return `<div class="section${collapsed ? ' collapsed' : ''}" data-key="local"><button class="section-head" ${act('toggleSection', { env: '__local' })}>${I.chevron}<span>Localhost</span><span class="count">${services.length}</span></button><div class="list">${rows}</div></div>`;
    }

    function row(r) {
        const deps = r.deployments || [];
        const latest = deps[0];
        const deploying = !!latest && isActive(latest.status);
        const lastFailed = !deploying && isFailed(latest);
        const open = ui.expanded.has(r.uuid);
        const busy = ui.busy.has(r.uuid);
        let cls = 'row';
        if (open) cls += ' open';
        if (deploying) cls += ' deploying';
        else if (lastFailed) cls += ' failed';
        if (r.isThisRepo) cls += ' this-repo';
        if (ui.flash.has(r.uuid)) cls += ' flash';

        let sub;
        if (r.kind !== 'application') {
            sub = `<span>${esc(r.typeLabel)}</span><span>·</span><span class="${r.running ? 'state-ok' : 'state-bad'}">${esc(r.container)}${r.health && r.health !== 'unknown' ? ' · ' + esc(r.health) : ''}</span>`;
        } else if (deploying) {
            sub = `<span class="state-busy">${latest.status === 'queued' ? 'Queued…' : 'Deploying…'}</span>${latest.commit ? `<span class="sha">${esc(short(latest.commit))}</span>` : ''}`;
        } else if (latest) {
            sub = `<span title="${esc(new Date(latest.createdAt).toLocaleString())}">${esc(rel(latest.createdAt))}</span>`;
            if (latest.commit) sub += `<span>·</span><span class="sha">${esc(short(latest.commit))}</span>`;
            if (lastFailed) sub += `<span>·</span><span class="state-bad">${latest.buildError ? 'build failed' : 'deploy failed'}</span>`;
            else if (!r.running) sub += `<span>·</span><span class="state-bad">${esc(r.container)}</span>`;
            else if (r.health === 'unhealthy') sub += `<span>·</span><span class="state-bad">unhealthy</span>`;
            else if (latest.commitMessage) sub += `<span>·</span><span class="msg">${esc(latest.commitMessage)}</span>`;
        } else {
            sub = `<span>Not deployed yet</span>${r.branch ? `<span>·</span><span>${esc(r.branch)}</span>` : ''}`;
        }

        const tip = `Container: ${r.container}${r.health ? ' · health: ' + r.health : ''}${lastFailed ? '\nLast deployment failed' : ''}`;
        const dots = `<div class="dots" title="${esc(tip)}"><span class="dot ${containerDot(r, deploying, lastFailed)}"></span><span class="dot sm ${healthDot(r)}"></span></div>`;
        const tags =
            (r.isThisRepo ? `<span class="tag" title="This app builds the repo you have open">${I.pin}</span>` : '') +
            (r.kind !== 'application' ? `<span class="tag neutral">${esc(r.kind === 'service' ? 'Service' : 'DB')}</span>` : r.branch ? `<span class="tag neutral" title="Git branch">${esc(r.branch)}</span>` : '');
        const link = r.urls && r.urls[0] ? `<a class="link" title="Open ${esc(r.urls[0])}" ${act('openUrl', { url: r.urls[0] })}>${I.external}</a>` : '';

        const b = busy ? ' aria-busy="true" disabled' : '';
        let actions = '';
        if (r.kind === 'application' && deploying) {
            actions += `<button class="btn primary" disabled aria-busy="true">${I.restart} ${latest.status === 'queued' ? 'Queued…' : 'Deploying…'}</button>`;
            actions += `<button class="btn ghost" ${act('logs', { appUuid: r.uuid, deploymentUuid: latest.uuid })}>${I.logs} Live log</button>`;
        } else if (r.kind === 'application') {
            if (r.isMergeTarget && state.merge) {
                const behind = state.merge.behind || 0;
                actions += `<button class="btn ${behind ? 'warn' : 'primary'}" ${act('merge', { uuid: r.uuid, name: r.name })}${b} title="Merge ${esc(state.merge.source)} into ${esc(state.merge.target)}, push, then deploy">${I.merge} Merge &amp; Deploy${behind ? ` · ${behind}` : ''}</button>`;
                actions += `<button class="btn ghost icon" title="Deploy ${esc(state.merge.target)} as it is (no merge)" ${act('deploy', { uuid: r.uuid, name: r.name })}${b}>${I.rocket}</button>`;
            } else {
                actions += `<button class="btn primary" ${act('deploy', { uuid: r.uuid, name: r.name })}${b}>${I.rocket} Deploy</button>`;
            }
        }
        if (r.running) {
            actions += `<button class="btn ghost icon" title="Restart" ${act('lifecycle', { uuid: r.uuid, name: r.name, kind: r.kind, op: 'restart' })}${b}>${I.restart}</button>`;
            actions += `<button class="btn ghost icon" title="Stop" ${act('lifecycle', { uuid: r.uuid, name: r.name, kind: r.kind, op: 'stop' })}${b}>${I.stop}</button>`;
        } else {
            actions += `<button class="btn ghost" title="Start" ${act('lifecycle', { uuid: r.uuid, name: r.name, kind: r.kind, op: 'start' })}${b}>${I.play} Start</button>`;
        }

        return `<div class="${cls}" data-key="r-${esc(r.uuid)}">
            <div class="row-main" role="button" tabindex="0" ${act('toggle', { uuid: r.uuid })} aria-expanded="${open}">${dots}<div class="info"><div class="title"><span class="name">${esc(r.name)}</span>${tags}${link}</div><div class="sub">${sub}</div></div></div>
            <div class="actions">${actions}</div>
            ${open ? details(r) : ''}
        </div>`;
    }

    function details(r) {
        const deps = r.deployments || [];
        const selUuid = ui.selected[r.uuid];
        const d = (selUuid && deps.find((x) => x.uuid === selUuid)) || deps[0];
        let h = '<div class="details">';
        const grid = [];
        grid.push(['Status', `${esc(r.container)}${r.health && r.health !== 'unknown' ? ' · ' + esc(r.health) : ''}`]);
        grid.push(['Environment', esc(r.environment)]);
        if (r.branch) grid.push(['Branch', esc(r.branch)]);
        if (r.urls && r.urls.length) grid.push(['URL', r.urls.map((u) => `<a ${act('openUrl', { url: u })}>${esc(u.replace(/^https?:\/\//, ''))}</a>`).join('<br>')]);
        if (r.kind === 'application' && d) {
            grid.push(['Deployment', `<span class="status-pill ${pillClass(d)}">${esc(statusWord(d))}</span>`]);
            grid.push(['Started', esc(rel(d.createdAt)) || '—']);
            if (!isActive(d.status)) grid.push(['Took', esc(duration(d.createdAt, d.updatedAt)) || '—']);
            grid.push(['Trigger', d.trigger === 'webhook' ? 'git push' : d.trigger === 'api' ? 'API' : 'manual']);
        }
        h += `<div class="grid">${grid.map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>`;
        if (r.description) h += `<div class="muted desc">${esc(r.description)}</div>`;

        if (d && d.buildError && !FAILED.includes(String(d.status).toLowerCase())) {
            h += `<div class="notice error build-warning">${I.warn}<div>Coolify marked this deployment as finished, but its build log contains <b>${esc(d.buildError)}</b>. The running container is probably the previous build.</div></div>`;
        }
        if (d && d.commit) {
            const url = commitLink(r.repoUrl, d.commit);
            h += `<div class="commit">${url ? `<a class="sha" ${act('openUrl', { url })}>${esc(short(d.commit))}</a>` : `<span class="sha">${esc(short(d.commit))}</span>`}${d.commitMessage ? `<div class="msg">${esc(d.commitMessage)}</div>` : ''}</div>`;
        }

        const b = ui.busy.has(r.uuid) ? ' disabled' : '';
        const btns = [];
        if (r.kind === 'application') {
            if (d) btns.push(`<button class="btn ghost" ${act('logs', { appUuid: r.uuid, deploymentUuid: d.uuid })}>${I.logs} Build log</button>`);
            btns.push(`<button class="btn ghost" ${act('runtimeLogs', { appUuid: r.uuid })}>${I.terminal} Container log</button>`);
            if (d && isActive(d.status)) btns.push(`<button class="btn danger" ${act('cancelDeployment', { deploymentUuid: d.uuid })}>${I.x} Cancel</button>`);
            else btns.push(`<button class="btn ghost" title="Rebuild without Docker cache" ${act('deploy', { uuid: r.uuid, name: r.name, force: '1' })}${b}>${I.restart} Force rebuild</button>`);
        }
        btns.push(`<button class="btn ghost" ${act('openUrl', { url: r.coolifyUrl })}>${I.external} Coolify</button>`);
        h += `<div class="detail-actions">${btns.join('')}</div>`;

        const log = ui.logs[r.uuid];
        if (log) {
            h += `<div class="logpane" data-key="log-${esc(r.uuid)}"><div class="logpane-head">${log.live ? '<span class="live-dot"></span>' : ''}<span class="title-text">${esc(log.title || 'Log')}</span><button class="icon-btn" title="Close log" ${act('closeLog', { appUuid: r.uuid })}>${I.x}</button></div><pre class="log${log.error ? ' error' : ''}" data-key="pre-${esc(r.uuid)}">${esc(log.text)}</pre></div>`;
        }

        if (deps.length > 1) {
            h += `<div class="history-title">Recent deployments</div><div class="history">${deps
                .map((x) => {
                    const dc = pillClass(x) || 'idle';
                    return `<button class="hist${x === d ? ' sel' : ''}" data-key="h-${esc(x.uuid)}" ${act('selectDeployment', { appUuid: r.uuid, deploymentUuid: x.uuid })} title="${esc(statusWord(x))}"><span class="dot sm h-${dc}"></span><span class="sha">${esc(short(x.commit) || '—')}</span><span class="msg">${esc(x.commitMessage || statusWord(x))}</span><span class="when">${esc(rel(x.createdAt))}</span></button>`;
                })
                .join('')}</div>`;
        }
        return h + '</div>';
    }

    // ---- Minimal keyed DOM morph: keeps focus, scroll and open panes ---------
    function keyOf(n) {
        return n.nodeType === 1 ? n.getAttribute('data-key') : null;
    }
    function morph(from, to) {
        if (from.nodeType === 3 || from.nodeType === 8) {
            if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
            return;
        }
        // attributes
        const fa = from.attributes;
        for (let i = fa.length - 1; i >= 0; i--) {
            const a = fa[i];
            if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
        }
        for (const a of Array.from(to.attributes)) {
            if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
        }
        if (from.tagName === 'INPUT') {
            if (document.activeElement !== from && from.value !== to.getAttribute('value')) from.value = to.getAttribute('value') || '';
            const checked = to.hasAttribute('checked');
            if (from.checked !== checked) from.checked = checked;
            return;
        }
        let stick = false;
        if (from.tagName === 'PRE') stick = from.scrollHeight - from.scrollTop - from.clientHeight < 24;
        morphChildren(from, to);
        if (from.tagName === 'PRE' && stick) from.scrollTop = from.scrollHeight;
    }
    function morphChildren(from, to) {
        const keyed = new Map();
        for (const c of Array.from(from.childNodes)) {
            const k = keyOf(c);
            if (k) keyed.set(k, c);
        }
        const incoming = Array.from(to.childNodes);
        let i = 0;
        for (const nn of incoming) {
            const current = from.childNodes[i] || null;
            const k = keyOf(nn);
            let match = null;
            if (k) {
                const cand = keyed.get(k);
                if (cand && cand.nodeName === nn.nodeName) match = cand;
            } else if (current && !keyOf(current) && current.nodeType === nn.nodeType && current.nodeName === nn.nodeName) {
                match = current;
            }
            if (match) {
                if (match !== current) from.insertBefore(match, current);
                morph(match, nn);
            } else {
                from.insertBefore(nn, current);
                if (nn.nodeType === 1 && nn.querySelector) {
                    const pre = nn.tagName === 'PRE' ? nn : nn.querySelector('pre.log');
                    if (pre) pre.scrollTop = pre.scrollHeight;
                }
            }
            i++;
        }
        while (from.childNodes.length > i) from.removeChild(from.lastChild);
    }

    // ---- Events ------------------------------------------------------------
    // One delegated listener: the innermost [data-action] wins, so a link inside a row
    // opens the link instead of also toggling the row.
    document.addEventListener('click', (ev) => {
        const target = /** @type {HTMLElement} */ (ev.target);
        const el = target && target.closest ? target.closest('[data-action]') : null;
        if (!el || el.tagName === 'INPUT') return;
        ev.preventDefault();
        handle(el.getAttribute('data-action'), /** @type {HTMLElement} */ (el).dataset);
    });

    document.addEventListener('keydown', (ev) => {
        const el = /** @type {HTMLElement} */ (ev.target);
        if ((ev.key === 'Enter' || ev.key === ' ') && el && el.getAttribute && el.getAttribute('role') === 'button' && el.hasAttribute('data-action')) {
            ev.preventDefault();
            handle(el.getAttribute('data-action'), el.dataset);
        }
    });

    document.addEventListener('input', (ev) => {
        const t = /** @type {HTMLInputElement} */ (ev.target);
        if (t && t.id === 'filter') {
            ui.filter = t.value;
            persist();
            render();
        }
    });

    document.addEventListener('change', (ev) => {
        const t = /** @type {HTMLInputElement} */ (ev.target);
        if (t && t.getAttribute('data-action') === 'toggleShare') {
            ui.share = t.checked;
            persist();
        }
    });

    function handle(a, d) {
        if (!a) return;
        switch (a) {
            case 'toggle':
                if (ui.expanded.has(d.uuid)) ui.expanded.delete(d.uuid);
                else ui.expanded.add(d.uuid);
                persist();
                return render();
            case 'toggleSection':
                if (ui.collapsed.has(d.env)) ui.collapsed.delete(d.env);
                else ui.collapsed.add(d.env);
                persist();
                return render();
            case 'toggleShare':
                return;
            case 'selectDeployment':
                ui.selected[d.appUuid] = d.deploymentUuid;
                return render();
            case 'closeLog':
                delete ui.logs[d.appUuid];
                vscode.postMessage({ type: 'stopLogs', appUuid: d.appUuid });
                return render();
            case 'selectProject':
                return vscode.postMessage({ type: 'selectProject', uuid: d.uuid, share: ui.share });
            case 'deploy':
                return vscode.postMessage({ type: 'deploy', uuid: d.uuid, name: d.name, force: d.force === '1' });
            case 'merge':
                return vscode.postMessage({ type: 'merge', uuid: d.uuid, name: d.name });
            case 'lifecycle':
                return vscode.postMessage({ type: 'lifecycle', uuid: d.uuid, name: d.name, kind: d.kind, action: d.op });
            case 'logs':
                ui.expanded.add(d.appUuid);
                return vscode.postMessage({ type: 'logs', appUuid: d.appUuid, deploymentUuid: d.deploymentUuid });
            case 'runtimeLogs':
                return vscode.postMessage({ type: 'runtimeLogs', appUuid: d.appUuid });
            case 'cancelDeployment':
                return vscode.postMessage({ type: 'cancelDeployment', deploymentUuid: d.deploymentUuid });
            case 'openUrl':
                return vscode.postMessage({ type: 'openUrl', url: d.url });
            case 'localStart':
            case 'localStop':
            case 'localShow':
            case 'localOpen':
                return vscode.postMessage({ type: a, name: d.name });
            default:
                return vscode.postMessage({ type: a });
        }
    }

    // Successful deploys flash once.
    function trackTransitions() {
        for (const g of state.environments || []) {
            for (const r of g.resources) {
                const latest = (r.deployments || [])[0];
                const now = !!latest && isActive(latest.status);
                if (ui.prevActive[r.uuid] && !now && latest && isFinished(latest.status) && !latest.buildError) {
                    ui.flash.add(r.uuid);
                    setTimeout(() => {
                        ui.flash.delete(r.uuid);
                        render();
                    }, 2000);
                }
                ui.prevActive[r.uuid] = now;
            }
        }
    }

    window.addEventListener('message', (event) => {
        const m = event.data;
        switch (m && m.type) {
            case 'state':
                state = m.state;
                trackTransitions();
                return render();
            case 'local':
                local = { services: m.services || [], trusted: m.trusted };
                return render();
            case 'busy':
                if (m.on) ui.busy.add(m.uuid);
                else ui.busy.delete(m.uuid);
                return render();
            case 'logs':
                ui.logs[m.appUuid] = { title: m.title, text: m.text, live: !!m.live, error: !!m.error, deploymentUuid: m.deploymentUuid };
                ui.expanded.add(m.appUuid);
                return render();
            case 'logsStopped':
                if (ui.logs[m.appUuid]) ui.logs[m.appUuid].live = false;
                return render();
        }
    });

    // Keep "x minutes ago" labels fresh without asking the extension.
    setInterval(render, 30000);
    render();
    vscode.postMessage({ type: 'ready' });
})();
