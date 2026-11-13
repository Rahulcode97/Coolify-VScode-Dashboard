/**
 * Decides when a pending deploy should wait until people stop using the app.
 *
 * A rolling deploy keeps the old container serving while the new one starts and
 * runs its migrations. Some SQL takes locks or changes the schema under the old
 * container, so users see errors or hanging requests. This module looks at the
 * migration files that are NEW since the deployed commit (applied ones never run
 * again) and at user-defined "needs downtime" file patterns.
 *
 * No VS Code imports: everything here is unit-tested.
 */

export interface StopUserFinding {
    id: string;
    file: string;
    /** Short label shown under the app row. */
    summary: string;
    /** Why this deploy needs downtime, shown on hover. */
    detail: string;
}

export interface DowntimeRule {
    pattern: string;
    reason?: string;
}

export const DEFAULT_MIGRATION_GLOBS = [
    '**/migrations/**/*.sql',
    '**/migrate/**/*.sql',
    '**/db/migrate/**/*.sql',
    'prisma/migrations/**/migration.sql',
    'supabase/migrations/*.sql',
    'drizzle/**/*.sql',
];

/** Put this comment anywhere in a migration to tell the checker it is safe. */
export const SAFE_MARKER = /--\s*coolify:\s*safe\b/i;

const MAX_FINDINGS = 12;

// ---- Globs -----------------------------------------------------------------

const globCache = new Map<string, RegExp>();

/** Minimal glob → RegExp: `**` any depth, `*` within a segment, `?` one char. Patterns without `/` match the file name anywhere. */
export function globToRegExp(pattern: string): RegExp {
    const key = pattern;
    const hit = globCache.get(key);
    if (hit) return hit;
    let p = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    if (!p.includes('/')) p = '**/' + p;
    let re = '';
    for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === '*') {
            if (p[i + 1] === '*') {
                i++;
                if (p[i + 1] === '/') {
                    i++;
                    re += '(?:.*/)?';
                } else {
                    re += '.*';
                }
            } else {
                re += '[^/]*';
            }
        } else if (c === '?') {
            re += '[^/]';
        } else {
            re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    const rx = new RegExp('^' + re + '$', 'i');
    globCache.set(key, rx);
    return rx;
}

export function matchesAny(file: string, patterns: string[]): boolean {
    const f = file.replace(/\\/g, '/').replace(/^\.?\//, '');
    return patterns.some((p) => p && globToRegExp(p).test(f));
}

/** Findings for changed files that match the user's "needs downtime" rules. */
export function ruleFindings(files: string[], rules: DowntimeRule[]): StopUserFinding[] {
    const out: StopUserFinding[] = [];
    for (const rule of rules) {
        if (!rule?.pattern) continue;
        for (const f of files) {
            if (!matchesAny(f, [rule.pattern])) continue;
            out.push({
                id: 'rule',
                file: f,
                summary: rule.reason || `matches downtime rule ${rule.pattern}`,
                detail: `${f} matches your downtime rule "${rule.pattern}"${rule.reason ? ` (${rule.reason})` : ''}. Stop users before this deploy.`,
            });
            if (out.length >= MAX_FINDINGS) return out;
        }
    }
    return out;
}

// ---- SQL parsing --------------------------------------------------------------

function baseName(file: string): string {
    const parts = file.split(/[/\\]/);
    return parts[parts.length - 1] || file;
}

function finding(file: string, id: string, summary: string, detail: string): StopUserFinding {
    return { id, file, summary, detail };
}

function ident(raw: string): string {
    const cleaned = raw.replace(/["`[\]]/g, '');
    const parts = cleaned.split('.');
    return (parts[parts.length - 1] || cleaned).toLowerCase();
}

/** Drop comments while keeping semicolons that sit inside strings or dollar quotes. */
export function stripSqlComments(sql: string): string {
    let out = '';
    let i = 0;
    let quote = false;
    let dollar: string | null = null;
    while (i < sql.length) {
        if (dollar) {
            if (sql.startsWith(dollar, i)) {
                out += dollar;
                i += dollar.length;
                dollar = null;
                continue;
            }
            out += sql[i++];
            continue;
        }
        if (quote) {
            out += sql[i];
            if (sql[i] === "'" && sql[i + 1] === "'") out += sql[++i];
            else if (sql[i] === "'") quote = false;
            i++;
            continue;
        }
        if (sql[i] === "'") {
            quote = true;
            out += sql[i++];
            continue;
        }
        const marker = sql.slice(i, i + 64).match(/^\$[A-Za-z0-9_]*\$/);
        if (marker) {
            dollar = marker[0];
            out += dollar;
            i += dollar.length;
            continue;
        }
        if (sql[i] === '-' && sql[i + 1] === '-') {
            i += 2;
            while (i < sql.length && sql[i] !== '\n') i++;
            continue;
        }
        if (sql[i] === '/' && sql[i + 1] === '*') {
            i += 2;
            while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        out += sql[i++];
    }
    return out;
}

/** Split into statements on `;`, ignoring semicolons in strings and dollar-quoted bodies. */
export function splitSqlStatements(sql: string): string[] {
    const src = stripSqlComments(sql);
    const parts: string[] = [];
    let cur = '';
    let i = 0;
    let quote = false;
    let dollar: string | null = null;
    while (i < src.length) {
        if (dollar) {
            if (src.startsWith(dollar, i)) {
                cur += dollar;
                i += dollar.length;
                dollar = null;
                continue;
            }
            cur += src[i++];
            continue;
        }
        if (quote) {
            cur += src[i];
            if (src[i] === "'" && src[i + 1] === "'") cur += src[++i];
            else if (src[i] === "'") quote = false;
            i++;
            continue;
        }
        if (src[i] === "'") {
            quote = true;
            cur += src[i++];
            continue;
        }
        const marker = src.slice(i, i + 64).match(/^\$[A-Za-z0-9_]*\$/);
        if (marker) {
            dollar = marker[0];
            cur += dollar;
            i += dollar.length;
            continue;
        }
        if (src[i] === ';') {
            const stmt = cur.trim();
            if (stmt) parts.push(stmt);
            cur = '';
            i++;
            continue;
        }
        cur += src[i++];
    }
    const last = cur.trim();
    if (last) parts.push(last);
    return parts;
}

function splitCommaList(body: string): string[] {
    const parts: string[] = [];
    let cur = '';
    let depth = 0;
    let quote = false;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (quote) {
            cur += c;
            if (c === "'" && body[i + 1] === "'") cur += body[++i];
            else if (c === "'") quote = false;
            continue;
        }
        if (c === "'") {
            quote = true;
            cur += c;
            continue;
        }
        if (c === '(') depth++;
        if (c === ')') depth = Math.max(0, depth - 1);
        if (c === ',' && depth === 0) {
            if (cur.trim()) parts.push(cur.trim());
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
}

const NAME = '("[^"]+"|`[^`]+`|[\\w.]+)';

function createdTableName(stmt: string): string | null {
    if (/^CREATE\s+(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\b/i.test(stmt)) return null;
    const m = stmt.match(new RegExp(`^CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:ONLY\\s+)?${NAME}`, 'i'));
    return m ? ident(m[1]) : null;
}

function dollarBody(stmt: string): string | null {
    const m = stmt.match(/\$([A-Za-z0-9_]*)\$([\s\S]*)\$\1\$/);
    return m ? m[2] : null;
}

function lockDetail(file: string, table: string, what: string): string {
    return `${what} in ${baseName(file)} locks ${table} while the current version of the app is still serving, so its requests wait or fail. Stop users before this deploy.`;
}

function isConstantDefault(expr: string): boolean {
    const stripped = expr.replace(/::[\w."[\]]+/g, '').trim();
    if (/^(null|true|false)$/i.test(stripped)) return true;
    if (/^-?\d+(\.\d+)?$/.test(stripped)) return true;
    if (/^'(?:[^']|'')*'$/.test(stripped)) return true;
    return false;
}

function defaultExpr(rest: string): string | null {
    const m = rest.match(/\bDEFAULT\s+([\s\S]+)/i);
    if (!m) return null;
    return m[1].replace(/\s+(NOT\s+NULL|NULL|CHECK|UNIQUE|REFERENCES|PRIMARY|CONSTRAINT|COLLATE)\b[\s\S]*$/i, '').trim();
}

function classifyAddColumn(file: string, table: string, action: string): StopUserFinding | null {
    const m = action.match(new RegExp(`^ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}\\s+([\\s\\S]+)$`, 'i'));
    if (!m) return null;
    const column = ident(m[1]);
    const rest = m[2];
    const expr = defaultExpr(rest);
    const notNull = /\bNOT\s+NULL\b/i.test(rest);
    if (expr && !isConstantDefault(expr)) {
        return finding(file, 'volatile-default', `Adding ${table}.${column} rewrites every row`, `${baseName(file)} adds ${column} with DEFAULT ${expr}. A non-constant default makes the database rewrite ${table} under an exclusive lock. Stop users before this deploy.`);
    }
    if (notNull && !expr) {
        return finding(file, 'add-not-null', `Adding ${table}.${column} NOT NULL locks the table`, `${baseName(file)} adds ${column} as NOT NULL without a default. On a table with rows this fails or locks the table, and the running app does not write the new column. Stop users before this deploy.`);
    }
    return null;
}

function classifyAlterAction(file: string, table: string, action: string): StopUserFinding | null {
    const name = baseName(file);
    if (/^ADD\s+(?:COLUMN\b|IF\s+NOT\s+EXISTS\b|"?[a-z_])/i.test(action) && !/^ADD\s+(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|INDEX|KEY)\b/i.test(action)) {
        return classifyAddColumn(file, table, action);
    }
    if (/^DROP\s+(?:COLUMN\b)/i.test(action)) {
        const col = action.match(new RegExp(`^DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${NAME}`, 'i'));
        const column = col ? ident(col[1]) : 'a column';
        return finding(file, 'drop-column', `Dropping ${table}.${column} breaks the app still serving`, `${name} drops ${table}.${column}. The old container still reads that column, so its requests start failing as soon as the migration commits. Stop users before this deploy.`);
    }
    if (/^RENAME\b/i.test(action) || /^CHANGE\s+(COLUMN\s+)?/i.test(action)) {
        return finding(file, 'rename', `Renaming in ${table} breaks the app still serving`, `${name} renames something in ${table} (${action.slice(0, 80)}). The old container still uses the old name. Stop users before this deploy.`);
    }
    if ((/^ALTER\s+COLUMN\b/i.test(action) && (/\bTYPE\b/i.test(action) || /\bUSING\b/i.test(action))) || /^MODIFY\s+(COLUMN\s+)?/i.test(action)) {
        return finding(file, 'alter-type', `Changing a ${table} column type rewrites the table`, `${name} changes a column type on ${table} (${action.slice(0, 80)}). That usually rewrites the table under an exclusive lock. Stop users before this deploy.`);
    }
    if (/^ALTER\s+COLUMN\b/i.test(action) && /\bSET\s+NOT\s+NULL\b/i.test(action)) {
        return finding(file, 'set-not-null', `SET NOT NULL scans ${table} under a lock`, `${name} sets a ${table} column NOT NULL. The database scans every row while holding a lock that blocks writes. Stop users before this deploy.`);
    }
    if (/^ADD\s+(CONSTRAINT\b|FOREIGN\s+KEY|CHECK|UNIQUE|PRIMARY\s+KEY)/i.test(action) && !/\bNOT\s+VALID\b/i.test(action)) {
        return finding(file, 'add-constraint', `New constraint on ${table} scans existing rows`, `${name} adds a constraint on ${table} and checks every existing row under a lock. Stop users before this deploy, or add it NOT VALID and validate later.`);
    }
    if (/^VALIDATE\s+CONSTRAINT\b/i.test(action)) {
        return finding(file, 'validate-constraint', `Validating a constraint scans ${table}`, `${name} validates a constraint on ${table}. The scan holds a lock for the length of the check. Stop users before this deploy.`);
    }
    if (/^(ATTACH|DETACH)\s+PARTITION\b/i.test(action)) {
        return finding(file, 'partition', `Partition change locks ${table}`, `${name} attaches or detaches a partition of ${table}, which locks the parent table. Stop users before this deploy.`);
    }
    if (/^DISABLE\s+TRIGGER\b/i.test(action) || /^SET\s+SCHEMA\b/i.test(action)) {
        return finding(file, 'alter-other', `ALTER on ${table} changes how the running app writes`, `${name} runs "${action.slice(0, 80)}" on ${table}. The old container expects the old behaviour. Stop users before this deploy.`);
    }
    return null;
}

function classifyStatement(file: string, stmt: string, created: Set<string>, out: StopUserFinding[], depth: number): void {
    if (out.length >= MAX_FINDINGS) return;
    const isNew = (t: string) => created.has(t.toLowerCase());
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER|VIEW)\b/i.test(stmt)) return;
    if (/^DO\b/i.test(stmt)) {
        const body = dollarBody(stmt);
        if (body && depth < 3) walkSql(file, body, created, out, depth + 1);
        return;
    }
    if (/^CREATE\s+[\s\S]*\bTABLE\b[\s\S]*\bAS\s+SELECT\b/i.test(stmt)) {
        out.push(finding(file, 'create-table-as', 'CREATE TABLE AS SELECT copies live rows', `${baseName(file)} builds a table from a SELECT, reading and locking the source rows while the current app is serving. Stop users before this deploy.`));
        return;
    }
    const partOf = stmt.match(new RegExp(`\\bPARTITION\\s+OF\\s+${NAME}`, 'i'));
    const newName = createdTableName(stmt);
    if (newName) {
        if (partOf) {
            const parent = ident(partOf[1]);
            out.push(finding(file, 'partition', `New partition locks ${parent}`, `${baseName(file)} creates a partition of ${parent}, which locks the parent table. Stop users before this deploy.`));
        }
        created.add(newName);
        return;
    }
    if (/^ALTER\s+TYPE\b/i.test(stmt) && /\b(RENAME\s+VALUE|DROP\s+VALUE)\b/i.test(stmt)) {
        out.push(finding(file, 'enum-rename', 'Renaming an enum value breaks the app still serving', `${baseName(file)} renames or drops an enum value that existing rows and the old container still use. Stop users before this deploy.`));
        return;
    }
    const index = stmt.match(new RegExp(`^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${NAME}\\s+)?ON\\s+(?:ONLY\\s+)?${NAME}`, 'i'));
    if (index) {
        const table = ident(index[4]);
        if (index[2] || isNew(table)) return;
        out.push(finding(file, 'create-index', `CREATE INDEX locks writes on ${table}`, lockDetail(file, table, 'The index build') + ' Use CREATE INDEX CONCURRENTLY (outside a transaction) to avoid it.'));
        return;
    }
    if (/^DROP\s+TABLE\b/i.test(stmt)) {
        const m = stmt.match(new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${NAME}`, 'i'));
        const table = m ? ident(m[1]) : '';
        if (table && isNew(table)) return;
        out.push(finding(file, 'drop-table', `DROP TABLE ${table} removes data the app still reads`.replace('  ', ' '), `${baseName(file)} drops ${table || 'a table'}. The old container still queries it. Stop users before this deploy.`));
        return;
    }
    if (/^ALTER\s+TABLE\b/i.test(stmt)) {
        const m = stmt.match(new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${NAME}\\s+([\\s\\S]+)$`, 'i'));
        if (!m) return;
        const table = ident(m[1]);
        if (isNew(table)) return;
        for (const action of splitCommaList(m[2])) {
            if (out.length >= MAX_FINDINGS) return;
            const hit = classifyAlterAction(file, table, action.trim());
            if (hit) out.push(hit);
        }
        return;
    }
    if (/^RENAME\s+TABLE\b/i.test(stmt)) {
        out.push(finding(file, 'rename', 'Renaming a table breaks the app still serving', `${baseName(file)} renames a table the old container still uses. Stop users before this deploy.`));
        return;
    }
    if (/^LOCK\s+TABLE/i.test(stmt)) {
        const m = stmt.match(new RegExp(`^LOCK\\s+TABLES?\\s+(?:ONLY\\s+)?${NAME}`, 'i'));
        const table = m ? ident(m[1]) : 'a table';
        out.push(finding(file, 'lock-table', `LOCK TABLE ${table}`, lockDetail(file, table, 'An explicit LOCK TABLE')));
        return;
    }
    if (/^REINDEX\b/i.test(stmt) && !/\bCONCURRENTLY\b/i.test(stmt)) {
        out.push(finding(file, 'reindex', 'REINDEX locks writes', `${baseName(file)} rebuilds an index while the current app is serving; writes wait until it finishes. Stop users before this deploy.`));
        return;
    }
    if (/^CLUSTER\b/i.test(stmt) || /^VACUUM\s+FULL\b/i.test(stmt)) {
        out.push(finding(file, 'rewrite', 'Table rewrite under an exclusive lock', `${baseName(file)} runs ${stmt.split(/\s+/).slice(0, 2).join(' ')}, which rewrites a table under an exclusive lock. Stop users before this deploy.`));
        return;
    }
    if (/^REFRESH\s+MATERIALIZED\s+VIEW\b/i.test(stmt) && !/\bCONCURRENTLY\b/i.test(stmt)) {
        out.push(finding(file, 'refresh-view', 'Refreshing a materialized view blocks reads', `${baseName(file)} refreshes a materialized view; queries against it wait until the refresh finishes. Stop users before this deploy.`));
        return;
    }
    if (/^(WITH\b[\s\S]*)?INSERT\s+INTO\b/i.test(stmt)) {
        const m = stmt.match(new RegExp(`\\bINSERT\\s+INTO\\s+${NAME}`, 'i'));
        const table = m ? ident(m[1]) : '';
        if (!table || isNew(table)) return;
        const backfill = /\bSELECT\b/i.test(stmt) || /\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b/i.test(stmt);
        if (!backfill) return; // plain seed rows are fine
        out.push(finding(file, 'insert-backfill', `Backfilling ${table} during the deploy`, lockDetail(file, table, 'The INSERT … SELECT backfill')));
        return;
    }
    if (/^UPDATE\b/i.test(stmt) || (/^WITH\b/i.test(stmt) && /\bUPDATE\s+/i.test(stmt))) {
        const m = stmt.match(new RegExp(`\\bUPDATE\\s+(?:ONLY\\s+)?${NAME}`, 'i'));
        const table = m ? ident(m[1]) : 'a table';
        if (isNew(table)) return;
        out.push(finding(file, 'update', `UPDATE ${table} rewrites live rows`, lockDetail(file, table, 'The UPDATE')));
        return;
    }
    if (/^DELETE\s+FROM\b/i.test(stmt) || (/^WITH\b/i.test(stmt) && /\bDELETE\s+FROM\b/i.test(stmt))) {
        const m = stmt.match(new RegExp(`\\bDELETE\\s+FROM\\s+(?:ONLY\\s+)?${NAME}`, 'i'));
        const table = m ? ident(m[1]) : 'a table';
        if (isNew(table)) return;
        out.push(finding(file, 'delete', `DELETE FROM ${table} locks live rows`, lockDetail(file, table, 'The DELETE')));
        return;
    }
    if (/^TRUNCATE\b/i.test(stmt)) {
        const m = stmt.match(new RegExp(`^TRUNCATE\\s+(?:TABLE\\s+)?(?:ONLY\\s+)?${NAME}`, 'i'));
        const table = m ? ident(m[1]) : 'a table';
        if (isNew(table)) return;
        out.push(finding(file, 'truncate', `TRUNCATE ${table} takes an exclusive lock`, lockDetail(file, table, 'The TRUNCATE')));
        return;
    }
    if (/^COPY\s+/i.test(stmt)) {
        const m = stmt.match(new RegExp(`^COPY\\s+${NAME}`, 'i'));
        const table = m ? ident(m[1]) : '';
        if (table && !isNew(table) && /\bFROM\b/i.test(stmt)) out.push(finding(file, 'copy', `COPY into ${table} during the deploy`, lockDetail(file, table, 'The COPY')));
    }
}

/** Inside DO blocks statements arrive as "BEGIN ALTER …" or "IF … THEN ALTER …": drop that control-flow prefix. */
function unwrapPlpgsql(stmt: string): string {
    let s = stmt.trim();
    for (let i = 0; i < 5; i++) {
        const next = s
            .replace(/^(BEGIN|DECLARE[\s\S]*?\bBEGIN|ELSE|LOOP)\b\s*/i, '')
            .replace(/^(ELS)?IF\b[\s\S]*?\bTHEN\s+/i, '')
            .replace(/^EXECUTE\s+'([\s\S]*)'$/i, (_m, inner: string) => inner.replace(/''/g, "'"))
            .trim();
        if (next === s) break;
        s = next;
    }
    return s;
}

function walkSql(file: string, sql: string, created: Set<string>, out: StopUserFinding[], depth: number): void {
    for (const stmt of splitSqlStatements(sql)) {
        if (out.length >= MAX_FINDINGS) return;
        const s = depth > 0 ? unwrapPlpgsql(stmt) : stmt;
        if (s) classifyStatement(file, s, created, out, depth);
    }
}

function dedupe(list: StopUserFinding[]): StopUserFinding[] {
    const seen = new Set<string>();
    return list.filter((f) => {
        const k = `${f.file}\n${f.summary}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/** Findings for one new migration file. Empty = it can run while people keep working. */
export function analyzeMigrationSql(file: string, sql: string): StopUserFinding[] {
    if (SAFE_MARKER.test(sql)) return [];
    const out: StopUserFinding[] = [];
    walkSql(file, sql, new Set(), out, 0);
    return dedupe(out);
}
