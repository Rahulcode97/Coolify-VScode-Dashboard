/**
 * Builds the dashboard state for one workspace folder. No VS Code imports:
 * the provider passes in folder facts and gets back plain data for the webview.
 */
import { CoolifyApiError, CoolifyClient } from './api/client';
import { CoolifyDeployment, CoolifyEnvironment, CoolifyResource, ResourceKind, resourceKind } from './api/types';
import { FolderSettings } from './config';
import {
    formatDeploymentLogs,
    isActiveDeployment,
    isFinishedDeployment,
    isRunning,
    parseResourceStatus,
    repoWebUrl,
    scanBuildLogForErrors,
} from './logs';
import { ProjectDirectory, ProjectSource, environmentsForRepo, filterByEnvironments, repoKey, resolveProject, sameRepo } from './projects';

export interface FolderContext {
    name: string;
    path: string;
    remoteUrl: string;
    branch: string;
    settings: FolderSettings;
    savedProjectUuid?: string;
}

export interface DeploymentView {
    uuid: string;
    status: string;
    commit: string;
    commitMessage: string;
    createdAt: string;
    updatedAt: string;
    trigger: 'webhook' | 'api' | 'manual';
    force: boolean;
    /** Build-error marker found in a "finished" deployment's log; null = scanned and clean. */
    buildError?: string | null;
}

export interface ResourceView {
    uuid: string;
    name: string;
    kind: ResourceKind;
    typeLabel: string;
    status: string;
    container: string;
    health: string | null;
    running: boolean;
    urls: string[];
    branch: string;
    repoUrl: string;
    description: string;
    environment: string;
    /** Opens this resource in Coolify. */
    coolifyUrl: string;
    /** This app builds the repo that is open in the editor. */
    isThisRepo: boolean;
    /** Merge & Deploy applies to this app. */
    isMergeTarget: boolean;
    deployments: DeploymentView[];
}

export interface EnvironmentGroup {
    name: string;
    resources: ResourceView[];
}

export interface ProjectOption {
    uuid: string;
    name: string;
    suggested: boolean;
}

export type Phase = 'setup' | 'error' | 'pick' | 'ready';

export interface DashboardState {
    phase: Phase;
    serverUrl: string;
    folder: { name: string; branch: string; repo: string } | null;
    project?: { uuid: string; name: string; source: ProjectSource; coolifyUrl: string };
    projects: ProjectOption[];
    pickReason?: string;
    error?: { message: string; hint: string };
    environments: EnvironmentGroup[];
    counts: { running: number; total: number };
    activeDeployments: boolean;
    merge?: { source: string; target: string; behind: number | null; ahead: number | null };
    warning?: string;
    updatedAt: string;
}

export function emptyState(phase: Phase, serverUrl = ''): DashboardState {
    return { phase, serverUrl, folder: null, projects: [], environments: [], counts: { running: 0, total: 0 }, activeDeployments: false, updatedAt: new Date().toISOString() };
}

const DB_LABELS: Record<string, string> = {
    postgresql: 'PostgreSQL',
    mysql: 'MySQL',
    mariadb: 'MariaDB',
    mongodb: 'MongoDB',
    redis: 'Redis',
    keydb: 'KeyDB',
    dragonfly: 'Dragonfly',
    clickhouse: 'ClickHouse',
    sqlite: 'SQLite',
};

export function typeLabel(r: Pick<CoolifyResource, 'type'>): string {
    const t = String(r.type || '').toLowerCase();
    if (t === 'application') return 'App';
    if (t === 'service') return 'Service';
    const engine = t.replace(/^standalone-/, '');
    return DB_LABELS[engine] || engine || 'Database';
}

function splitUrls(fqdn?: string | null): string[] {
    return String(fqdn || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function toDeploymentView(d: CoolifyDeployment): DeploymentView {
    return {
        uuid: d.deployment_uuid,
        status: String(d.status || 'unknown').toLowerCase(),
        commit: String(d.commit || ''),
        commitMessage: String(d.commit_message || '').split('\n')[0],
        createdAt: d.created_at || '',
        updatedAt: d.updated_at || '',
        trigger: d.is_webhook ? 'webhook' : d.is_api ? 'api' : 'manual',
        force: !!d.force_rebuild,
    };
}

export interface BuildOptions {
    /** Look up commit subjects locally when Coolify does not send them. */
    commitSubjects?: (shas: string[]) => Promise<Record<string, string>>;
    /** Compare branches for Merge & Deploy. */
    aheadBehind?: () => Promise<{ behind: number; ahead: number } | null>;
    deploymentsPerApp?: number;
}

/** Holds caches that survive between refreshes (project environments, build-log scans). */
export class DashboardData {
    readonly directory = new ProjectDirectory();
    private buildErrors = new Map<string, string | null>();

    reset(): void {
        this.directory.invalidate();
        this.buildErrors.clear();
    }

    async build(client: CoolifyClient, folder: FolderContext | null, opts: BuildOptions = {}): Promise<DashboardState> {
        const state = emptyState('ready', client.serverUrl);
        state.folder = folder ? { name: folder.name, branch: folder.branch, repo: repoKey(folder.remoteUrl) } : null;

        // One request for apps, services and databases; projects are cached.
        const [resources, projects] = await Promise.all([client.listResources(), this.directory.listProjects(client)]);
        const folderRepo = folder ? repoKey(folder.remoteUrl) : '';
        const repoEnvIds = environmentsForRepo(resources, folderRepo);
        const repoMatches = await this.directory.projectsOwning(client, repoEnvIds);

        state.projects = projects.map((p) => ({ uuid: p.uuid, name: p.name, suggested: repoMatches.includes(p.uuid) }));
        const resolution = resolveProject({
            projects,
            explicitUuid: folder?.settings.projectUuid,
            savedUuid: folder?.savedProjectUuid,
            repoMatches,
        });

        if (resolution.kind === 'none') {
            state.phase = 'error';
            state.error = { message: 'This Coolify server has no projects yet.', hint: 'Create a project in Coolify, add your app to it, then refresh.' };
            return state;
        }
        if (resolution.kind === 'pick') {
            state.phase = 'pick';
            state.pickReason =
                resolution.reason === 'not-found'
                    ? `The project set in "coolify.projectUuid" (${folder?.settings.projectUuid}) was not found on this server.`
                    : resolution.reason === 'multiple-matches'
                      ? 'This repo is deployed in more than one Coolify project. Which one should this folder show?'
                      : folder
                        ? `No Coolify app builds this folder's repo${folderRepo ? ` (${folderRepo})` : ''}. Which project should "${folder.name}" show?`
                        : 'Which Coolify project should the dashboard show?';
            if (resolution.candidates.length) {
                const set = new Set(resolution.candidates);
                state.projects = state.projects.map((p) => ({ ...p, suggested: set.has(p.uuid) }));
            }
            return state;
        }

        const project = projects.find((p) => p.uuid === resolution.projectUuid)!;
        const envs = await this.directory.environments(client, project.uuid);
        state.project = { uuid: project.uuid, name: project.name, source: resolution.source, coolifyUrl: `${client.serverUrl}/project/${project.uuid}` };

        const envFilter = (folder?.settings.environment || '').toLowerCase();
        const selectedEnvs = envFilter ? envs.filter((e) => e.name.toLowerCase() === envFilter || e.uuid === folder?.settings.environment) : envs;
        if (envFilter && selectedEnvs.length === 0) {
            state.warning = `Environment "${folder?.settings.environment}" was not found in ${project.name}; showing all environments.`;
        }
        const useEnvs = selectedEnvs.length ? selectedEnvs : envs;
        const envById = new Map<number, CoolifyEnvironment>(useEnvs.map((e) => [Number(e.id), e]));

        let inProject: CoolifyResource[];
        if (resources.length && resources.every((r) => r.environment_id == null)) {
            // Very old Coolify builds do not report environments at all.
            inProject = resources;
            state.warning = 'Your Coolify version does not report which project a resource belongs to, so everything is shown. Update Coolify to get per-project filtering.';
        } else {
            inProject = filterByEnvironments(resources, new Set(envById.keys()));
        }

        const settings = folder?.settings;
        const views: ResourceView[] = inProject.map((r) => {
            const parsed = parseResourceStatus(r.status);
            const kind = resourceKind(r);
            const env = envById.get(Number(r.environment_id));
            const branch = String(r.git_branch || '');
            const envUuid = env?.uuid;
            const collection = kind === 'application' ? 'application' : kind === 'service' ? 'service' : 'database';
            return {
                uuid: r.uuid,
                name: r.name,
                kind,
                typeLabel: typeLabel(r),
                status: String(r.status || 'unknown'),
                container: parsed.container,
                health: parsed.health,
                running: isRunning(r.status),
                urls: splitUrls(r.fqdn),
                branch,
                repoUrl: repoWebUrl(r.git_repository),
                description: String(r.description || ''),
                environment: env?.name || 'default',
                coolifyUrl: envUuid ? `${client.serverUrl}/project/${project.uuid}/environment/${envUuid}/${collection}/${r.uuid}` : state.project!.coolifyUrl,
                isThisRepo: kind === 'application' && !!folderRepo && sameRepo(repoKey(r.git_repository), folderRepo),
                isMergeTarget: kind === 'application' && !!settings?.mergeEnabled && branch === settings.mergeTarget,
                deployments: [],
            };
        });

        await this.attachDeployments(client, views, opts);

        // Group by environment, in Coolify's order; apps first, then services, then databases.
        const order: Record<ResourceKind, number> = { application: 0, service: 1, database: 2 };
        const groups = new Map<string, ResourceView[]>();
        for (const e of useEnvs) groups.set(e.name, []);
        for (const v of views) {
            if (!groups.has(v.environment)) groups.set(v.environment, []);
            groups.get(v.environment)!.push(v);
        }
        state.environments = [...groups.entries()]
            .filter(([, list]) => list.length > 0)
            .map(([name, list]) => ({
                name,
                resources: list.sort((a, b) => order[a.kind] - order[b.kind] || Number(b.isThisRepo) - Number(a.isThisRepo) || a.name.localeCompare(b.name)),
            }));
        state.counts = { total: views.length, running: views.filter((v) => v.running).length };
        state.activeDeployments = views.some((v) => v.deployments[0] && isActiveDeployment(v.deployments[0].status));

        if (settings?.mergeEnabled && views.some((v) => v.isMergeTarget) && opts.aheadBehind) {
            const ab = await opts.aheadBehind().catch(() => null);
            state.merge = { source: settings.mergeSource, target: settings.mergeTarget, behind: ab?.behind ?? null, ahead: ab?.ahead ?? null };
        }
        state.updatedAt = new Date().toISOString();
        return state;
    }

    private async attachDeployments(client: CoolifyClient, views: ResourceView[], opts: BuildOptions): Promise<void> {
        const apps = views.filter((v) => v.kind === 'application');
        const take = opts.deploymentsPerApp ?? 5;
        await Promise.all(
            apps.map(async (app) => {
                try {
                    const list = await client.listApplicationDeployments(app.uuid, take);
                    app.deployments = list.map(toDeploymentView);
                    const latest = list[0];
                    if (latest && isFinishedDeployment(latest.status)) {
                        app.deployments[0].buildError = await this.scanLatest(client, latest);
                    }
                } catch (e) {
                    if (e instanceof CoolifyApiError && e.status === 401) throw e;
                    app.deployments = [];
                }
            }),
        );
        if (opts.commitSubjects) {
            const missing = apps.flatMap((a) => a.deployments).filter((d) => d.commit && !d.commitMessage);
            if (missing.length) {
                const subjects = await opts.commitSubjects(missing.map((d) => d.commit)).catch(() => ({}) as Record<string, string>);
                for (const d of missing) d.commitMessage = subjects[d.commit] || '';
            }
        }
    }

    /** Cached per deployment: costs one extra request per new deployment, not per refresh. */
    private async scanLatest(client: CoolifyClient, d: CoolifyDeployment): Promise<string | null | undefined> {
        if (this.buildErrors.has(d.deployment_uuid)) return this.buildErrors.get(d.deployment_uuid);
        try {
            const logs = d.logs != null ? d.logs : (await client.getDeployment(d.deployment_uuid)).logs;
            const marker = scanBuildLogForErrors(formatDeploymentLogs(logs, true));
            this.buildErrors.set(d.deployment_uuid, marker);
            if (this.buildErrors.size > 500) this.buildErrors.delete(this.buildErrors.keys().next().value as string);
            return marker;
        } catch {
            return undefined;
        }
    }
}
