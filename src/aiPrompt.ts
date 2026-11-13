import * as fs from 'fs';
import * as path from 'path';

export interface PromptContext {
    serverUrl?: string;
    authMode?: string;
    hasToken?: boolean;
    folderName?: string;
    repo?: string;
    project?: string;
    lastError?: string;
    editor?: string;
}

/** Load the template shipped in media/ and fill in non-secret context. Secrets are never passed in. */
export function buildAiSetupPrompt(extensionPath: string, ctx: PromptContext): string {
    const template = fs.readFileSync(path.join(extensionPath, 'media', 'ai-setup-prompt.md'), 'utf8');
    return fillPrompt(template, ctx);
}

export function fillPrompt(template: string, ctx: PromptContext): string {
    const lines: string[] = [];
    const add = (label: string, v?: string | boolean) => {
        if (v === undefined || v === '') return;
        lines.push(`- ${label}: ${v}`);
    };
    add('Editor', ctx.editor);
    add('Server URL I entered so far', ctx.serverUrl);
    add('Connection type selected', ctx.authMode);
    if (ctx.hasToken !== undefined) add('API token saved', ctx.hasToken ? 'yes' : 'no');
    add('Folder open in VS Code', ctx.folderName);
    add('Its git remote', ctx.repo);
    add('Coolify project shown', ctx.project);
    add('Last error from the extension', ctx.lastError);
    const block = lines.length ? `My current state (filled in by the extension; it contains no secrets):\n${lines.join('\n')}\n` : '';
    return template.replace('{{CONTEXT}}', block);
}
