import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { buildAiSetupPrompt, fillPrompt } from '../src/aiPrompt';

const root = path.resolve(__dirname, '..');

describe('AI setup prompt', () => {
    it('fills in non-secret context', () => {
        const p = buildAiSetupPrompt(root, { serverUrl: 'https://coolify.example.com', authMode: 'Cloudflare Access', hasToken: false, folderName: 'web', lastError: 'Token rejected (401).' });
        expect(p).toContain('Server URL I entered so far: https://coolify.example.com');
        expect(p).toContain('API token saved: no');
        expect(p).toContain('Token rejected (401).');
        expect(p).not.toContain('{{CONTEXT}}');
    });
    it('drops the context block when there is nothing to say', () => {
        expect(fillPrompt('A\n{{CONTEXT}}B', {})).toBe('A\nB');
    });
    it('mentions every setting the extension contributes', () => {
        const prompt = fs.readFileSync(path.join(root, 'media', 'ai-setup-prompt.md'), 'utf8');
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        const keys = pkg.contributes.configuration.flatMap((c: any) => Object.keys(c.properties));
        const optional = keys.filter((k: string) => /preDeploy\.command|merge\.|localServices|projectUuid|environment/.test(k));
        for (const k of optional) expect(prompt, k).toContain(k);
    });
    it('is published in the README word for word', () => {
        const prompt = fs.readFileSync(path.join(root, 'media', 'ai-setup-prompt.md'), 'utf8').replace('{{CONTEXT}}\n', '');
        const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
        expect(readme).toContain(prompt.trim());
    });
});
