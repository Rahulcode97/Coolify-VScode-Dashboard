/**
 * Helpers for Coolify deployment logs and statuses. No VS Code imports, so they
 * are unit-tested directly.
 */

export interface ParsedStatus {
    /** running, exited, stopped, starting, restarting, degraded, unknown … */
    container: string;
    /** healthy, unhealthy, unknown, or null when Coolify did not report health. */
    health: string | null;
}

/** Split a Coolify compound status such as `running:healthy` (never confuses `unhealthy` with `healthy`). */
export function parseResourceStatus(status?: string | null): ParsedStatus {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw) return { container: 'unknown', health: null };
    // Services can report e.g. "running:healthy,exited:unhealthy" — take the worst part.
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    const parsed = parts.map((p) => {
        const i = p.indexOf(':');
        return i === -1 ? { container: p, health: null as string | null } : { container: p.slice(0, i) || 'unknown', health: p.slice(i + 1) || null };
    });
    const rank = (s: ParsedStatus) => (s.container === 'running' ? 0 : s.container === 'starting' || s.container === 'restarting' ? 1 : 2) * 10 + (s.health === 'unhealthy' ? 1 : 0);
    parsed.sort((a, b) => rank(b) - rank(a));
    return parsed[0];
}

export function isRunning(status?: string | null): boolean {
    const c = parseResourceStatus(status).container;
    return c === 'running' || c === 'starting' || c === 'restarting' || c === 'degraded';
}

const ACTIVE = new Set(['queued', 'in_progress', 'running', 'deploying', 'building']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'cancelled-by-user', 'canceled']);
const DONE = new Set(['finished', 'success', 'succeeded']);

export function isActiveDeployment(status?: string | null): boolean {
    return ACTIVE.has(String(status || '').toLowerCase());
}

export function isFailedDeployment(status?: string | null): boolean {
    return FAILED.has(String(status || '').toLowerCase());
}

export function isFinishedDeployment(status?: string | null): boolean {
    return DONE.has(String(status || '').toLowerCase());
}

/**
 * Markers that mean the build actually failed even though Coolify recorded the
 * deployment as finished (it happens: the old container keeps serving).
 */
const BUILD_ERROR_PATTERNS: { pattern: RegExp; label: string }[] = [
    { pattern: /error during build/i, label: 'Build error' },
    { pattern: /build failed with \d+ error/i, label: 'Build failed' },
    { pattern: /\bnpm ERR!/, label: 'npm error' },
    { pattern: /returned a non-zero code|exit code: [1-9]/i, label: 'Non-zero exit code' },
    { pattern: /failed to solve|executor failed running/i, label: 'Docker build failure' },
    { pattern: /ERROR: process ".*" did not complete successfully/i, label: 'Docker step failed' },
];

/** First build-error marker in a log, or null when the log looks clean. */
export function scanBuildLogForErrors(log: string | null | undefined): string | null {
    const text = String(log || '');
    if (!text) return null;
    for (const { pattern, label } of BUILD_ERROR_PATTERNS) {
        if (pattern.test(text)) return label;
    }
    return null;
}

interface LogEntry {
    output?: string;
    type?: string;
    hidden?: boolean;
    timestamp?: string;
    order?: number;
    command?: string | null;
}

/**
 * Coolify stores deployment logs as a JSON string holding an array of entries.
 * Turn that into readable text. Hidden (debug) entries are skipped unless asked for.
 * Plain-text input is returned unchanged.
 */
export function formatDeploymentLogs(logs: unknown, includeHidden = false): string {
    if (logs == null) return '';
    let entries: LogEntry[] | null = null;
    if (Array.isArray(logs)) entries = logs as LogEntry[];
    else if (typeof logs === 'string') {
        const t = logs.trim();
        if (t.startsWith('[')) {
            try {
                const parsed = JSON.parse(t);
                if (Array.isArray(parsed)) entries = parsed;
            } catch {
                /* plain text */
            }
        }
        if (!entries) return logs;
    } else return String(logs);

    return entries
        .filter((e) => e && (includeHidden || !e.hidden))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((e) => String(e.output ?? '').replace(/\s+$/, ''))
        .filter((line) => line.length > 0)
        .join('\n');
}

/** "3m ago" style label. */
export function relativeTime(iso?: string | null, now = Date.now()): string {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const mins = Math.floor((now - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    const days = Math.floor(mins / 1440);
    if (days < 30) return `${days}d ago`;
    return new Date(t).toISOString().slice(0, 10);
}

/** Resolve a Coolify `git_repository` (owner/repo, https or ssh URL) to a browsable web URL. */
export function repoWebUrl(gitRepository?: string | null): string {
    if (!gitRepository) return '';
    const v = gitRepository.trim();
    if (/^https?:\/\//i.test(v)) return v.replace(/\.git$/, '').replace(/\/\/[^@/]+@/, '//');
    const ssh = v.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/i);
    if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
    if (/^[\w.-]+\/[\w.-]+$/.test(v)) return `https://github.com/${v.replace(/\.git$/, '')}`;
    return '';
}

/** Commit link for a repo web URL (GitHub / GitLab / Gitea style). */
export function commitUrl(repoUrl: string, sha?: string | null): string {
    if (!repoUrl || !sha) return '';
    if (/gitlab/i.test(repoUrl)) return `${repoUrl}/-/commit/${sha}`;
    return `${repoUrl}/commit/${sha}`;
}
