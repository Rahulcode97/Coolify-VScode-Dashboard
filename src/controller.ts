import * as vscode from 'vscode';
import { CoolifyApiError, CoolifyClient } from './api/client';
import { ResourceKind } from './api/types';
import { Settings, activeFolder } from './config';
import { DashboardData, DashboardState, FolderContext, emptyState } from './dashboardData';
import { GitInfo } from './git';
import { LocalServices } from './localServices';
import { DEFAULT_MIGRATION_GLOBS } from './deployRisk';
import { isFinishedDeployment } from './logs';
import { PendingResult, computePending } from './pending';
import { runPreDeployCommand } from './preDeploy';

const SAVED_PROJECT_KEY = 'coolify.projectByFolder';

/** Shared brain for the dashboard, status bar and commands. */
export class Controller implements vscode.Disposable {
    readonly git = new GitInfo();
    readonly data = new DashboardData();
    readonly local = new LocalServices();
    readonly output = vscode.window.createOutputChannel('Coolify', { log: true });

    private state: DashboardState = emptyState('setup');
    private inFlight: Promise<DashboardState> | null = null;
    private readonly stateEmitter = new vscode.EventEmitter<DashboardState>();
    readonly onState = this.stateEmitter.event;
    private clientCache: { key: string; client: CoolifyClient } | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        readonly settings: Settings,
    ) {
        settings.onDidChange(() => {
            this.clientCache = null;
            this.data.reset();
        });
    }

    get lastState(): DashboardState {
        return this.state;
    }

    /** A client for the saved connection, or null when setup is incomplete. */
    async client(): Promise<CoolifyClient | null> {
        const conn = await this.settings.connection();
        if (!conn) return null;
        const key = JSON.stringify(conn);
        if (this.clientCache?.key === key) return this.clientCache.client;
        const client = new CoolifyClient(conn);
        this.clientCache = { key, client };
        return client;
    }

    async requireClient(): Promise<CoolifyClient> {
        const c = await this.client();
        if (!c) {
            const pick = await vscode.window.showWarningMessage('Coolify is not connected yet.', 'Open Settings');
            if (pick) void vscode.commands.executeCommand('coolify.openSettings');
            throw new CoolifyApiError('Coolify is not connected yet.', 'Open Coolify settings.');
        }
        return c;
    }

    savedProject(folder?: vscode.WorkspaceFolder): string | undefined {
        if (!folder) return this.context.workspaceState.get<string>(`${SAVED_PROJECT_KEY}:__none__`);
        const map = this.context.workspaceState.get<Record<string, string>>(SAVED_PROJECT_KEY) || {};
        return map[folder.uri.toString()];
    }

    /** Remember a folder's project. `share` writes it to the folder's .vscode/settings.json instead. */
    async saveProject(folder: vscode.WorkspaceFolder | undefined, uuid: string, share = false): Promise<void> {
        if (share && folder) {
            await vscode.workspace.getConfiguration('coolify', folder.uri).update('projectUuid', uuid, vscode.ConfigurationTarget.WorkspaceFolder);
        } else if (folder) {
            const map = { ...(this.context.workspaceState.get<Record<string, string>>(SAVED_PROJECT_KEY) || {}) };
            map[folder.uri.toString()] = uuid;
            await this.context.workspaceState.update(SAVED_PROJECT_KEY, map);
            // An explicit folder setting would win over the saved choice; clear a stale one.
            const inspect = vscode.workspace.getConfiguration('coolify', folder.uri).inspect<string>('projectUuid');
            const folderValue = inspect?.workspaceFolderValue ?? inspect?.workspaceValue;
            if (folderValue && folderValue !== uuid) {
                await vscode.workspace.getConfiguration('coolify', folder.uri).update('projectUuid', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
            }
        } else {
            await this.context.workspaceState.update(`${SAVED_PROJECT_KEY}:__none__`, uuid);
        }
    }

    async folderContext(folder = activeFolder()): Promise<FolderContext | null> {
        if (!folder) {
            const saved = this.savedProject(undefined);
            return { name: '', path: '', remoteUrl: '', branch: '', settings: this.settings.folder(undefined), savedProjectUuid: saved };
        }
        const dir = folder.uri.fsPath;
        const settings = this.settings.folder(folder);
        const [remoteUrl, branch] = folder.uri.scheme === 'file' ? await Promise.all([this.git.remoteUrl(dir, settings.mergeRemote || 'origin'), this.git.currentBranch(dir)]) : ['', ''];
        return { name: folder.name, path: dir, remoteUrl, branch, settings, savedProjectUuid: this.savedProject(folder) };
    }

    /** Rebuild the dashboard state. Concurrent calls share one request. */
    refresh(opts: { forceGitFetch?: boolean; resetCaches?: boolean } = {}): Promise<DashboardState> {
        if (this.inFlight) return this.inFlight;
        this.inFlight = this.doRefresh(opts).finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private async doRefresh(opts: { forceGitFetch?: boolean; resetCaches?: boolean }): Promise<DashboardState> {
        let next: DashboardState;
        const client = await this.client().catch(() => null);
        if (!client) {
            next = emptyState('setup', (await this.settings.summary()).serverUrl);
        } else {
            if (opts.resetCaches) this.data.reset();
            const folder = await this.folderContext();
            try {
                next = await this.data.build(client, folder, {
                    commitSubjects: folder?.path ? (shas) => this.git.commitSubjects(folder.path, shas) : undefined,
                    pending:
                        folder?.path && folder.settings.pendingBar
                            ? async (apps) => {
                                  const s = folder.settings;
                                  await this.git.maybeFetch(folder.path, s.mergeRemote, !!opts.forceGitFetch);
                                  const git = this.git.pendingGit(folder.path);
                                  const out: Record<string, PendingResult | null> = {};
                                  for (const app of apps) {
                                      // The running container comes from the last deployment that finished.
                                      const deployed = app.deployments.find((d) => isFinishedDeployment(d.status) && !d.buildError);
                                      out[app.uuid] = deployed?.commit
                                          ? await computePending(
                                                git,
                                                { branch: app.branch, deployedCommit: deployed.commit, baseDirectory: app.baseDirectory, watchPaths: app.watchPaths },
                                                { remote: s.mergeRemote, stopUsers: s.stopUsersCheck, migrationGlobs: s.migrationGlobs.length ? s.migrationGlobs : DEFAULT_MIGRATION_GLOBS, rules: s.downtimeRules },
                                            ).catch(() => null)
                                          : null;
                                  }
                                  return out;
                              }
                            : undefined,
                    aheadBehind: folder?.path
                        ? () => this.git.aheadBehind(folder.path, folder.settings.mergeSource, folder.settings.mergeTarget, folder.settings.mergeRemote, !!opts.forceGitFetch)
                        : undefined,
                });
            } catch (e: any) {
                next = emptyState('error', client.serverUrl);
                next.folder = folder ? { name: folder.name, branch: folder.branch, repo: '' } : null;
                next.error = e instanceof CoolifyApiError ? { message: e.message, hint: e.hint } : { message: String(e?.message || e), hint: 'Check the Server URL and token in Coolify settings.' };
                this.output.warn(`Refresh failed: ${next.error.message}`);
            }
        }
        this.state = next;
        this.stateEmitter.fire(next);
        return next;
    }

    private findResource(uuid: string) {
        for (const g of this.state.environments) for (const r of g.resources) if (r.uuid === uuid) return r;
        return undefined;
    }

    /** Ask before a destructive or deploying action (can be turned off in settings). */
    private async confirm(message: string, detail: string, action: string): Promise<boolean> {
        if (!this.settings.confirmDeploy()) return true;
        const pick = await vscode.window.showWarningMessage(message, { modal: true, detail }, action);
        return pick === action;
    }

    /** Run the pre-deploy command, if one is set. Returns false when the deploy should stop. */
    async passesPreDeploy(label: string): Promise<boolean> {
        const folder = activeFolder();
        const s = this.settings.folder(folder);
        if (!s.preDeployCommand || !folder) return true;
        this.output.info(`Pre-deploy for ${label}: ${s.preDeployCommand}`);
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Running "${s.preDeployCommand}" before deploying ${label}…`, cancellable: true },
            (_p, token) => {
                const ac = new AbortController();
                token.onCancellationRequested(() => ac.abort());
                return runPreDeployCommand({
                    command: s.preDeployCommand,
                    folder: folder.uri.fsPath,
                    cwd: s.preDeployCwd,
                    timeoutMs: s.preDeployTimeoutMinutes * 60_000,
                    signal: ac.signal,
                    onOutput: (chunk) => this.output.append(chunk),
                });
            },
        );
        if (result.ok) return true;
        if (result.summary === 'Cancelled') return false;
        const pick = await vscode.window.showErrorMessage(`Pre-deploy command failed. ${label} was not deployed.`, { modal: true, detail: `${result.summary}\n\nFull output is in the "Coolify" output panel.` }, 'Deploy anyway', 'Show output');
        if (pick === 'Show output') this.output.show(true);
        return pick === 'Deploy anyway';
    }

    /** Returns the new deployment UUID, if Coolify reported one. */
    async deploy(uuid: string, name: string, force = false): Promise<string | undefined> {
        const client = await this.requireClient();
        const r = this.findResource(uuid);
        const target = r ? `${r.branch ? `Branch: ${r.branch}\n` : ''}${r.urls[0] ? `URL: ${r.urls[0]}\n` : ''}Environment: ${r.environment}` : '';
        const ok = await this.confirm(`${force ? 'Force rebuild' : 'Deploy'} "${name}"?`, `${target}${force ? '\n\nForce rebuild ignores the Docker build cache.' : ''}`, force ? 'Rebuild' : 'Deploy');
        if (!ok) return undefined;
        if (!(await this.passesPreDeploy(name))) return undefined;
        const res = await client.deploy(uuid, force);
        const depUuid = res.find((d) => d.resource_uuid === uuid)?.deployment_uuid || res[0]?.deployment_uuid;
        this.output.info(`Deploy queued for ${name}${depUuid ? ` (${depUuid})` : ''}`);
        vscode.window.setStatusBarMessage(`$(rocket) Deploy queued: ${name}`, 5000);
        void this.refresh();
        return depUuid;
    }

    async mergeAndDeploy(uuid: string, name: string): Promise<string | undefined> {
        const folder = activeFolder();
        if (!folder) throw new Error('Open the repository folder first.');
        const s = this.settings.folder(folder);
        const ok = await this.confirm(
            `Merge "${s.mergeSource}" into "${s.mergeTarget}" and deploy "${name}"?`,
            `This fetches ${s.mergeRemote}, fast-forwards ${s.mergeTarget}, merges ${s.mergeRemote}/${s.mergeSource} into it, pushes to ${s.mergeRemote}/${s.mergeTarget}, then starts a Coolify deploy. You are switched back to your current branch afterwards.`,
            'Merge and Deploy',
        );
        if (!ok) return undefined;
        // Check before merging so a failing build never lands on the target branch.
        if (!(await this.passesPreDeploy(name))) return undefined;
        const merged = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Merging ${s.mergeSource} → ${s.mergeTarget}…` }, () =>
            this.git.mergeAndPush(folder.uri.fsPath, s.mergeSource, s.mergeTarget, s.mergeRemote),
        );
        if (!merged.ok) {
            void vscode.window.showErrorMessage(`Merge failed: ${merged.error}`);
            return undefined;
        }
        const client = await this.requireClient();
        const res = await client.deploy(uuid, false);
        vscode.window.setStatusBarMessage(`$(git-merge) Merged and deploying ${name}`, 5000);
        void this.refresh({ forceGitFetch: true });
        return res.find((d) => d.resource_uuid === uuid)?.deployment_uuid || res[0]?.deployment_uuid;
    }

    async lifecycle(kind: ResourceKind, uuid: string, name: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
        const client = await this.requireClient();
        if (action !== 'start') {
            const verb = action === 'stop' ? 'Stop' : 'Restart';
            const ok = await this.confirm(`${verb} "${name}"?`, action === 'stop' ? 'It will be offline until you start it again.' : 'It may be briefly unavailable.', verb);
            if (!ok) return;
        }
        await client.lifecycle(kind, uuid, action);
        vscode.window.setStatusBarMessage(`$(sync) ${action === 'start' ? 'Starting' : action === 'stop' ? 'Stopping' : 'Restarting'} ${name}…`, 5000);
        setTimeout(() => void this.refresh(), 1500);
    }

    dispose(): void {
        this.local.dispose();
        this.output.dispose();
        this.stateEmitter.dispose();
    }
}
