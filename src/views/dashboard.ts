import * as vscode from 'vscode';
import { CoolifyApiError } from '../api/client';
import { ResourceKind } from '../api/types';
import { activeFolder } from '../config';
import { Controller } from '../controller';
import { DashboardState } from '../dashboardData';
import { formatDeploymentLogs, isActiveDeployment } from '../logs';
import { webviewHtml } from './html';

interface LogWatch {
    deploymentUuid: string;
    timer: NodeJS.Timeout;
    last: string;
}

/** The sidebar dashboard. Polls only while visible; never overlaps requests. */
export class DashboardViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewType = 'coolify.dashboard';

    private view?: vscode.WebviewView;
    private refreshTimer?: NodeJS.Timeout;
    private localTimer?: NodeJS.Timeout;
    private watches = new Map<string, LogWatch>();
    private lastRefreshAt = 0;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly ctl: Controller,
    ) {
        this.disposables.push(ctl.onState((s) => this.postState(s)));
    }

    get visible(): boolean {
        return !!this.view?.visible;
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
        view.webview.html = webviewHtml(view.webview, this.extensionUri, { title: 'Coolify', script: 'dashboard.js', styles: ['common.css', 'dashboard.css'] });

        this.disposables.push(
            view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => this.showError(e))),
            view.onDidChangeVisibility(() => {
                if (view.visible) {
                    if (Date.now() - this.lastRefreshAt > 10_000) void this.refreshNow();
                    else this.schedule();
                    this.scheduleLocal(0);
                } else {
                    this.clearTimers();
                }
            }),
            view.onDidDispose(() => {
                this.clearTimers();
                this.stopAllLogs();
                this.view = undefined;
            }),
        );
    }

    private clearTimers(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        if (this.localTimer) clearTimeout(this.localTimer);
        this.refreshTimer = undefined;
        this.localTimer = undefined;
    }

    /** Next refresh: 5 s while a deployment runs, otherwise the configured interval. */
    private schedule(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        if (!this.visible) return;
        const s = this.ctl.lastState;
        if (s.phase === 'setup') return;
        const ms = s.activeDeployments ? 5000 : this.ctl.settings.refreshIntervalMs();
        this.refreshTimer = setTimeout(() => void this.refreshNow(), ms);
    }

    async refreshNow(opts: { forceGitFetch?: boolean; resetCaches?: boolean } = {}): Promise<DashboardState> {
        this.lastRefreshAt = Date.now();
        try {
            return await this.ctl.refresh(opts);
        } finally {
            this.schedule();
        }
    }

    private postState(state: DashboardState): void {
        void this.view?.webview.postMessage({ type: 'state', state });
    }

    private post(msg: unknown): void {
        void this.view?.webview.postMessage(msg);
    }

    private scheduleLocal(delay = 5000): void {
        if (this.localTimer) clearTimeout(this.localTimer);
        if (!this.visible) return;
        this.localTimer = setTimeout(async () => {
            await this.pushLocal();
            this.scheduleLocal(5000);
        }, delay);
    }

    private async pushLocal(): Promise<void> {
        const folder = activeFolder();
        const services = this.ctl.settings.folder(folder).localServices;
        const states = services.length ? await this.ctl.local.status(services) : [];
        this.post({ type: 'local', services: states, trusted: vscode.workspace.isTrusted });
    }

    private showError(e: any): void {
        const msg = e instanceof CoolifyApiError ? `${e.message} ${e.hint}` : String(e?.message || e);
        void vscode.window.showErrorMessage(`Coolify: ${msg}`);
    }

    private localService(name: string) {
        return this.ctl.settings.folder(activeFolder()).localServices.find((s) => s.name === name);
    }

    private async onMessage(m: any): Promise<void> {
        switch (m?.type) {
            case 'ready':
                this.postState(this.ctl.lastState);
                await this.refreshNow();
                this.scheduleLocal(0);
                return;
            case 'refresh':
                await this.refreshNow({ forceGitFetch: true, resetCaches: true });
                return;
            case 'openSettings':
                await vscode.commands.executeCommand('coolify.openSettings');
                return;
            case 'pickProject':
                await vscode.commands.executeCommand('coolify.selectProject');
                return;
            case 'selectProject':
                await this.ctl.saveProject(activeFolder(), String(m.uuid), !!m.share);
                await this.refreshNow();
                return;
            case 'copyPrompt':
                await vscode.commands.executeCommand('coolify.copyAiSetupPrompt');
                return;
            case 'openUrl':
                if (typeof m.url === 'string' && /^https?:\/\//i.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
                return;
            case 'deploy': {
                const dep = await this.withBusy(m.uuid, () => this.ctl.deploy(m.uuid, m.name, !!m.force));
                if (dep) this.watchLogs(m.uuid, dep);
                return;
            }
            case 'merge': {
                const dep = await this.withBusy(m.uuid, () => this.ctl.mergeAndDeploy(m.uuid, m.name));
                if (dep) this.watchLogs(m.uuid, dep);
                return;
            }
            case 'lifecycle':
                await this.withBusy(m.uuid, () => this.ctl.lifecycle(m.kind as ResourceKind, m.uuid, m.name, m.action));
                return;
            case 'logs':
                await this.showDeploymentLogs(m.appUuid, m.deploymentUuid);
                return;
            case 'runtimeLogs':
                await this.showRuntimeLogs(m.appUuid);
                return;
            case 'stopLogs':
                this.stopLogs(m.appUuid);
                return;
            case 'cancelDeployment': {
                const client = await this.ctl.requireClient();
                await client.cancelDeployment(m.deploymentUuid);
                void this.refreshNow();
                return;
            }
            case 'localStart': {
                const s = this.localService(m.name);
                const folder = activeFolder();
                if (s && folder) this.ctl.local.start(folder, s);
                this.scheduleLocal(800);
                return;
            }
            case 'localStop': {
                const s = this.localService(m.name);
                if (s) this.ctl.local.stop(s);
                this.scheduleLocal(800);
                return;
            }
            case 'localShow': {
                const s = this.localService(m.name);
                if (s && !this.ctl.local.show(s)) void vscode.window.showInformationMessage(`${s.name} is not running. Click Start first.`);
                return;
            }
            case 'localOpen': {
                const s = this.localService(m.name);
                const url = s ? this.ctl.local.urlFor(s) : '';
                if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
                return;
            }
        }
    }

    private async withBusy<T>(uuid: string, fn: () => Promise<T>): Promise<T | undefined> {
        this.post({ type: 'busy', uuid, on: true });
        try {
            return await fn();
        } finally {
            this.post({ type: 'busy', uuid, on: false });
        }
    }

    private async showDeploymentLogs(appUuid: string, deploymentUuid: string): Promise<void> {
        const client = await this.ctl.requireClient();
        this.post({ type: 'logs', appUuid, deploymentUuid, text: 'Loading…', live: false, title: 'Build log' });
        try {
            const d = await client.getDeployment(deploymentUuid);
            const text = formatDeploymentLogs(d.logs) || 'This deployment has no log output.';
            const live = isActiveDeployment(d.status);
            this.post({ type: 'logs', appUuid, deploymentUuid, text, live, title: live ? 'Build log (live)' : 'Build log' });
            if (live) this.watchLogs(appUuid, deploymentUuid);
        } catch (e: any) {
            this.post({ type: 'logs', appUuid, deploymentUuid, text: e instanceof CoolifyApiError ? `${e.message}\n${e.hint}` : String(e?.message || e), live: false, title: 'Build log', error: true });
        }
    }

    private async showRuntimeLogs(appUuid: string): Promise<void> {
        const client = await this.ctl.requireClient();
        this.stopLogs(appUuid);
        this.post({ type: 'logs', appUuid, deploymentUuid: '', text: 'Loading…', live: false, title: 'Container log' });
        try {
            const text = (await client.applicationLogs(appUuid, 300)) || 'No container output yet.';
            this.post({ type: 'logs', appUuid, deploymentUuid: '', text, live: false, title: 'Container log (last 300 lines)' });
        } catch (e: any) {
            const hint = e instanceof CoolifyApiError && e.status === 403 ? '\nContainer logs need a token with the "Read sensitive data" permission.' : '';
            this.post({ type: 'logs', appUuid, deploymentUuid: '', text: `${e?.message || e}${hint}`, live: false, title: 'Container log', error: true });
        }
    }

    /** Follow a running deployment's log every 2 s until it ends, then refresh once. */
    watchLogs(appUuid: string, deploymentUuid: string): void {
        this.stopLogs(appUuid);
        const watch: LogWatch = { deploymentUuid, last: '', timer: undefined as unknown as NodeJS.Timeout };
        let misses = 0;
        const tick = async () => {
            if (!this.watches.has(appUuid)) return;
            if (!this.visible) {
                watch.timer = setTimeout(tick, 3000);
                return;
            }
            try {
                const client = await this.ctl.client();
                if (!client) return this.stopLogs(appUuid);
                const d = await client.getDeployment(deploymentUuid);
                const text = formatDeploymentLogs(d.logs);
                const live = isActiveDeployment(d.status);
                if (text !== watch.last || !live) {
                    watch.last = text;
                    this.post({ type: 'logs', appUuid, deploymentUuid, text: text || 'Waiting for build output…', live, title: live ? 'Build log (live)' : `Build log · ${d.status}` });
                }
                if (!live) {
                    this.stopLogs(appUuid, false);
                    void this.refreshNow();
                    return;
                }
            } catch {
                if (++misses > 10) return this.stopLogs(appUuid);
            }
            watch.timer = setTimeout(tick, 2000);
        };
        this.watches.set(appUuid, watch);
        watch.timer = setTimeout(tick, 300);
    }

    private stopLogs(appUuid: string, notify = true): void {
        const w = this.watches.get(appUuid);
        if (w) clearTimeout(w.timer);
        this.watches.delete(appUuid);
        if (notify) this.post({ type: 'logsStopped', appUuid });
    }

    private stopAllLogs(): void {
        for (const k of [...this.watches.keys()]) this.stopLogs(k, false);
    }

    dispose(): void {
        this.clearTimers();
        this.stopAllLogs();
        this.disposables.forEach((d) => d.dispose());
    }
}
