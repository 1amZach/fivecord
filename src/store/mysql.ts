import { cfx } from '../fivem';
import type { Ban, Entry, PlayerRecord, Seen, Store } from './types';

type Row = Record<string, any>;

export function query<T = Row[]>(sql: string, params: unknown[] = []): Promise<T> {
    return new Promise((resolve, reject) => {
        try {
            cfx().oxmysql.query(sql, params, (result: T) => resolve(result));
        } catch (err) {
            reject(err);
        }
    });
}

const json = (value: unknown): string[] => {
    try {
        const parsed = JSON.parse(String(value ?? '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const num = (v: unknown) => (v == null ? null : Number(v));

const toPlayer = (r: Row): PlayerRecord => ({
    license: r.license,
    name: r.name,
    discord: r.discord ?? undefined,
    identifiers: json(r.identifiers),
    tokens: json(r.tokens),
    firstSeen: Number(r.first_seen),
    lastSeen: Number(r.last_seen),
    playtime: Number(r.playtime),
});

const toBan = (r: Row): Ban => ({
    id: Number(r.id),
    license: r.license,
    name: r.name,
    identifiers: json(r.identifiers),
    tokens: json(r.tokens),
    reason: r.reason,
    staff: r.staff,
    created: Number(r.created),
    expires: num(r.expires),
    revokedBy: r.revoked_by ?? null,
    revokedAt: num(r.revoked_at),
});

const toEntry = (r: Row): Entry => ({
    id: Number(r.id),
    license: r.license,
    text: r.text,
    staff: r.staff,
    created: Number(r.created),
});

const table = { warning: 'fivecord_warnings', note: 'fivecord_notes' } as const;

export class MysqlStore implements Store {
    readonly kind = 'mysql';

    async init() {
        await query(`CREATE TABLE IF NOT EXISTS fivecord_players (
            license VARCHAR(64) NOT NULL PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            discord VARCHAR(24) NULL,
            identifiers TEXT NOT NULL,
            tokens TEXT NOT NULL,
            first_seen BIGINT NOT NULL,
            last_seen BIGINT NOT NULL,
            playtime BIGINT NOT NULL DEFAULT 0,
            INDEX (discord), INDEX (name)
        )`);
        await query(`CREATE TABLE IF NOT EXISTS fivecord_bans (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            license VARCHAR(64) NOT NULL,
            name VARCHAR(128) NOT NULL,
            identifiers TEXT NOT NULL,
            tokens TEXT NOT NULL,
            reason TEXT NOT NULL,
            staff VARCHAR(128) NOT NULL,
            created BIGINT NOT NULL,
            expires BIGINT NULL,
            revoked_by VARCHAR(128) NULL,
            revoked_at BIGINT NULL,
            INDEX (license)
        )`);
        for (const name of Object.values(table)) {
            await query(`CREATE TABLE IF NOT EXISTS ${name} (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                license VARCHAR(64) NOT NULL,
                text TEXT NOT NULL,
                staff VARCHAR(128) NOT NULL,
                created BIGINT NOT NULL,
                INDEX (license)
            )`);
        }
    }

    async seen(p: Seen, now: number) {
        await query(
            `INSERT INTO fivecord_players (license, name, discord, identifiers, tokens, first_seen, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name), discord = VALUES(discord),
                identifiers = VALUES(identifiers), tokens = VALUES(tokens), last_seen = VALUES(last_seen)`,
            [p.license, p.name, p.discord ?? null, JSON.stringify(p.identifiers), JSON.stringify(p.tokens), now, now],
        );
    }

    async addPlaytime(license: string, seconds: number) {
        await query('UPDATE fivecord_players SET playtime = playtime + ? WHERE license = ?', [seconds, license]);
    }

    async player(license: string) {
        const rows = await query('SELECT * FROM fivecord_players WHERE license = ?', [license]);
        return rows[0] ? toPlayer(rows[0]) : undefined;
    }

    async byDiscord(id: string) {
        const rows = await query('SELECT * FROM fivecord_players WHERE discord = ? ORDER BY last_seen DESC LIMIT 1', [id]);
        return rows[0] ? toPlayer(rows[0]) : undefined;
    }

    async search(q: string, limit: number) {
        const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
        const rows = await query(
            'SELECT * FROM fivecord_players WHERE name LIKE ? OR license = ? OR discord = ? ORDER BY last_seen DESC LIMIT ?',
            [like, q, q, limit],
        );
        return rows.map(toPlayer);
    }

    async top(limit: number) {
        const rows = await query('SELECT * FROM fivecord_players ORDER BY playtime DESC LIMIT ?', [limit]);
        return rows.map(toPlayer);
    }

    async bans() {
        return (await query('SELECT * FROM fivecord_bans')).map(toBan);
    }

    async addBan(b: Omit<Ban, 'id'>) {
        const result = await query<{ insertId: number }>(
            `INSERT INTO fivecord_bans (license, name, identifiers, tokens, reason, staff, created, expires)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [b.license, b.name, JSON.stringify(b.identifiers), JSON.stringify(b.tokens), b.reason, b.staff, b.created, b.expires],
        );
        return result.insertId;
    }

    async revokeBan(id: number, by: string, at: number) {
        await query('UPDATE fivecord_bans SET revoked_by = ?, revoked_at = ? WHERE id = ?', [by, at, id]);
    }

    async entries(kind: 'warning' | 'note', license: string) {
        const rows = await query(`SELECT * FROM ${table[kind]} WHERE license = ? ORDER BY created DESC`, [license]);
        return rows.map(toEntry);
    }

    async addEntry(kind: 'warning' | 'note', e: Omit<Entry, 'id'>) {
        const result = await query<{ insertId: number }>(
            `INSERT INTO ${table[kind]} (license, text, staff, created) VALUES (?, ?, ?, ?)`,
            [e.license, e.text, e.staff, e.created],
        );
        return result.insertId;
    }

    async removeEntry(kind: 'warning' | 'note', id: number) {
        const rows = await query(`SELECT * FROM ${table[kind]} WHERE id = ?`, [id]);
        if (!rows[0]) return undefined;
        await query(`DELETE FROM ${table[kind]} WHERE id = ?`, [id]);
        return toEntry(rows[0]);
    }
}
