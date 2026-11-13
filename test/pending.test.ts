import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATION_GLOBS } from '../src/deployRisk';
import { GitInfo, parsePorcelain } from '../src/git';
import { computePending, makeScope } from '../src/pending';

let dir = '';
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const write = (f: string, c: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
};
const opts = { remote: 'origin', stopUsers: true, migrationGlobs: DEFAULT_MIGRATION_GLOBS, rules: [{ pattern: 'docker-compose.yml', reason: 'recreates all containers' }] };

describe('computePending against a real git repo', () => {
    let deployed = '';
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-'));
        git('init', '-q', '-b', 'main');
        git('config', 'user.email', 'dev@example.com');
        git('config', 'user.name', 'Dev');
        write('web/index.html', 'v1');
        write('api/main.py', 'v1');
        write('api/migrations/001_init.sql', 'CREATE TABLE users (id int, legacy_name text);');
        git('add', '.');
        git('commit', '-qm', 'init');
        deployed = git('rev-parse', 'HEAD');
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    const pg = () => new GitInfo().pendingGit(dir);

    it('is quiet when the deployed commit is the tip', async () => {
        expect(await computePending(pg(), { branch: 'main', deployedCommit: deployed, baseDirectory: '/web' }, opts)).toBeNull();
    });

    it('turns pink only for the app whose folder changed', async () => {
        write('web/index.html', 'v2');
        git('commit', '-qam', 'web change');
        const web = await computePending(pg(), { branch: 'main', deployedCommit: deployed, baseDirectory: '/web' }, opts);
        const api = await computePending(pg(), { branch: 'main', deployedCommit: deployed, baseDirectory: '/api' }, opts);
        expect(web?.reasons[0]).toBe('1 commit on main not deployed (touching web/)');
        expect(web?.findings).toEqual([]);
        expect(api).toBeNull();
    });

    it('turns red for a new risky migration, not for the applied one', async () => {
        write('api/migrations/002_drop_legacy.sql', 'ALTER TABLE users DROP COLUMN legacy_name;');
        git('add', '.');
        git('commit', '-qm', 'drop legacy');
        const api = await computePending(pg(), { branch: 'main', deployedCommit: deployed, baseDirectory: '/api' }, opts);
        expect(api?.findings.map((f) => f.id)).toEqual(['drop-column']);
        expect(api?.reasons[0]).toBe('1 commit on main not deployed (touching api/)');
        expect(api?.findings[0].file).toBe('api/migrations/002_drop_legacy.sql');
    });

    it('sees uncommitted and untracked work and user rules', async () => {
        write('docker-compose.yml', 'services: {}');
        write('api/migrations/003_index.sql', 'CREATE INDEX i ON users (id);');
        const root = await computePending(pg(), { branch: 'main', deployedCommit: git('rev-parse', 'HEAD') }, opts);
        expect(root?.reasons.some((r) => r.startsWith('uncommitted changes'))).toBe(true);
        expect(root?.findings.map((f) => f.id).sort()).toEqual(['create-index', 'rule']);
    });

    it('stays quiet when the deployed commit is unknown locally', async () => {
        expect(await computePending(pg(), { branch: 'main', deployedCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, opts)).toBeNull();
    });

    it('respects watch paths', () => {
        const inScope = makeScope({ baseDirectory: '/api', watchPaths: 'src/**\n!src/**/*.md' });
        expect(inScope('api/src/a.py')).toBe(true);
        expect(inScope('api/src/README.md')).toBe(false);
        expect(inScope('api/tests/a.py')).toBe(false);
        expect(inScope('web/src/a.py')).toBe(false);
    });

    it('parses porcelain status', () => {
        expect(parsePorcelain('?? new.sql\n M a.ts\nR  old.ts -> new.ts\nA  b.sql')).toEqual([
            { status: '?', file: 'new.sql' },
            { status: 'M', file: 'a.ts' },
            { status: 'R', file: 'new.ts' },
            { status: 'A', file: 'b.sql' },
        ]);
    });
});
