import * as vscode from 'vscode';
import { AuthMode, ConnectionConfig, normalizeServerUrl } from './api/client';

const SECRET = {
    token: 'coolify.apiToken',
    cfClientId: 'coolify.cfAccessClientId',
    cfClientSecret: 'coolify.cfAccessClientSecret',
    customHeaders: 'coolify.customHeaders',
} as const;

export interface LocalServiceConfig {
    name: string;
    command: string;
    cwd?: string;
    port?: number;
    url?: string;
    env?: Record<string, string>;
}

export interface DowntimeRuleConfig {
    pattern: string;
    reason?: string;
}

export interface FolderSettings {
    projectUuid: string;
    environment: string;
    preDeployCommand: string;
    preDeployCwd: string;
    preDeployTimeoutMinutes: number;
    mergeEnabled: boolean;
    mergeSource: string;
    mergeTarget: string;
    mergeRemote: string;
    localServices: LocalServiceConfig[];
    pendingBar: boolean;
    stopUsersCheck: boolean;
    migrationGlobs: string[];
    downtimeRules: DowntimeRuleConfig[];
}

/** What the settings page shows. Secrets are never included, only whether they are set. */
export interface ConnectionSummary {
    serverUrl: string;
    authMode: AuthMode;
    allowSelfSigned: boolean;
    timeoutSeconds: number;
    hasToken: boolean;
    hasCfClientId: boolean;
    hasCfClientSecret: boolean;
    customHeaderNames: string[];
}

export interface ConnectionUpdate {
    serverUrl: string;
    authMode: AuthMode;
    allowSelfSigned: boolean;
    timeoutSeconds?: number;
    /** undefined = keep the saved value, '' = clear it. */
    token?: string;
    cfClientId?: string;
    cfClientSecret?: string;
    /** Header name → value. A value of undefined keeps the saved value for that name. */
    customHeaders?: Record<string, string | undefined>;
}

function cfg(scope?: vscode.ConfigurationScope) {
    return vscode.workspace.getConfiguration('coolify', scope);
}

/** Settings live in settings.json; tokens and secrets live in VS Code SecretStorage (OS keychain). */
export class Settings {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;

    constructor(private readonly secrets: vscode.SecretStorage) {}

    notifyChanged(): void {
        this.changed.fire();
    }

    async connection(): Promise<ConnectionConfig | null> {
        const c = cfg();
        const serverUrl = normalizeServerUrl(c.get<string>('serverUrl') || '');
        const token = (await this.secrets.get(SECRET.token)) || '';
        if (!serverUrl || !token) return null;
        const authMode = (c.get<AuthMode>('authMode') || 'token') as AuthMode;
        return {
            serverUrl,
            authMode,
            token,
            cfClientId: (await this.secrets.get(SECRET.cfClientId)) || '',
            cfClientSecret: (await this.secrets.get(SECRET.cfClientSecret)) || '',
            customHeaders: await this.customHeaders(),
            allowSelfSigned: c.get<boolean>('allowSelfSignedCerts') === true,
            timeoutMs: Math.max(3, c.get<number>('requestTimeoutSeconds') ?? 15) * 1000,
        };
    }

    private async customHeaders(): Promise<Record<string, string>> {
        const raw = await this.secrets.get(SECRET.customHeaders);
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    async summary(): Promise<ConnectionSummary> {
        const c = cfg();
        const headers = await this.customHeaders();
        return {
            serverUrl: c.get<string>('serverUrl') || '',
            authMode: (c.get<AuthMode>('authMode') || 'token') as AuthMode,
            allowSelfSigned: c.get<boolean>('allowSelfSignedCerts') === true,
            timeoutSeconds: c.get<number>('requestTimeoutSeconds') ?? 15,
            hasToken: !!(await this.secrets.get(SECRET.token)),
            hasCfClientId: !!(await this.secrets.get(SECRET.cfClientId)),
            hasCfClientSecret: !!(await this.secrets.get(SECRET.cfClientSecret)),
            customHeaderNames: Object.keys(headers),
        };
    }

    /** Build a connection from a pending (unsaved) form, filling blanks from what is saved. */
    async draftConnection(u: ConnectionUpdate): Promise<ConnectionConfig> {
        const saved = await this.customHeaders();
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(u.customHeaders || {})) {
            const value = v === undefined ? saved[k] : v;
            if (k.trim() && value !== undefined) headers[k.trim()] = value;
        }
        const pick = async (v: string | undefined, key: string) => (v === undefined ? (await this.secrets.get(key)) || '' : v.trim());
        return {
            serverUrl: normalizeServerUrl(u.serverUrl),
            authMode: u.authMode,
            token: await pick(u.token, SECRET.token),
            cfClientId: await pick(u.cfClientId, SECRET.cfClientId),
            cfClientSecret: await pick(u.cfClientSecret, SECRET.cfClientSecret),
            customHeaders: headers,
            allowSelfSigned: u.allowSelfSigned,
            timeoutMs: Math.max(3, u.timeoutSeconds ?? cfg().get<number>('requestTimeoutSeconds') ?? 15) * 1000,
        };
    }

    async saveConnection(u: ConnectionUpdate): Promise<void> {
        const draft = await this.draftConnection(u);
        const c = cfg();
        const G = vscode.ConfigurationTarget.Global;
        await c.update('serverUrl', draft.serverUrl, G);
        await c.update('authMode', u.authMode, G);
        await c.update('allowSelfSignedCerts', u.allowSelfSigned, G);
        if (u.timeoutSeconds) await c.update('requestTimeoutSeconds', u.timeoutSeconds, G);
        await this.putSecret(SECRET.token, draft.token);
        await this.putSecret(SECRET.cfClientId, draft.cfClientId || '');
        await this.putSecret(SECRET.cfClientSecret, draft.cfClientSecret || '');
        const headers = draft.customHeaders || {};
        await this.putSecret(SECRET.customHeaders, Object.keys(headers).length ? JSON.stringify(headers) : '');
        this.changed.fire();
    }

    private async putSecret(key: string, value: string): Promise<void> {
        if (value) await this.secrets.store(key, value);
        else await this.secrets.delete(key);
    }

    async forgetCredentials(): Promise<void> {
        for (const key of Object.values(SECRET)) await this.secrets.delete(key);
        this.changed.fire();
    }

    /**
     * One-time move of credentials that older builds kept in plain settings.json
     * (`coolify.apiUrl`, `coolify.apiToken`, `coolify.cfAccessClientId/Secret`).
     * Returns what happened, so the user can be told to delete leftovers by hand.
     */
    async migrateLegacy(): Promise<{ moved: boolean; leftover: string[] }> {
        const c = cfg();
        const legacyUrl = (c.inspect<string>('apiUrl')?.globalValue || '').trim();
        const legacyToken = (c.inspect<string>('apiToken')?.globalValue || '').trim();
        const legacyCfId = (c.inspect<string>('cfAccessClientId')?.globalValue || '').trim();
        const legacyCfSecret = (c.inspect<string>('cfAccessClientSecret')?.globalValue || '').trim();
        if (!legacyUrl && !legacyToken) return { moved: false, leftover: [] };
        const G = vscode.ConfigurationTarget.Global;
        if (legacyUrl && !c.get<string>('serverUrl')) await c.update('serverUrl', normalizeServerUrl(legacyUrl), G);
        if (legacyToken && !(await this.secrets.get(SECRET.token))) await this.secrets.store(SECRET.token, legacyToken);
        if (legacyCfId && legacyCfSecret) {
            if (!(await this.secrets.get(SECRET.cfClientId))) await this.secrets.store(SECRET.cfClientId, legacyCfId);
            if (!(await this.secrets.get(SECRET.cfClientSecret))) await this.secrets.store(SECRET.cfClientSecret, legacyCfSecret);
            await c.update('authMode', 'cloudflare', G);
        }
        // Remove the plain-text copies so they stop sitting in settings.json.
        const leftover: string[] = [];
        for (const key of ['apiUrl', 'apiToken', 'cfAccessClientId', 'cfAccessClientSecret']) {
            if (c.inspect(key)?.globalValue === undefined) continue;
            try {
                await c.update(key, undefined, G);
            } catch {
                leftover.push(`coolify.${key}`); // VS Code refuses to write keys that are no longer declared
            }
        }
        this.changed.fire();
        return { moved: true, leftover };
    }

    folder(folder?: vscode.WorkspaceFolder): FolderSettings {
        const c = cfg(folder?.uri);
        const services = (c.get<LocalServiceConfig[]>('localServices') || []).filter((s) => s && s.name && s.command);
        return {
            projectUuid: (c.get<string>('projectUuid') || '').trim(),
            environment: (c.get<string>('environment') || '').trim(),
            preDeployCommand: (c.get<string>('preDeploy.command') || '').trim(),
            preDeployCwd: (c.get<string>('preDeploy.cwd') || '').trim(),
            preDeployTimeoutMinutes: c.get<number>('preDeploy.timeoutMinutes') ?? 10,
            mergeEnabled: c.get<boolean>('merge.enabled') === true,
            mergeSource: (c.get<string>('merge.sourceBranch') || 'development').trim(),
            mergeTarget: (c.get<string>('merge.targetBranch') || 'main').trim(),
            mergeRemote: (c.get<string>('merge.remote') || 'origin').trim(),
            localServices: services,
            pendingBar: c.get<boolean>('deployRisk.pendingBar') !== false,
            stopUsersCheck: c.get<boolean>('deployRisk.stopUsersCheck') !== false,
            migrationGlobs: (c.get<string[]>('deployRisk.migrationGlobs') || []).filter((g) => typeof g === 'string' && g.trim()),
            downtimeRules: (c.get<DowntimeRuleConfig[]>('deployRisk.downtimeRules') || []).filter((r) => r && typeof r.pattern === 'string' && r.pattern.trim()),
        };
    }

    refreshIntervalMs(): number {
        return Math.max(10, cfg().get<number>('refreshIntervalSeconds') ?? 30) * 1000;
    }

    statusBarEnabled(): boolean {
        return cfg().get<boolean>('statusBar.enabled') !== false;
    }

    confirmDeploy(): boolean {
        return cfg().get<boolean>('confirmDeploy') !== false;
    }
}

/** The folder whose project the dashboard shows: active editor's folder, else the first one. */
export function activeFolder(): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return undefined;
    if (folders.length === 1) return folders[0];
    const uri = vscode.window.activeTextEditor?.document.uri;
    const fromEditor = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    return fromEditor || folders[0];
}
