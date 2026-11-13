import { describe, expect, it } from 'vitest';
import { environmentsForRepo, filterByEnvironments, repoKey, resolveProject, sameRepo } from '../src/projects';

describe('repoKey', () => {
    it.each([
        ['https://github.com/Acme/Acme-Web.git', 'github.com/acme/acme-web'],
        ['https://github.com/acme/acme-web', 'github.com/acme/acme-web'],
        ['git@github.com:acme/acme-web.git', 'github.com/acme/acme-web'],
        ['ssh://git@gitlab.example.com:2222/team/app.git', 'gitlab.example.com/team/app'],
        ['https://user:token@github.com/acme/acme-web.git', 'github.com/acme/acme-web'], // secretlint-disable-line -- fake credentials: tests that they are stripped
        ['acme/acme-web', 'acme/acme-web'],
        ['', ''],
    ])('%s → %s', (input, out) => expect(repoKey(input)).toBe(out));

    it('matches owner/repo against a full URL', () => {
        expect(sameRepo(repoKey('acme/acme-web'), repoKey('git@github.com:acme/acme-web.git'))).toBe(true);
        expect(sameRepo(repoKey('acme/blog'), repoKey('git@github.com:acme/acme-web.git'))).toBe(false);
    });
});

describe('resolveProject', () => {
    const projects = [{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' }];
    it('prefers the explicit setting', () => {
        expect(resolveProject({ projects, explicitUuid: 'b', savedUuid: 'c', repoMatches: ['a'] })).toEqual({ kind: 'bound', projectUuid: 'b', source: 'setting' });
    });
    it('flags a setting that points at a missing project', () => {
        expect(resolveProject({ projects, explicitUuid: 'zzz', repoMatches: [] })).toMatchObject({ kind: 'pick', reason: 'not-found' });
    });
    it('uses the saved choice next', () => {
        expect(resolveProject({ projects, savedUuid: 'c', repoMatches: ['a'] })).toMatchObject({ projectUuid: 'c', source: 'saved' });
    });
    it('ignores a stale saved choice', () => {
        expect(resolveProject({ projects, savedUuid: 'gone', repoMatches: ['a'] })).toMatchObject({ projectUuid: 'a', source: 'repo' });
    });
    it('auto-detects a single repo match', () => {
        expect(resolveProject({ projects, repoMatches: ['b'] })).toMatchObject({ projectUuid: 'b', source: 'repo' });
    });
    it('asks when the repo is in several projects', () => {
        expect(resolveProject({ projects, repoMatches: ['a', 'b'] })).toEqual({ kind: 'pick', candidates: ['a', 'b'], reason: 'multiple-matches' });
    });
    it('uses the only project when there is one', () => {
        expect(resolveProject({ projects: [{ uuid: 'x' }], repoMatches: [] })).toMatchObject({ projectUuid: 'x', source: 'only' });
    });
    it('asks when nothing matches', () => {
        expect(resolveProject({ projects, repoMatches: [] })).toMatchObject({ kind: 'pick', reason: 'no-match' });
    });
    it('reports no projects', () => {
        expect(resolveProject({ projects: [], repoMatches: [] })).toEqual({ kind: 'none' });
    });
});

describe('environment filtering', () => {
    const resources = [
        { uuid: '1', name: 'web', type: 'application', environment_id: 11, git_repository: 'acme/acme-web' },
        { uuid: '2', name: 'db', type: 'standalone-postgresql', environment_id: 11 },
        { uuid: '3', name: 'blog', type: 'application', environment_id: 21, git_repository: 'https://github.com/acme/blog' },
        { uuid: '4', name: 'orphan', type: 'application' },
    ];
    it('keeps only resources in the given environments', () => {
        expect(filterByEnvironments(resources, new Set([11])).map((r) => r.uuid)).toEqual(['1', '2']);
    });
    it('finds environments of apps that build the repo', () => {
        expect([...environmentsForRepo(resources as any, repoKey('git@github.com:acme/blog.git'))]).toEqual([21]);
        expect([...environmentsForRepo(resources as any, '')]).toEqual([]);
    });
});
