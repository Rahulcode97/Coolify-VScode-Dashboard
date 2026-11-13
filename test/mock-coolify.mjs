// A small fake Coolify v4 API for tests, screenshots and trying the extension
// without a real server. All names, hosts and ids are made up.
//
//   node test/mock-coolify.mjs            # http://127.0.0.1:8765, token "test-token"
//   node test/mock-coolify.mjs --cf       # also require Cloudflare Access headers
//
import { execFileSync } from 'node:child_process';
import http from 'node:http';

export const TOKEN = 'test-token';
export const CF_ID = 'test-client.access';
export const CF_SECRET = 'test-client-secret';

const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60_000).toISOString();

function logJson(lines) {
    return JSON.stringify(lines.map((output, i) => ({ command: null, output, type: 'stdout', timestamp: iso(1), hidden: false, batch: 1, order: i + 1 })));
}

export function seed() {
    const projects = [
        { id: 1, uuid: 'proj-acme-web-0000000001', name: 'Acme Web', description: 'Marketing site and API' },
        { id: 2, uuid: 'proj-blog-00000000000002', name: 'Blog', description: 'Static blog' },
        { id: 3, uuid: 'proj-shop-00000000000003', name: 'Shop', description: 'Storefront' },
    ];
    const environments = {
        'proj-acme-web-0000000001': [
            { id: 11, uuid: 'env-acme-prod-000000011', name: 'production', project_id: 1 },
            { id: 12, uuid: 'env-acme-stag-000000012', name: 'staging', project_id: 1 },
        ],
        'proj-blog-00000000000002': [{ id: 21, uuid: 'env-blog-prod-000000021', name: 'production', project_id: 2 }],
        'proj-shop-00000000000003': [{ id: 31, uuid: 'env-shop-prod-000000031', name: 'production', project_id: 3 }],
    };
    const resources = [
        { uuid: 'app-acme-web-prod-0001', name: 'acme-web', type: 'application', status: 'running:healthy', environment_id: 11, fqdn: 'https://www.example.com', git_repository: 'acme/acme-web', git_branch: 'main', base_directory: '/web' },
        { uuid: 'app-acme-api-prod-0002', name: 'acme-api', type: 'application', status: 'running:healthy', environment_id: 11, fqdn: 'https://api.example.com', git_repository: 'https://github.com/acme/acme-web.git', git_branch: 'main', base_directory: '/api' },
        { uuid: 'db-acme-postgres-0003', name: 'acme-postgres', type: 'standalone-postgresql', status: 'running:healthy', environment_id: 11 },
        { uuid: 'svc-acme-umami-00004', name: 'umami-analytics', type: 'service', status: 'running:healthy', environment_id: 11 },
        { uuid: 'app-acme-web-stag-0005', name: 'acme-web-staging', type: 'application', status: 'running:healthy', environment_id: 12, fqdn: 'https://staging.example.com', git_repository: 'git@github.com:acme/acme-web.git', git_branch: 'development' },
        { uuid: 'app-acme-worker-00006', name: 'acme-worker', type: 'application', status: 'exited:unhealthy', environment_id: 12, fqdn: '', git_repository: 'acme/acme-web', git_branch: 'development' },
        { uuid: 'app-blog-0000000000007', name: 'blog', type: 'application', status: 'running:healthy', environment_id: 21, fqdn: 'https://blog.example.com', git_repository: 'acme/blog', git_branch: 'main' },
        { uuid: 'db-blog-redis-0000008', name: 'blog-cache', type: 'standalone-redis', status: 'running:healthy', environment_id: 21 },
        { uuid: 'app-shop-front-000009', name: 'shop-frontend', type: 'application', status: 'running:healthy', environment_id: 31, fqdn: 'https://shop.example.com', git_repository: 'acme/shop', git_branch: 'main' },
    ];
    const deployments = {
        'app-acme-web-prod-0001': [
            { deployment_uuid: 'dep-web-03', status: 'finished', commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', commit_message: 'Add pricing page', is_webhook: true, created_at: iso(14), updated_at: iso(12), logs: logJson(['Cloning repository', 'npm ci', 'npm run build', '✓ built in 21.4s', 'Rolling update completed.']) },
            { deployment_uuid: 'dep-web-02', status: 'finished', commit: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890', commit_message: 'Fix footer links', is_api: true, created_at: iso(60 * 26), updated_at: iso(60 * 26 - 2) },
            { deployment_uuid: 'dep-web-01', status: 'failed', commit: 'c3d4e5f60718293a4b5c6d7e8f90123456789012', commit_message: 'Upgrade framework', is_webhook: true, created_at: iso(60 * 50), updated_at: iso(60 * 50 - 3) },
        ],
        'app-acme-api-prod-0002': [
            { deployment_uuid: 'dep-api-02', status: 'finished', commit: 'd4e5f60718293a4b5c6d7e8f9012345678901234', commit_message: 'Rate-limit login endpoint', is_webhook: true, created_at: iso(42), updated_at: iso(40), logs: logJson(['Building image', 'npm ERR! code ELIFECYCLE', 'npm ERR! build failed', 'Deployment finished.']) },
            { deployment_uuid: 'dep-api-01', status: 'finished', commit: 'e5f60718293a4b5c6d7e8f901234567890123456', commit_message: 'Add health endpoint', is_webhook: true, created_at: iso(60 * 30), updated_at: iso(60 * 30 - 2) },
        ],
        'app-acme-web-stag-0005': [
            { deployment_uuid: 'dep-stag-02', status: 'in_progress', commit: 'f60718293a4b5c6d7e8f90123456789012345678', commit_message: 'New onboarding flow', is_webhook: true, created_at: iso(1), updated_at: iso(0) },
            { deployment_uuid: 'dep-stag-01', status: 'finished', commit: '0718293a4b5c6d7e8f9012345678901234567890', commit_message: 'Copy tweaks', is_webhook: true, created_at: iso(60 * 3), updated_at: iso(60 * 3 - 2) },
        ],
        'app-acme-worker-00006': [{ deployment_uuid: 'dep-worker-01', status: 'failed', commit: '18293a4b5c6d7e8f901234567890123456789012', commit_message: 'Queue retries', is_webhook: true, created_at: iso(90), updated_at: iso(88) }],
        'app-blog-0000000000007': [{ deployment_uuid: 'dep-blog-01', status: 'finished', commit: '293a4b5c6d7e8f9012345678901234567890abcd', commit_message: 'New post', is_webhook: true, created_at: iso(60 * 5), updated_at: iso(60 * 5 - 1) }],
        'app-shop-front-000009': [{ deployment_uuid: 'dep-shop-01', status: 'finished', commit: '3a4b5c6d7e8f9012345678901234567890abcdef', commit_message: 'Holiday banner', is_webhook: true, created_at: iso(60 * 8), updated_at: iso(60 * 8 - 1) }],
    };
    return { projects, environments, resources, deployments, calls: [] };
}

/**
 * Demo mode: point `repo` at a real git checkout. The latest finished deployments
 * then report `deployedCommit` (default: the repo's first commit), new deploys
 * record the branch tip, and apps listed in `failUuids` fail their next deploy.
 */
function applyRepo(data, repo, deployedCommit) {
    const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
    const sha = deployedCommit || g('rev-list', '--max-parents=0', 'HEAD').split('\n')[0];
    const subject = g('show', '-s', '--format=%s', sha);
    for (const uuid of ['app-acme-web-prod-0001', 'app-acme-api-prod-0002', 'app-acme-web-stag-0005']) {
        const latest = data.deployments[uuid][0];
        Object.assign(latest, { commit: sha, commit_message: subject, status: 'finished' });
        delete latest.logs;
    }
    data.gitTip = (branch) => {
        try {
            return { commit: g('rev-parse', branch), message: g('show', '-s', '--format=%s', branch) };
        } catch {
            return null;
        }
    };
}

export function createMockCoolify({ requireCf = false, version = '4.7.5', data = seed(), liveDeployTicks = 3, repo = '', deployedCommit = '', failUuids = [] } = {}) {
    if (repo) applyRepo(data, repo, deployedCommit);
    const failing = new Set(failUuids);
    const json = (res, status, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
    };
    let counter = 100;
    const live = new Map(); // deployment uuid -> ticks left

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        const p = url.pathname;
        data.calls.push({ method: req.method, path: p + url.search, headers: req.headers });

        if (requireCf && (req.headers['cf-access-client-id'] !== CF_ID || req.headers['cf-access-client-secret'] !== CF_SECRET)) {
            res.writeHead(302, { Location: 'https://example.cloudflareaccess.com/cdn-cgi/access/login/coolify.example.com' });
            return res.end();
        }
        if (!p.startsWith('/api/v1/')) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end('<html><body>Coolify login</body></html>');
        }
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { message: 'Unauthenticated.' });

        const parts = p.slice('/api/v1/'.length).split('/').filter(Boolean);
        const [a, b, c] = parts;

        if (a === 'version') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
            return res.end(version);
        }
        if (a === 'projects' && !b) return json(res, 200, data.projects.map(({ id, uuid, name, description }) => ({ id, uuid, name, description })));
        if (a === 'projects' && b && !c) {
            const proj = data.projects.find((x) => x.uuid === b);
            if (!proj) return json(res, 404, { message: 'Project not found.' });
            return json(res, 200, { ...proj, environments: data.environments[b] || [] });
        }
        if (a === 'projects' && b && c === 'environments') return json(res, 200, data.environments[b] || []);
        if (a === 'resources') return json(res, 200, data.resources);

        if (a === 'deployments' && b === 'applications' && c) {
            const take = Number(url.searchParams.get('take') || 10);
            const list = (data.deployments[c] || []).map((d) => tick(d));
            return json(res, 200, { count: list.length, deployments: list.slice(0, take).map(({ logs: _logs, ...rest }) => rest) });
        }
        if (a === 'deployments' && b && c === 'cancel' && req.method === 'POST') {
            for (const list of Object.values(data.deployments)) for (const d of list) if (d.deployment_uuid === b) d.status = 'cancelled-by-user';
            return json(res, 200, { message: 'Deployment cancelled.' });
        }
        if (a === 'deployments' && b && !c) {
            for (const list of Object.values(data.deployments)) {
                const d = list.find((x) => x.deployment_uuid === b);
                if (d) {
                    const t = tick(d);
                    return json(res, 200, { ...t, logs: t.logs || logJson(['Starting deployment', `Commit ${String(t.commit || '').slice(0, 7)}`, t.status === 'in_progress' ? 'Building image…' : 'Done.']) });
                }
            }
            return json(res, 404, { message: 'Deployment not found.' });
        }
        if (a === 'deploy' && req.method === 'POST') {
            const uuid = url.searchParams.get('uuid');
            const r = data.resources.find((x) => x.uuid === uuid);
            if (!r) return json(res, 404, { message: 'Resource not found.' });
            const tipInfo = data.gitTip ? data.gitTip(r.git_branch || 'main') : null;
            const dep = { deployment_uuid: `dep-new-${++counter}`, status: 'queued', commit: tipInfo ? tipInfo.commit : 'abcdef0123456789abcdef0123456789abcdef01', commit_message: tipInfo ? tipInfo.message : 'Deployed from VS Code', fail: failing.has(uuid), is_api: true, force_rebuild: url.searchParams.get('force') === 'true', created_at: iso(0), updated_at: iso(0) };
            (data.deployments[uuid] ||= []).unshift(dep);
            live.set(dep.deployment_uuid, liveDeployTicks);
            return json(res, 200, { deployments: [{ message: `Application ${r.name} deployment queued.`, resource_uuid: uuid, deployment_uuid: dep.deployment_uuid }] });
        }
        if (a === 'deploy' && req.method === 'GET') {
            // Real Coolify treats GET /deploy as "deploy now": the extension must never call it.
            data.calls.push({ method: 'GET', path: '/deploy (FORBIDDEN)' });
            return json(res, 400, { message: 'GET /deploy must not be used by the extension' });
        }
        if (['applications', 'services', 'databases'].includes(a) && b && ['start', 'stop', 'restart'].includes(c)) {
            if (req.method !== 'POST') return json(res, 405, { message: 'Method not allowed' });
            const r = data.resources.find((x) => x.uuid === b);
            if (!r) return json(res, 404, { message: 'Not found.' });
            r.status = c === 'stop' ? 'exited:unhealthy' : 'running:healthy';
            return json(res, 200, { message: `${c} request queued.` });
        }
        if (a === 'applications' && b && c === 'logs') {
            return json(res, 200, { logs: `2026-01-01T10:00:00Z Server listening on :3000\n2026-01-01T10:00:05Z GET / 200 12ms\n2026-01-01T10:00:09Z GET /pricing 200 18ms` });
        }
        return json(res, 404, { message: 'Not found.' });
    });

    function tick(d) {
        if (live.has(d.deployment_uuid)) {
            const left = live.get(d.deployment_uuid);
            if (left <= 0) {
                d.status = d.fail ? 'failed' : 'finished';
                d.updated_at = iso(0);
                d.logs = d.fail
                    ? logJson(['Starting deployment', 'Building image…', 'npm ERR! code ELIFECYCLE', 'npm ERR! Missing script: "build"', 'Deployment failed.'])
                    : logJson(['Starting deployment', 'Building image…', 'Image built.', 'Rolling update completed.']);
                live.delete(d.deployment_uuid);
            } else {
                d.status = 'in_progress';
                d.logs = logJson(['Starting deployment', 'Building image…', `step ${liveDeployTicks - left + 1}/${liveDeployTicks}`]);
                live.set(d.deployment_uuid, left - 1);
            }
        }
        return d;
    }

    return {
        server,
        data,
        listen: (port = 0) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))),
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const port = Number(process.env.PORT || 8765);
    const mock = createMockCoolify({
        requireCf: process.argv.includes('--cf'),
        repo: process.env.MOCK_REPO || '',
        deployedCommit: process.env.MOCK_DEPLOYED || '',
        failUuids: (process.env.MOCK_FAIL || '').split(',').filter(Boolean),
        liveDeployTicks: Number(process.env.MOCK_TICKS || 3),
    });
    mock.listen(port).then((url) => console.log(`Mock Coolify at ${url} (token: ${TOKEN})`));
}
