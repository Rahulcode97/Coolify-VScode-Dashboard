import * as os from 'os';
import { describe, expect, it } from 'vitest';
import { firstError, runPreDeployCommand } from '../src/preDeploy';

describe('firstError', () => {
    it('reads ESLint stylish output', () => {
        const out = ['/repo/web/src/pages/Home.tsx', '  12:5  error  \'x\' is not defined  no-undef', '', '✖ 1 problem'].join('\n');
        expect(firstError(out)).toBe("src/pages/Home.tsx:12:5 — 'x' is not defined (no-undef)");
    });
    it('reads TypeScript errors', () => {
        expect(firstError('src/a.ts(3,7): error TS2322: Type string is not assignable to type number.')).toMatch(/TS2322/);
    });
    it('reads Vite build errors with the cause on the next line', () => {
        expect(firstError('vite v5\nerror during build:\nCould not resolve "./missing"')).toBe('error during build: Could not resolve "./missing"');
    });
    it('falls back to the last lines', () => {
        expect(firstError('a\nb\nc\nd')).toBe('b · c · d');
    });
});

describe('runPreDeployCommand', () => {
    const folder = os.tmpdir();
    it('passes on exit code 0', async () => {
        const r = await runPreDeployCommand({ command: 'node -e "console.log(1)"', folder, timeoutMs: 20000 });
        expect(r).toMatchObject({ ok: true, skipped: false });
        expect(r.output).toContain('1');
    });
    it('fails with the first error on a non-zero exit', async () => {
        const r = await runPreDeployCommand({ command: 'node -e "console.error(\'error TS1005: x\'); process.exit(2)"', folder, timeoutMs: 20000 });
        expect(r.ok).toBe(false);
        expect(r.exitCode).toBe(2);
        expect(r.summary).toMatch(/TS1005/);
    });
    it('times out', async () => {
        const r = await runPreDeployCommand({ command: 'node -e "setTimeout(()=>{}, 10000)"', folder, timeoutMs: 300 });
        expect(r.ok).toBe(false);
        expect(r.summary).toMatch(/Timed out/);
    });
    it('skips when no command is set', async () => {
        expect(await runPreDeployCommand({ command: ' ', folder, timeoutMs: 1000 })).toMatchObject({ ok: true, skipped: true });
    });
});
