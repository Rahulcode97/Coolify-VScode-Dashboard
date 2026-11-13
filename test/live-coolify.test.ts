/**
 * Optional, read-only check against a real Coolify:
 *   COOLIFY_URL=https://coolify.example.com COOLIFY_TOKEN=... npm test -- live
 * Add COOLIFY_CF_ID / COOLIFY_CF_SECRET for Cloudflare Access.
 * It never deploys, starts or stops anything.
 */
import { describe, expect, it } from 'vitest';
import { CoolifyClient } from '../src/api/client';
import { DashboardData } from '../src/dashboardData';

const url = process.env.COOLIFY_URL;
const token = process.env.COOLIFY_TOKEN;
const cf = process.env.COOLIFY_CF_ID && process.env.COOLIFY_CF_SECRET;

describe.skipIf(!url || !token)('live Coolify (read-only)', () => {
    const client = () =>
        new CoolifyClient({
            serverUrl: url!,
            authMode: cf ? 'cloudflare' : 'token',
            token: token!,
            cfClientId: process.env.COOLIFY_CF_ID,
            cfClientSecret: process.env.COOLIFY_CF_SECRET,
        });

    it('connects and lists projects with their environments', async () => {
        const c = client();
        expect(await c.version()).toMatch(/\d+\.\d+/);
        const projects = await c.listProjects();
        for (const p of projects) {
            const envs = await c.getProjectEnvironments(p.uuid);
            expect(envs.every((e) => typeof e.id === 'number')).toBe(true);
        }
    });

    it('reports environment_id on every resource (needed for per-project filtering)', async () => {
        const resources = await client().listResources();
        expect(resources.every((r) => r.environment_id != null)).toBe(true);
    });

    it('builds a dashboard for every project without errors', async () => {
        const c = client();
        const data = new DashboardData();
        for (const p of await c.listProjects()) {
            const s = await data.build(c, {
                name: 'live',
                path: '',
                remoteUrl: '',
                branch: '',
                savedProjectUuid: p.uuid,
                settings: { projectUuid: '', environment: '', preDeployCommand: '', preDeployCwd: '', preDeployTimeoutMinutes: 10, mergeEnabled: false, mergeSource: 'development', mergeTarget: 'main', mergeRemote: 'origin', localServices: [] },
            });
            expect(s.phase).toBe('ready');
            expect(s.project?.uuid).toBe(p.uuid);
        }
    });
});
