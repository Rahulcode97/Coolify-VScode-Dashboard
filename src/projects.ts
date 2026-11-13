/**
 * Which Coolify project belongs to which workspace folder.
 *
 * Coolify's list endpoints (`/resources`, `/applications`, `/databases`) do not
 * return a project UUID, only `environment_id`. So the only reliable way to
 * filter by project is: project → its environments → their ids → resources
 * whose `environment_id` is one of them. This module does exactly that and
 * contains no VS Code code, so it is unit-tested.
 */
import { CoolifyClient } from './api/client';
import { CoolifyEnvironment, CoolifyProject, CoolifyResource } from './api/types';

/**
 * Reduce a git URL to a comparable key: `host/owner/repo` when the host is known,
 * otherwise `owner/repo`. Handles https, ssh, `owner/repo` and trailing `.git`.
 */
export function repoKey(url?: string | null): string {
    if (!url) return '';
    let v = url.trim().toLowerCase();
    v = v.replace(/\.git$/, '').replace(/\/+$/, '');
    let host = '';
    let path = v;
    const scp = v.match(/^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/); // git@github.com:owner/repo
    const uri = v.match(/^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/); // https://… or ssh://…
    if (uri) {
        host = uri[1];
        path = uri[2];
    } else if (scp && !/^[\w.-]+\/[\w.-]+$/.test(v)) {
        host = scp[1];
        path = scp[2];
    }
    path = path.replace(/^\/+/, '');
    return host ? `${host}/${path}` : path;
}

/** True when two repo keys point at the same repository (host is ignored if either side lacks one). */
export function sameRepo(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    const pathOf = (k: string) => (k.split('/').length > 2 ? k.split('/').slice(1).join('/') : k);
    return pathOf(a) === pathOf(b);
}

export type ProjectSource = 'setting' | 'saved' | 'repo' | 'only';

export type Resolution =
    | { kind: 'bound'; projectUuid: string; source: ProjectSource }
    | { kind: 'pick'; candidates: string[]; reason: 'multiple-matches' | 'no-match' | 'not-found' }
    | { kind: 'none' };

/**
 * Decide the project for a folder.
 * Order: explicit setting → saved choice → git remote match → only project → ask.
 */
export function resolveProject(input: {
    projects: Pick<CoolifyProject, 'uuid'>[];
    explicitUuid?: string;
    savedUuid?: string;
    repoMatches: string[];
}): Resolution {
    const known = new Set(input.projects.map((p) => p.uuid));
    if (input.projects.length === 0) return { kind: 'none' };
    const explicit = (input.explicitUuid || '').trim();
    if (explicit) {
        if (known.has(explicit)) return { kind: 'bound', projectUuid: explicit, source: 'setting' };
        return { kind: 'pick', candidates: [], reason: 'not-found' };
    }
    const saved = (input.savedUuid || '').trim();
    if (saved && known.has(saved)) return { kind: 'bound', projectUuid: saved, source: 'saved' };
    const matches = [...new Set(input.repoMatches)].filter((u) => known.has(u));
    if (matches.length === 1) return { kind: 'bound', projectUuid: matches[0], source: 'repo' };
    if (matches.length > 1) return { kind: 'pick', candidates: matches, reason: 'multiple-matches' };
    if (input.projects.length === 1) return { kind: 'bound', projectUuid: input.projects[0].uuid, source: 'only' };
    return { kind: 'pick', candidates: [], reason: 'no-match' };
}

/** Keep only resources that live in one of the given environments. */
export function filterByEnvironments<T extends Pick<CoolifyResource, 'environment_id'>>(resources: T[], envIds: Set<number>): T[] {
    return resources.filter((r) => r.environment_id != null && envIds.has(Number(r.environment_id)));
}

/** Environment ids of applications whose git repository matches the folder's remote. */
export function environmentsForRepo(resources: CoolifyResource[], folderRepoKey: string): Set<number> {
    const ids = new Set<number>();
    if (!folderRepoKey) return ids;
    for (const r of resources) {
        if (String(r.type).toLowerCase() !== 'application' || r.environment_id == null) continue;
        if (sameRepo(repoKey(r.git_repository), folderRepoKey)) ids.add(Number(r.environment_id));
    }
    return ids;
}

/** Caches project environments (they rarely change) so a refresh costs one `/resources` call. */
export class ProjectDirectory {
    private projects: CoolifyProject[] | null = null;
    private projectsAt = 0;
    private envs = new Map<string, { at: number; list: CoolifyEnvironment[] }>();

    constructor(private readonly ttlMs = 5 * 60_000) {}

    invalidate(): void {
        this.projects = null;
        this.envs.clear();
    }

    async listProjects(client: CoolifyClient, force = false): Promise<CoolifyProject[]> {
        if (!force && this.projects && Date.now() - this.projectsAt < this.ttlMs) return this.projects;
        const list = await client.listProjects();
        this.projects = [...list].sort((a, b) => a.name.localeCompare(b.name));
        this.projectsAt = Date.now();
        return this.projects;
    }

    async environments(client: CoolifyClient, projectUuid: string, force = false): Promise<CoolifyEnvironment[]> {
        const hit = this.envs.get(projectUuid);
        if (!force && hit && Date.now() - hit.at < this.ttlMs) return hit.list;
        const list = await client.getProjectEnvironments(projectUuid);
        this.envs.set(projectUuid, { at: Date.now(), list });
        return list;
    }

    /**
     * Projects that own any of the given environment ids. Stops fetching as soon
     * as every id is accounted for, so it is cheap when the match is early.
     */
    async projectsOwning(client: CoolifyClient, envIds: Set<number>): Promise<string[]> {
        if (envIds.size === 0) return [];
        const remaining = new Set(envIds);
        const owners: string[] = [];
        for (const p of await this.listProjects(client)) {
            const envs = await this.environments(client, p.uuid);
            let owns = false;
            for (const e of envs) {
                if (remaining.delete(Number(e.id))) owns = true;
            }
            if (owns) owners.push(p.uuid);
            if (remaining.size === 0) break;
        }
        return owners;
    }
}
