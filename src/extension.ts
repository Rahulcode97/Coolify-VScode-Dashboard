import * as vscode from 'vscode';
import { CoolifyApiError } from './api/client';
import { buildAiSetupPrompt } from './aiPrompt';
import { Settings, activeFolder } from './config';
import { Controller } from './controller';
import { DashboardState, ResourceView } from './dashboardData';
import { formatDeploymentLogs, relativeTime } from './logs';
import { DashboardViewProvider } from './views/dashboard';
import { SettingsPanel } from './views/settings';

export function activate(context: vscode.ExtensionContext): void {
    const settings = new Settings(context.secrets);
    const ctl = new Controller(context, settings);
    const dashboard = new DashboardViewProvider(context.extensionUri, ctl);
    const status = vscode.window.createStatusBarItem('coolify.status', vscode.StatusBarAlignment.Left, 50);
    status.name = 'Coolify';
    status.command = 'coolify.focus';

    context.subscriptions.push(ctl, dashboard, status, vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, dashboard, { webviewOptions: { retainContextWhenHidden: false } }));

    void settings.migrateLegacy().then(({ moved, leftover }) => {
        if (!moved) return;
        if (leftover.length) {
            void vscode.window
                .showWarningMessage(`Coolify: your credentials were copied into secure storage. Please delete the old plain-text entries from your user settings.json: ${leftover.join(', ')}.`, 'Open settings.json')
                .then((pick) => pick && vscode.commands.executeCommand('workbench.action.openSettingsJson'));
        } else {
            void vscode.window.showInformationMessage('Coolify: your credentials were moved from settings.json into secure storage.');
        }
    });

    // ---- Status bar -----------------------------------------------------
    const renderStatus = (s: DashboardState) => {
        if (!settings.statusBarEnabled() || s.phase === 'setup') return status.hide();
        if (s.phase === 'error') {
            status.text = '$(cloud) Coolify $(warning)';
            status.tooltip = `${s.error?.message || 'Error'}\n${s.error?.hint || ''}`;
            status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else if (s.phase === 'pick') {
            status.text = '$(cloud) Coolify: pick project';
            status.tooltip = 'Choose which Coolify project this folder shows';
            status.backgroundColor = undefined;
        } else {
            const { running, total } = s.counts;
            const down = total - running;
            status.text = `${s.activeDeployments ? '$(sync~spin)' : '$(cloud)'} ${s.project?.name ?? 'Coolify'} ${running}/${total}`;
            status.tooltip = `${s.project?.name}: ${running} running${down ? `, ${down} not running` : ''}${s.activeDeployments ? '\nA deployment is in progress' : ''}\nClick to open the Coolify dashboard`;
            status.backgroundColor = down > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
        }
        status.show();
    };
    context.subscriptions.push(ctl.onState(renderStatus));

    // Light background refresh for the status bar while the sidebar is closed.
    const bg = setInterval(() => {
        if (!settings.statusBarEnabled() || dashboard.visible || !vscode.window.state.focused) return;
        if (ctl.lastState.phase === 'setup') return;
        void ctl.refresh();
    }, 120_000);
    context.subscriptions.push({ dispose: () => clearInterval(bg) });
    setTimeout(async () => {
        if (settings.statusBarEnabled() && (await ctl.client()) && !dashboard.visible) void ctl.refresh();
    }, 4000);

    // ---- React to changes ----------------------------------------------
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (!e.affectsConfiguration('coolify')) return;
            settings.notifyChanged();
            if (e.affectsConfiguration('coolify.statusBar.enabled')) renderStatus(ctl.lastState);
            if (dashboard.visible) void dashboard.refreshNow();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => void ctl.refresh()),
        vscode.workspace.onDidGrantWorkspaceTrust(() => void ctl.refresh()),
    );
    // Multi-root: follow the folder of the active editor.
    let lastFolder = activeFolder()?.uri.toString();
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            const now = activeFolder()?.uri.toString();
            if (now === lastFolder) return;
            lastFolder = now;
            if (dashboard.visible || settings.statusBarEnabled()) void ctl.refresh();
        }),
    );

    // ---- Commands -------------------------------------------------------
    const run = (fn: (...args: any[]) => Promise<unknown> | unknown) => async (...args: any[]) => {
        try {
            await fn(...args);
        } catch (e: any) {
            if (e instanceof CoolifyApiError && e.message === 'Coolify is not connected yet.') return;
            void vscode.window.showErrorMessage(`Coolify: ${e instanceof CoolifyApiError ? `${e.message} ${e.hint}` : e?.message || e}`);
        }
    };

    const allApps = (s: DashboardState): ResourceView[] => s.environments.flatMap((g) => g.resources).filter((r) => r.kind === 'application');

    context.subscriptions.push(
        vscode.commands.registerCommand('coolify.focus', () => vscode.commands.executeCommand('coolify.dashboard.focus')),
        vscode.commands.registerCommand('coolify.refresh', run(() => (dashboard.visible ? dashboard.refreshNow({ forceGitFetch: true, resetCaches: true }) : ctl.refresh({ resetCaches: true })))),
        vscode.commands.registerCommand('coolify.openSettings', () => SettingsPanel.show(context.extensionUri, ctl)),
        vscode.commands.registerCommand(
            'coolify.selectProject',
            run(async () => {
                const client = await ctl.requireClient();
                const folder = activeFolder();
                const projects = await ctl.data.directory.listProjects(client, true);
                const s = ctl.lastState;
                const suggested = new Set(s.projects.filter((p) => p.suggested).map((p) => p.uuid));
                type Item = vscode.QuickPickItem & { uuid: string };
                const items: Item[] = [
                    { label: '$(sparkle) Auto-detect from git remote', description: 'default', uuid: '' },
                    ...projects
                        .map((p) => ({
                            label: `${suggested.has(p.uuid) ? '$(star-full) ' : ''}${p.name}`,
                            description: [s.project?.uuid === p.uuid ? 'current' : '', suggested.has(p.uuid) ? 'builds this repo' : ''].filter(Boolean).join(' · '),
                            detail: p.description || undefined,
                            uuid: p.uuid,
                        }))
                        .sort((a, b) => Number(suggested.has(b.uuid)) - Number(suggested.has(a.uuid))),
                ];
                const pick = await vscode.window.showQuickPick(items, { title: folder ? `Coolify project for "${folder.name}"` : 'Coolify project', placeHolder: 'Pick the project this folder deploys to', matchOnDescription: true });
                if (!pick) return;
                let share = false;
                if (folder && pick.uuid) {
                    const where = await vscode.window.showQuickPick(
                        [
                            { label: 'Just for me', description: 'Remembered on this machine', share: false },
                            { label: 'Share with my team', description: 'Writes coolify.projectUuid to .vscode/settings.json', share: true },
                        ],
                        { title: 'Remember this choice' },
                    );
                    if (!where) return;
                    share = where.share;
                }
                await ctl.saveProject(folder, pick.uuid, share);
                if (!pick.uuid && folder) {
                    const fc = vscode.workspace.getConfiguration('coolify', folder.uri);
                    const i = fc.inspect<string>('projectUuid');
                    if (i?.workspaceFolderValue ?? i?.workspaceValue) await fc.update('projectUuid', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
                }
                await (dashboard.visible ? dashboard.refreshNow() : ctl.refresh());
            }),
        ),
        vscode.commands.registerCommand(
            'coolify.quickDeploy',
            run(async () => {
                await ctl.requireClient();
                const s = await ctl.refresh();
                const apps = allApps(s);
                if (!apps.length) {
                    void vscode.window.showInformationMessage(s.phase === 'pick' ? 'Pick a Coolify project for this folder first.' : 'No applications in this project.');
                    return;
                }
                const pick = await vscode.window.showQuickPick(
                    apps.map((a) => ({ label: a.name, description: [a.environment, a.branch].filter(Boolean).join(' · '), detail: a.urls[0], app: a })),
                    { title: 'Deploy which application?' },
                );
                if (!pick) return;
                const mode = await vscode.window.showQuickPick([{ label: 'Deploy', force: false }, { label: 'Force rebuild', description: 'Ignore build cache', force: true }], { title: `Deploy ${pick.app.name}` });
                if (!mode) return;
                const dep = await ctl.deploy(pick.app.uuid, pick.app.name, mode.force);
                if (dep) dashboard.watchLogs(pick.app.uuid, dep);
            }),
        ),
        vscode.commands.registerCommand(
            'coolify.showDeployments',
            run(async (arg?: { uuid?: string; name?: string }) => {
                const client = await ctl.requireClient();
                let app = arg?.uuid ? { uuid: arg.uuid, name: arg.name || arg.uuid } : undefined;
                if (!app) {
                    const apps = allApps(ctl.lastState.phase === 'ready' ? ctl.lastState : await ctl.refresh());
                    const pick = await vscode.window.showQuickPick(apps.map((a) => ({ label: a.name, description: a.environment, a })), { title: 'Deployment history for…' });
                    if (!pick) return;
                    app = { uuid: pick.a.uuid, name: pick.a.name };
                }
                const list = await client.listApplicationDeployments(app.uuid, 20);
                if (!list.length) return void vscode.window.showInformationMessage(`No deployments for ${app.name} yet.`);
                const icon = (st: string) => (/finished|success/.test(st) ? '$(pass)' : /fail|error|cancel/.test(st) ? '$(error)' : '$(sync~spin)');
                const pick = await vscode.window.showQuickPick(
                    list.map((d) => ({ label: `${icon(d.status)} ${d.status}`, description: `${relativeTime(d.created_at)} · ${String(d.commit || '').slice(0, 7)}`, detail: d.commit_message || undefined, d })),
                    { title: `${app.name}: deployments`, matchOnDescription: true, matchOnDetail: true },
                );
                if (!pick) return;
                const full = await client.getDeployment(pick.d.deployment_uuid);
                ctl.output.clear();
                ctl.output.appendLine(`── ${app.name} · ${full.status} · ${full.created_at || ''} · ${full.commit || ''}`);
                ctl.output.appendLine(formatDeploymentLogs(full.logs) || '(no log output)');
                ctl.output.show(true);
            }),
        ),
        vscode.commands.registerCommand(
            'coolify.openInCoolify',
            run(async () => {
                const s = ctl.lastState;
                const url = s.project?.coolifyUrl || s.serverUrl || (await settings.summary()).serverUrl;
                if (!url) return SettingsPanel.show(context.extensionUri, ctl);
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }),
        ),
        vscode.commands.registerCommand(
            'coolify.runPreDeploy',
            run(async () => {
                const cmd = settings.folder(activeFolder()).preDeployCommand;
                if (!cmd) {
                    const pick = await vscode.window.showInformationMessage('No pre-deploy command is set for this folder.', 'Open Settings');
                    if (pick) SettingsPanel.show(context.extensionUri, ctl);
                    return;
                }
                if (await ctl.passesPreDeploy('this folder')) void vscode.window.showInformationMessage(`Pre-deploy command passed: ${cmd}`);
            }),
        ),
        vscode.commands.registerCommand(
            'coolify.copyAiSetupPrompt',
            run(async () => {
                const summary = await settings.summary();
                const folder = await ctl.folderContext();
                const s = ctl.lastState;
                const prompt = buildAiSetupPrompt(context.extensionPath, {
                    editor: `${vscode.env.appName} ${vscode.version}`,
                    serverUrl: summary.serverUrl,
                    authMode: { token: 'API token only', cloudflare: 'Cloudflare Access', headers: 'Custom headers' }[summary.authMode],
                    hasToken: summary.hasToken,
                    folderName: folder?.name,
                    repo: folder?.remoteUrl ? folder.remoteUrl.replace(/\/\/[^@/]+@/, '//') : undefined,
                    project: s.project?.name,
                    lastError: s.error ? `${s.error.message} ${s.error.hint}` : undefined,
                });
                await vscode.env.clipboard.writeText(prompt);
                void vscode.window.showInformationMessage('AI setup prompt copied. Paste it into Claude, ChatGPT or Cursor chat. It contains no secrets.');
            }),
        ),
        vscode.commands.registerCommand(
            'coolify.signOut',
            run(async () => {
                const pick = await vscode.window.showWarningMessage('Forget the saved Coolify token and Cloudflare secrets?', { modal: true }, 'Forget');
                if (pick !== 'Forget') return;
                await settings.forgetCredentials();
                await ctl.refresh();
            }),
        ),
    );
}

export function deactivate(): void {
    /* disposables handle cleanup */
}
