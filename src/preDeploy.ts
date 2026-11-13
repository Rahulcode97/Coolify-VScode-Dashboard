import { spawn } from 'child_process';
import * as path from 'path';

export interface PreDeployResult {
    ok: boolean;
    skipped: boolean;
    summary: string;
    output: string;
    exitCode: number | null;
}

/**
 * Run the user's pre-deploy command (e.g. `npm run build`) with a shell.
 * `onOutput` receives output as it arrives (for the output channel).
 */
export function runPreDeployCommand(opts: {
    command: string;
    folder: string;
    cwd?: string;
    timeoutMs: number;
    onOutput?: (chunk: string) => void;
    signal?: AbortSignal;
}): Promise<PreDeployResult> {
    const command = opts.command.trim();
    if (!command) return Promise.resolve({ ok: true, skipped: true, summary: 'No pre-deploy command set', output: '', exitCode: null });
    const rel = (opts.cwd || '').trim();
    const cwd = rel ? (path.isAbsolute(rel) ? rel : path.join(opts.folder, rel)) : opts.folder;
    return new Promise((resolve) => {
        let output = '';
        let settled = false;
        const done = (r: PreDeployResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(r);
        };
        const child = spawn(command, { cwd, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', CI: process.env.CI || '1' } });
        const onData = (d: Buffer) => {
            const s = d.toString();
            output += s;
            if (output.length > 2_000_000) output = output.slice(-1_000_000);
            opts.onOutput?.(s);
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        const timer = setTimeout(() => {
            child.kill();
            done({ ok: false, skipped: false, summary: `Timed out after ${Math.round(opts.timeoutMs / 60000)} min`, output, exitCode: null });
        }, opts.timeoutMs);
        opts.signal?.addEventListener('abort', () => {
            child.kill();
            done({ ok: false, skipped: false, summary: 'Cancelled', output, exitCode: null });
        });
        child.on('error', (err) => done({ ok: false, skipped: false, summary: `Could not start: ${err.message}`, output, exitCode: null }));
        child.on('close', (code) => done({ ok: code === 0, skipped: false, summary: code === 0 ? 'Passed' : firstError(output) || `Exited with code ${code}`, output, exitCode: code }));
    });
}

/**
 * Pull the most useful line out of noisy build/test output.
 * Understands ESLint's "stylish" format, TypeScript errors and Vite/esbuild build errors.
 */
export function firstError(output: string): string {
    const lines = output.split(/\r?\n/);

    // ESLint stylish: file path on its own line, then "  12:5  error  message  rule".
    let currentFile = '';
    for (const raw of lines) {
        const line = raw.trimEnd();
        if (/^\S.*\.(jsx?|tsx?|mjs|cjs|vue|svelte)$/.test(line.trim())) {
            currentFile = line.trim();
            continue;
        }
        const m = line.match(/^\s+(\d+:\d+)\s+error\s+(.+?)\s{2,}(\S+)\s*$/);
        if (m) {
            const where = currentFile ? `${shortenPath(currentFile)}:${m[1]}` : m[1];
            return `${where} — ${m[2]} (${m[3]})`.slice(0, 300);
        }
    }

    // TypeScript: src/a.ts(3,7): error TS2322: ...  or  src/a.ts:3:7 - error TS2322: ...
    const ts = lines.find((l) => /error TS\d+:/.test(l));
    if (ts) return ts.trim().slice(0, 300);

    // Vite / esbuild / rollup put the cause on the next line.
    const trimmed = lines.map((l) => l.trim());
    const i = trimmed.findIndex((l) => /error during build|Transform failed|Could not resolve|Expression expected|Invalid character/i.test(l));
    if (i >= 0) return `${trimmed[i]} ${trimmed.slice(i + 1).find(Boolean) || ''}`.trim().slice(0, 300);

    const generic = trimmed.find((l) => /^(error|ERR!|npm ERR!|FAIL)\b/i.test(l));
    if (generic) return generic.slice(0, 300);

    return trimmed.filter(Boolean).slice(-3).join(' · ').slice(0, 300);
}

function shortenPath(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const src = parts.lastIndexOf('src');
    return src >= 0 ? parts.slice(src).join('/') : parts.slice(-2).join('/');
}
