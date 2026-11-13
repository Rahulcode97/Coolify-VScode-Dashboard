import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
    CoolifyDeployment,
    CoolifyEnvironment,
    CoolifyProject,
    CoolifyResource,
    DeployResult,
    ResourceKind,
} from './types';

export type AuthMode = 'token' | 'cloudflare' | 'headers';

export interface ConnectionConfig {
    /** Base address as typed by the user. Normalised with {@link normalizeServerUrl}. */
    serverUrl: string;
    authMode: AuthMode;
    token: string;
    cfClientId?: string;
    cfClientSecret?: string;
    customHeaders?: Record<string, string>;
    allowSelfSigned?: boolean;
    timeoutMs?: number;
}

/** An API failure with a plain-language hint about how to fix it. */
export class CoolifyApiError extends Error {
    constructor(
        message: string,
        public readonly hint: string,
        public readonly status?: number,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'CoolifyApiError';
    }
}

/**
 * Turn whatever the user typed into a clean base URL.
 *  - adds a scheme (http for localhost / private IPs, https otherwise)
 *  - drops a trailing slash and a pasted `/api/v1` suffix
 *  - drops paths that come from copying a Coolify page URL (`/project/...`)
 */
export function normalizeServerUrl(input: string): string {
    let v = String(input || '').trim();
    if (!v) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
        const host = v.split(/[/:]/)[0].toLowerCase();
        v = (isLocalHost(host) ? 'http://' : 'https://') + v;
    }
    let u: URL;
    try {
        u = new URL(v);
    } catch {
        return v.replace(/\/+$/, '');
    }
    let p = u.pathname.replace(/\/+$/, '');
    p = p.replace(/\/api(\/v1)?$/i, '');
    // Pasted a page URL like /project/<uuid>/environment/<uuid> or /dashboard.
    p = p.replace(/\/(project|projects|dashboard|security|settings|servers|team)(\/.*)?$/i, '');
    return `${u.protocol}//${u.host}${p}`;
}

function isLocalHost(host: string): boolean {
    return (
        host === 'localhost' ||
        host.endsWith('.local') ||
        host.endsWith('.localhost') ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        host === '[::1]'
    );
}

const FORBIDDEN_HEADER_NAMES = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);

/** Headers for a request, given the connection settings. Never logs or returns secrets elsewhere. */
export function buildHeaders(cfg: Pick<ConnectionConfig, 'authMode' | 'token' | 'cfClientId' | 'cfClientSecret' | 'customHeaders'>): Record<string, string> {
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'coolify-vscode-dashboard',
    };
    if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token.trim()}`;
    if (cfg.authMode === 'cloudflare' && cfg.cfClientId && cfg.cfClientSecret) {
        headers['CF-Access-Client-Id'] = cfg.cfClientId.trim();
        headers['CF-Access-Client-Secret'] = cfg.cfClientSecret.trim();
    }
    if (cfg.authMode === 'headers' && cfg.customHeaders) {
        for (const [rawName, value] of Object.entries(cfg.customHeaders)) {
            const name = rawName.trim();
            if (!name || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) continue;
            if (FORBIDDEN_HEADER_NAMES.has(name.toLowerCase())) continue;
            headers[name] = String(value ?? '');
        }
    }
    return headers;
}

interface RawResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
}

/** Explain a network-level error in words a user can act on. */
export function explainNetworkError(err: any, serverUrl: string): CoolifyApiError {
    const code: string = err?.code || '';
    let host = serverUrl;
    try {
        host = new URL(serverUrl).host;
    } catch {
        /* keep raw */
    }
    switch (code) {
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return new CoolifyApiError(`Can't find the server "${host}".`, 'Check the Server URL for typos. If it only works on your VPN or LAN, connect to it first.', undefined, code);
        case 'ECONNREFUSED':
            return new CoolifyApiError(`Connection refused by ${host}.`, 'Coolify is not listening there. Check the port (a fresh Coolify install uses :8000) and that the server is running.', undefined, code);
        case 'ECONNRESET':
        case 'EPIPE':
            return new CoolifyApiError(`The connection to ${host} was reset.`, 'A proxy or firewall closed the connection. Try again, and check any proxy in front of Coolify.', undefined, code);
        case 'ETIMEDOUT':
        case 'ESOCKETTIMEDOUT':
        case 'TIMEOUT':
            return new CoolifyApiError(`${host} did not answer in time.`, 'The server is slow or unreachable. Check the URL, your network, or raise "Request timeout" in settings.', undefined, code);
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
        case 'CERT_HAS_EXPIRED':
        case 'ERR_TLS_CERT_ALTNAME_INVALID':
            return new CoolifyApiError(`The HTTPS certificate of ${host} is not trusted (${code}).`, 'Use a valid certificate, or turn on "Allow self-signed certificates" in Coolify settings if you control this server.', undefined, code);
        case 'EPROTO':
        case 'ERR_SSL_WRONG_VERSION_NUMBER':
            return new CoolifyApiError(`HTTPS handshake with ${host} failed.`, 'The server may only speak plain HTTP. Try "http://" in the Server URL.', undefined, code);
        default:
            return new CoolifyApiError(`Request to ${host} failed: ${err?.message || err}`, 'Check the Server URL and your network connection.', undefined, code || undefined);
    }
}

/** Explain a non-2xx HTTP response. */
export function explainHttpError(res: RawResponse, authMode: AuthMode): CoolifyApiError {
    const status = res.status;
    const location = String(res.headers['location'] || '');
    const contentType = String(res.headers['content-type'] || '');
    let apiMessage = '';
    try {
        const parsed = JSON.parse(res.body);
        apiMessage = String(parsed?.message || parsed?.error || '');
    } catch {
        /* not JSON */
    }

    if (status >= 300 && status < 400) {
        if (/cloudflareaccess\.com|cdn-cgi\/access/i.test(location)) {
            return new CoolifyApiError(
                'Cloudflare Access redirected the request to its login page.',
                authMode === 'cloudflare'
                    ? 'The service token was not accepted. Check the Client ID/Secret, and that the Access application has a policy with action "Service Auth" that includes this token.'
                    : 'Your Coolify is behind Cloudflare Access. Choose "Cloudflare Access" as the connection type and add a service token.',
                status,
            );
        }
        return new CoolifyApiError(`The server redirected to ${location || 'another page'}.`, 'Check the Server URL: use the exact address Coolify runs at (including https:// if it uses HTTPS).', status);
    }
    if (status === 401) {
        return new CoolifyApiError('The API token was rejected (401).', 'Create a new token in Coolify → Keys & Tokens → API Tokens and paste it in the extension settings. Tokens are shown only once and expire (30 days by default).', status);
    }
    if (status === 403) {
        if (/api is disabled|not allowed to access the api/i.test(apiMessage)) {
            return new CoolifyApiError('The Coolify API is turned off on this server (403).', 'In Coolify open Settings → Advanced and set "API access" to Enabled (or click "Enable API Access" on Keys & Tokens → API Tokens). If "Allowed IPs" is filled in there, your IP must be in it.', status);
        }
        if (/cloudflare/i.test(String(res.headers['server'] || '')) || /cf-ray/i.test(Object.keys(res.headers).join(' '))) {
            if (!/json/i.test(contentType)) {
                return new CoolifyApiError('Cloudflare blocked the request (403).', authMode === 'cloudflare' ? 'Check the service token and that the Access policy uses action "Service Auth".' : 'If Coolify is behind Cloudflare Access, choose "Cloudflare Access" as the connection type and add a service token.', status);
            }
        }
        return new CoolifyApiError(`Permission denied (403)${apiMessage ? `: ${apiMessage}` : ''}.`, 'The token is missing a permission, or your IP is not in Coolify\'s "Allowed IPs". Create a token with Read and Deploy (add Write for start/stop/restart).', status);
    }
    if (status === 404) {
        return new CoolifyApiError(`Not found (404)${apiMessage ? `: ${apiMessage}` : ''}.`, 'Check the Server URL. It should be the address of Coolify itself, not of one of your apps.', status);
    }
    if (status === 429) {
        return new CoolifyApiError('Too many requests (429).', 'Coolify rate-limited the extension. Raise the refresh interval in settings.', status);
    }
    if (status >= 500) {
        return new CoolifyApiError(`Coolify had a server error (${status})${apiMessage ? `: ${apiMessage}` : ''}.`, 'Check that Coolify is healthy; it may be updating or restarting.', status);
    }
    return new CoolifyApiError(`Request failed (${status})${apiMessage ? `: ${apiMessage}` : ''}.`, 'Check the Server URL and token.', status);
}

/** Small dependency-free client for the Coolify v4 REST API. */
export class CoolifyClient {
    private readonly base: string;
    private readonly headers: Record<string, string>;
    private readonly agent?: https.Agent;

    constructor(private readonly cfg: ConnectionConfig) {
        this.base = normalizeServerUrl(cfg.serverUrl);
        if (!this.base) throw new CoolifyApiError('No Coolify server URL is set.', 'Open Coolify settings and enter the address you open Coolify at.');
        if (!cfg.token) throw new CoolifyApiError('No Coolify API token is saved.', 'Open Coolify settings and paste an API token (Coolify → Keys & Tokens → API Tokens).');
        this.headers = buildHeaders(cfg);
        if (this.base.startsWith('https:') && cfg.allowSelfSigned) {
            this.agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
        }
    }

    get serverUrl(): string {
        return this.base;
    }

    private raw(method: string, path: string, body?: unknown): Promise<RawResponse> {
        const url = new URL(this.base + '/api/v1' + path);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const headers: Record<string, string> = { ...this.headers };
        if (payload !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = String(Buffer.byteLength(payload));
        }
        const timeout = this.cfg.timeoutMs ?? 15000;
        return new Promise((resolve, reject) => {
            const req = lib.request(
                url,
                { method, headers, agent: isHttps ? this.agent : undefined, timeout },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (c: Buffer) => chunks.push(c));
                    res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
                    res.on('error', (e) => reject(explainNetworkError(e, this.base)));
                },
            );
            req.on('timeout', () => {
                req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
            });
            req.on('error', (e) => reject(explainNetworkError(e, this.base)));
            if (payload !== undefined) req.write(payload);
            req.end();
        });
    }

    /** Make a request and parse JSON. Non-JSON 2xx bodies are returned as strings. */
    async request<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
        const res = await this.raw(method, path, body);
        if (res.status < 200 || res.status >= 300) throw explainHttpError(res, this.cfg.authMode);
        const text = res.body;
        const contentType = String(res.headers['content-type'] || '');
        if (/text\/html/i.test(contentType) && /<html/i.test(text)) {
            throw new CoolifyApiError('The server answered with a web page instead of the Coolify API.', 'Check the Server URL. A proxy or login page may be in front of Coolify; if it is Cloudflare Access, choose "Cloudflare Access" as the connection type.', res.status);
        }
        if (!text) return undefined as T;
        try {
            return JSON.parse(text) as T;
        } catch {
            return text as unknown as T;
        }
    }

    async version(): Promise<string> {
        const v = await this.request<unknown>('GET', '/version');
        return String(typeof v === 'string' ? v : (v as any)?.version ?? v).trim();
    }

    async listProjects(): Promise<CoolifyProject[]> {
        return asArray<CoolifyProject>(await this.request('GET', '/projects'));
    }

    /** Environments of a project. Uses the project detail (one call) and falls back to /environments. */
    async getProjectEnvironments(projectUuid: string): Promise<CoolifyEnvironment[]> {
        const id = encodeURIComponent(projectUuid);
        try {
            const detail = await this.request<any>('GET', `/projects/${id}`);
            if (Array.isArray(detail?.environments) && detail.environments.length) return detail.environments;
        } catch (e) {
            if (e instanceof CoolifyApiError && e.status && e.status !== 404 && e.status !== 400) throw e;
        }
        return asArray<CoolifyEnvironment>(await this.request('GET', `/projects/${id}/environments`));
    }

    async listResources(): Promise<CoolifyResource[]> {
        return asArray<CoolifyResource>(await this.request('GET', '/resources'));
    }

    async listApplicationDeployments(appUuid: string, take = 5): Promise<CoolifyDeployment[]> {
        const res = await this.request<any>('GET', `/deployments/applications/${encodeURIComponent(appUuid)}?skip=0&take=${take}`);
        const list = Array.isArray(res) ? res : Array.isArray(res?.deployments) ? res.deployments : Array.isArray(res?.data) ? res.data : [];
        return list.map(normalizeDeployment);
    }

    async getDeployment(deploymentUuid: string): Promise<CoolifyDeployment> {
        return normalizeDeployment(await this.request<any>('GET', `/deployments/${encodeURIComponent(deploymentUuid)}`));
    }

    async cancelDeployment(deploymentUuid: string): Promise<void> {
        await this.request('POST', `/deployments/${encodeURIComponent(deploymentUuid)}/cancel`);
    }

    async applicationLogs(appUuid: string, lines = 200): Promise<string> {
        const res = await this.request<any>('GET', `/applications/${encodeURIComponent(appUuid)}/logs?lines=${lines}`);
        return typeof res === 'string' ? res : String(res?.logs ?? '');
    }

    /** Queue a deployment. Uses POST: never GET /deploy (Coolify treats that as "deploy now" too). */
    async deploy(uuid: string, force = false): Promise<DeployResult[]> {
        const res = await this.request<any>('POST', `/deploy?uuid=${encodeURIComponent(uuid)}&force=${force ? 'true' : 'false'}`);
        return Array.isArray(res?.deployments) ? res.deployments : [];
    }

    async lifecycle(kind: ResourceKind, uuid: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
        const collection = kind === 'application' ? 'applications' : kind === 'service' ? 'services' : 'databases';
        const path = `/${collection}/${encodeURIComponent(uuid)}/${action}`;
        try {
            await this.request('POST', path);
        } catch (e) {
            // Older Coolify v4 builds only accept GET here.
            if (e instanceof CoolifyApiError && e.status === 405) await this.request('GET', path);
            else throw e;
        }
    }
}

function asArray<T>(v: any): T[] {
    if (Array.isArray(v)) return v;
    if (Array.isArray(v?.data)) return v.data;
    return [];
}

export function normalizeDeployment(raw: any): CoolifyDeployment {
    return {
        ...raw,
        deployment_uuid: String(raw?.deployment_uuid || raw?.uuid || raw?.id || ''),
        status: String(raw?.status || 'unknown'),
    };
}
