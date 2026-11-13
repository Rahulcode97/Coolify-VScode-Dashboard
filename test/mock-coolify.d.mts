export const TOKEN: string;
export const CF_ID: string;
export const CF_SECRET: string;
export function seed(): any;
export function createMockCoolify(opts?: { requireCf?: boolean; version?: string; data?: any; liveDeployTicks?: number; repo?: string; deployedCommit?: string; failUuids?: string[] }): {
    server: import('http').Server;
    data: any;
    listen(port?: number): Promise<string>;
    close(): Promise<void>;
};
