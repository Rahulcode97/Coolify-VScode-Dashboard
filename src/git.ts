import simpleGit, { SimpleGit } from 'simple-git';

/** Thin, cached wrappers around simple-git. All methods fail soft (return empty values). */
export class GitInfo {
    private remotes = new Map<string, { at: number; url: string }>();
    private subjects = new Map<string, string>();
    private lastFetch = new Map<string, number>();

    private git(dir: string): SimpleGit {
        return simpleGit({ baseDir: dir, maxConcurrentProcesses: 4, timeout: { block: 30_000 } });
    }

    async remoteUrl(dir: string, remote = 'origin'): Promise<string> {
        const key = `${dir}\n${remote}`;
        const hit = this.remotes.get(key);
        if (hit && Date.now() - hit.at < 60_000) return hit.url;
        let url = '';
        try {
            url = (await this.git(dir).remote(['get-url', remote])) || '';
        } catch {
            try {
                const all = await this.git(dir).getRemotes(true);
                const first = all.find((r) => r.name === remote) || all[0];
                url = first?.refs.fetch || first?.refs.push || '';
            } catch {
                url = '';
            }
        }
        url = url.trim();
        this.remotes.set(key, { at: Date.now(), url });
        return url;
    }

    async currentBranch(dir: string): Promise<string> {
        try {
            return (await this.git(dir).revparse(['--abbrev-ref', 'HEAD'])).trim();
        } catch {
            return '';
        }
    }

    /** Commit subjects from local history (no network). Missing commits resolve to ''. */
    async commitSubjects(dir: string, shas: (string | null | undefined)[]): Promise<Record<string, string>> {
        const out: Record<string, string> = {};
        const unique = [...new Set(shas.filter((s): s is string => !!s && /^[0-9a-f]{4,40}$/i.test(s)))];
        const git = this.git(dir);
        await Promise.all(
            unique.map(async (sha) => {
                const cached = this.subjects.get(sha);
                if (cached !== undefined) {
                    out[sha] = cached;
                    return;
                }
                let subject = '';
                try {
                    subject = (await git.show([sha, '-s', '--format=%s'])).trim();
                } catch {
                    subject = '';
                }
                this.subjects.set(sha, subject);
                out[sha] = subject;
            }),
        );
        return out;
    }

    /**
     * How far `target` is behind `source` (commits on source not in target).
     * Fetches the remote at most every 5 minutes, or when `forceFetch` is set.
     */
    async aheadBehind(dir: string, source: string, target: string, remote: string, forceFetch = false): Promise<{ behind: number; ahead: number } | null> {
        const git = this.git(dir);
        const last = this.lastFetch.get(dir) || 0;
        if (forceFetch || Date.now() - last > 5 * 60_000) {
            this.lastFetch.set(dir, Date.now());
            try {
                await git.fetch([remote, '--prune', '--quiet']);
            } catch {
                /* offline: use local refs */
            }
        }
        try {
            const refs = (await git.branch(['-r'])).all.map((b) => b.trim());
            const t = refs.includes(`${remote}/${target}`) ? `${remote}/${target}` : target;
            const s = refs.includes(`${remote}/${source}`) ? `${remote}/${source}` : source;
            const out = (await git.raw(['rev-list', '--left-right', '--count', `${t}...${s}`])).trim();
            const [left, right] = out.split(/\s+/).map((n) => parseInt(n, 10) || 0);
            return { ahead: left, behind: right };
        } catch {
            return null;
        }
    }

    /**
     * Merge `remote/source` into `target`, push, and return to the original branch.
     * Refuses when tracked files have uncommitted changes. Aborts cleanly on conflict.
     */
    async mergeAndPush(dir: string, source: string, target: string, remote: string): Promise<{ ok: true } | { ok: false; error: string }> {
        const git = this.git(dir);
        let original = '';
        try {
            const status = await git.status();
            original = status.current || '';
            const dirty = [...status.conflicted, ...status.created, ...status.deleted, ...status.modified, ...status.renamed.map((r) => r.to), ...status.staged];
            if (dirty.length) {
                return { ok: false, error: `Uncommitted changes to tracked files (${[...new Set(dirty)].slice(0, 5).join(', ')}). Commit or stash them first.` };
            }
            await git.fetch([remote]);
            const local = await git.branchLocal();
            if (!local.all.includes(target)) await git.checkout(['-b', target, `${remote}/${target}`]);
            else {
                await git.checkout(target);
                await git.merge([`${remote}/${target}`, '--ff-only']);
            }
            await git.merge([`${remote}/${source}`, '--no-edit']);
            await git.push(remote, target);
            if (original && original !== target) await git.checkout(original);
            this.lastFetch.delete(dir);
            return { ok: true };
        } catch (e: any) {
            try {
                await git.merge(['--abort']);
            } catch {
                /* nothing to abort */
            }
            if (original) {
                try {
                    await git.checkout(original);
                } catch {
                    /* best effort */
                }
            }
            return { ok: false, error: String(e?.message || e).trim() };
        }
    }
}
