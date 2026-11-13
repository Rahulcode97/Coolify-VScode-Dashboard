import { describe, expect, it } from 'vitest';
import { analyzeMigrationSql, globToRegExp, matchesAny, ruleFindings, splitSqlStatements } from '../src/deployRisk';

const ids = (sql: string) => analyzeMigrationSql('db/migrations/002.sql', sql).map((f) => f.id);

describe('SQL migration checker', () => {
    it('flags changes that break or lock the running app', () => {
        expect(ids('ALTER TABLE users DROP COLUMN legacy_name;')).toEqual(['drop-column']);
        expect(ids('ALTER TABLE users RENAME COLUMN a TO b;')).toEqual(['rename']);
        expect(ids('ALTER TABLE users ADD COLUMN plan text NOT NULL;')).toEqual(['add-not-null']);
        expect(ids('ALTER TABLE users ADD COLUMN created timestamptz DEFAULT now();')).toEqual(['volatile-default']);
        expect(ids('ALTER TABLE orders ALTER COLUMN total TYPE numeric(12,2);')).toEqual(['alter-type']);
        expect(ids('ALTER TABLE orders ALTER COLUMN total SET NOT NULL;')).toEqual(['set-not-null']);
        expect(ids('ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (u) REFERENCES users(id);')).toEqual(['add-constraint']);
        expect(ids('CREATE INDEX idx_orders_user ON orders (user_id);')).toEqual(['create-index']);
        expect(ids('DROP TABLE sessions;')).toEqual(['drop-table']);
        expect(ids('UPDATE users SET plan = \'free\';')).toEqual(['update']);
        expect(ids('TRUNCATE audit_log;')).toEqual(['truncate']);
        expect(ids("ALTER TYPE status RENAME VALUE 'old' TO 'new';")).toEqual(['enum-rename']);
        expect(ids('INSERT INTO totals SELECT user_id, sum(x) FROM orders GROUP BY 1;')).toEqual(['insert-backfill']);
    });

    it('lets safe migrations through', () => {
        expect(ids('ALTER TABLE users ADD COLUMN nickname text;')).toEqual([]);
        expect(ids("ALTER TABLE users ADD COLUMN plan text NOT NULL DEFAULT 'free';")).toEqual([]);
        expect(ids('CREATE INDEX CONCURRENTLY idx ON orders (user_id);')).toEqual([]);
        expect(ids('ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (u) REFERENCES users(id) NOT VALID;')).toEqual([]);
        expect(ids("INSERT INTO settings (k, v) VALUES ('a', 'b');")).toEqual([]);
        expect(ids('CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN DELETE FROM x; END $$ LANGUAGE plpgsql;')).toEqual([]);
    });

    it('treats tables created in the same file as new', () => {
        expect(ids('CREATE TABLE invoices (id int); CREATE INDEX i ON invoices (id); ALTER TABLE invoices DROP COLUMN id;')).toEqual([]);
    });

    it('looks inside DO blocks and ignores comments and strings', () => {
        expect(ids("DO $$ BEGIN ALTER TABLE users DROP COLUMN old; END $$;")).toEqual(['drop-column']);
        expect(ids("-- DROP TABLE users;\n/* TRUNCATE users; */ SELECT 'DROP TABLE x;';")).toEqual([]);
    });

    it('can be silenced with -- coolify:safe', () => {
        expect(ids('-- coolify:safe (tiny table, done at night)\nALTER TABLE flags DROP COLUMN x;')).toEqual([]);
    });

    it('splits statements without breaking dollar quotes', () => {
        expect(splitSqlStatements("SELECT 1; DO $x$ BEGIN PERFORM 1; END $x$; SELECT ';';")).toHaveLength(3);
    });
});

describe('globs and rules', () => {
    it('matches like gitignore-style globs', () => {
        expect(globToRegExp('**/migrations/**/*.sql').test('api/db/migrations/2026/001.sql')).toBe(true);
        expect(globToRegExp('**/migrations/**/*.sql').test('migrations/001.sql')).toBe(true);
        expect(globToRegExp('supabase/migrations/*.sql').test('supabase/migrations/x/1.sql')).toBe(false);
        expect(matchesAny('deploy/docker-compose.yml', ['docker-compose.yml'])).toBe(true);
        expect(matchesAny('src/a.ts', ['*.sql'])).toBe(false);
    });
    it('turns matching files into findings with the user reason', () => {
        const f = ruleFindings(['web/index.html', 'docker-compose.yml'], [{ pattern: 'docker-compose.yml', reason: 'recreates all containers' }]);
        expect(f).toHaveLength(1);
        expect(f[0].summary).toBe('recreates all containers');
        expect(f[0].file).toBe('docker-compose.yml');
    });
});
