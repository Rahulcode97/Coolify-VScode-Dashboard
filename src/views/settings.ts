import * as vscode from 'vscode';
import { AuthMode, CoolifyApiError, CoolifyClient } from '../api/client';
import { ConnectionUpdate, LocalServiceConfig, activeFolder } from '../config';
import { Controller } from '../controller';
import { repoKey } from '../projects';
import { webviewHtml } from './html';

const DOCS = 'https://github.com/Rahulcode97/Coolify-VScode-Dashboard/blob/main/docs/';

interface FormConnection {
    serverUrl: string;
    authMode: AuthMode;
    allowSelfSigned: boolean;
    timeoutSeconds?: number;
    token?: string;
    cfClientId?: string;
    cfClientSecret?: string;
    headers?: { name: string; value?: string }[];
}

/** Settings page: connection wizard, project for this folder, and optional features. */
export class SettingsPanel implements vscode.Disposable {
    private static current?: SettingsPanel;
    private disposables: vscode.Disposable[] = [];

    static show(extensionUri: vscode.Uri, ctl: Controller): void {
        if (SettingsPanel.current) {
            SettingsPanel.current.panel.reveal();
            void SettingsPanel.current.sendInit();
            return;
        }
        const panel = vscode.window.createWebviewPanel('coolify.settings', 'Coolify Settings', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        });
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');
        SettingsPanel.current = new SettingsPanel(panel, extensionUri, ctl);
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly ctl: Controller,
    ) {
        panel.webview.html = webviewHtml(panel.webview, extensionUri, { title: 'Coolify Settings', script: 'settings.js', styles: ['common.css', 'settings.css'] });
        this.disposables.push(
            panel.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => this.post({ type: 'toast', kind: 'error', text: String(e?.message || e) }))),
            panel.onDidDispose(() => this.dispose()),
        );
    }

    private post(msg: unknown): void {
        void this.panel.webview.postMessage(msg);
    }

    private toUpdate(f: FormConnection): ConnectionUpdate {
        const headers: Record<string, string | undefined> = {};
        for (const h of f.headers || []) {
            if (h.name?.trim()) headers[h.name.trim()] = h.value === undefined || h.value === '' ? undefined : h.value;
        }
        const blankToKeep = (v?: string) => (v === undefined || v === '' ? undefined : v);
        return {
            serverUrl: f.serverUrl || '',
            authMode: f.authMode || 'token',
            allowSelfSigned: !!f.allowSelfSigned,
            timeoutSeconds: f.timeoutSeconds,
            token: blankToKeep(f.token),
            cfClientId: blankToKeep(f.cfClientId),
            cfClientSecret: blankToKeep(f.cfClientSecret),
            customHeaders: headers,
        };
    }

    async sendInit(): Promise<void> {
        const folder = activeFolder();
        const fs = this.ctl.settings.folder(folder);
        const ctx = await this.ctl.folderContext(folder);
        const c = vscode.workspace.getConfiguration('coolify');
        const inspect = folder ? vscode.workspace.getConfiguration('coolify', folder.uri).inspect<string>('projectUuid') : undefined;
        this.post({
            type: 'init',
            connection: await this.ctl.settings.summary(),
            dashboard: {
                refreshIntervalSeconds: c.get<number>('refreshIntervalSeconds') ?? 30,
                statusBar: c.get<boolean>('statusBar.enabled') !== false,
                confirmDeploy: c.get<boolean>('confirmDeploy') !== false,
            },
            folder: folder
                ? {
                      name: folder.name,
                      repo: repoKey(ctx?.remoteUrl),
                      projectUuid: fs.projectUuid || ctx?.savedProjectUuid || '',
                      shared: !!(inspect?.workspaceFolderValue || inspect?.workspaceValue),
                      environment: fs.environment,
                  }
                : null,
            features: {
                preDeployCommand: fs.preDeployCommand,
                preDeployCwd: fs.preDeployCwd,
                mergeEnabled: fs.mergeEnabled,
                mergeSource: fs.mergeSource,
                mergeTarget: fs.mergeTarget,
                mergeRemote: fs.mergeRemote,
                localServices: fs.localServices,
                pendingBar: fs.pendingBar,
                stopUsersCheck: fs.stopUsersCheck,
                migrationGlobs: fs.migrationGlobs,
                downtimeRules: fs.downtimeRules,
            },
            trusted: vscode.workspace.isTrusted,
            currentProject: this.ctl.lastState.project?.uuid || '',
        });
        if (await this.ctl.client()) void this.loadProjects();
    }

    private async loadProjects(form?: FormConnection): Promise<void> {
        try {
            const client = form ? new CoolifyClient(await this.ctl.settings.draftConnection(this.toUpdate(form))) : await this.ctl.client();
            if (!client) return;
            const projects = await client.listProjects();
            this.post({ type: 'projects', projects: projects.map((p) => ({ uuid: p.uuid, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)) });
        } catch {
            this.post({ type: 'projects', projects: null });
        }
    }

    private async onMessage(m: any): Promise<void> {
        switch (m?.type) {
            case 'ready':
                await this.sendInit();
                return;
            case 'test': {
                const started = Date.now();
                try {
                    const draft = await this.ctl.settings.draftConnection(this.toUpdate(m.connection));
                    const client = new CoolifyClient(draft);
                    const version = await client.version();
                    const projects = await client.listProjects();
                    this.post({
                        type: 'testResult',
                        ok: true,
                        message: `Connected to Coolify ${version} in ${Date.now() - started} ms. ${projects.length} project${projects.length === 1 ? '' : 's'} found.`,
                        projects: projects.map((p) => ({ uuid: p.uuid, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
                    });
                } catch (e: any) {
                    this.post({ type: 'testResult', ok: false, message: e instanceof CoolifyApiError ? e.message : String(e?.message || e), hint: e instanceof CoolifyApiError ? e.hint : '' });
                }
                return;
            }
            case 'save':
                await this.save(m);
                return;
            case 'copyPrompt':
                await vscode.commands.executeCommand('coolify.copyAiSetupPrompt');
                return;
            case 'openDoc':
                if (typeof m.doc === 'string' && /^[a-z0-9-]+\.md(#[a-z0-9-]+)?$/.test(m.doc)) await vscode.env.openExternal(vscode.Uri.parse(DOCS + m.doc));
                return;
            case 'openUrl':
                if (typeof m.url === 'string' && /^https?:\/\//.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
                return;
            case 'forget': {
                const pick = await vscode.window.showWarningMessage('Forget the saved Coolify token and Cloudflare secrets?', { modal: true }, 'Forget');
                if (pick === 'Forget') {
                    await this.ctl.settings.forgetCredentials();
                    await this.sendInit();
                    void this.ctl.refresh();
                }
                return;
            }
        }
    }

    private async save(m: any): Promise<void> {
        const G = vscode.ConfigurationTarget.Global;
        const c = vscode.workspace.getConfiguration('coolify');
        await this.ctl.settings.saveConnection(this.toUpdate(m.connection));

        const d = m.dashboard || {};
        const interval = Math.min(600, Math.max(10, Number(d.refreshIntervalSeconds) || 30));
        await c.update('refreshIntervalSeconds', interval, G);
        await c.update('statusBar.enabled', d.statusBar !== false, G);
        await c.update('confirmDeploy', d.confirmDeploy !== false, G);

        const folder = activeFolder();
        if (folder) {
            const fc = vscode.workspace.getConfiguration('coolify', folder.uri);
            const W = vscode.ConfigurationTarget.WorkspaceFolder;
            const f = m.features || {};
            const setIfChanged = async (key: string, value: unknown, fallback: unknown) => {
                const current = fc.inspect(key);
                const has = current?.workspaceFolderValue !== undefined || current?.workspaceValue !== undefined;
                if (!has && JSON.stringify(value) === JSON.stringify(fallback)) return; // keep folder settings clean
                await fc.update(key, value, W);
            };
            await setIfChanged('preDeploy.command', String(f.preDeployCommand || '').trim(), '');
            await setIfChanged('preDeploy.cwd', String(f.preDeployCwd || '').trim(), '');
            await setIfChanged('merge.enabled', !!f.mergeEnabled, false);
            await setIfChanged('merge.sourceBranch', String(f.mergeSource || 'development').trim(), 'development');
            await setIfChanged('merge.targetBranch', String(f.mergeTarget || 'main').trim(), 'main');
            await setIfChanged('merge.remote', String(f.mergeRemote || 'origin').trim(), 'origin');
            const services: LocalServiceConfig[] = (Array.isArray(f.localServices) ? f.localServices : [])
                .map((s: any) => ({
                    name: String(s.name || '').trim(),
                    command: String(s.command || '').trim(),
                    ...(s.cwd ? { cwd: String(s.cwd).trim() } : {}),
                    ...(Number(s.port) > 0 ? { port: Number(s.port) } : {}),
                    ...(s.url ? { url: String(s.url).trim() } : {}),
                }))
                .filter((s: LocalServiceConfig) => s.name && s.command);
            await setIfChanged('localServices', services, []);
            await setIfChanged('deployRisk.pendingBar', f.pendingBar !== false, true);
            await setIfChanged('deployRisk.stopUsersCheck', f.stopUsersCheck !== false, true);
            const globs = (Array.isArray(f.migrationGlobs) ? f.migrationGlobs : []).map((g: unknown) => String(g).trim()).filter(Boolean);
            await setIfChanged('deployRisk.migrationGlobs', globs, []);
            const rules = (Array.isArray(f.downtimeRules) ? f.downtimeRules : [])
                .map((r: any) => ({ pattern: String(r?.pattern || '').trim(), ...(r?.reason ? { reason: String(r.reason).trim() } : {}) }))
                .filter((r: { pattern: string }) => r.pattern);
            await setIfChanged('deployRisk.downtimeRules', rules, []);
            await setIfChanged('environment', String(m.folder?.environment || '').trim(), '');

            const projectUuid = String(m.folder?.projectUuid || '').trim();
            if (projectUuid) await this.ctl.saveProject(folder, projectUuid, !!m.folder?.shared);
            else {
                // "Auto-detect": drop the saved choice and any folder-level setting.
                await this.ctl.saveProject(folder, '', false);
                const inspect = fc.inspect<string>('projectUuid');
                if (inspect?.workspaceFolderValue ?? inspect?.workspaceValue) await fc.update('projectUuid', undefined, W);
            }
        }
        this.ctl.settings.notifyChanged();
        const state = await this.ctl.refresh({ resetCaches: true });
        this.post({ type: 'saved', phase: state.phase, error: state.error, project: state.project?.name });
    }

    dispose(): void {
        SettingsPanel.current = undefined;
        this.disposables.forEach((d) => d.dispose());
        this.panel.dispose();
    }
}
