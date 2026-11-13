import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoolifyClient } from '../src/api/client';
import { FolderSettings } from '../src/config';
import { DashboardData, FolderContext } from '../src/dashboardData';
import { TOKEN, createMockCoolify } from './mock-coolify.mjs';

const defaults: FolderSettings = {
    projectUuid: '',
    environment: '',
    preDeployCommand: '',
    preDeployCwd: '',
    preDeployTimeoutMinutes: 10,
    mergeEnabled: false,
    mergeSource: 'development',
    mergeTarget: 'main',
    mergeRemote: 'origin',
    localServices: [],
    pendingBar: true,
    stopUsersCheck: true,
    migrationGlobs: [],
    downtimeRules: [],
};
const folder = (remoteUrl: string, over: Partial<FolderSettings> = {}, saved?: string): FolderContext => ({
    name: remoteUrl.split('/').pop()?.replace('.git', '') || 'folder',
    path: '/tmp/x',
    remoteUrl,
    branch: 'main',
    settings: { ...defaults, ...over },
    savedProjectUuid: saved,
});
const names = (s: any) => s.environments.flatMap((g: any) => g.resources.map((r: any) => r.name)).sort();

describe('DashboardData: one Coolify server, several projects', () => {
    const mock = createMockCoolify();
    let client: CoolifyClient;
    beforeAll(async () => {
        client = new CoolifyClient({ serverUrl: await mock.listen(), authMode: 'token', token: TOKEN });
    });
    afterAll(() => mock.close());

    it('shows only the project whose app builds the open repo', async () => {
        const s = await new DashboardData().build(client, folder('git@github.com:acme/acme-web.git'));
        expect(s.phase).toBe('ready');
        expect(s.project).toMatchObject({ name: 'Acme Web', source: 'repo' });
        expect(names(s)).toEqual(['acme-api', 'acme-postgres', 'acme-web', 'acme-web-staging', 'acme-worker', 'umami-analytics']);
        expect(s.environments.map((g) => g.name)).toEqual(['production', 'staging']);
    });

    it('shows a different project for a different repo folder on the same server', async () => {
        const s = await new DashboardData().build(client, folder('https://github.com/acme/blog.git'));
        expect(s.project?.name).toBe('Blog');
        expect(names(s)).toEqual(['blog', 'blog-cache']);
    });

    it('asks which project when the repo is unknown', async () => {
        const s = await new DashboardData().build(client, folder('https://github.com/someone/else.git'));
        expect(s.phase).toBe('pick');
        expect(s.projects.map((p) => p.name)).toEqual(['Acme Web', 'Blog', 'Shop']);
        expect(s.environments).toEqual([]);
    });

    it('honours an explicit project setting over the git remote', async () => {
        const s = await new DashboardData().build(client, folder('git@github.com:acme/acme-web.git', { projectUuid: 'proj-shop-00000000000003' }));
        expect(s.project).toMatchObject({ name: 'Shop', source: 'setting' });
        expect(names(s)).toEqual(['shop-frontend']);
    });

    it('uses a saved choice for a folder without a matching repo', async () => {
        const s = await new DashboardData().build(client, folder('', {}, 'proj-blog-00000000000002'));
        expect(s.project).toMatchObject({ name: 'Blog', source: 'saved' });
    });

    it('can limit to one environment', async () => {
        const s = await new DashboardData().build(client, folder('acme/acme-web', { environment: 'staging' }));
        expect(names(s)).toEqual(['acme-web-staging', 'acme-worker']);
    });

    it('marks this repo, running counts, active deploys and hidden build failures', async () => {
        const s = await new DashboardData().build(client, folder('acme/acme-web'));
        const all = s.environments.flatMap((g) => g.resources);
        expect(all.find((r) => r.name === 'acme-web')?.isThisRepo).toBe(true);
        expect(all.find((r) => r.name === 'acme-postgres')?.typeLabel).toBe('PostgreSQL');
        expect(s.counts).toEqual({ running: 5, total: 6 });
        expect(s.activeDeployments).toBe(true);
        const api = all.find((r) => r.name === 'acme-api')!;
        expect(api.deployments[0].buildError).toBe('npm error');
        const web = all.find((r) => r.name === 'acme-web')!;
        expect(web.deployments[0].buildError).toBeNull();
        expect(web.coolifyUrl).toContain('/project/proj-acme-web-0000000001/environment/env-acme-prod-000000011/application/app-acme-web-prod-0001');
    });

    it('offers Merge & Deploy only on apps that build the target branch', async () => {
        const s = await new DashboardData().build(client, folder('acme/acme-web', { mergeEnabled: true }), { aheadBehind: async () => ({ behind: 3, ahead: 0 }) });
        const all = s.environments.flatMap((g) => g.resources);
        expect(all.filter((r) => r.isMergeTarget).map((r) => r.name).sort()).toEqual(['acme-api', 'acme-web']);
        expect(s.merge).toEqual({ source: 'development', target: 'main', behind: 3, ahead: 0 });
    });

    it('asks for pink/red bars only for apps of this repo that are not deploying', async () => {
        let asked: string[] = [];
        const s = await new DashboardData().build(client, folder('acme/acme-web'), {
            pending: async (apps) => {
                asked = apps.map((a) => a.name).sort();
                return Object.fromEntries(apps.map((a) => [a.uuid, { reasons: ['1 commit on main not deployed'], findings: [] }]));
            },
        });
        // acme-web-staging is mid-deploy; databases/services and other repos are skipped.
        expect(asked).toEqual(['acme-api', 'acme-web', 'acme-worker']);
        const web = s.environments.flatMap((g) => g.resources).find((r) => r.name === 'acme-web');
        expect(web?.pending?.reasons).toEqual(['1 commit on main not deployed']);
        expect(web?.baseDirectory).toBe('/web');
    });

    it('costs one /resources call per refresh once caches are warm', async () => {
        const data = new DashboardData();
        await data.build(client, folder('acme/blog'));
        const before = mock.data.calls.length;
        await data.build(client, folder('acme/blog'));
        const paths = mock.data.calls.slice(before).map((c: any) => c.path.split('?')[0]);
        expect(paths.filter((p: string) => p === '/api/v1/resources')).toHaveLength(1);
        expect(paths.filter((p: string) => p.startsWith('/api/v1/projects'))).toHaveLength(0);
    });
});
