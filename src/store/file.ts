// For servers without oxmysql. Everything lives in one JSON file inside the
// resource, written a second after the last change.

import type { Ban, Entry, PlayerRecord, Seen, Store } from './types';

interface Data {
    players: Record<string, PlayerRecord>;
    bans: Ban[];
    warning: Entry[];
    note: Entry[];
    ids: { ban: number; warning: number; note: number };
}

const empty = (): Data => ({ players: {}, bans: [], warning: [], note: [], ids: { ban: 0, warning: 0, note: 0 } });

export class FileStore implements Store {
    readonly kind = 'file';
    private data = empty();
    private timer?: NodeJS.Timeout;

    constructor(
        private read: () => string | null,
        private write: (text: string) => void,
        private keep: (text: string) => void = () => {},
    ) {}

    async init() {
        const text = this.read();
        if (!text) return;
        try {
            this.data = { ...empty(), ...JSON.parse(text) };
        } catch {
            console.error('fivecord: data.json is broken, starting fresh. The old file was saved as data.broken.json');
            this.keep(text);
        }
    }

    private save() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), 1000);
    }

    flush() {
        clearTimeout(this.timer);
        this.write(JSON.stringify(this.data));
    }

    async seen(p: Seen, now: number) {
        const old = this.data.players[p.license];
        this.data.players[p.license] = {
            ...p,
            firstSeen: old?.firstSeen ?? now,
            lastSeen: now,
            playtime: old?.playtime ?? 0,
        };
        this.save();
    }

    async addPlaytime(license: string, seconds: number) {
        const p = this.data.players[license];
        if (!p) return;
        p.playtime += seconds;
        this.save();
    }

    async player(license: string) {
        return this.data.players[license];
    }

    async byDiscord(id: string) {
        return Object.values(this.data.players)
            .filter((p) => p.discord === id)
            .sort((a, b) => b.lastSeen - a.lastSeen)[0];
    }

    async search(q: string, limit: number) {
        const needle = q.toLowerCase();
        return Object.values(this.data.players)
            .filter((p) => p.name.toLowerCase().includes(needle) || p.license === q || p.discord === q)
            .sort((a, b) => b.lastSeen - a.lastSeen)
            .slice(0, limit);
    }

    async top(limit: number) {
        return Object.values(this.data.players)
            .sort((a, b) => b.playtime - a.playtime)
            .slice(0, limit);
    }

    async bans() {
        return this.data.bans.map((b) => ({ ...b }));
    }

    async addBan(ban: Omit<Ban, 'id'>) {
        const id = ++this.data.ids.ban;
        this.data.bans.push({ ...ban, id });
        this.save();
        return id;
    }

    async revokeBan(id: number, by: string, at: number) {
        const ban = this.data.bans.find((b) => b.id === id);
        if (!ban) return;
        ban.revokedBy = by;
        ban.revokedAt = at;
        this.save();
    }

    async entries(kind: 'warning' | 'note', license: string) {
        return this.data[kind].filter((e) => e.license === license).sort((a, b) => b.created - a.created);
    }

    async addEntry(kind: 'warning' | 'note', entry: Omit<Entry, 'id'>) {
        const id = ++this.data.ids[kind];
        this.data[kind].push({ ...entry, id });
        this.save();
        return id;
    }

    async removeEntry(kind: 'warning' | 'note', id: number) {
        const index = this.data[kind].findIndex((e) => e.id === id);
        if (index < 0) return undefined;
        const [removed] = this.data[kind].splice(index, 1);
        this.save();
        return removed;
    }
}
