import { describe, expect, it } from 'vitest';
import { commitUrl, formatDeploymentLogs, isRunning, parseResourceStatus, relativeTime, repoWebUrl, scanBuildLogForErrors } from '../src/logs';

describe('status parsing', () => {
    it('splits compound statuses without confusing unhealthy with healthy', () => {
        expect(parseResourceStatus('running:healthy')).toEqual({ container: 'running', health: 'healthy' });
        expect(parseResourceStatus('running:unhealthy')).toEqual({ container: 'running', health: 'unhealthy' });
        expect(parseResourceStatus('exited')).toEqual({ container: 'exited', health: null });
        expect(parseResourceStatus('')).toEqual({ container: 'unknown', health: null });
    });
    it('takes the worst part of a multi-container service status', () => {
        expect(parseResourceStatus('running:healthy,exited:unhealthy').container).toBe('exited');
    });
    it('knows what counts as running', () => {
        expect(isRunning('running:healthy')).toBe(true);
        expect(isRunning('exited:unhealthy')).toBe(false);
    });
});

describe('deployment logs', () => {
    it('formats Coolify JSON log arrays and hides debug lines', () => {
        const raw = JSON.stringify([
            { output: 'second', order: 2, hidden: false },
            { output: 'first', order: 1, hidden: false },
            { output: 'secret debug', order: 3, hidden: true },
        ]);
        expect(formatDeploymentLogs(raw)).toBe('first\nsecond');
        expect(formatDeploymentLogs(raw, true)).toContain('secret debug');
    });
    it('passes plain text through', () => {
        expect(formatDeploymentLogs('hello')).toBe('hello');
        expect(formatDeploymentLogs(null)).toBe('');
    });
    it('finds build errors hidden in a finished deployment', () => {
        expect(scanBuildLogForErrors('…\nnpm ERR! code ELIFECYCLE')).toBe('npm error');
        expect(scanBuildLogForErrors('error during build:\nX')).toBe('Build error');
        expect(scanBuildLogForErrors('all good')).toBeNull();
    });
});

describe('links and time', () => {
    it('turns git_repository values into web URLs', () => {
        expect(repoWebUrl('acme/web')).toBe('https://github.com/acme/web');
        expect(repoWebUrl('git@gitlab.example.com:team/app.git')).toBe('https://gitlab.example.com/team/app');
        expect(repoWebUrl('https://user:pw@github.com/acme/web.git')).toBe('https://github.com/acme/web'); // secretlint-disable-line -- fake credentials: tests that they are stripped
        expect(commitUrl('https://gitlab.example.com/team/app', 'abc')).toBe('https://gitlab.example.com/team/app/-/commit/abc');
    });
    it('formats relative times', () => {
        const now = Date.parse('2026-01-01T12:00:00Z');
        expect(relativeTime('2026-01-01T11:57:00Z', now)).toBe('3m ago');
        expect(relativeTime('2026-01-01T09:00:00Z', now)).toBe('3h ago');
        expect(relativeTime('', now)).toBe('');
    });
});
