import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { LocalServiceConfig } from './config';

export type LocalStatus = 'running' | 'starting' | 'stopped';

export interface LocalServiceState {
    name: string;
    command: string;
    port?: number;
    url: string;
    status: LocalStatus;
    hasTerminal: boolean;
}

/** One TCP connect to localhost: cheap, and no HTTP noise in the service's logs. */
export function isPortOpen(port: number, timeoutMs = 400): Promise<boolean> {
    const tryHost = (host: string) =>
        new Promise<boolean>((resolve) => {
            const socket = net.connect({ port, host });
            const finish = (ok: boolean) => {
                socket.destroy();
                resolve(ok);
            };
            socket.setTimeout(timeoutMs, () => finish(false));
            socket.once('connect', () => finish(true));
            socket.once('error', () => finish(false));
        });
    return tryHost('127.0.0.1').then((ok) => ok || tryHost('::1'));
}

/** Starts user-defined local dev servers in named terminals and reports whether they are up. */
export class LocalServices implements vscode.Disposable {
    private terminals = new Map<string, vscode.Terminal>();
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            vscode.window.onDidCloseTerminal((t) => {
                for (const [k, v] of this.terminals) if (v === t) this.terminals.delete(k);
            }),
        );
    }

    private terminalName(s: LocalServiceConfig): string {
        return `Local · ${s.name}`;
    }

    private find(s: LocalServiceConfig): vscode.Terminal | undefined {
        return this.terminals.get(s.name) || vscode.window.terminals.find((t) => t.name === this.terminalName(s));
    }

    urlFor(s: LocalServiceConfig): string {
        if (s.url) return s.url;
        return s.port ? `http://localhost:${s.port}` : '';
    }

    async status(services: LocalServiceConfig[]): Promise<LocalServiceState[]> {
        return Promise.all(
            services.map(async (s) => {
                const term = this.find(s);
                const up = s.port ? await isPortOpen(s.port) : false;
                const status: LocalStatus = up ? 'running' : term ? (s.port ? 'starting' : 'running') : 'stopped';
                return { name: s.name, command: s.command, port: s.port, url: this.urlFor(s), status, hasTerminal: !!term };
            }),
        );
    }

    start(folder: vscode.WorkspaceFolder, s: LocalServiceConfig): void {
        const existing = this.find(s);
        if (existing) {
            existing.show(true);
            return;
        }
        const cwd = s.cwd ? (path.isAbsolute(s.cwd) ? s.cwd : path.join(folder.uri.fsPath, s.cwd)) : folder.uri.fsPath;
        const term = vscode.window.createTerminal({ name: this.terminalName(s), cwd, env: s.env, iconPath: new vscode.ThemeIcon('server-process') });
        this.terminals.set(s.name, term);
        term.show(true);
        term.sendText(s.command, true);
    }

    stop(s: LocalServiceConfig): void {
        const term = this.find(s);
        term?.dispose();
        this.terminals.delete(s.name);
    }

    show(s: LocalServiceConfig): boolean {
        const term = this.find(s);
        term?.show(true);
        return !!term;
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}
