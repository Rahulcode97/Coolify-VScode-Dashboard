import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoolifyApiError, CoolifyClient, buildHeaders, explainHttpError, normalizeServerUrl } from '../src/api/client';
import { CF_ID, CF_SECRET, TOKEN, createMockCoolify } from './mock-coolify.mjs';

describe('normalizeServerUrl', () => {
    it.each([
        ['coolify.example.com', 'https://coolify.example.com'],
        ['https://coolify.example.com/', 'https://coolify.example.com'],
        ['https://coolify.example.com/api/v1', 'https://coolify.example.com'],
        ['https://coolify.example.com/api/v1/', 'https://coolify.example.com'],
        ['localhost:8000', 'http://localhost:8000'],
        ['192.168.1.20:8000', 'http://192.168.1.20:8000'],
        ['203.0.113.10:8000', 'https://203.0.113.10:8000'],
        ['http://203.0.113.10:8000/project/abc/environment/def', 'http://203.0.113.10:8000'],
        ['https://example.com/coolify/', 'https://example.com/coolify'],
        ['  https://coolify.example.com  ', 'https://coolify.example.com'],
        ['', ''],
    ])('%s → %s', (input, out) => expect(normalizeServerUrl(input)).toBe(out));
});

describe('buildHeaders', () => {
    it('sends only the bearer token in token mode, even if CF values exist', () => {
        const h = buildHeaders({ authMode: 'token', token: 'abc', cfClientId: 'id', cfClientSecret: 'sec' });
        expect(h.Authorization).toBe('Bearer abc');
        expect(h['CF-Access-Client-Id']).toBeUndefined();
    });
    it('adds Cloudflare Access headers in cloudflare mode', () => {
        const h = buildHeaders({ authMode: 'cloudflare', token: 'abc', cfClientId: ' id ', cfClientSecret: 'sec' });
        expect(h['CF-Access-Client-Id']).toBe('id');
        expect(h['CF-Access-Client-Secret']).toBe('sec');
    });
    it('adds valid custom headers and drops unsafe ones', () => {
        const h = buildHeaders({ authMode: 'headers', token: 'abc', customHeaders: { 'X-Api-Key': 'k', Host: 'evil', 'bad header': 'x', Authorization: 'Basic Zm9vOmJhcg==' } });
        expect(h['X-Api-Key']).toBe('k');
        expect(h.Host).toBeUndefined();
        expect(h['bad header']).toBeUndefined();
        expect(h.Authorization).toBe('Basic Zm9vOmJhcg==');
    });
});

describe('explainHttpError', () => {
    it('recognises a Cloudflare Access login redirect', () => {
        const e = explainHttpError({ status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/x' }, body: '' }, 'token');
        expect(e.message).toMatch(/Cloudflare Access/);
        expect(e.hint).toMatch(/Cloudflare Access/);
    });
    it('explains a disabled API', () => {
        const e = explainHttpError({ status: 403, headers: { 'content-type': 'application/json' }, body: '{"success":false,"message":"API is disabled."}' }, 'token');
        expect(e.hint).toMatch(/API access/);
    });
    it('explains 401', () => {
        expect(explainHttpError({ status: 401, headers: {}, body: '' }, 'token').hint).toMatch(/Keys & Tokens/);
    });
});

describe('CoolifyClient against the mock server', () => {
    const mock = createMockCoolify();
    const cfMock = createMockCoolify({ requireCf: true });
    let url = '';
    let cfUrl = '';
    beforeAll(async () => {
        url = await mock.listen();
        cfUrl = await cfMock.listen();
    });
    afterAll(async () => {
        await mock.close();
        await cfMock.close();
    });

    const client = (over: Partial<ConstructorParameters<typeof CoolifyClient>[0]> = {}) => new CoolifyClient({ serverUrl: url, authMode: 'token', token: TOKEN, ...over });

    it('reads version, projects, environments and resources', async () => {
        const c = client();
        expect(await c.version()).toMatch(/^4\./);
        expect((await c.listProjects()).map((p) => p.name)).toEqual(['Acme Web', 'Blog', 'Shop']);
        const envs = await c.getProjectEnvironments('proj-acme-web-0000000001');
        expect(envs.map((e) => e.id)).toEqual([11, 12]);
        expect((await c.listResources()).length).toBeGreaterThan(5);
    });

    it('accepts a pasted /api/v1 URL', async () => {
        expect(await client({ serverUrl: url + '/api/v1/' }).version()).toMatch(/^4\./);
    });

    it('deploys with POST, never GET /deploy', async () => {
        const res = await client().deploy('app-blog-0000000000007', true);
        expect(res[0].deployment_uuid).toMatch(/^dep-new-/);
        const deployCalls = mock.data.calls.filter((c: any) => c.path.startsWith('/api/v1/deploy'));
        expect(deployCalls.every((c: any) => c.method === 'POST')).toBe(true);
        expect(deployCalls.at(-1).path).toContain('force=true');
    });

    it('lists deployments in both response shapes and normalises them', async () => {
        const list = await client().listApplicationDeployments('app-acme-web-prod-0001', 2);
        expect(list).toHaveLength(2);
        expect(list[0].deployment_uuid).toBe('dep-web-03');
    });

    it('starts/stops/restarts with POST', async () => {
        await client().lifecycle('database', 'db-blog-redis-0000008', 'stop');
        expect(mock.data.resources.find((r: any) => r.uuid === 'db-blog-redis-0000008').status).toMatch(/^exited/);
        await client().lifecycle('database', 'db-blog-redis-0000008', 'start');
        expect(mock.data.resources.find((r: any) => r.uuid === 'db-blog-redis-0000008').status).toMatch(/^running/);
    });

    it('gives a clear error for a bad token', async () => {
        await expect(client({ token: 'nope' }).listProjects()).rejects.toMatchObject({ status: 401 });
    });

    it('detects Cloudflare Access and works with a service token', async () => {
        const plain = new CoolifyClient({ serverUrl: cfUrl, authMode: 'token', token: TOKEN });
        await expect(plain.listProjects()).rejects.toThrow(/Cloudflare Access/);
        const cf = new CoolifyClient({ serverUrl: cfUrl, authMode: 'cloudflare', token: TOKEN, cfClientId: CF_ID, cfClientSecret: CF_SECRET });
        expect((await cf.listProjects()).length).toBe(3);
    });

    it('explains a refused connection', async () => {
        const dead = new CoolifyClient({ serverUrl: 'http://127.0.0.1:1', authMode: 'token', token: 'x', timeoutMs: 2000 });
        const err = await dead.version().catch((e) => e);
        expect(err).toBeInstanceOf(CoolifyApiError);
        expect(err.hint).toMatch(/port/);
    });

    it('refuses to start without URL or token', () => {
        expect(() => new CoolifyClient({ serverUrl: '', authMode: 'token', token: 'x' })).toThrow(/URL/);
        expect(() => new CoolifyClient({ serverUrl: url, authMode: 'token', token: '' })).toThrow(/token/);
    });
});
