/**
 * "Needs deploy" (pink) and "stop users" (red) for one Coolify application.
 *
 * Compares the commit Coolify deployed last with what is in git now: newer
 * commits on the app's branch, unpushed commits and uncommitted files (when
 * that branch is checked out). Only files inside the app's Base Directory and
 * Watch Paths count, so in a monorepo each app reacts to its own folder.
 * No VS Code imports: git access goes through the small {@link PendingGit} interface.
 */
import { createHash } from 'crypto';
import { DowntimeRule, StopUserFinding, analyzeMigrationSql, matchesAny, ruleFindings } from './deployRisk';

export interface FileChange {
    status: string; // A, M, D, R, C, T, U, ?
    file: string;
}

export interface PendingGit {
    revExists(sha: string): Promise<boolean>;
    resolve(ref: string): Promise<string | null>;
    currentBranch(): Promise<string>;
    diff(from: string, to: string): Promise<FileChange[]>;
    /** Commits in from..to, optionally only those touching `pathspec` (e.g. "web/"). */
    countCommits(from: string, to: string, pathspec?: string): Promise<number>;
    /** Uncommitted (staged, unstaged and untracked) changes against HEAD. */
    working(): Promise<FileChange[]>;
    /** File content at a commit, or in the working tree when `sha` is null. '' when missing. */
    read(sha: string | null, file: string): Promise<string>;
}

export interface PendingApp {
    branch: string;
    deployedCommit: string;
    baseDirectory?: string | null;
    watchPaths?: string | null;
}

export interface PendingOptions {
    remote: string;
    stopUsers: boolean;
    migrationGlobs: string[];
    rules: DowntimeRule[];
}

export interface PendingResult {
    reasons: string[];
    findings: StopUserFinding[];
}

function sameSha(a: string, b: string): boolean {
    const x = a.trim().toLowerCase();
    const y = b.trim().toLowerCase();
    return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
}

/** Coolify base directory ("/", "/web", "web/") → "" or "web/". */
export function normalizeBase(base?: string | null): string {
    const b = String(base || '').trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
    return b ? b + '/' : '';
}

/** Coolify "Watch Paths": one gitignore-like pattern per line; lines starting with ! exclude. */
export function parseWatchPaths(raw?: string | null): { include: string[]; exclude: string[] } {
    const lines = String(raw || '')
        .split(/\r?\n|,/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    return { include: lines.filter((l) => !l.startsWith('!')), exclude: lines.filter((l) => l.startsWith('!')).map((l) => l.slice(1)) };
}

export function makeScope(app: Pick<PendingApp, 'baseDirectory' | 'watchPaths'>): (file: string) => boolean {
    const base = normalizeBase(app.baseDirectory);
    const watch = parseWatchPaths(app.watchPaths);
    return (file: string) => {
        const f = file.replace(/\\/g, '/');
        if (base && !f.startsWith(base)) return false;
        const rel = base ? f.slice(base.length) : f;
        if (watch.include.length && !matchesAny(f, watch.include) && !matchesAny(rel, watch.include)) return false;
        if (watch.exclude.length && (matchesAny(f, watch.exclude) || matchesAny(rel, watch.exclude))) return false;
        return true;
    };
}

const sqlCache = new Map<string, StopUserFinding[]>();

function analyzeCached(file: string, sql: string): StopUserFinding[] {
    const key = file + '\n' + createHash('sha1').update(sql).digest('hex');
    const hit = sqlCache.get(key);
    if (hit) return hit;
    const res = analyzeMigrationSql(file, sql);
    if (sqlCache.size > 500) sqlCache.clear();
    sqlCache.set(key, res);
    return res;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** null = nothing pending (or not knowable, e.g. the deployed commit is not in local history). */
export async function computePending(git: PendingGit, app: PendingApp, opts: PendingOptions): Promise<PendingResult | null> {
    if (!app.deployedCommit || !app.branch) return null;
    if (!(await git.revExists(app.deployedCommit))) return null;

    const remoteRef = `${opts.remote}/${app.branch}`;
    const tip = (await git.resolve(remoteRef)) || (await git.resolve(app.branch));
    if (!tip) return null;

    const inScope = makeScope(app);
    const where = normalizeBase(app.baseDirectory) || '';
    const reasons: string[] = [];
    /** New or changed files with where to read them from. */
    const touched: { change: FileChange; at: string | null }[] = [];

    if (!sameSha(app.deployedCommit, tip)) {
        const changes = (await git.diff(app.deployedCommit, tip)).filter((c) => inScope(c.file));
        if (changes.length) {
            const n = (await git.countCommits(app.deployedCommit, tip, where || undefined)) || 1;
            reasons.push(`${plural(n, 'commit')} on ${app.branch} not deployed${where ? ` (touching ${where})` : ''}`);
            touched.push(...changes.map((change) => ({ change, at: tip })));
        }
    }

    if ((await git.currentBranch()) === app.branch) {
        const head = await git.resolve('HEAD');
        if (head && !sameSha(head, tip)) {
            const ahead = (await git.diff(tip, head)).filter((c) => inScope(c.file));
            if (ahead.length) {
                reasons.push(`unpushed commits on ${app.branch}${where ? ` in ${where}` : ''}`);
                touched.push(...ahead.map((change) => ({ change, at: head })));
            }
        }
        const work = (await git.working()).filter((c) => inScope(c.file));
        if (work.length) {
            reasons.push(`uncommitted changes${where ? ` in ${where}` : ''} (${plural(work.length, 'file')})`);
            touched.push(...work.map((change) => ({ change, at: null })));
        }
    }

    if (!reasons.length) return null;

    const findings: StopUserFinding[] = [];
    if (opts.stopUsers) {
        // Only NEW migration files run on the next start; applied ones are skipped by every migration tool.
        const seen = new Set<string>();
        for (const { change, at } of touched) {
            if (seen.has(change.file)) continue;
            const isNew = change.status === 'A' || change.status === '?' || change.status === 'C' || change.status === 'R';
            if (!isNew || !/\.sql$/i.test(change.file) || !matchesAny(change.file, opts.migrationGlobs)) continue;
            seen.add(change.file);
            const sql = await git.read(at, change.file);
            if (sql) findings.push(...analyzeCached(change.file, sql));
        }
        const changedFiles = [...new Set(touched.filter((t) => t.change.status !== 'D').map((t) => t.change.file))];
        findings.push(...ruleFindings(changedFiles, opts.rules));
    }
    return { reasons, findings: findings.slice(0, 12) };
}
