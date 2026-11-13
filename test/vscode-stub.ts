// Minimal stand-in for the `vscode` module so pure modules can be imported in unit tests.
export const workspace = { getConfiguration: () => ({ get: () => undefined, inspect: () => undefined, update: async () => undefined }), workspaceFolders: undefined };
export const window = {};
export class EventEmitter<T> {
    private listeners: ((e: T) => void)[] = [];
    event = (l: (e: T) => void) => {
        this.listeners.push(l);
        return { dispose: () => undefined };
    };
    fire(e: T) {
        this.listeners.forEach((l) => l(e));
    }
    dispose() {}
}
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
