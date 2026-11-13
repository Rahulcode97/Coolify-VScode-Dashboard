/** Shapes returned by the Coolify v4 API (only the fields this extension uses). */

export type ResourceKind = 'application' | 'service' | 'database';

export interface CoolifyProject {
    id?: number;
    uuid: string;
    name: string;
    description?: string | null;
}

export interface CoolifyEnvironment {
    id: number;
    uuid?: string;
    name: string;
    project_id?: number;
}

/** One row of `GET /resources` (applications, services and standalone databases). */
export interface CoolifyResource {
    uuid: string;
    name: string;
    /** `application`, `service`, or `standalone-<engine>` for databases. */
    type: string;
    status?: string;
    environment_id?: number;
    description?: string | null;
    fqdn?: string | null;
    git_repository?: string | null;
    git_branch?: string | null;
    created_at?: string;
    updated_at?: string;
    [key: string]: unknown;
}

export interface CoolifyDeployment {
    id?: number;
    deployment_uuid: string;
    application_id?: number | string;
    application_name?: string;
    status: string;
    commit?: string | null;
    commit_message?: string | null;
    is_webhook?: boolean;
    is_api?: boolean;
    force_rebuild?: boolean;
    created_at?: string;
    updated_at?: string;
    /** JSON string with an array of log entries (only on some endpoints). */
    logs?: string | null;
    deployment_url?: string | null;
    pull_request_id?: number;
}

export interface DeployResult {
    message?: string;
    resource_uuid?: string;
    deployment_uuid?: string;
}

export function resourceKind(r: Pick<CoolifyResource, 'type'>): ResourceKind {
    const t = String(r.type || '').toLowerCase();
    if (t === 'application') return 'application';
    if (t === 'service') return 'service';
    return 'database';
}
